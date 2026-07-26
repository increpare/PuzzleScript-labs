#!/usr/bin/env python3
"""Validate the linked PuzzleScript CGB cartridge and exported RAM budgets."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


MAX_ROM_BYTES = 512 * 1024
MAX_SESSION_BYTES = 4 * 1024
MAX_SNAPSHOT_BANK_BYTES = 8 * 1024
MAX_FIXED_ROM_BYTES = 16 * 1024
MAX_FOUNDATION_HOME_BYTES = 8 * 1024
MAX_GAME_BANK_BYTES = 16 * 1024
MAX_STATIC_WRAM_BYTES = 6 * 1024
MAP_AREA = re.compile(
    r"^([._A-Za-z][._A-Za-z0-9]*)\s+([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{8})\s+="
)
OBJECT_AREA = re.compile(
    r"^A\s+(\S+)\s+size\s+([0-9A-Fa-f]+)\b"
)
OBJECT_REFERENCE = re.compile(r"^S\s+(\S+)\s+Ref")
OBJECT_CODE_BANK = re.compile(r"_CODE_(\d+)")
GENERATED_STATIC_AREAS = {"_DATA", "_BSS", "_INITIALIZED"}
SHARED_OBJECTS = (
    "audio.o",
    "text.o",
    "tile_cache.o",
    "autotest.o",
    "benchmark.o",
)


def map_banked_sizes(path: Path) -> dict[str, int]:
    sizes: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = MAP_AREA.match(line)
        if not match:
            continue
        name, _address_text, size_text = match.groups()
        if re.fullmatch(r"_CODE_\d+", name):
            sizes[name] = int(size_text, 16)
    return sizes


def map_usage(path: Path) -> tuple[int, int, int]:
    """Return (fixed_rom_high, banked_rom_bytes_sum, static_wram_bytes)."""
    fixed_rom_high = 0
    static_wram_high = 0xC000
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = MAP_AREA.match(line)
        if not match:
            continue
        name, address_text, _size_text = match.groups()
        address = int(address_text, 16)
        size = int(match.group(3), 16)
        if name.startswith("_HEADER") or (0 < address < 0x4000):
            fixed_rom_high = max(fixed_rom_high, address + size)
        if 0xC000 <= address < 0xE000:
            static_wram_high = max(static_wram_high, address + size)
    banked = sum(map_banked_sizes(path).values())
    return fixed_rom_high, banked, static_wram_high - 0xC000


def object_areas(path: Path) -> dict[str, int]:
    areas: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = OBJECT_AREA.match(line)
        if match:
            areas[match.group(1)] = int(match.group(2), 16)
    return areas


def object_code_banks(path: Path) -> set[int]:
    banks: set[int] = set()
    for area in object_areas(path):
        match = OBJECT_CODE_BANK.fullmatch(area)
        if match:
            banks.add(int(match.group(1)))
    return banks


def forbidden_generated_references(path: Path) -> list[str]:
    references: set[str] = set()
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = OBJECT_REFERENCE.match(line)
        if not match:
            continue
        symbol = match.group(1).lstrip("_")
        if "ps_gbc_generated_" in symbol:
            references.add(symbol)
    return sorted(references)


def generated_static_bytes(build_dir: Path) -> dict[str, int]:
    totals: dict[str, int] = {}
    for path in sorted(build_dir.glob("generated*.o")):
        areas = object_areas(path)
        total = sum(areas.get(name, 0) for name in GENERATED_STATIC_AREAS)
        if total:
            totals[path.name] = total
    return totals


def default_build_directory(map_path: Path) -> Path:
    stem = map_path.stem
    autotest_prefix = "puzzlescript_gbc_autotest"
    production_prefix = "puzzlescript_gbc"
    if stem.startswith(autotest_prefix):
        return map_path.parent / f"build-autotest{stem[len(autotest_prefix):]}"
    if stem.startswith(production_prefix):
        return map_path.parent / f"build{stem[len(production_prefix):]}"
    return map_path.parent / "build"


def main() -> int:
    if len(sys.argv) not in (3, 4, 5):
        print(
            "usage: check_gbc_rom.py game.gb gbc_manifest.json "
            "[game.map] [build-dir]",
            file=sys.stderr,
        )
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
    if len(sys.argv) == 5:
        map_path = Path(sys.argv[3])
    build_dir = (
        Path(sys.argv[4])
        if len(sys.argv) == 5
        else default_build_directory(map_path)
    )
    fixed_rom, game_bank, static_wram = map_usage(map_path) if map_path.is_file() else (0, 0, 0)
    bank_sizes = map_banked_sizes(map_path) if map_path.is_file() else {}
    largest_bank = max(bank_sizes.values()) if bank_sizes else game_bank
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
        game_core_bank = int(manifest["game_core_bank"])
        bank_base = int(manifest["bank_base"])
        facade_bank = int(manifest["facade_bank"])
        specialized_main_bank = int(manifest["specialized_main_bank"])
        specialized_first_rules_bank = int(
            manifest["specialized_first_rules_bank"]
        )
        next_bank = int(manifest["next_bank"])
        specialized_turn = bool(manifest["specialized_turn"])
        allocated_banks = [game_core_bank, facade_bank]
        if specialized_turn:
            allocated_banks.append(specialized_main_bank)
        valid_manifest_range = (
            bank_base >= 2
            and game_core_bank == bank_base
            and facade_bank == game_core_bank + 1
            and specialized_main_bank == facade_bank + 1
            and specialized_first_rules_bank == specialized_main_bank + 1
            and all(2 <= bank < 256 for bank in allocated_banks)
            and specialized_first_rules_bank >= 2
            and specialized_first_rules_bank <= 256
            and max(allocated_banks) < next_bank <= 256
        )
        checks.extend(
            [
                ("fixed ROM bank", fixed_rom <= MAX_FIXED_ROM_BYTES, str(fixed_rom)),
                (
                    "foundation HOME budget",
                    fixed_rom <= MAX_FOUNDATION_HOME_BYTES,
                    str(fixed_rom),
                ),
                (
                    "largest generated ROM bank",
                    largest_bank <= MAX_GAME_BANK_BYTES,
                    str(largest_bank),
                ),
                ("static WRAM", static_wram <= MAX_STATIC_WRAM_BYTES, str(static_wram)),
                (
                    "manifest ROM bank range",
                    valid_manifest_range,
                    (
                        f"{bank_base}..{next_bank - 1} "
                        f"core={game_core_bank} facade={facade_bank} "
                        f"specialized={specialized_main_bank}"
                    ),
                ),
            ]
        )
        if build_dir.is_dir():
            expected_banks = {game_core_bank}
            core_path = build_dir / "core.o"
            game_path = build_dir / "generated_game.o"
            core_banks = (
                object_code_banks(core_path) if core_path.is_file() else set()
            )
            game_banks = (
                object_code_banks(game_path) if game_path.is_file() else set()
            )
            forbidden = {
                name: references
                for name in SHARED_OBJECTS
                if (build_dir / name).is_file()
                if (references := forbidden_generated_references(build_dir / name))
            }
            generated_statics = generated_static_bytes(build_dir)
            checks.extend(
                [
                    (
                        "core object bank ownership",
                        core_banks == expected_banks,
                        str(sorted(core_banks)),
                    ),
                    (
                        "game object bank ownership",
                        game_banks == expected_banks,
                        str(sorted(game_banks)),
                    ),
                    (
                        "shared generated references",
                        not forbidden,
                        json.dumps(forbidden, sort_keys=True),
                    ),
                    (
                        "generated static WRAM",
                        not generated_statics,
                        json.dumps(generated_statics, sort_keys=True),
                    ),
                ]
            )
        else:
            checks.append(
                (
                    "object build directory",
                    False,
                    str(build_dir),
                )
            )
    failed = False
    for label, passed, value in checks:
        print(f"gbc-check {label}: value={value} status={'ok' if passed else 'FAILED'}")
        failed = failed or not passed
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
