#!/usr/bin/env python3
"""Validate the linked PuzzleScript CGB cartridge and exported RAM budgets."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


MAX_ROM_BYTES = 128 * 1024
MAX_SESSION_BYTES = 4 * 1024
MAX_SNAPSHOT_BANK_BYTES = 8 * 1024
MAX_FIXED_ROM_BYTES = 16 * 1024
MAX_GAME_BANK_BYTES = 16 * 1024
MAX_STATIC_WRAM_BYTES = 6 * 1024
MAP_AREA = re.compile(
    r"^([._A-Za-z][._A-Za-z0-9]*)\s+([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{8})\s+="
)


def map_usage(path: Path) -> tuple[int, int, int]:
    fixed_rom_high = 0
    game_bank_bytes = 0
    static_wram_high = 0xC000
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = MAP_AREA.match(line)
        if not match:
            continue
        name, address_text, size_text = match.groups()
        address = int(address_text, 16)
        size = int(size_text, 16)
        if name.startswith("_HEADER") or (0 < address < 0x4000):
            fixed_rom_high = max(fixed_rom_high, address + size)
        if name == "_CODE_1":
            game_bank_bytes = max(game_bank_bytes, size)
        if 0xC000 <= address < 0xE000:
            static_wram_high = max(static_wram_high, address + size)
    return fixed_rom_high, game_bank_bytes, static_wram_high - 0xC000


def main() -> int:
    if len(sys.argv) not in (3, 4):
        print("usage: check_gbc_rom.py game.gb gbc_manifest.json [game.map]", file=sys.stderr)
        return 2
    rom_path = Path(sys.argv[1])
    manifest_path = Path(sys.argv[2])
    if not rom_path.is_file() or not manifest_path.is_file():
        print("GBC ROM or manifest is missing", file=sys.stderr)
        return 2
    rom = rom_path.read_bytes()
    if len(rom) < 0x150:
        print("GBC ROM is too short to contain a cartridge header", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    map_path = Path(sys.argv[3]) if len(sys.argv) == 4 else rom_path.with_suffix(".map")
    fixed_rom, game_bank, static_wram = map_usage(map_path) if map_path.is_file() else (0, 0, 0)
    collision_layers = int(manifest["collision_layer_count"])
    movement_layers = int(manifest["movement_layer_count"])
    movement_bytes = int(manifest["movement_bytes_per_cell"])
    object_count = int(manifest["object_count"])
    object_bytes = int(manifest["object_bytes_per_cell"])
    expected_movement_bytes = 1 if movement_layers <= 1 else 2 if movement_layers <= 3 else 4
    expected_object_bytes = 1 if object_count <= 8 else 2 if object_count <= 16 else 4
    checks = [
        ("CGB-only header flag", rom[0x143] == 0xC0, f"0x{rom[0x143]:02x}"),
        ("MBC5+RAM+battery type", rom[0x147] == 0x1B, f"0x{rom[0x147]:02x}"),
        ("32 KiB SRAM header", rom[0x149] == 0x03, f"0x{rom[0x149]:02x}"),
        ("ROM size", len(rom) <= MAX_ROM_BYTES, str(len(rom))),
        (
            "collision layers",
            1 <= collision_layers <= 32,
            str(collision_layers),
        ),
        (
            "compact movement layers",
            1 <= movement_layers <= 6 and movement_layers <= collision_layers,
            str(movement_layers),
        ),
        (
            "movement bytes per cell",
            movement_bytes == expected_movement_bytes,
            str(movement_bytes),
        ),
        (
            "object bytes per cell",
            object_bytes == expected_object_bytes,
            str(object_bytes),
        ),
        (
            "WRAM session",
            int(manifest["estimated_session_bytes"]) <= MAX_SESSION_BYTES,
            str(manifest["estimated_session_bytes"]),
        ),
        (
            "snapshot SRAM bank",
            int(manifest["snapshot_sram_bytes"]) <= MAX_SNAPSHOT_BANK_BYTES,
            str(manifest["snapshot_sram_bytes"]),
        ),
        (
            "estimated game ROM bank",
            int(manifest["estimated_game_rom_bank_bytes"]) <= 14 * 1024,
            str(manifest["estimated_game_rom_bank_bytes"]),
        ),
    ]
    if map_path.is_file():
        checks.extend(
            [
                ("fixed ROM bank", fixed_rom <= MAX_FIXED_ROM_BYTES, str(fixed_rom)),
                ("generated ROM bank", game_bank <= MAX_GAME_BANK_BYTES, str(game_bank)),
                ("static WRAM", static_wram <= MAX_STATIC_WRAM_BYTES, str(static_wram)),
            ]
        )
    failed = False
    for label, passed, value in checks:
        print(f"gbc-check {label}: value={value} status={'ok' if passed else 'FAILED'}")
        failed = failed or not passed
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
