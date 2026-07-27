#!/usr/bin/env python3
"""Drive the compilation-cart launcher and two games in headless libmGBA."""

from __future__ import annotations

import argparse
import ctypes
import json
import shutil
import struct
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import run_gbc_smoke


CART_MAGIC = 0x54524350
CART_VERSION = 1
CART_RECORD = struct.Struct("<IHBBBB2xII")
CART_SRAM_BANK = 3
SRAM_BANK_BYTES = 8 * 1024
KEY_A = 1 << 0
KEY_B = 1 << 1
KEY_START = 1 << 3
KEY_LEFT = 1 << 4
KEY_RIGHT = 1 << 5
KEY_UP = 1 << 6
KEY_DOWN = 1 << 7
SCRIPT_FRAMES = 570
VIDEO_BYTES = 160 * 144 * 4


@dataclass(frozen=True)
class CartTelemetry:
    launches: int
    returns: int
    first_index: int
    second_index: int
    first_hash: int
    second_hash: int


def build_key_script() -> list[int]:
    keys = [0] * SCRIPT_FRAMES
    keys[100] = KEY_RIGHT
    keys[110] = KEY_A
    keys[160] = KEY_A
    keys[210] = KEY_A
    keys[260] = KEY_UP
    keys[310] = KEY_START
    keys[350] = KEY_B
    keys[410] = KEY_LEFT
    keys[420] = KEY_DOWN
    keys[430] = KEY_A
    return keys


def validate_page_trace(
    lcdc: list[int],
    background_hashes: list[int],
    *,
    key_frame: int,
    stable_through: int,
) -> None:
    """Require a visible page switch that is complete by the next frame."""
    if len(lcdc) != len(background_hashes):
        raise ValueError("launcher frame trace arrays have different lengths")
    if (
        key_frame < 1
        or stable_through <= key_frame + 1
        or stable_through >= len(lcdc)
    ):
        raise ValueError("launcher page trace window is invalid")
    for frame in range(key_frame, stable_through + 1):
        if (lcdc[frame] & 0x80) == 0:
            raise ValueError(
                f"launcher disabled the LCD at frame {frame}: "
                f"lcdc=0x{lcdc[frame]:02x}"
            )
    settled_hash = background_hashes[key_frame + 1]
    if settled_hash == background_hashes[key_frame - 1]:
        raise ValueError(
            f"launcher page did not change at frame {key_frame}"
        )
    for frame in range(key_frame + 1, stable_through + 1):
        if background_hashes[frame] != settled_hash:
            samples = ", ".join(
                f"{sample}:0x{background_hashes[sample]:08x}/"
                f"0x{lcdc[sample]:02x}"
                for sample in range(key_frame - 1, stable_through + 1)
            )
            raise ValueError(
                "launcher page did not settle within one frame: "
                f"frame={frame} expected=0x{settled_hash:08x} "
                f"actual=0x{background_hashes[frame]:08x}; "
                f"samples={samples}"
            )


def parse_telemetry(
    data: bytes,
    *,
    expected_first_index: int,
    expected_second_index: int,
) -> CartTelemetry:
    if len(data) < CART_RECORD.size:
        raise ValueError("cart telemetry is truncated")
    (
        magic,
        version,
        launches,
        returns,
        first_index,
        second_index,
        first_hash,
        second_hash,
    ) = CART_RECORD.unpack_from(data)
    if magic != CART_MAGIC or version != CART_VERSION:
        raise ValueError(
            f"cart telemetry header is invalid: "
            f"magic=0x{magic:08x} version={version}"
        )
    if launches != 2 or returns != 1:
        raise ValueError(
            f"cart lifecycle is incomplete: launches={launches} "
            f"returns={returns}"
        )
    if (
        first_index != expected_first_index
        or second_index != expected_second_index
    ):
        raise ValueError(
            f"cart launched games {first_index}/{second_index}, expected "
            f"{expected_first_index}/{expected_second_index}"
        )
    if first_hash == 0 or second_hash == 0 or first_hash == second_hash:
        raise ValueError(
            f"cart hashes are invalid: "
            f"0x{first_hash:08x}/0x{second_hash:08x}"
        )
    return CartTelemetry(
        launches=launches,
        returns=returns,
        first_index=first_index,
        second_index=second_index,
        first_hash=first_hash,
        second_hash=second_hash,
    )


def run_smoke(
    rom: Path,
    manifest_path: Path,
    *,
    mgba_prefix: Path | None,
    cache: Path,
    maximum_warnings: int,
) -> str:
    prefix, missing = run_gbc_smoke.find_libmgba_prefix(mgba_prefix)
    if prefix is None:
        raise SystemExit(f"libmGBA is unavailable: {missing}")
    handle = run_gbc_smoke.load_libmgba_shim(prefix, cache)
    handle.psgbc_run_with_keys.restype = ctypes.c_int
    handle.psgbc_last_lcdc.restype = ctypes.c_uint
    handle.psgbc_last_tilemap_nonzero.restype = ctypes.c_uint
    handle.psgbc_run_with_keys.argtypes = [
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
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.c_uint,
    ]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if len(manifest.get("games", [])) < 9:
        raise SystemExit("cart smoke needs at least nine games")
    keys = build_key_script()
    key_array = (ctypes.c_uint32 * len(keys))(*keys)
    with tempfile.TemporaryDirectory(
        prefix="puzzlescript-gbc-cart-smoke-"
    ) as temporary:
        directory = Path(temporary)
        local_rom = directory / "cart.gb"
        save = directory / "cart.sav"
        shutil.copy2(rom, local_rom)
        sram = (ctypes.c_ubyte * (1 << 20))()
        video = (ctypes.c_ubyte * VIDEO_BYTES)()
        sram_size = ctypes.c_uint(0)
        frames_run = ctypes.c_uint(0)
        program_counter = ctypes.c_uint(0)
        stack_pointer = ctypes.c_uint(0)
        started = time.monotonic()
        status = handle.psgbc_run_with_keys(
            str(local_rom).encode(),
            str(save).encode(),
            len(keys),
            sram,
            len(sram),
            ctypes.byref(sram_size),
            ctypes.byref(frames_run),
            video,
            len(video),
            ctypes.byref(program_counter),
            ctypes.byref(stack_pointer),
            key_array,
            len(keys),
        )
        elapsed = time.monotonic() - started
        if status != 0:
            raise SystemExit(
                "libmGBA cart backend failed: "
                + run_gbc_smoke.SHIM_ERRORS.get(
                    status, f"unknown status {status}"
                )
            )
        if not save.is_file():
            raise SystemExit("libmGBA did not flush the cart SRAM")
        save_data = save.read_bytes()
    offset = CART_SRAM_BANK * SRAM_BANK_BYTES
    trace_count = handle.psgbc_frame_trace_count()
    lcdc_trace = [
        handle.psgbc_frame_lcdc(frame)
        for frame in range(trace_count)
    ]
    background_hashes = [
        handle.psgbc_frame_background_hash(frame)
        for frame in range(trace_count)
    ]
    validate_page_trace(
        lcdc_trace,
        background_hashes,
        key_frame=100,
        stable_through=109,
    )
    validate_page_trace(
        lcdc_trace,
        background_hashes,
        key_frame=410,
        stable_through=419,
    )
    telemetry = parse_telemetry(
        save_data[offset : offset + CART_RECORD.size],
        expected_first_index=8,
        expected_second_index=1,
    )
    expected_first_hash = int(manifest["games"][8]["source_hash"])
    expected_second_hash = int(manifest["games"][1]["source_hash"])
    if (
        telemetry.first_hash != expected_first_hash
        or telemetry.second_hash != expected_second_hash
    ):
        raise SystemExit(
            "cart telemetry hashes do not match the manifest: "
            f"0x{telemetry.first_hash:08x}/0x{telemetry.second_hash:08x}"
        )
    pixels = bytes(video)
    colors = {
        pixels[index : index + 4]
        for index in range(0, len(pixels), 4)
    }
    lcdc = handle.psgbc_last_lcdc()
    tilemap_nonzero = handle.psgbc_last_tilemap_nonzero()
    if (lcdc & 0x80) == 0 or tilemap_nonzero == 0:
        raise SystemExit(
            "cart smoke ended with a blank display: "
            f"frames={frames_run.value} pc=0x{program_counter.value:04x} "
            f"sp=0x{stack_pointer.value:04x} "
            f"lcdc=0x{lcdc:02x} tilemap_nonzero={tilemap_nonzero}"
        )
    warnings = handle.psgbc_log_count()
    run_gbc_smoke.enforce_emulator_warning_limit(
        warnings, maximum_warnings
    )
    return (
        f"frames={frames_run.value} launches={telemetry.launches} "
        f"returns={telemetry.returns} games=8,1 "
        f"hashes=0x{telemetry.first_hash:08x},"
        f"0x{telemetry.second_hash:08x} lcdc=0x{lcdc:02x} "
        f"tilemap_nonzero={tilemap_nonzero} colors={len(colors)} "
        f"pc=0x{program_counter.value:04x} "
        f"sp=0x{stack_pointer.value:04x} "
        f"emulator_warnings={warnings} wall={elapsed:.2f}s"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rom", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--mgba-prefix", type=Path)
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path("build/gbc-smoke"),
    )
    parser.add_argument("--max-emulator-warnings", type=int, default=5)
    args = parser.parse_args()
    print(
        "gbc-cart-smoke "
        + run_smoke(
            args.rom,
            args.manifest,
            mgba_prefix=args.mgba_prefix,
            cache=args.cache,
            maximum_warnings=args.max_emulator_warnings,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
