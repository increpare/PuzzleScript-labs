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
OBJECT_HEADER_RECORD = re.compile(
    r"^H\s+([0-9A-Fa-f]+)\s+areas\s+"
    r"([0-9A-Fa-f]+)\s+global symbols$"
)
OBJECT_AREA_RECORD = re.compile(
    r"^A\s+(\S+)\s+size\s+([0-9A-Fa-f]+)\s+"
    r"flags\s+([0-9A-Fa-f]+)\s+addr\s+([0-9A-Fa-f]+)$"
)
OBJECT_SYMBOL_RECORD = re.compile(
    r"^S\s+(\S+)\s+(Def|Ref)([0-9A-Fa-f]{8})$"
)
OBJECT_MODULE_RECORD = re.compile(r"^M\s+\S+$")
OBJECT_TEXT_RECORD = re.compile(r"^T(?:\s+[0-9A-Fa-f]{2})+$")
OBJECT_RELOCATION_RECORD = re.compile(
    r"^R(?:\s+[0-9A-Fa-f]{2})+$"
)
MAP_AREA = re.compile(
    r"^([._A-Za-z][._A-Za-z0-9]*)\s+"
    r"([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{8})\s+="
)
STATIC_AREAS = {"_DATA", "_BSS", "_INITIALIZED"}
CODE_AREA = re.compile(r"_CODE_(\d+)")
MAX_ROM_BYTES = 4 * 1024 * 1024
MAX_HOME_BYTES = 8 * 1024
MAX_BANK_BYTES = 16 * 1024
COMPACT_FACADE_SHARING_MODE = "same-bank-alias-canary-v1"
COMPACT_FACADE_OWNER = "g21"
COMPACT_FACADE_MEMBER = "g31"
COMPACT_FACADE_MEMBERS = (
    COMPACT_FACADE_OWNER,
    COMPACT_FACADE_MEMBER,
)
COMPACT_FACADE_SUFFIXES = (
    "ps_gbc_facade_get_movements",
    "ps_gbc_facade_set_movements",
    "ps_gbc_facade_get_objects",
    "ps_gbc_facade_cell_has_all",
    "ps_gbc_facade_set_objects",
    "ps_gbc_facade_cell_has_any",
    "ps_gbc_facade_cell_count",
    "ps_gbc_facade_mark_dirty",
)
COMPACT_FACADE_ALIASES = tuple(
    sorted(
        f"{COMPACT_FACADE_MEMBER}_{suffix}"
        for suffix in COMPACT_FACADE_SUFFIXES
    )
)
COMPACT_FACADE_IMPLEMENTATION_BYTES = 349
_MISSING_SHARING = object()


@dataclass(frozen=True)
class CartCheck:
    label: str
    passed: bool
    value: str


@dataclass(frozen=True)
class _AsxxxxEvidence:
    definitions: dict[str, int]
    code_bank: int
    code_size: int


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


def _read_asxxxx_object(path: Path) -> str:
    with path.open(
        "r",
        encoding="ascii",
        errors="strict",
        newline="",
    ) as source:
        return source.read()


def _parse_asxxxx_evidence(text: str) -> _AsxxxxEvidence:
    lines = text.splitlines()
    if not lines or lines[0] != "XL4":
        raise ValueError("object must begin with an exact XL4 record")
    headers: list[tuple[int, int]] = []
    symbol_count = 0
    definitions: dict[str, int] = {}
    nonempty_code_areas: list[tuple[int, int]] = []
    for line in lines[1:]:
        if line.startswith("H"):
            match = OBJECT_HEADER_RECORD.fullmatch(line)
            if match is None:
                raise ValueError(f"malformed header record: {line!r}")
            headers.append(
                (
                    int(match.group(1), 16),
                    int(match.group(2), 16),
                )
            )
            continue
        if line.startswith("S"):
            match = OBJECT_SYMBOL_RECORD.fullmatch(line)
            if match is None:
                raise ValueError(f"malformed symbol record: {line!r}")
            symbol_count += 1
            if match.group(2) != "Def":
                continue
            name = match.group(1)
            if name in definitions:
                raise ValueError(f"duplicate definition: {name}")
            definitions[name] = int(match.group(3), 16)
            continue
        if line.startswith("A"):
            match = OBJECT_AREA_RECORD.fullmatch(line)
            if match is None:
                raise ValueError(f"malformed area record: {line!r}")
            code = CODE_AREA.fullmatch(match.group(1))
            size = int(match.group(2), 16)
            if code is not None and size != 0:
                nonempty_code_areas.append(
                    (int(code.group(1)), size)
                )
            continue
        if line.startswith("M"):
            if OBJECT_MODULE_RECORD.fullmatch(line) is None:
                raise ValueError(f"malformed module record: {line!r}")
            continue
        if line.startswith("T"):
            if OBJECT_TEXT_RECORD.fullmatch(line) is None:
                raise ValueError(f"malformed text record: {line!r}")
            continue
        if line.startswith("R"):
            if OBJECT_RELOCATION_RECORD.fullmatch(line) is None:
                raise ValueError(
                    f"malformed relocation record: {line!r}"
                )
            continue
        raise ValueError(f"unrecognized object record: {line!r}")

    if len(headers) != 1:
        raise ValueError(
            f"expected one H record, found {len(headers)}"
        )
    _declared_area_count, declared_symbol_count = headers[0]
    if declared_symbol_count != symbol_count:
        raise ValueError(
            "global-symbol count mismatch: "
            f"declared {declared_symbol_count:X}, "
            f"found {symbol_count:X}"
        )
    if len(nonempty_code_areas) != 1:
        raise ValueError(
            "expected one nonempty _CODE_N area, "
            f"found {len(nonempty_code_areas)}"
        )
    code_bank, code_size = nonempty_code_areas[0]
    return _AsxxxxEvidence(
        definitions=definitions,
        code_bank=code_bank,
        code_size=code_size,
    )


def _sharing_check(
    label: str,
    passed: bool,
    errors: list[str],
    *,
    disabled: bool = False,
) -> CartCheck:
    if disabled:
        value = "disabled"
    else:
        value = "ok" if not errors else json.dumps(errors)
    return CartCheck(label, passed, value)


def _compact_facade_sharing_checks(
    sharing: object,
    object_banks: dict[str, object],
    object_paths: Iterable[Path],
) -> list[CartCheck]:
    labels = (
        "compact facade aliases",
        "compact facade same-bank capacity",
        "compact facade duplicate omission",
        "compact facade sharing metadata",
    )
    if sharing is _MISSING_SHARING:
        return [
            _sharing_check(label, True, [], disabled=True)
            for label in labels
        ]
    if not isinstance(sharing, dict):
        errors = ["compact_facade_sharing must be an object"]
        return [
            _sharing_check(label, False, errors)
            for label in labels
        ]

    paths_by_name: dict[str, list[Path]] = {}
    for path in object_paths:
        paths_by_name.setdefault(path.name, []).append(path)

    owner_object_name = (
        f"{COMPACT_FACADE_OWNER}_generated_compact_facade.o"
    )
    retained_names = (
        owner_object_name,
        f"{COMPACT_FACADE_OWNER}_generated_facade_rules.o",
        f"{COMPACT_FACADE_MEMBER}_generated_facade_rules.o",
    )
    omitted_name = (
        f"{COMPACT_FACADE_MEMBER}_generated_compact_facade.o"
    )

    evidence_by_name: dict[str, _AsxxxxEvidence] = {}
    evidence_errors: dict[str, str] = {}
    for name in retained_names:
        paths = paths_by_name.get(name, [])
        if len(paths) != 1:
            evidence_errors[name] = (
                f"expected one linked object, found {len(paths)}"
            )
            continue
        try:
            evidence_by_name[name] = _parse_asxxxx_evidence(
                _read_asxxxx_object(paths[0])
            )
        except (OSError, UnicodeError, ValueError) as error:
            evidence_errors[name] = str(error)

    alias_errors: list[str] = []
    owner_definitions: dict[str, int] = {}
    owner_evidence = evidence_by_name.get(owner_object_name)
    if owner_evidence is None:
        alias_errors.append(
            f"{owner_object_name}: "
            f"{evidence_errors.get(owner_object_name, 'invalid object')}"
        )
    else:
        owner_definitions = owner_evidence.definitions

    expected_owner_names = {
        f"_{COMPACT_FACADE_OWNER}_{suffix}"
        for suffix in COMPACT_FACADE_SUFFIXES
    }
    expected_alias_names = {
        f"_{COMPACT_FACADE_MEMBER}_{suffix}"
        for suffix in COMPACT_FACADE_SUFFIXES
    }
    actual_owner_names = {
        name
        for name in owner_definitions
        if name.startswith(f"_{COMPACT_FACADE_OWNER}_")
    }
    actual_alias_names = {
        name
        for name in owner_definitions
        if name.startswith(f"_{COMPACT_FACADE_MEMBER}_")
    }
    if actual_owner_names != expected_owner_names:
        alias_errors.append(
            "owner definitions differ: "
            f"missing={sorted(expected_owner_names - actual_owner_names)} "
            f"extra={sorted(actual_owner_names - expected_owner_names)}"
        )
    if actual_alias_names != expected_alias_names:
        alias_errors.append(
            "alias definitions differ: "
            f"missing={sorted(expected_alias_names - actual_alias_names)} "
            f"extra={sorted(actual_alias_names - expected_alias_names)}"
        )
    unequal_addresses = [
        suffix
        for suffix in COMPACT_FACADE_SUFFIXES
        if owner_definitions.get(
            f"_{COMPACT_FACADE_OWNER}_{suffix}"
        )
        != owner_definitions.get(
            f"_{COMPACT_FACADE_MEMBER}_{suffix}"
        )
    ]
    if unequal_addresses:
        alias_errors.append(
            "normalized definition addresses differ: "
            + ", ".join(unequal_addresses)
        )

    bank_errors: list[str] = []
    layouts: dict[str, tuple[int, int]] = {}
    for name in retained_names:
        evidence = evidence_by_name.get(name)
        if evidence is None:
            bank_errors.append(
                f"{name}: "
                f"{evidence_errors.get(name, 'invalid object')}"
            )
            continue
        layouts[name] = (evidence.code_bank, evidence.code_size)
    sharing_bank = sharing.get("bank")
    if len(layouts) == len(retained_names):
        code_banks = {bank for bank, _size in layouts.values()}
        if len(code_banks) != 1:
            bank_errors.append(
                f"linked code banks differ: {sorted(code_banks)}"
            )
        for name, (code_bank, _size) in layouts.items():
            if object_banks.get(name) != code_bank:
                bank_errors.append(
                    f"{name}: object bank {code_bank}, "
                    f"manifest bank {object_banks.get(name)!r}"
                )
            if sharing_bank != code_bank:
                bank_errors.append(
                    f"{name}: sharing bank {sharing_bank!r}, "
                    f"object bank {code_bank}"
                )
        compound_bytes = sum(size for _bank, size in layouts.values())
        if compound_bytes > MAX_BANK_BYTES:
            bank_errors.append(
                f"compound code bytes {compound_bytes} > {MAX_BANK_BYTES}"
            )

    omission_errors: list[str] = []
    if paths_by_name.get(omitted_name):
        omission_errors.append(f"{omitted_name}: linked object retained")
    if omitted_name in object_banks:
        omission_errors.append(f"{omitted_name}: bank ownership retained")

    metadata_errors: list[str] = []
    required_fields = {
        "mode",
        "owner",
        "members",
        "normalized_sha256",
        "implementation_bytes",
        "gross_removed_bytes",
        "bank",
        "aliases",
    }
    missing_fields = sorted(required_fields - sharing.keys())
    if missing_fields:
        metadata_errors.append(
            "missing fields: " + ", ".join(missing_fields)
        )
    if sharing.get("mode") != COMPACT_FACADE_SHARING_MODE:
        metadata_errors.append(f"mode={sharing.get('mode')!r}")
    if sharing.get("owner") != COMPACT_FACADE_OWNER:
        metadata_errors.append(f"owner={sharing.get('owner')!r}")
    if sharing.get("members") != list(COMPACT_FACADE_MEMBERS):
        metadata_errors.append(f"members={sharing.get('members')!r}")
    digest = sharing.get("normalized_sha256")
    if not isinstance(digest, str) or re.fullmatch(
        r"[0-9a-f]{64}",
        digest,
    ) is None:
        metadata_errors.append(f"normalized_sha256={digest!r}")
    if (
        sharing.get("implementation_bytes")
        != COMPACT_FACADE_IMPLEMENTATION_BYTES
    ):
        metadata_errors.append(
            f"implementation_bytes="
            f"{sharing.get('implementation_bytes')!r}"
        )
    if (
        sharing.get("gross_removed_bytes")
        != COMPACT_FACADE_IMPLEMENTATION_BYTES
    ):
        metadata_errors.append(
            f"gross_removed_bytes="
            f"{sharing.get('gross_removed_bytes')!r}"
        )
    if (
        not isinstance(sharing_bank, int)
        or isinstance(sharing_bank, bool)
        or not 3 <= sharing_bank <= 255
    ):
        metadata_errors.append(f"bank={sharing_bank!r}")
    if sharing.get("aliases") != list(COMPACT_FACADE_ALIASES):
        metadata_errors.append(f"aliases={sharing.get('aliases')!r}")
    owner_layout = layouts.get(owner_object_name)
    if (
        owner_layout is None
        or owner_layout[1] != COMPACT_FACADE_IMPLEMENTATION_BYTES
    ):
        metadata_errors.append(
            "owner implementation code bytes="
            f"{None if owner_layout is None else owner_layout[1]}"
        )

    return [
        _sharing_check(
            "compact facade aliases",
            not alias_errors,
            alias_errors,
        ),
        _sharing_check(
            "compact facade same-bank capacity",
            not bank_errors,
            bank_errors,
        ),
        _sharing_check(
            "compact facade duplicate omission",
            not omission_errors,
            omission_errors,
        ),
        _sharing_check(
            "compact facade sharing metadata",
            not metadata_errors,
            metadata_errors,
        ),
    ]


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
    checks = [
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
    checks.extend(
        _compact_facade_sharing_checks(
            manifest.get(
                "compact_facade_sharing",
                _MISSING_SHARING,
            ),
            object_banks,
            object_paths,
        )
    )
    return checks


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
