#!/usr/bin/env python3
"""Build and bank-pack a multi-game PuzzleScript GBC cartridge."""

from __future__ import annotations

import argparse
import re
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from build_gbc_eligible_roms import ELIGIBLE_GAMES


ROM_BANK_BYTES = 16 * 1024
FIRST_CART_GAME_BANK = 3
LAST_CART_BANK = 255
OBJECT_CODE_AREA = re.compile(
    r"^(A\s+)_CODE_(\d+)(\s+size\s+)([0-9A-Fa-f]+)(\b.*)$"
)


@dataclass(frozen=True)
class CartItem:
    name: str
    size: int
    objects: tuple[Path, ...]
    pinned_bank: int | None = None


@dataclass
class CartBank:
    number: int
    used: int = 0
    items: list[CartItem] = field(default_factory=list)


@dataclass(frozen=True)
class CartIndexEntry:
    slug: str
    prefix: str
    title: str
    source_hash: int
    descriptor_bank: int
    session_bytes: int


def emit_cart_header(entries: Sequence[CartIndexEntry]) -> str:
    if not entries:
        raise ValueError("a cart needs at least one game")
    max_session = max(entry.session_bytes for entry in entries)
    return (
        "#pragma once\n\n"
        "#include <gb/gb.h>\n"
        "#include \"puzzlescript/gbc_cart.h\"\n\n"
        f"#define PS_GBC_CART_GAME_COUNT {len(entries)}U\n"
        f"#define PS_GBC_CART_MAX_SESSION_BYTES {max_session}U\n"
        "#define PS_GBC_CART_INDEX_BANK 2U\n\n"
        "bool ps_gbc_cart_copy_entry(\n"
        "    uint8_t index,\n"
        "    ps_gbc_cart_entry* entry) BANKED;\n"
    )


def _c_string(value: str, capacity: int) -> str:
    encoded = value.encode("ascii", errors="replace")[: capacity - 1]
    return json.dumps(encoded.decode("ascii"), ensure_ascii=True)


def emit_cart_source(entries: Sequence[CartIndexEntry]) -> str:
    if not entries:
        raise ValueError("a cart needs at least one game")
    declarations = "\n".join(
        "extern const ps_gbc_game_descriptor "
        f"{entry.prefix}_ps_gbc_generated_descriptor;"
        for entry in entries
    )
    rows = ",\n".join(
        "    {"
        f"{entry.descriptor_bank}U, "
        f"&{entry.prefix}_ps_gbc_generated_descriptor, "
        f"0x{entry.source_hash:08x}UL, "
        f"{_c_string(entry.title, 32)}"
        "}"
        for entry in entries
    )
    return (
        "#pragma bank 2\n\n"
        "#include \"generated_cart.h\"\n\n"
        f"{declarations}\n\n"
        "static const ps_gbc_cart_entry kCartEntries"
        "[PS_GBC_CART_GAME_COUNT] = {\n"
        f"{rows}\n"
        "};\n\n"
        "bool ps_gbc_cart_copy_entry(\n"
        "    uint8_t index,\n"
        "    ps_gbc_cart_entry* entry\n"
        ") BANKED {\n"
        "    if (entry == NULL || index >= PS_GBC_CART_GAME_COUNT) "
        "return false;\n"
        "    *entry = kCartEntries[index];\n"
        "    return true;\n"
        "}\n"
    )


def pack_items(
    items: Sequence[CartItem],
    *,
    first_bank: int,
    last_bank: int = LAST_CART_BANK,
    capacity: int = ROM_BANK_BYTES,
) -> list[CartBank]:
    if first_bank < 1 or first_bank > last_bank:
        raise ValueError(
            f"first bank {first_bank} is outside 1..{last_bank}"
        )
    banks: dict[int, CartBank] = {}
    unpinned: list[CartItem] = []
    for item in items:
        if item.size <= 0:
            raise ValueError(f"{item.name} has no banked code")
        if item.size > capacity:
            raise ValueError(
                f"{item.name} is oversize: {item.size} > {capacity}"
            )
        if item.pinned_bank is None:
            unpinned.append(item)
            continue
        if item.pinned_bank < first_bank or item.pinned_bank > last_bank:
            raise ValueError(
                f"{item.name} pins bank {item.pinned_bank} outside "
                f"{first_bank}..{last_bank}"
            )
        bank = banks.setdefault(
            item.pinned_bank, CartBank(number=item.pinned_bank)
        )
        if bank.used + item.size > capacity:
            raise ValueError(
                f"bank {bank.number} overflows while pinning {item.name}"
            )
        bank.items.append(item)
        bank.used += item.size

    for item in sorted(unpinned, key=lambda entry: (-entry.size, entry.name)):
        destination = next(
            (
                bank
                for bank in sorted(banks.values(), key=lambda entry: entry.number)
                if bank.used + item.size <= capacity
            ),
            None,
        )
        if destination is None:
            next_bank = max(banks, default=first_bank - 1) + 1
            while next_bank in banks:
                next_bank += 1
            if next_bank > last_bank:
                raise ValueError(
                    f"cart needs a bank beyond {last_bank} for {item.name}"
                )
            destination = CartBank(number=next_bank)
            banks[next_bank] = destination
        destination.items.append(item)
        destination.used += item.size
    return sorted(banks.values(), key=lambda entry: entry.number)


def _nonempty_code_areas(text: str) -> list[re.Match[str]]:
    areas: list[re.Match[str]] = []
    for line in text.splitlines():
        match = OBJECT_CODE_AREA.match(line)
        if match is not None and int(match.group(4), 16) != 0:
            areas.append(match)
    return areas


def relocate_code_area(text: str, bank: int) -> str:
    if bank < 1 or bank > LAST_CART_BANK:
        raise ValueError(f"bank {bank} is outside 1..{LAST_CART_BANK}")
    areas = _nonempty_code_areas(text)
    if len(areas) != 1:
        raise ValueError(
            f"expected one non-empty banked code area, found {len(areas)}"
        )
    source_bank = areas[0].group(2)
    return re.sub(
        rf"^(A\s+)_CODE_{re.escape(source_bank)}(\s+size\s+"
        r"[0-9A-Fa-f]+\b.*)$",
        rf"\1_CODE_{bank}\2",
        text,
        count=1,
        flags=re.MULTILINE,
    )


def object_code_size(path: Path) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    areas = _nonempty_code_areas(text)
    if len(areas) != 1:
        raise ValueError(
            f"{path}: expected one non-empty banked code area, "
            f"found {len(areas)}"
        )
    return int(areas[0].group(4), 16)


def relocate_object_code_area(path: Path, bank: int) -> None:
    text = path.read_text(encoding="utf-8", errors="replace")
    path.write_text(relocate_code_area(text, bank), encoding="utf-8")


def run_checked(command: Sequence[str], *, cwd: Path) -> None:
    completed = subprocess.run(
        list(command),
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"command failed ({completed.returncode}): "
            + " ".join(command)
            + "\n"
            + completed.stdout
        )


def compile_source(
    *,
    lcc: Path,
    source: Path,
    object_path: Path,
    include_directories: Sequence[Path],
    defines: Sequence[str] = (),
) -> None:
    object_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(lcc),
        "-msm83:gb",
        *[f"-I{path}" for path in include_directories],
        "-DPS_GBC_FREESTANDING=1",
        "-DPS_GBC_GENERATED_BUILD=1",
        "-Wf--max-allocs-per-node50000",
        *[f"-D{define}" for define in defines],
        "-c",
        "-o",
        str(object_path),
        str(source),
    ]
    run_checked(command, cwd=object_path.parent)


def _read_specialized_sources(export_directory: Path) -> list[Path]:
    sources_list = export_directory / "specialized_sources.list"
    if not sources_list.is_file():
        raise RuntimeError(
            f"specialized source list is missing: {sources_list}"
        )
    result: list[Path] = []
    for line in sources_list.read_text(encoding="utf-8").splitlines():
        name = line.strip()
        if name and name.endswith(".c"):
            result.append(export_directory / name)
    if not result:
        raise RuntimeError(f"specialized source list is empty: {sources_list}")
    return result


def _object_name(prefix: str, source: Path) -> str:
    return f"{prefix}_{source.stem}.o"


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def build_cart(
    *,
    repository: Path,
    compiler: Path,
    gbdk_home: Path,
    out: Path,
    games: Sequence[tuple[str, str]],
    cull: bool,
    autotest: bool,
) -> tuple[Path, Path]:
    repository = repository.resolve()
    compiler = compiler.resolve()
    gbdk_home = gbdk_home.resolve()
    out = out.resolve()
    lcc = gbdk_home / "bin" / "lcc"
    if not compiler.is_file():
        raise RuntimeError(f"compiler is missing: {compiler}")
    if not lcc.is_file():
        raise RuntimeError(f"GBDK lcc is missing: {lcc}")
    if not games:
        raise RuntimeError("cart needs at least one game")
    if len(games) > 253:
        raise RuntimeError("cart cannot reserve one core bank per game")

    exports_root = out / "exports"
    objects_root = out / "objects"
    generated_root = out / "generated"
    for directory in (exports_root, objects_root, generated_root):
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True)

    native_include = repository / "native" / "include"
    native_gbc = repository / "native" / "src" / "gbc"
    firmware_source = repository / "firmware" / "gbc" / "source"
    entries: list[CartIndexEntry] = []
    items: list[CartItem] = []
    game_records: list[dict[str, object]] = []
    all_game_objects: list[Path] = []

    for index, (slug, source_relative) in enumerate(games):
        prefix = f"g{index:02d}"
        game_bank = FIRST_CART_GAME_BANK + index
        source = repository / source_relative
        export_directory = exports_root / slug
        export_command = [
            str(compiler),
            "export-gbc",
            str(source),
            "--out",
            str(export_directory),
            "--symbol-prefix",
            prefix,
            "--bank-base",
            str(game_bank),
        ]
        if cull:
            export_command.append("--cull-oversize-levels")
        print(
            f"[{index + 1}/{len(games)}] export {slug} "
            f"prefix={prefix} core_bank={game_bank}",
            flush=True,
        )
        run_checked(export_command, cwd=repository)
        manifest_path = export_directory / "gbc_manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not manifest.get("specialized_turn"):
            raise RuntimeError(f"{slug} did not emit specialized turn code")

        include_directories = (
            export_directory,
            native_include,
            native_gbc,
        )
        core_source = export_directory / "generated_core.c"
        game_source = export_directory / "generated_game.c"
        facade_sources = (
            export_directory / "generated_compact_facade.c",
            export_directory / "generated_facade_rules.c",
        )
        specialized_sources = _read_specialized_sources(export_directory)

        core_objects: list[Path] = []
        for generated_source in (core_source, game_source):
            object_path = objects_root / _object_name(prefix, generated_source)
            compile_source(
                lcc=lcc,
                source=generated_source,
                object_path=object_path,
                include_directories=include_directories,
                defines=("PS_GBC_HAS_SPECIALIZED_TURN=1",),
            )
            core_objects.append(object_path)
            all_game_objects.append(object_path)
        core_size = sum(object_code_size(path) for path in core_objects)
        items.append(
            CartItem(
                name=f"{prefix}-core-data",
                size=core_size,
                objects=tuple(core_objects),
                pinned_bank=game_bank,
            )
        )

        facade_objects: list[Path] = []
        for generated_source in facade_sources:
            object_path = objects_root / _object_name(prefix, generated_source)
            compile_source(
                lcc=lcc,
                source=generated_source,
                object_path=object_path,
                include_directories=include_directories,
            )
            facade_objects.append(object_path)
            all_game_objects.append(object_path)
        items.append(
            CartItem(
                name=f"{prefix}-facade",
                size=sum(object_code_size(path) for path in facade_objects),
                objects=tuple(facade_objects),
            )
        )

        specialized_objects: list[Path] = []
        for generated_source in specialized_sources:
            object_path = objects_root / _object_name(prefix, generated_source)
            compile_source(
                lcc=lcc,
                source=generated_source,
                object_path=object_path,
                include_directories=include_directories,
                defines=("PS_GBC_HAS_SPECIALIZED_TURN=1",),
            )
            specialized_objects.append(object_path)
            all_game_objects.append(object_path)
            items.append(
                CartItem(
                    name=f"{prefix}-{generated_source.stem}",
                    size=object_code_size(object_path),
                    objects=(object_path,),
                )
            )

        entry = CartIndexEntry(
            slug=slug,
            prefix=prefix,
            title=str(manifest.get("title") or slug),
            source_hash=int(manifest["source_hash"]),
            descriptor_bank=game_bank,
            session_bytes=int(manifest["estimated_session_bytes"]),
        )
        entries.append(entry)
        game_records.append(
            {
                "index": index,
                "slug": slug,
                "source": source_relative,
                "prefix": prefix,
                "source_hash": entry.source_hash,
                "title": entry.title,
                "session_bytes": entry.session_bytes,
                "descriptor_bank": game_bank,
                "core_data_bytes": core_size,
                "specialized": True,
            }
        )

    banks = pack_items(items, first_bank=FIRST_CART_GAME_BANK)
    object_banks: dict[str, int] = {}
    for bank in banks:
        for packed_item in bank.items:
            for object_path in packed_item.objects:
                relocate_object_code_area(object_path, bank.number)
                object_banks[object_path.name] = bank.number

    (generated_root / "generated_cart.h").write_text(
        emit_cart_header(entries),
        encoding="utf-8",
    )
    (generated_root / "generated_cart.c").write_text(
        emit_cart_source(entries),
        encoding="utf-8",
    )

    shared_includes = (
        generated_root,
        exports_root / entries[0].slug,
        firmware_source,
        native_include,
        native_gbc,
    )
    shared_sources = (
        firmware_source / "main.c",
        firmware_source / "audio.c",
        firmware_source / "text.c",
        firmware_source / "tile_cache.c",
        firmware_source / "cart_launcher.c",
        firmware_source / "frontend_flow.c",
        native_gbc / "bank_access.c",
        firmware_source / "game_dispatch.c",
        native_gbc / "packed_cell.c",
    )
    shared_objects: list[Path] = []
    for shared_source in shared_sources:
        object_path = objects_root / f"shared_{shared_source.stem}.o"
        compile_source(
            lcc=lcc,
            source=shared_source,
            object_path=object_path,
            include_directories=shared_includes,
            defines=(
                "PS_GBC_CART_BUILD=1",
                *(("PS_GBC_CART_AUTOTEST=1",) if autotest else ()),
            ),
        )
        shared_objects.append(object_path)
    cart_index_object = objects_root / "cart_index.o"
    compile_source(
        lcc=lcc,
        source=generated_root / "generated_cart.c",
        object_path=cart_index_object,
        include_directories=shared_includes,
    )
    shared_objects.append(cart_index_object)

    rom_name = (
        f"puzzlescript-compilation-autotest-{len(entries)}.gb"
        if autotest
        else f"puzzlescript-compilation-{len(entries)}.gb"
    )
    rom = out / rom_name
    link_command = [
        str(lcc),
        "-msm83:gb",
        "-Wm-yC",
        "-Wm-yt0x1B",
        "-Wm-yo256",
        "-Wm-ya4",
        "-Wm-ynPSCOMPILATION",
        "-Wl-m",
        "-o",
        str(rom),
        *[str(path) for path in shared_objects],
        *[str(path) for path in all_game_objects],
    ]
    print(
        f"link {len(entries)} games across {len(banks)} packed game banks",
        flush=True,
    )
    run_checked(link_command, cwd=out)

    cart_manifest = out / "cart-manifest.json"
    _write_json(
        cart_manifest,
        {
            "format": "puzzlescript-gbc-cart-v1",
            "autotest": autotest,
            "game_count": len(entries),
            "index_bank": 2,
            "max_session_bytes": max(
                entry.session_bytes for entry in entries
            ),
            "highest_game_bank": max(bank.number for bank in banks),
            "packed_banks": [
                {
                    "bank": bank.number,
                    "used": bank.used,
                    "items": [item.name for item in bank.items],
                }
                for bank in banks
            ],
            "object_banks": object_banks,
            "games": game_records,
            "rom": str(rom),
        },
    )
    return rom, cart_manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--compiler", type=Path)
    parser.add_argument("--gbdk-home", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("build/gbc/cart"))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--autotest", action="store_true")
    parser.add_argument(
        "--cull",
        action=argparse.BooleanOptionalAction,
        default=True,
    )
    args = parser.parse_args()
    repository = args.repository.resolve()
    compiler = args.compiler or (
        repository / "build" / "native" / "puzzlescript_cpp"
    )
    out = args.out if args.out.is_absolute() else repository / args.out
    games = list(ELIGIBLE_GAMES)
    if args.limit is not None:
        if args.limit < 1:
            parser.error("--limit must be positive")
        games = games[: args.limit]
    try:
        rom, manifest = build_cart(
            repository=repository,
            compiler=compiler,
            gbdk_home=args.gbdk_home,
            out=out,
            games=games,
            cull=args.cull,
            autotest=args.autotest,
        )
    except (OSError, RuntimeError, ValueError) as error:
        print(f"gbc-cart: {error}", file=sys.stderr)
        return 1
    print(f"wrote {rom}")
    print(f"wrote {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
