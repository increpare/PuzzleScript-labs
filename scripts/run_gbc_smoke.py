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
FRAME_DUMP_MAGIC = 0x46474250
VERSION = 1
RECORD = struct.Struct("<IHBBBBBBI")
RENDER_RECORD = struct.Struct("<I19H")
SRAM_BANK_SIZE = 8 * 1024
SRAM_BANK = 3
RENDER_OFFSET = 16
FRAME_DUMP_BANK = 2
FRAME_DUMP_HEADER = struct.Struct("<IHH")
SCREEN_TILES = 20 * 18


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
    parser.add_argument("--expect-cell", type=coordinate, default=(16, 16))
    parser.add_argument("--skip-step-check", action="store_true")
    parser.add_argument("--logic-only", action="store_true")
    parser.add_argument("--frame-out", type=Path)
    parser.add_argument("--frame-scale", type=int, default=1)
    parser.add_argument("--require-dedicated-tiles", action="store_true")
    parser.add_argument("--require-second-vram-bank", action="store_true")
    args = parser.parse_args()
    unique_quartets = 0
    dedicated_cells = 0
    second_bank_cells = 0
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
        if args.logic_only:
            print(
                "gbc-smoke logic-only ok "
                f"source_hash=0x{source_hash:08x} "
                f"player={initial_x},{initial_y}->{final_x},{final_y} "
                f"changed={changed} won={won}"
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
        if args.frame_out is not None:
            from PIL import Image

            frame_offset = FRAME_DUMP_BANK * SRAM_BANK_SIZE
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
                    f"magic=0x{frame_magic:08x} version={frame_version} "
                    f"tiles={frame_tiles}"
                )
            cursor = frame_offset + FRAME_DUMP_HEADER.size
            tile_map = data[cursor : cursor + SCREEN_TILES]
            cursor += SCREEN_TILES
            attributes = data[cursor : cursor + SCREEN_TILES]
            cursor += SCREEN_TILES
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
            tile_data = data[cursor : cursor + SCREEN_TILES * 16]
            cursor += SCREEN_TILES * 16
            palettes = struct.unpack_from("<32H", data, cursor)
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
            args.frame_out.parent.mkdir(parents=True, exist_ok=True)
            if args.frame_scale < 1:
                raise SystemExit("--frame-scale must be at least 1")
            if args.frame_scale != 1:
                image = image.resize(
                    (160 * args.frame_scale, 144 * args.frame_scale),
                    Image.Resampling.NEAREST,
                )
            image.save(args.frame_out)
        print(
            "gbc-smoke ok "
            f"source_hash=0x{source_hash:08x} "
            f"player={initial_x},{initial_y}->{final_x},{final_y} "
            f"title_tiles={title_map_nonzero}/{title_tile_nonzero} "
            f"board_tiles={board_tile_nonzero} "
            f"cell={cell_width}x{cell_height} "
            f"board_pixels={board_pixel_width}x{board_pixel_height} "
            "renderer=fixed-16x16 "
            f"quartets={unique_quartets} "
            f"dedicated_cells={dedicated_cells} "
            f"bank1_cells={second_bank_cells}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
