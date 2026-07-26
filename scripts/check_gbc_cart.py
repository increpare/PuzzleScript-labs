#!/usr/bin/env python3
"""Validate a linked PuzzleScript multi-game GBC cartridge."""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


OBJECT_AREA = re.compile(r"^A\s+(\S+)\s+size\s+([0-9A-Fa-f]+)\b")
MAP_AREA = re.compile(
    r"^([._A-Za-z][._A-Za-z0-9]*)\s+"
    r"([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{8})\s+="
)
STATIC_AREAS = {"_DATA", "_BSS", "_INITIALIZED"}
CODE_AREA = re.compile(r"_CODE_(\d+)")
MAX_ROM_BYTES = 4 * 1024 * 1024
MAX_HOME_BYTES = 8 * 1024
MAX_BANK_BYTES = 16 * 1024


@dataclass(frozen=True)
class CartCheck:
    label: str
    passed: bool
    value: str


def object_areas(path: Path) -> dict[str, int]:
    areas: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = OBJECT_AREA.match(line)
        if match:
            areas[match.group(1)] = int(match.group(2), 16)
    return areas


def generated_static_areas(
    paths: Iterable[Path],
) -> dict[str, dict[str, int]]:
    offenders: dict[str, dict[str, int]] = {}
    for path in paths:
        areas = {
            name: size
            for name, size in object_areas(path).items()
            if name in STATIC_AREAS and size != 0
        }
        if areas:
            offenders[path.name] = areas
    return offenders


def object_code_banks(path: Path) -> set[int]:
    banks: set[int] = set()
    for name, size in object_areas(path).items():
        match = CODE_AREA.fullmatch(name)
        if match is not None and size != 0:
            banks.add(int(match.group(1)))
    return banks


def map_areas(path: Path) -> dict[str, tuple[int, int]]:
    areas: dict[str, tuple[int, int]] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = MAP_AREA.match(line)
        if match is not None:
            areas[match.group(1)] = (
                int(match.group(2), 16),
                int(match.group(3), 16),
            )
    return areas


def check_named(checks: Iterable[CartCheck], label: str) -> CartCheck:
    return next(check for check in checks if check.label == label)


def _declared_rom_bytes(code: int) -> int | None:
    if 0 <= code <= 8:
        return 32 * 1024 << code
    return {
        0x52: 1152 * 1024,
        0x53: 1280 * 1024,
        0x54: 1536 * 1024,
    }.get(code)


def evaluate_cart(
    rom: bytes,
    manifest: dict[str, object],
    areas: dict[str, tuple[int, int]],
    object_paths: Iterable[Path],
    *,
    expected_games: int = 46,
) -> list[CartCheck]:
    games = list(manifest.get("games", []))
    packed_banks = list(manifest.get("packed_banks", []))
    object_banks = dict(manifest.get("object_banks", {}))
    object_paths = list(object_paths)
    fixed_high = max(
        (
            address + size
            for name, (address, size) in areas.items()
            if name.startswith("_HEADER") or 0 < address < 0x4000
        ),
        default=0,
    )
    bank_sizes = {
        int(name.removeprefix("_CODE_")): size
        for name, (_address, size) in areas.items()
        if re.fullmatch(r"_CODE_\d+", name)
    }
    header_ok = (
        len(rom) >= 0x150
        and rom[0x143] == 0xC0
        and rom[0x147] == 0x1B
        and rom[0x149] == 0x03
    )
    declared_rom = (
        _declared_rom_bytes(rom[0x148]) if len(rom) >= 0x150 else None
    )
    rom_size_ok = (
        len(rom) <= MAX_ROM_BYTES
        and declared_rom is not None
        and len(rom) == declared_rom
    )
    prefixes = [str(game.get("prefix", "")) for game in games]
    hashes = [int(game.get("source_hash", -1)) for game in games]
    identities_ok = (
        len(prefixes) == len(set(prefixes))
        and len(hashes) == len(set(hashes))
        and all(
            game.get("index") == index
            and prefix == f"g{index:02d}"
            for index, (game, prefix) in enumerate(zip(games, prefixes))
        )
    )
    specialized_ok = all(game.get("specialized") is True for game in games)
    bank_range_ok = (
        int(manifest.get("index_bank", -1)) == 2
        and 2 <= int(manifest.get("highest_game_bank", -1)) <= 255
        and all(
            3 <= int(bank.get("bank", -1)) <= 255
            for bank in packed_banks
        )
    )
    map_banks_ok = (
        bool(bank_sizes)
        and max(bank_sizes, default=0) <= 255
        and all(size <= MAX_BANK_BYTES for size in bank_sizes.values())
        and all(
            int(bank.get("used", MAX_BANK_BYTES + 1)) <= MAX_BANK_BYTES
            for bank in packed_banks
        )
    )
    ownership_errors: list[str] = []
    actual_paths = {path.name: path for path in object_paths}
    for game in games:
        prefix = str(game.get("prefix", ""))
        descriptor_bank = int(game.get("descriptor_bank", -1))
        for stem in ("generated_core", "generated_game"):
            name = f"{prefix}_{stem}.o"
            if object_banks.get(name) != descriptor_bank:
                ownership_errors.append(f"{name}:manifest")
                continue
            path = actual_paths.get(name)
            if path is None or object_code_banks(path) != {descriptor_bank}:
                ownership_errors.append(f"{name}:object")
    static_offenders = generated_static_areas(
        path for path in object_paths if path.name.startswith("g")
    )
    return [
        CartCheck(
            "cartridge header",
            header_ok,
            (
                "missing"
                if len(rom) < 0x150
                else (
                    f"cgb=0x{rom[0x143]:02x} "
                    f"type=0x{rom[0x147]:02x} "
                    f"ram=0x{rom[0x149]:02x}"
                )
            ),
        ),
        CartCheck(
            "ROM size",
            rom_size_ok,
            f"{len(rom)} declared={declared_rom}",
        ),
        CartCheck("HOME", fixed_high <= MAX_HOME_BYTES, str(fixed_high)),
        CartCheck(
            "ROM bank sizes",
            map_banks_ok,
            str(max(bank_sizes.values(), default=0)),
        ),
        CartCheck(
            "bank range",
            bank_range_ok,
            str(manifest.get("highest_game_bank")),
        ),
        CartCheck(
            "game count",
            manifest.get("game_count") == expected_games
            and len(games) == expected_games,
            f"{manifest.get('game_count')}/{len(games)}",
        ),
        CartCheck(
            "game identities",
            identities_ok,
            f"prefixes={len(set(prefixes))} hashes={len(set(hashes))}",
        ),
        CartCheck(
            "specialization",
            specialized_ok,
            f"{sum(game.get('specialized') is True for game in games)}/{len(games)}",
        ),
        CartCheck(
            "core/data ownership",
            not ownership_errors,
            json.dumps(ownership_errors),
        ),
        CartCheck(
            "per-game static WRAM",
            not static_offenders,
            json.dumps(static_offenders, sort_keys=True),
        ),
    ]


def check_cart(
    rom_path: Path,
    manifest_path: Path,
    map_path: Path,
    objects_directory: Path,
    *,
    expected_games: int = 46,
) -> list[CartCheck]:
    return evaluate_cart(
        rom_path.read_bytes(),
        json.loads(manifest_path.read_text(encoding="utf-8")),
        map_areas(map_path),
        sorted(objects_directory.glob("g*.o")),
        expected_games=expected_games,
    )


def main() -> int:
    if len(sys.argv) != 5:
        print(
            "usage: check_gbc_cart.py game.gb cart-manifest.json "
            "game.map objects-directory",
            file=sys.stderr,
        )
        return 2
    paths = [Path(argument) for argument in sys.argv[1:]]
    if not all(path.exists() for path in paths):
        print("GBC cart input is missing", file=sys.stderr)
        return 2
    checks = check_cart(paths[0], paths[1], paths[2], paths[3])
    for check in checks:
        print(
            f"gbc-cart-check {check.label}: value={check.value} "
            f"status={'ok' if check.passed else 'FAILED'}"
        )
    return 0 if all(check.passed for check in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
