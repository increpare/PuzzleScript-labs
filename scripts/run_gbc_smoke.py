#!/usr/bin/env python3
"""Boot an instrumented CGB ROM in mGBA and validate its SRAM result."""

from __future__ import annotations

import argparse
import ctypes
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import sysconfig
import tempfile
import time


MAGIC = 0x54434250
RENDER_MAGIC = 0x52434250
AUDIO_MAGIC = 0x41434250
FRAME_DUMP_MAGIC = 0x46474250
VERSION = 1
RECORD = struct.Struct("<IHBBBBBBI")
RENDER_RECORD = struct.Struct("<I21H")
AUDIO_RECORD = struct.Struct("<IHBBHI7B")
SRAM_BANK_SIZE = 8 * 1024
SRAM_BANK = 3
RENDER_OFFSET = 16
AUDIO_OFFSET = 128
FRAME_DUMP_BANK = 2
TITLE_FRAME_DUMP_BANK = 0
MESSAGE_FRAME_DUMP_BANK = 1
FRAME_DUMP_HEADER = struct.Struct("<IHH")
SCREEN_TILES = 20 * 18
FRAME_HORIZONTAL_TILE = 38
FRAME_VERTICAL_TILE = 39

SRAM_BANK_COUNT = 4
SRAM_SIZE = SRAM_BANK_COUNT * SRAM_BANK_SIZE
SHIM_SOURCE = Path(__file__).resolve().with_name("gbc_mgba_shim.c")
SHIM_ABI_VERSION = 2
# 60 s of emulated time. The instrumented ROM never self-terminates -- it spins
# on vsync once it has published its result -- so this is a budget, not a
# deadline: a ROM that has crashed or hung writes nothing however long it runs,
# and every SRAM assertion below still has to hold.
DEFAULT_FRAME_BUDGET = 3600
MGBA_PREFIX_CANDIDATES = (
    "/opt/homebrew/opt/mgba",
    "/usr/local/opt/mgba",
    "/opt/homebrew",
    "/usr/local",
    "/usr",
)


def coordinate(value: str) -> tuple[int, int]:
    try:
        x_text, y_text = value.split(",", 1)
        return int(x_text), int(y_text)
    except ValueError as error:
        raise argparse.ArgumentTypeError("coordinate must be X,Y") from error


def integer(value: str) -> int:
    try:
        return int(value, 0)
    except ValueError as error:
        raise argparse.ArgumentTypeError("value must be an integer") from error


def default_mgba() -> Path | None:
    executable = shutil.which("mgba-sdl") or shutil.which("mgba-sdl.exe")
    if executable:
        return Path(executable)
    mac_app = Path("/Applications/mGBA.app/Contents/MacOS/mGBA")
    if mac_app.is_file():
        return mac_app
    candidate = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "mGBA" / "mgba-sdl.exe"
    return candidate if candidate.is_file() else None


def shared_library_suffix() -> str:
    if sys.platform == "darwin":
        return ".dylib"
    if os.name == "nt":
        return ".dll"
    return ".so"


def libmgba_names() -> tuple[str, ...]:
    if sys.platform == "darwin":
        return ("libmgba.dylib",)
    if os.name == "nt":
        return ("mgba.dll",)
    return ("libmgba.so",)


def find_libmgba_prefix(explicit: Path | None) -> tuple[Path | None, str]:
    """Locate an mGBA installation that has both headers and a shared library.

    Returns the prefix plus a human-readable explanation of what was missing
    when nothing usable was found.
    """
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit)
    else:
        environment = os.environ.get("MGBA_PREFIX")
        if environment:
            candidates.append(Path(environment))
        candidates.extend(Path(name) for name in MGBA_PREFIX_CANDIDATES)
    problems: list[str] = []
    for prefix in candidates:
        header = prefix / "include" / "mgba" / "core" / "core.h"
        library = next(
            (
                prefix / "lib" / name
                for name in libmgba_names()
                if (prefix / "lib" / name).is_file()
            ),
            None,
        )
        if header.is_file() and library is not None:
            return prefix, ""
        if header.is_file() or library is not None:
            problems.append(
                f"{prefix}: "
                + ("headers present" if header.is_file() else "headers missing")
                + ", "
                + ("library present" if library is not None else "library missing")
            )
    if not problems:
        problems.append(
            "searched " + ", ".join(str(path) for path in candidates)
        )
    return None, "; ".join(problems)


def build_libmgba_shim(prefix: Path, cache: Path) -> Path:
    """Compile scripts/gbc_mgba_shim.c against the installed mGBA headers.

    Compiling rather than hand-rolling ctypes structs is deliberate: `struct
    mCore` is a wall of function pointers whose offsets depend on the flags the
    library was built with, and a wrong offset produces plausible garbage rather
    than a crash. Letting the C compiler read the installed flags.h removes the
    guesswork entirely.
    """
    if not SHIM_SOURCE.is_file():
        raise SystemExit(f"libmgba shim source is missing: {SHIM_SOURCE}")
    cache.mkdir(parents=True, exist_ok=True)
    library = cache / f"libpsgbcshim{shared_library_suffix()}"
    stamp = cache / "libpsgbcshim.stamp"
    compiler = os.environ.get("CC") or sysconfig.get_config_var("CC") or "cc"
    compiler = compiler.split()[0]
    signature = "\n".join(
        (
            str(prefix),
            compiler,
            str(SHIM_ABI_VERSION),
            str(SHIM_SOURCE.stat().st_mtime_ns),
            str(SHIM_SOURCE.stat().st_size),
        )
    )
    if (
        library.is_file()
        and stamp.is_file()
        and stamp.read_text(encoding="utf-8") == signature
    ):
        return library
    command = [
        compiler,
        "-O2",
        "-fPIC",
        "-shared",
        "-std=gnu11",
        f"-I{prefix / 'include'}",
        str(SHIM_SOURCE),
        f"-L{prefix / 'lib'}",
        "-lmgba",
        f"-Wl,-rpath,{prefix / 'lib'}",
        "-o",
        str(library),
    ]
    completed = subprocess.run(
        command, capture_output=True, text=True, check=False
    )
    if completed.returncode != 0 or not library.is_file():
        raise SystemExit(
            "failed to build the libmgba shim:\n"
            + " ".join(command)
            + "\n"
            + completed.stdout
            + completed.stderr
        )
    stamp.write_text(signature, encoding="utf-8")
    return library


def load_libmgba_shim(prefix: Path, cache: Path) -> ctypes.CDLL:
    library = build_libmgba_shim(prefix, cache)
    handle = ctypes.CDLL(str(library))
    handle.psgbc_abi_version.restype = ctypes.c_uint
    version = handle.psgbc_abi_version()
    if version != SHIM_ABI_VERSION:
        raise SystemExit(
            f"libmgba shim ABI mismatch: built {version}, expected "
            f"{SHIM_ABI_VERSION} ({library})"
        )
    handle.psgbc_log_count.restype = ctypes.c_ulong
    handle.psgbc_run.restype = ctypes.c_int
    handle.psgbc_run.argtypes = [
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.c_uint,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_uint,
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_uint,
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_uint),
    ]
    return handle


SHIM_ERRORS = {
    1: "mGBA did not recognise the file as a supported ROM",
    2: "mCore initialisation failed",
    3: "mGBA failed to load the ROM",
    4: "mGBA failed to open the save file",
    5: "cartridge SRAM is larger than the harness buffer",
    6: "the core exposed no cartridge SRAM",
    7: "the ROM is not a Game Boy / Game Boy Color image",
}


def read_sram_libmgba(
    rom: Path, prefix: Path, cache: Path, frames: int
) -> tuple[bytes, str]:
    """Run the ROM inside this process and return the cartridge SRAM."""
    handle = load_libmgba_shim(prefix, cache)
    with tempfile.TemporaryDirectory(prefix="puzzlescript-gbc-smoke-") as name:
        temp = Path(name)
        local_rom = temp / "smoke.gb"
        save = temp / "smoke.sav"
        shutil.copy2(rom, local_rom)
        capacity = 1 << 20
        buffer = (ctypes.c_ubyte * capacity)()
        sram_size = ctypes.c_uint(0)
        frames_run = ctypes.c_uint(0)
        program_counter = ctypes.c_uint(0)
        stack_pointer = ctypes.c_uint(0)
        started = time.monotonic()
        status = handle.psgbc_run(
            str(local_rom).encode(),
            str(save).encode(),
            frames,
            buffer,
            capacity,
            ctypes.byref(sram_size),
            ctypes.byref(frames_run),
            None,
            0,
            ctypes.byref(program_counter),
            ctypes.byref(stack_pointer),
        )
        elapsed = time.monotonic() - started
        if status != 0:
            raise SystemExit(
                "libmgba backend failed: "
                + SHIM_ERRORS.get(status, f"unknown status {status}")
            )
        if not save.is_file():
            raise SystemExit("libmgba did not write cartridge SRAM")
        data = save.read_bytes()
        if len(data) != SRAM_SIZE:
            raise SystemExit(
                "libmgba produced the wrong amount of cartridge SRAM: "
                f"{len(data)} bytes, expected {SRAM_SIZE} "
                f"({SRAM_BANK_COUNT} banks of {SRAM_BANK_SIZE})"
            )
        # savedataClone is unimplemented in mGBA 0.10's GB core (it returns 0);
        # when a core does implement it, insist the two agree.
        clone = bytes(buffer[: sram_size.value])
        if clone and clone != data:
            raise SystemExit(
                "libmgba savedataClone disagrees with the flushed save file: "
                f"clone={len(clone)} file={len(data)}"
            )
        summary = (
            f"backend=libmgba prefix={prefix} frames={frames_run.value} "
            f"sram={len(data)} pc=0x{program_counter.value:04x} "
            f"sp=0x{stack_pointer.value:04x} "
            f"emulator_warnings={handle.psgbc_log_count()} "
            f"wall={elapsed:.2f}s"
        )
        return data, summary


def read_sram_subprocess(emulator: Path, rom: Path, timeout: float) -> tuple[bytes, str]:
    """Run the ROM in an external mGBA and return the flushed cartridge SRAM."""
    with tempfile.TemporaryDirectory(prefix="puzzlescript-gbc-smoke-") as temp_name:
        temp = Path(temp_name)
        local_rom = temp / "smoke.gb"
        save = temp / "smoke.sav"
        shutil.copy2(rom, local_rom)
        environment = os.environ.copy()
        # SDL dummy drivers are for mgba-sdl. The macOS .app is Qt/Cocoa and
        # fails to write SRAM under dummy video in some environments.
        if emulator.name.lower() in {"mgba-sdl", "mgba-sdl.exe"}:
            environment["SDL_VIDEODRIVER"] = "dummy"
            environment["SDL_AUDIODRIVER"] = "dummy"
        process = subprocess.Popen(
            [
                str(emulator),
                "-C",
                "videoSync=0",
                "-C",
                "audioSync=0",
                local_rom.name,
            ],
            cwd=temp,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and process.poll() is None:
            time.sleep(0.1)
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        flush_deadline = time.monotonic() + 2.0
        while not save.is_file() and time.monotonic() < flush_deadline:
            time.sleep(0.05)
        if not save.is_file():
            raise SystemExit("mGBA did not flush cartridge SRAM")
        data = save.read_bytes()
        return data, f"backend=subprocess emulator={emulator} sram={len(data)}"


def collect_sram(args: argparse.Namespace) -> tuple[bytes, str]:
    """Produce the cartridge SRAM bytes the rest of this script validates.

    This is the whole emulator seam: everything below it is struct parsing.
    """
    repository = Path(__file__).resolve().parent.parent
    cache = Path(
        os.environ.get("GBC_SMOKE_CACHE", repository / "build" / "gbc-smoke")
    )
    backend = args.backend
    if backend == "auto" and args.mgba is not None:
        # An explicitly named emulator is a request for the subprocess path.
        backend = "subprocess"

    prefix: Path | None = None
    missing = ""
    if backend in {"auto", "libmgba"}:
        prefix, missing = find_libmgba_prefix(args.mgba_prefix)

    if backend == "libmgba":
        if prefix is None:
            raise SystemExit(
                "libmgba backend requested but no usable mGBA installation was "
                f"found ({missing}). Install mGBA with its development headers "
                "(macOS: brew install mgba; Debian/Ubuntu: libmgba-dev) or pass "
                "--mgba-prefix."
            )
        return read_sram_libmgba(args.rom, prefix, cache, args.frames)

    if backend == "auto" and prefix is not None:
        try:
            return read_sram_libmgba(args.rom, prefix, cache, args.frames)
        except SystemExit as error:
            fallback = args.mgba or default_mgba()
            if fallback is None or not fallback.is_file():
                raise
            print(
                f"gbc-smoke warning: libmgba backend unavailable ({error}); "
                f"falling back to {fallback}"
            )

    emulator = args.mgba or default_mgba()
    if emulator is None or not emulator.is_file():
        raise SystemExit(
            "no usable mGBA backend: libmgba was not found ("
            + missing
            + ") and no mGBA executable is on PATH. Install mGBA with its "
            "development headers, or put mgba-sdl on PATH."
        )
    return read_sram_subprocess(emulator, args.rom, args.timeout)



def read_frame_dump(
    data: bytes, bank: int
) -> tuple[bytes, bytes, bytes, tuple[int, ...]]:
    frame_offset = bank * SRAM_BANK_SIZE
    frame_magic, frame_version, frame_tiles = FRAME_DUMP_HEADER.unpack_from(
        data, frame_offset
    )
    if (
        frame_magic != FRAME_DUMP_MAGIC
        or frame_version != VERSION
        or frame_tiles != SCREEN_TILES
    ):
        raise SystemExit(
            "frame dump record missing: "
            f"bank={bank} magic=0x{frame_magic:08x} "
            f"version={frame_version} tiles={frame_tiles}"
        )
    cursor = frame_offset + FRAME_DUMP_HEADER.size
    tile_map = data[cursor : cursor + SCREEN_TILES]
    cursor += SCREEN_TILES
    attributes = data[cursor : cursor + SCREEN_TILES]
    cursor += SCREEN_TILES
    tile_data = data[cursor : cursor + SCREEN_TILES * 16]
    cursor += SCREEN_TILES * 16
    palettes = struct.unpack_from("<32H", data, cursor)
    return tile_map, attributes, tile_data, palettes


def save_frame_image(
    frame: tuple[bytes, bytes, bytes, tuple[int, ...]],
    output: Path,
    scale: int,
) -> None:
    from PIL import Image

    _, attributes, tile_data, palettes = frame
    image = Image.new("RGB", (160, 144))
    pixels = image.load()
    for screen_tile in range(SCREEN_TILES):
        tile_x = screen_tile % 20
        tile_y = screen_tile // 20
        palette = attributes[screen_tile] & 0x07
        pattern = tile_data[screen_tile * 16 : (screen_tile + 1) * 16]
        for pixel_y in range(8):
            low = pattern[pixel_y * 2]
            high = pattern[pixel_y * 2 + 1]
            for pixel_x in range(8):
                shift = 7 - pixel_x
                color_index = (
                    ((low >> shift) & 1)
                    | (((high >> shift) & 1) << 1)
                )
                color = palettes[palette * 4 + color_index]
                pixels[tile_x * 8 + pixel_x, tile_y * 8 + pixel_y] = (
                    (color & 0x1F) * 255 // 31,
                    ((color >> 5) & 0x1F) * 255 // 31,
                    ((color >> 10) & 0x1F) * 255 // 31,
                )
    output.parent.mkdir(parents=True, exist_ok=True)
    if scale != 1:
        image = image.resize(
            (160 * scale, 144 * scale),
            Image.Resampling.NEAREST,
        )
    image.save(output)


def frame_tile_colors(
    frame: tuple[bytes, bytes, bytes, tuple[int, ...]],
    screen_tiles: tuple[int, ...],
) -> set[int]:
    _, attributes, tile_data, palettes = frame
    colors: set[int] = set()
    for screen_tile in screen_tiles:
        palette = attributes[screen_tile] & 0x07
        pattern = tile_data[screen_tile * 16 : (screen_tile + 1) * 16]
        for pixel_y in range(8):
            low = pattern[pixel_y * 2]
            high = pattern[pixel_y * 2 + 1]
            for pixel_x in range(8):
                shift = 7 - pixel_x
                color_index = (
                    ((low >> shift) & 1)
                    | (((high >> shift) & 1) << 1)
                )
                colors.add(palettes[palette * 4 + color_index])
    return colors


def glyph_tiles(text: str) -> bytes:
    punctuation = {
        ".": 37,
        "-": 38,
        ":": 39,
        "!": 40,
        "?": 41,
        ",": 42,
        "'": 43,
        "/": 44,
        "[": 45,
        "]": 46,
    }
    return bytes(
        ord(character) - ord("A") + 1
        if "A" <= character <= "Z"
        else punctuation.get(character, 0)
        for character in text
    )


def frame_border_mismatches(tile_map: bytes) -> int:
    mismatches = 0
    for column in range(2, 18):
        mismatches += tile_map[20 + column] != FRAME_HORIZONTAL_TILE
        mismatches += tile_map[320 + column] != FRAME_HORIZONTAL_TILE
    for row in range(2, 16):
        mismatches += tile_map[row * 20 + 1] != FRAME_VERTICAL_TILE
        mismatches += tile_map[row * 20 + 18] != FRAME_VERTICAL_TILE
    return mismatches


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rom", type=Path)
    parser.add_argument("--mgba", type=Path)
    parser.add_argument(
        "--backend",
        choices=("auto", "libmgba", "subprocess"),
        default="auto",
        help=(
            "auto prefers the in-process libmgba backend and falls back to "
            "launching an mGBA executable"
        ),
    )
    parser.add_argument(
        "--mgba-prefix",
        type=Path,
        help="installation prefix holding include/mgba and lib/libmgba",
    )
    parser.add_argument(
        "--frames",
        type=int,
        default=DEFAULT_FRAME_BUDGET,
        help="emulated frames to run under the libmgba backend",
    )
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--expect-initial", type=coordinate, default=(2, 3))
    parser.add_argument("--expect-final", type=coordinate, default=(3, 3))
    parser.add_argument("--expect-changed", type=int, choices=(0, 1), default=1)
    parser.add_argument("--expect-won", type=int, choices=(0, 1), default=0)
    parser.add_argument("--expect-game-audio", type=int)
    parser.add_argument("--expect-ui-audio", type=int)
    parser.add_argument("--expect-last-seed", type=int)
    parser.add_argument("--expect-cell", type=coordinate, default=(16, 16))
    parser.add_argument("--skip-step-check", action="store_true")
    parser.add_argument("--logic-only", action="store_true")
    parser.add_argument("--frame-out", type=Path)
    parser.add_argument("--title-frame-out", type=Path)
    parser.add_argument("--message-frame-out", type=Path)
    parser.add_argument("--frame-scale", type=int, default=1)
    parser.add_argument("--require-dedicated-tiles", action="store_true")
    parser.add_argument("--require-second-vram-bank", action="store_true")
    parser.add_argument("--require-quadrant-palettes", action="store_true")
    parser.add_argument(
        "--require-player-color", action="append", type=integer, default=[]
    )
    args = parser.parse_args()
    unique_quartets = 0
    dedicated_cells = 0
    second_bank_cells = 0
    quadrant_palette_cells = 0
    if args.frame_scale < 1:
        raise SystemExit("--frame-scale must be at least 1")
    if not args.rom.is_file():
        raise SystemExit(f"ROM was not found: {args.rom}")
    # The emulator's entire job is to produce these bytes; everything below
    # this line is pure parsing of them.
    data, backend_summary = collect_sram(args)
    print(f"gbc-smoke {backend_summary}")
    offset = SRAM_BANK * SRAM_BANK_SIZE
    if len(data) < offset + RECORD.size:
        raise SystemExit(f"unexpected SRAM size: {len(data)}")
    record = RECORD.unpack_from(data, offset)
    magic, version, initial_x, initial_y, final_x, final_y, changed, won, source_hash = record
    if magic != MAGIC or version != VERSION:
        raise SystemExit(
            f"autotest record missing: magic=0x{magic:08x} version={version}"
        )
    if not args.skip_step_check and (initial_x, initial_y) != args.expect_initial:
        raise SystemExit(f"initial player position differs: {initial_x},{initial_y}")
    if (
        not args.skip_step_check
        and (
            (final_x, final_y) != args.expect_final
            or changed != args.expect_changed
            or won != args.expect_won
        )
    ):
        raise SystemExit(
            "right-step result differs: "
            f"position={final_x},{final_y} changed={changed} won={won}"
        )
    expect_audio = (
        args.expect_game_audio is not None
        or args.expect_ui_audio is not None
        or args.expect_last_seed is not None
    )
    audio_summary = ""
    if expect_audio:
        audio_offset = offset + AUDIO_OFFSET
        if len(data) < audio_offset + AUDIO_RECORD.size:
            raise SystemExit("audio autotest record is truncated")
        (
            audio_magic,
            audio_version,
            game_audio,
            ui_audio,
            play_count,
            last_seed,
            nr52,
            nr50,
            nr51,
            nr12,
            nr22,
            nr42,
            nr43,
        ) = AUDIO_RECORD.unpack_from(data, audio_offset)
        if audio_magic != AUDIO_MAGIC or audio_version != VERSION:
            raise SystemExit(
                "audio autotest record missing: "
                f"magic=0x{audio_magic:08x} version={audio_version}"
            )
        if (
            args.expect_game_audio is not None
            and game_audio != args.expect_game_audio
        ):
            raise SystemExit(
                f"gameplay audio count differs: {game_audio}"
            )
        if (
            args.expect_ui_audio is not None
            and ui_audio != args.expect_ui_audio
        ):
            raise SystemExit(f"UI audio count differs: {ui_audio}")
        if (
            args.expect_last_seed is not None
            and last_seed != args.expect_last_seed
        ):
            raise SystemExit(f"last played seed differs: {last_seed}")
        if play_count != game_audio + ui_audio:
            raise SystemExit(
                "not every exported event reached the APU driver: "
                f"events={game_audio + ui_audio} plays={play_count}"
            )
        if (
            (nr52 & 0x80) == 0
            or nr50 != 0x77
            or nr51 != 0xBB
            or (nr12 | nr22 | nr42) == 0
        ):
            raise SystemExit(
                "APU register probe differs: "
                f"NR52=0x{nr52:02x} NR50=0x{nr50:02x} "
                f"NR51=0x{nr51:02x} envelopes="
                f"{nr12:02x}/{nr22:02x}/{nr42:02x} "
                f"NR43=0x{nr43:02x}"
            )
        audio_summary = (
            f" audio={game_audio}+{ui_audio} plays={play_count}"
            f" last_seed={last_seed} apu=0x{nr52:02x}"
        )
    if args.logic_only:
        print(
            "gbc-smoke logic-only ok "
            f"source_hash=0x{source_hash:08x} "
            f"player={initial_x},{initial_y}->{final_x},{final_y} "
            f"changed={changed} won={won}{audio_summary}"
        )
        return 0
    render_record = RENDER_RECORD.unpack_from(data, offset + RENDER_OFFSET)
    (
        render_magic,
        render_version,
        title_map_nonzero,
        title_tile_nonzero,
        title_palette_mismatches,
        title_background,
        title_foreground,
        title_map_mismatches,
        board_tile_nonzero,
        board_attributes_nonzero,
        board_map_mismatches,
        board_attribute_mismatches,
        board_palette_mismatches,
        incremental_blank_count,
        incremental_lcd_on,
        cell_width,
        cell_height,
        board_pixel_width,
        board_pixel_height,
        tile_upload_mismatches,
        title_selection_blank_count,
        full_transition_blank_count,
    ) = render_record
    if render_magic != RENDER_MAGIC or render_version != VERSION:
        raise SystemExit(
            "render autotest record missing: "
            f"magic=0x{render_magic:08x} version={render_version}"
        )
    if title_map_nonzero == 0 or title_tile_nonzero == 0:
        raise SystemExit(
            "title rendering is empty: "
            f"map={title_map_nonzero} tile_bytes={title_tile_nonzero}"
        )
    if title_background == title_foreground:
        raise SystemExit(
            f"title colors do not contrast: color=0x{title_background:04x}"
        )
    if title_palette_mismatches != 0 or title_map_mismatches != 0:
        raise SystemExit(
            "title hardware state differs: "
            f"palette={title_palette_mismatches} map={title_map_mismatches}"
        )
    if title_selection_blank_count != 0:
        raise SystemExit(
            "title selection blanked the display: "
            f"blank_count={title_selection_blank_count}"
        )
    if full_transition_blank_count not in (1, 0xFFFF):
        raise SystemExit(
            "full level transition performed extra display rewrites: "
            f"blank_count={full_transition_blank_count}"
        )
    if board_tile_nonzero == 0 or board_attributes_nonzero == 0:
        raise SystemExit(
            "board rendering is empty: "
            f"tile_bytes={board_tile_nonzero} attributes={board_attributes_nonzero}"
        )
    if (
        board_map_mismatches != 0
        or board_attribute_mismatches != 0
        or board_palette_mismatches != 0
    ):
        raise SystemExit(
            "board hardware state differs: "
            f"map={board_map_mismatches} attributes={board_attribute_mismatches} "
            f"palette={board_palette_mismatches}"
        )
    if incremental_blank_count != 0 or incremental_lcd_on != 1:
        raise SystemExit(
            "incremental board update blanked the display: "
            f"blank_count={incremental_blank_count} lcd_on={incremental_lcd_on}"
        )
    if (cell_width, cell_height) != args.expect_cell:
        raise SystemExit(
            "rendered cell dimensions differ: "
            f"actual={cell_width}x{cell_height} "
            f"expected={args.expect_cell[0]}x{args.expect_cell[1]}"
        )
    if (
        board_pixel_width % cell_width != 0
        or board_pixel_height % cell_height != 0
    ):
        raise SystemExit(
            "board dimensions are not integral rendered cells: "
            f"board={board_pixel_width}x{board_pixel_height} "
            f"cell={cell_width}x{cell_height}"
        )
    if tile_upload_mismatches != 0:
        raise SystemExit(
            "VRAM tile upload readback differs: "
            f"mismatches={tile_upload_mismatches}"
        )
    title_frame = read_frame_dump(data, TITLE_FRAME_DUMP_BANK)
    title_tile_map, title_attributes, _, _ = title_frame
    frame_mismatches = frame_border_mismatches(title_tile_map)
    masthead = glyph_tiles("PUZZLESCRIPT")
    prompt = glyph_tiles("PRESS A")
    new_game = glyph_tiles("NEW GAME")
    selected_continue = glyph_tiles("[CONTINUE]")
    if (
        frame_mismatches != 0
        or any(title_attributes)
        or title_tile_map[3 * 20 + 4 : 3 * 20 + 16] != masthead
        or title_tile_map[13 * 20 + 6 : 13 * 20 + 14] != new_game
        or title_tile_map[15 * 20 + 5 : 15 * 20 + 15]
            != selected_continue
    ):
        raise SystemExit(
            "title layout differs: "
            f"frame={frame_mismatches} attributes={sum(bool(value) for value in title_attributes)} "
            f"masthead={title_tile_map[3 * 20 + 4 : 3 * 20 + 16] == masthead} "
            f"new_game={title_tile_map[13 * 20 + 6 : 13 * 20 + 14] == new_game} "
            f"continue={title_tile_map[15 * 20 + 5 : 15 * 20 + 15] == selected_continue}"
        )
    if args.title_frame_out is not None:
        save_frame_image(title_frame, args.title_frame_out, args.frame_scale)
    message_frame = read_frame_dump(data, MESSAGE_FRAME_DUMP_BANK)
    message_tile_map, message_attributes, _, _ = message_frame
    message_frame_mismatches = frame_border_mismatches(message_tile_map)
    message_line_1 = glyph_tiles("VERTEX DISPENSER")
    message_line_2 = glyph_tiles("/ [OK]?")
    if (
        message_frame_mismatches != 0
        or any(message_attributes)
        or message_tile_map[3 * 20 + 2 : 3 * 20 + 18] != message_line_1
        or message_tile_map[4 * 20 + 6 : 4 * 20 + 13] != message_line_2
        or message_tile_map[15 * 20 + 6 : 15 * 20 + 13] != prompt
    ):
        raise SystemExit(
            "message layout differs: "
            f"frame={message_frame_mismatches} "
            f"attributes={sum(bool(value) for value in message_attributes)} "
            f"line1={message_tile_map[3 * 20 + 2 : 3 * 20 + 18] == message_line_1} "
            f"line2={message_tile_map[4 * 20 + 6 : 4 * 20 + 13] == message_line_2} "
            f"prompt={message_tile_map[15 * 20 + 6 : 15 * 20 + 13] == prompt}"
        )
    if args.message_frame_out is not None:
        save_frame_image(message_frame, args.message_frame_out, args.frame_scale)
    if (
        args.frame_out is not None
        or args.require_quadrant_palettes
        or args.require_player_color
    ):
        board_frame = read_frame_dump(data, FRAME_DUMP_BANK)
        tile_map, attributes, _, _ = board_frame
        mapping_mismatches = 0
        quartet_bases = set()
        for logical_y in range(9):
            for logical_x in range(10):
                top_left = (logical_y * 2) * 20 + logical_x * 2
                parts = (
                    top_left,
                    top_left + 1,
                    top_left + 20,
                    top_left + 21,
                )
                base_tile = tile_map[top_left] + (
                    256 if attributes[top_left] & 0x08 else 0
                )
                if (
                    base_tile < 64
                    or base_tile > 484
                    or base_tile % 4 != 0
                ):
                    mapping_mismatches += 1
                    continue
                quartet_bases.add(base_tile)
                if base_tile >= 128:
                    dedicated_cells += 1
                if base_tile >= 256:
                    second_bank_cells += 1
                quadrant_palettes = {
                    attributes[screen_tile] & 0x07 for screen_tile in parts
                }
                if len(quadrant_palettes) > 1:
                    quadrant_palette_cells += 1
                for part, screen_tile in enumerate(parts):
                    expected_tile = base_tile + part
                    actual_tile = tile_map[screen_tile] + (
                        256 if attributes[screen_tile] & 0x08 else 0
                    )
                    if actual_tile != expected_tile:
                        mapping_mismatches += 1
        if mapping_mismatches != 0:
            raise SystemExit(
                "16x16 cells are not mapped to aligned four-tile quartets: "
                f"mismatches={mapping_mismatches}"
            )
        unique_quartets = len(quartet_bases)
        if args.require_dedicated_tiles and dedicated_cells == 0:
            raise SystemExit(
                "frame did not exercise the dedicated quartet overflow path"
            )
        if args.require_second_vram_bank and second_bank_cells == 0:
            raise SystemExit(
                "frame did not exercise logical cells in VRAM pattern bank 1"
            )
        if args.require_quadrant_palettes and quadrant_palette_cells == 0:
            raise SystemExit(
                "frame did not exercise multiple palettes within one 16x16 cell"
            )
        if args.require_player_color:
            logical_board_width = board_pixel_width // cell_width
            logical_board_height = board_pixel_height // cell_height
            player_logical_x = (
                (10 - logical_board_width) // 2 + final_x
            )
            player_logical_y = (
                (9 - logical_board_height) // 2 + final_y
            )
            player_top_left = (
                (player_logical_y * 2) * 20 + player_logical_x * 2
            )
            player_tiles = (
                player_top_left,
                player_top_left + 1,
                player_top_left + 20,
                player_top_left + 21,
            )
            player_colors = frame_tile_colors(board_frame, player_tiles)
            missing_player_colors = sorted(
                set(args.require_player_color) - player_colors
            )
            if missing_player_colors:
                player_palettes = [
                    attributes[screen_tile] & 0x07
                    for screen_tile in player_tiles
                ]
                raise SystemExit(
                    "player cell is missing required rendered colors: "
                    f"missing={missing_player_colors} "
                    f"observed={sorted(player_colors)} "
                    f"palettes={player_palettes}"
                )
        if args.frame_out is not None:
            save_frame_image(board_frame, args.frame_out, args.frame_scale)
    print(
        "gbc-smoke ok "
        f"source_hash=0x{source_hash:08x} "
        f"player={initial_x},{initial_y}->{final_x},{final_y} "
        f"changed={changed} won={won} "
        f"title_tiles={title_map_nonzero}/{title_tile_nonzero} "
        f"board_tiles={board_tile_nonzero} "
        f"cell={cell_width}x{cell_height} "
        f"board_pixels={board_pixel_width}x{board_pixel_height} "
        "renderer=fixed-16x16 "
        f"quartets={unique_quartets} "
        f"dedicated_cells={dedicated_cells} "
        f"bank1_cells={second_bank_cells}"
        f" title_selection_blanks={title_selection_blank_count}"
        f" level_transition_blanks={full_transition_blank_count}"
        f" quadrant_palette_cells={quadrant_palette_cells}"
        f"{audio_summary}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
