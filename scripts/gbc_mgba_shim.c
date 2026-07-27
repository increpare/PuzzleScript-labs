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
#define PSGBC_MAX_FRAME_TRACE 2048

/* Bumped whenever the exported signatures change so the Python side can refuse
 * a stale cached build. */
#define PSGBC_ABI_VERSION 6

unsigned psgbc_abi_version(void) {
	return PSGBC_ABI_VERSION;
}

/* mGBA's stock logger prints every unusable-memory access to stdout, which for
 * this ROM means megabytes of noise. Swallow it (set PSGBC_MGBA_LOG=1 to see
 * it again) but keep a count so the harness can report emulator complaints. */
static unsigned long sLogCount = 0;
static bool sLogPassthrough = false;
static unsigned sLastLcdc = 0;
static unsigned sLastTilemapNonzero = 0;
static uint16_t sLastBgPalette[32];
static uint8_t sLastVram[2][0x2000];
static unsigned sFrameTraceCount = 0;
static uint8_t sFrameLcdc[PSGBC_MAX_FRAME_TRACE];
static uint8_t sFrameHeaderPalette[PSGBC_MAX_FRAME_TRACE];
static uint32_t sFrameBackgroundHash[PSGBC_MAX_FRAME_TRACE];

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

unsigned psgbc_last_lcdc(void) {
	return sLastLcdc;
}

unsigned psgbc_last_tilemap_nonzero(void) {
	return sLastTilemapNonzero;
}

unsigned psgbc_last_bg_color(unsigned index) {
	if (index >= 32) {
		return 0;
	}
	return sLastBgPalette[index];
}

unsigned psgbc_last_vram_byte(unsigned bank, unsigned index) {
	if (bank >= 2 || index >= 0x2000) {
		return 0;
	}
	return sLastVram[bank][index];
}

unsigned psgbc_frame_trace_count(void) {
	return sFrameTraceCount;
}

unsigned psgbc_frame_lcdc(unsigned frame) {
	return frame < sFrameTraceCount ? sFrameLcdc[frame] : 0;
}

unsigned psgbc_frame_header_palette(unsigned frame) {
	return frame < sFrameTraceCount ? sFrameHeaderPalette[frame] : 0;
}

uint32_t psgbc_frame_background_hash(unsigned frame) {
	return frame < sFrameTraceCount ? sFrameBackgroundHash[frame] : 0;
}

static uint8_t psgbcHeaderPalette(struct mCore* core) {
	unsigned old_vbk = core->busRead8(core, 0xFF4F) & 1U;
	unsigned lcdc = core->busRead8(core, 0xFF40);
	unsigned tilemap = (lcdc & 0x08U) ? 0x9C00U : 0x9800U;
	core->busWrite8(core, 0xFF4F, 1);
	uint8_t palette = core->busRead8(core, tilemap) & 0x07U;
	core->busWrite8(core, 0xFF4F, old_vbk);
	return palette;
}

static uint32_t psgbcBackgroundHash(struct mCore* core) {
	uint32_t hash = 2166136261U;
	unsigned old_vbk = core->busRead8(core, 0xFF4F) & 1U;
	unsigned old_bcps = core->busRead8(core, 0xFF68);
	unsigned lcdc = core->busRead8(core, 0xFF40);
	unsigned tilemap = (lcdc & 0x08U) ? 0x9C00U : 0x9800U;
	hash ^= lcdc & 0x19U;
	hash *= 16777619U;
	hash ^= core->busRead8(core, 0xFF42);
	hash *= 16777619U;
	hash ^= core->busRead8(core, 0xFF43);
	hash *= 16777619U;
	for (unsigned row = 0; row < 18; ++row) {
		for (unsigned column = 0; column < 20; ++column) {
			unsigned map_address = tilemap + row * 32U + column;
			core->busWrite8(core, 0xFF4F, 0);
			uint8_t tile = core->busRead8(core, map_address);
			core->busWrite8(core, 0xFF4F, 1);
			uint8_t attributes = core->busRead8(core, map_address);
			unsigned tile_address = (lcdc & 0x10U)
				? 0x8000U + (unsigned) tile * 16U
				: 0x9000U + (int8_t) tile * 16;
			hash ^= tile;
			hash *= 16777619U;
			hash ^= attributes;
			hash *= 16777619U;
			core->busWrite8(
				core, 0xFF4F, (attributes & 0x08U) ? 1 : 0);
			for (unsigned byte = 0; byte < 16; ++byte) {
				uint8_t value =
					core->busRead8(core, tile_address + byte);
				hash ^= value;
				hash *= 16777619U;
			}
		}
	}
	core->busWrite8(core, 0xFF4F, old_vbk);
	for (unsigned index = 0; index < 64; ++index) {
		core->busWrite8(core, 0xFF68, index);
		uint8_t value = core->busRead8(core, 0xFF69);
		hash ^= value;
		hash *= 16777619U;
	}
	core->busWrite8(core, 0xFF68, old_bcps);
	return hash;
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
static int psgbcRun(const char* rom_path,
                    const char* save_path,
                    unsigned frames,
                    unsigned char* sram_out,
                    unsigned sram_capacity,
                    unsigned* sram_size_out,
                    unsigned* frames_run_out,
                    unsigned char* video_out,
                    unsigned video_capacity,
                    unsigned* pc_out,
                    unsigned* sp_out,
                    const uint32_t* frame_keys,
                    unsigned frame_key_count) {
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
	sFrameTraceCount = 0;
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
		core->setKeys(
			core,
			frame_keys && frame < frame_key_count ? frame_keys[frame] : 0);
		core->runFrame(core);
		if (sFrameTraceCount < PSGBC_MAX_FRAME_TRACE) {
			sFrameLcdc[sFrameTraceCount] =
				(uint8_t) core->busRead8(core, 0xFF40);
			sFrameHeaderPalette[sFrameTraceCount] =
				psgbcHeaderPalette(core);
			sFrameBackgroundHash[sFrameTraceCount] =
				psgbcBackgroundHash(core);
			++sFrameTraceCount;
		}
	}
	if (frames_run_out) {
		*frames_run_out = core->frameCounter(core);
	}
	sLastLcdc = core->busRead8(core, 0xFF40);
	sLastTilemapNonzero = 0;
	for (unsigned row = 0; row < PSGBC_SCREEN_HEIGHT / 8; ++row) {
		for (unsigned column = 0; column < PSGBC_SCREEN_WIDTH / 8; ++column) {
			if (core->busRead8(
					core, 0x9800 + row * 32 + column) != 0) {
				++sLastTilemapNonzero;
			}
		}
	}
	for (unsigned color = 0; color < 32; ++color) {
		core->busWrite8(core, 0xFF68, color * 2);
		uint16_t low = core->busRead8(core, 0xFF69);
		core->busWrite8(core, 0xFF68, color * 2 + 1);
		sLastBgPalette[color] =
			(uint16_t) (low | (core->busRead8(core, 0xFF69) << 8));
	}
	for (unsigned bank = 0; bank < 2; ++bank) {
		core->busWrite8(core, 0xFF4F, bank);
		for (unsigned index = 0; index < 0x2000; ++index) {
			sLastVram[bank][index] =
				core->busRead8(core, 0x8000 + index);
		}
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
		const void* pixels = NULL;
		size_t stride = 0;
		core->getPixels(core, &pixels, &stride);
		size_t video_size = (size_t) width * height * sizeof(color_t);
		if (video_size <= video_capacity) {
			if (pixels && stride >= width) {
				for (unsigned row = 0; row < height; ++row) {
					memcpy(
						video_out
							+ (size_t) row * width * sizeof(color_t),
						(const color_t*) pixels + (size_t) row * stride,
						(size_t) width * sizeof(color_t));
				}
			} else {
				memcpy(video_out, frame_buffer, video_size);
			}
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
	return psgbcRun(
		rom_path, save_path, frames, sram_out, sram_capacity,
		sram_size_out, frames_run_out, video_out, video_capacity,
		pc_out, sp_out, NULL, 0);
}

int psgbc_run_with_keys(const char* rom_path,
                        const char* save_path,
                        unsigned frames,
                        unsigned char* sram_out,
                        unsigned sram_capacity,
                        unsigned* sram_size_out,
                        unsigned* frames_run_out,
                        unsigned char* video_out,
                        unsigned video_capacity,
                        unsigned* pc_out,
                        unsigned* sp_out,
                        const uint32_t* frame_keys,
                        unsigned frame_key_count) {
	return psgbcRun(
		rom_path, save_path, frames, sram_out, sram_capacity,
		sram_size_out, frames_run_out, video_out, video_capacity,
		pc_out, sp_out, frame_keys, frame_key_count);
}
