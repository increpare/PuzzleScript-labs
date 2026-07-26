/* Headless libmgba driver for scripts/run_gbc_smoke.py.
 *
 * The macOS Homebrew mGBA distribution ships only the Qt/Cocoa frontend, which
 * refuses to advance its CPU core while the process lacks window focus. That
 * makes the subprocess-based smoke gate blind: a healthy ROM and a hung ROM
 * both produce an empty save file. This shim drives libmgba's mCore directly so
 * the gate needs no window, no focus and no subprocess.
 *
 * It is compiled on demand by run_gbc_smoke.py against the *installed* mGBA
 * headers, so every struct offset inside `struct mCore` is computed by the C
 * compiler from the same flags.h that built the shared library. Nothing here
 * hard-codes an ABI layout.
 *
 * Build (performed automatically by the Python harness):
 *   cc -O2 -fPIC -shared -I<prefix>/include scripts/gbc_mgba_shim.c \
 *      -L<prefix>/lib -lmgba -Wl,-rpath,<prefix>/lib -o libpsgbcshim.<ext>
 */

#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba-util/vfs.h>

#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PSGBC_OK 0
#define PSGBC_ERR_NO_CORE 1
#define PSGBC_ERR_INIT 2
#define PSGBC_ERR_LOAD_ROM 3
#define PSGBC_ERR_LOAD_SAVE 4
#define PSGBC_ERR_SRAM_TOO_LARGE 5
#define PSGBC_ERR_NO_SRAM 6
#define PSGBC_ERR_NOT_GB 7

#define PSGBC_SCREEN_WIDTH 160
#define PSGBC_SCREEN_HEIGHT 144

/* Bumped whenever the exported signatures change so the Python side can refuse
 * a stale cached build. */
#define PSGBC_ABI_VERSION 2

unsigned psgbc_abi_version(void) {
	return PSGBC_ABI_VERSION;
}

/* mGBA's stock logger prints every unusable-memory access to stdout, which for
 * this ROM means megabytes of noise. Swallow it (set PSGBC_MGBA_LOG=1 to see
 * it again) but keep a count so the harness can report emulator complaints. */
static unsigned long sLogCount = 0;
static bool sLogPassthrough = false;

static void psgbcLog(struct mLogger* logger, int category, enum mLogLevel level,
                     const char* format, va_list args) {
	(void) logger;
	++sLogCount;
	if (!sLogPassthrough) {
		return;
	}
	fprintf(stderr, "[mgba %s/%i] ", mLogCategoryName(category), level);
	vfprintf(stderr, format, args);
	fputc('\n', stderr);
}

static struct mLogger sLogger = { .log = psgbcLog, .filter = NULL };

unsigned long psgbc_log_count(void) {
	return sLogCount;
}

/* Boot `rom_path` for `frames` frames and hand back the cartridge SRAM.
 *
 * `save_path` is opened as the cartridge's backing save file through
 * mCoreLoadSaveFile -- the exact call an mGBA frontend reaches via
 * mCoreAutoloadSave -- so the file left behind IS a `.sav`, written by mGBA's
 * own savedata code. `sram_out` additionally receives mCore::savedataClone's
 * copy when the core implements it, as a cross-check.
 *
 * `video_out` (optional) receives the final 160x144 frame as native color_t
 * pixels; it exists so callers can prove the PPU -- and therefore the CPU --
 * actually ran.
 *
 * `pc_out`/`sp_out` (optional) report the SM83 program counter and stack
 * pointer at the end of the run. A ROM parked in a legitimate idle loop, a ROM
 * spinning on an error screen and a ROM that has crashed into RST 38 look
 * identical from SRAM alone; these make the difference legible.
 */
int psgbc_run(const char* rom_path,
              const char* save_path,
              unsigned frames,
              unsigned char* sram_out,
              unsigned sram_capacity,
              unsigned* sram_size_out,
              unsigned* frames_run_out,
              unsigned char* video_out,
              unsigned video_capacity,
              unsigned* pc_out,
              unsigned* sp_out) {
	if (sram_size_out) {
		*sram_size_out = 0;
	}
	if (frames_run_out) {
		*frames_run_out = 0;
	}
	if (pc_out) {
		*pc_out = 0xFFFF;
	}
	if (sp_out) {
		*sp_out = 0xFFFF;
	}

	const char* passthrough = getenv("PSGBC_MGBA_LOG");
	sLogPassthrough = passthrough && passthrough[0] && passthrough[0] != '0';
	sLogCount = 0;
	mLogSetDefaultLogger(&sLogger);

	struct mCore* core = mCoreFind(rom_path);
	if (!core) {
		return PSGBC_ERR_NO_CORE;
	}
	if (!core->init(core)) {
		core->deinit(core);
		return PSGBC_ERR_INIT;
	}

	mCoreInitConfig(core, NULL);

	unsigned width = 0;
	unsigned height = 0;
	core->desiredVideoDimensions(core, &width, &height);
	if (!width || !height) {
		width = PSGBC_SCREEN_WIDTH;
		height = PSGBC_SCREEN_HEIGHT;
	}
	color_t* frame_buffer = calloc((size_t) width * height, sizeof(color_t));
	if (!frame_buffer) {
		mCoreConfigDeinit(&core->config);
		core->deinit(core);
		return PSGBC_ERR_INIT;
	}
	core->setVideoBuffer(core, frame_buffer, width);
	core->setAudioBufferSize(core, 2048);

	if (!mCoreLoadFile(core, rom_path)) {
		free(frame_buffer);
		mCoreConfigDeinit(&core->config);
		core->deinit(core);
		return PSGBC_ERR_LOAD_ROM;
	}
	if (core->platform(core) != mPLATFORM_GB) {
		core->unloadROM(core);
		free(frame_buffer);
		mCoreConfigDeinit(&core->config);
		core->deinit(core);
		return PSGBC_ERR_NOT_GB;
	}
	if (save_path && save_path[0]) {
		if (!mCoreLoadSaveFile(core, save_path, false)) {
			core->unloadROM(core);
			free(frame_buffer);
			mCoreConfigDeinit(&core->config);
			core->deinit(core);
			return PSGBC_ERR_LOAD_SAVE;
		}
	}

	core->reset(core);
	for (unsigned frame = 0; frame < frames; ++frame) {
		core->runFrame(core);
	}
	if (frames_run_out) {
		*frames_run_out = core->frameCounter(core);
	}

	int status = PSGBC_OK;
	void* sram = NULL;
	/* Best effort: mGBA 0.10's GB core leaves savedataClone unimplemented and
	 * returns 0. The save file written through mCoreLoadSaveFile is the
	 * authoritative copy; the clone, when present, is a cross-check. */
	size_t sram_size = core->savedataClone(core, &sram);
	if (!sram || !sram_size) {
		if (!save_path || !save_path[0]) {
			status = PSGBC_ERR_NO_SRAM;
		}
	} else if (sram_size > sram_capacity) {
		status = PSGBC_ERR_SRAM_TOO_LARGE;
		if (sram_size_out) {
			*sram_size_out = (unsigned) sram_size;
		}
	} else {
		memcpy(sram_out, sram, sram_size);
		if (sram_size_out) {
			*sram_size_out = (unsigned) sram_size;
		}
	}
	if (sram) {
		free(sram);
	}

	if (video_out) {
		size_t video_size = (size_t) width * height * sizeof(color_t);
		if (video_size <= video_capacity) {
			memcpy(video_out, frame_buffer, video_size);
		}
	}

	if (pc_out || sp_out) {
		int32_t pc = -1;
		int32_t sp = -1;
		if (pc_out && core->readRegister(core, "pc", &pc)) {
			*pc_out = (unsigned) (pc & 0xFFFF);
		}
		if (sp_out && core->readRegister(core, "sp", &sp)) {
			*sp_out = (unsigned) (sp & 0xFFFF);
		}
	}

	/* unloadROM flushes the memory-mapped save file to disk. */
	core->unloadROM(core);
	free(frame_buffer);
	mCoreConfigDeinit(&core->config);
	core->deinit(core);
	return status;
}
