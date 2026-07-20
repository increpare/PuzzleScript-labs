#!/usr/bin/env python3
"""Boot an instrumented CGB ROM in mGBA and validate its SRAM result."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import time


MAGIC = 0x54434250
RENDER_MAGIC = 0x52434250
VERSION = 1
RECORD = struct.Struct("<IHBBBBBBI")
RENDER_RECORD = struct.Struct("<I14H")
SRAM_BANK_SIZE = 8 * 1024
SRAM_BANK = 3
RENDER_OFFSET = 16


def coordinate(value: str) -> tuple[int, int]:
    try:
        x_text, y_text = value.split(",", 1)
        return int(x_text), int(y_text)
    except ValueError as error:
        raise argparse.ArgumentTypeError("coordinate must be X,Y") from error


def default_mgba() -> Path | None:
    executable = shutil.which("mgba-sdl") or shutil.which("mgba-sdl.exe")
    if executable:
        return Path(executable)
    candidate = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "mGBA" / "mgba-sdl.exe"
    return candidate if candidate.is_file() else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rom", type=Path)
    parser.add_argument("--mgba", type=Path)
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--expect-initial", type=coordinate, default=(2, 3))
    parser.add_argument("--expect-final", type=coordinate, default=(3, 3))
    parser.add_argument("--expect-changed", type=int, choices=(0, 1), default=1)
    parser.add_argument("--expect-won", type=int, choices=(0, 1), default=0)
    args = parser.parse_args()
    emulator = args.mgba or default_mgba()
    if emulator is None or not emulator.is_file():
        raise SystemExit("mGBA SDL executable was not found")
    if not args.rom.is_file():
        raise SystemExit(f"ROM was not found: {args.rom}")
    with tempfile.TemporaryDirectory(prefix="puzzlescript-gbc-smoke-") as temp_name:
        temp = Path(temp_name)
        rom = temp / "smoke.gb"
        save = temp / "smoke.sav"
        shutil.copy2(args.rom, rom)
        environment = os.environ.copy()
        environment["SDL_VIDEODRIVER"] = "dummy"
        environment["SDL_AUDIODRIVER"] = "dummy"
        process = subprocess.Popen(
            [
                str(emulator),
                "-C",
                "videoSync=0",
                "-C",
                "audioSync=0",
                rom.name,
            ],
            cwd=temp,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + args.timeout
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
        offset = SRAM_BANK * SRAM_BANK_SIZE
        if len(data) < offset + RECORD.size:
            raise SystemExit(f"unexpected SRAM size: {len(data)}")
        record = RECORD.unpack_from(data, offset)
        magic, version, initial_x, initial_y, final_x, final_y, changed, won, source_hash = record
        if magic != MAGIC or version != VERSION:
            raise SystemExit(
                f"autotest record missing: magic=0x{magic:08x} version={version}"
            )
        if (initial_x, initial_y) != args.expect_initial:
            raise SystemExit(f"initial player position differs: {initial_x},{initial_y}")
        if ((final_x, final_y) != args.expect_final
            or changed != args.expect_changed
            or won != args.expect_won):
            raise SystemExit(
                "right-step result differs: "
                f"position={final_x},{final_y} changed={changed} won={won}"
            )
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
        print(
            "gbc-smoke ok "
            f"source_hash=0x{source_hash:08x} "
            f"player={initial_x},{initial_y}->{final_x},{final_y} "
            f"title_tiles={title_map_nonzero}/{title_tile_nonzero} "
            f"board_tiles={board_tile_nonzero}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
