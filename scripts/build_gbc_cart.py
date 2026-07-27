#!/usr/bin/env python3
"""Build and bank-pack a multi-game PuzzleScript GBC cartridge."""

from __future__ import annotations

import argparse
import re
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Sequence

from build_gbc_eligible_roms import ELIGIBLE_GAMES


ROM_BANK_BYTES = 16 * 1024
FIRST_CART_GAME_BANK = 3
LAST_CART_BANK = 255
LAUNCHER_PAGE_SIZE = 8
LAUNCHER_BAND_TILES = 40
LAUNCHER_BAND_BYTES = LAUNCHER_BAND_TILES * 16
OBJECT_CODE_AREA = re.compile(
    r"^(A\s+)_CODE_(\d+)(\s+size\s+)([0-9A-Fa-f]+)(\b.*)$"
)
OBJECT_BANK_SYMBOL = re.compile(
    r"^(S\s+b_\S+\s+Def)([0-9A-Fa-f]{8})(\b.*)$",
    re.MULTILINE,
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
class LauncherCard:
    palette: tuple[int, ...]
    background_tile: tuple[int, ...]
    player_pixels: tuple[int, ...]
    level_count: int
    board_level_count: int
    level_is_board_bits: tuple[int, ...]
    detail_colors_reduced: bool


@dataclass(frozen=True)
class LauncherArt:
    bands: bytes
    progress_variant_count: int


@dataclass(frozen=True)
class CartIndexEntry:
    slug: str
    prefix: str
    title: str
    source_hash: int
    descriptor_bank: int
    session_bytes: int
    launcher_art_bank: int
    launcher_card: LauncherCard


_LAUNCHER_ROW_OFFSETS = (
    0, 2, 4, 6, 8, 10, 12, 14,
    320, 322, 324, 326, 328, 330, 332, 334,
)
_LAUNCHER_PIXEL_MASKS = (
    0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01,
)
_LAUNCHER_GLYPHS = (
    (0x7E, 0x11, 0x11, 0x11, 0x7E),
    (0x7F, 0x49, 0x49, 0x49, 0x36),
    (0x3E, 0x41, 0x41, 0x41, 0x22),
    (0x7F, 0x41, 0x41, 0x22, 0x1C),
    (0x7F, 0x49, 0x49, 0x49, 0x41),
    (0x7F, 0x09, 0x09, 0x09, 0x01),
    (0x3E, 0x41, 0x49, 0x49, 0x7A),
    (0x7F, 0x08, 0x08, 0x08, 0x7F),
    (0x00, 0x41, 0x7F, 0x41, 0x00),
    (0x20, 0x40, 0x41, 0x3F, 0x01),
    (0x7F, 0x08, 0x14, 0x22, 0x41),
    (0x7F, 0x40, 0x40, 0x40, 0x40),
    (0x7F, 0x02, 0x0C, 0x02, 0x7F),
    (0x7F, 0x04, 0x08, 0x10, 0x7F),
    (0x3E, 0x41, 0x41, 0x41, 0x3E),
    (0x7F, 0x09, 0x09, 0x09, 0x06),
    (0x3E, 0x41, 0x51, 0x21, 0x5E),
    (0x7F, 0x09, 0x19, 0x29, 0x46),
    (0x46, 0x49, 0x49, 0x49, 0x31),
    (0x01, 0x01, 0x7F, 0x01, 0x01),
    (0x3F, 0x40, 0x40, 0x40, 0x3F),
    (0x1F, 0x20, 0x40, 0x20, 0x1F),
    (0x3F, 0x40, 0x38, 0x40, 0x3F),
    (0x63, 0x14, 0x08, 0x14, 0x63),
    (0x07, 0x08, 0x70, 0x08, 0x07),
    (0x61, 0x51, 0x49, 0x45, 0x43),
    (0x3E, 0x51, 0x49, 0x45, 0x3E),
    (0x00, 0x42, 0x7F, 0x40, 0x00),
    (0x62, 0x51, 0x49, 0x49, 0x46),
    (0x22, 0x41, 0x49, 0x49, 0x36),
    (0x18, 0x14, 0x12, 0x7F, 0x10),
    (0x2F, 0x49, 0x49, 0x49, 0x31),
    (0x3E, 0x49, 0x49, 0x49, 0x32),
    (0x01, 0x71, 0x09, 0x05, 0x03),
    (0x36, 0x49, 0x49, 0x49, 0x36),
    (0x26, 0x49, 0x49, 0x49, 0x3E),
    (0x00, 0x60, 0x60, 0x00, 0x00),
    (0x08, 0x08, 0x08, 0x08, 0x08),
    (0x00, 0x36, 0x36, 0x00, 0x00),
    (0x00, 0x00, 0x5F, 0x00, 0x00),
    (0x02, 0x01, 0x51, 0x09, 0x06),
    (0x00, 0x40, 0x20, 0x00, 0x00),
    (0x00, 0x04, 0x03, 0x00, 0x00),
    (0x40, 0x20, 0x10, 0x0C, 0x03),
    (0x7F, 0x41, 0x41, 0x00, 0x00),
    (0x00, 0x00, 0x41, 0x41, 0x7F),
)


def _launcher_glyph_index(character: str) -> int:
    if "a" <= character <= "z":
        character = character.upper()
    if "A" <= character <= "Z":
        return 1 + ord(character) - ord("A")
    if "0" <= character <= "9":
        return 27 + ord(character) - ord("0")
    return {
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
    }.get(character, 0)


def _set_launcher_band_pixel(
    band: bytearray,
    x: int,
    y: int,
    color: int,
) -> None:
    offset = _LAUNCHER_ROW_OFFSETS[y] + (x >> 3) * 16
    mask = _LAUNCHER_PIXEL_MASKS[x & 7]
    band[offset] &= ~mask
    band[offset + 1] &= ~mask
    if color & 1:
        band[offset] |= mask
    if color & 2:
        band[offset + 1] |= mask


def launcher_band_pixel(
    band: bytes,
    x: int,
    y: int,
) -> int:
    if len(band) != LAUNCHER_BAND_BYTES:
        raise ValueError("launcher band has the wrong size")
    if x < 0 or x >= 160 or y < 0 or y >= 16:
        raise ValueError("launcher band pixel is out of range")
    offset = _LAUNCHER_ROW_OFFSETS[y] + (x >> 3) * 16
    shift = 7 - (x & 7)
    return (
        ((band[offset] >> shift) & 1)
        | (((band[offset + 1] >> shift) & 1) << 1)
    )


def _apply_launcher_row_mask(
    band: bytearray,
    x: int,
    y: int,
    pixels: int,
    foreground: bool,
) -> None:
    tile = x >> 3
    shift = 9 - (x & 7)
    shifted = (pixels << shift) & 0xFFFF
    offset = _LAUNCHER_ROW_OFFSETS[y] + tile * 16
    first = shifted >> 8
    second = shifted & 0xFF
    if foreground:
        band[offset] |= first
        band[offset + 1] |= first
        if tile < 19:
            band[offset + 16] |= second
            band[offset + 17] |= second
    else:
        band[offset] &= ~first
        band[offset + 1] &= ~first
        if tile < 19:
            band[offset + 16] &= ~second
            band[offset + 17] &= ~second


def _draw_launcher_text(
    band: bytearray,
    text: str,
    start_x: int,
    limit_x: int,
) -> None:
    for character_index, character in enumerate(text[:31]):
        character_x = start_x + character_index * 6
        if character_x + 5 >= limit_x:
            break
        glyph = _launcher_glyph_index(character)
        if glyph == 0:
            continue
        rows = [0] * 7
        for column in range(5):
            for row in range(7):
                if _LAUNCHER_GLYPHS[glyph - 1][column] & (1 << row):
                    rows[row] |= 1 << (4 - column)
        for row in range(-1, 8):
            neighbors = 0
            if row > 0:
                neighbors |= rows[row - 1]
            if 0 <= row < 7:
                neighbors |= rows[row]
            if row < 6:
                neighbors |= rows[row + 1]
            neighbors = (neighbors << 1) & 0xFF
            outline = (
                neighbors | (neighbors << 1) | (neighbors >> 1)
            ) & 0xFF
            _apply_launcher_row_mask(
                band,
                character_x - 1,
                row + 4,
                outline,
                False,
            )
        for row in range(7):
            _apply_launcher_row_mask(
                band,
                character_x - 1,
                row + 4,
                rows[row] << 1,
                True,
            )


def launcher_progress_labels(card: LauncherCard) -> tuple[str, ...]:
    if card.board_level_count == 0:
        return ("--", "DONE")
    return (
        "--",
        *(
            f"{board}/{card.board_level_count}"
            for board in range(1, card.board_level_count + 1)
        ),
        "DONE",
    )


def render_launcher_header_band(
    selected: int,
    game_count: int,
) -> bytes:
    if selected < 0 or selected >= game_count:
        raise ValueError("launcher header selection is out of range")
    counter = f"{selected + 1} / {game_count}"
    counter_x = 156 - len(counter) * 6
    band = bytearray(LAUNCHER_BAND_BYTES)
    _draw_launcher_text(band, "PUZZLESCRIPT", 4, counter_x)
    _draw_launcher_text(band, counter, counter_x, 158)
    for x in range(160):
        _set_launcher_band_pixel(band, x, 15, 3)
    return bytes(band)


def render_launcher_card_band(
    *,
    title: str,
    card: LauncherCard,
    game_index: int,
    game_count: int,
    progress: str,
) -> bytes:
    if game_index < 0 or game_index >= game_count:
        raise ValueError("launcher card index is out of range")
    band = bytearray(card.background_tile * LAUNCHER_BAND_TILES)
    for y in range(8):
        for x in range(8):
            player = card.player_pixels[y * 8 + x]
            if player != 0xFF:
                _set_launcher_band_pixel(band, x + 2, y + 4, player)
    progress_width = len(progress) * 6
    progress_x = 154 - progress_width if progress_width < 154 else 12
    _draw_launcher_text(band, title, 12, progress_x - 2)
    _draw_launcher_text(band, progress, progress_x, 158)
    first_visible = (
        game_index - game_index % LAUNCHER_PAGE_SIZE
    )
    thumb_top = first_visible * 128 // game_count
    thumb_height = max(
        4,
        LAUNCHER_PAGE_SIZE * 128 // game_count,
    )
    row = game_index - first_visible
    for y in range(16):
        global_y = row * 16 + y
        color = (
            3
            if thumb_top <= global_y < thumb_top + thumb_height
            else 0
        )
        _set_launcher_band_pixel(band, 158, y, color)
        _set_launcher_band_pixel(band, 159, y, color)
    return bytes(band)


def render_launcher_art(
    entry: CartIndexEntry,
    game_index: int,
    game_count: int,
) -> LauncherArt:
    progress = launcher_progress_labels(entry.launcher_card)
    bands = bytearray(
        render_launcher_header_band(game_index, game_count)
    )
    for label in progress:
        bands.extend(
            render_launcher_card_band(
                title=entry.title,
                card=entry.launcher_card,
                game_index=game_index,
                game_count=game_count,
                progress=label,
            )
        )
    if len(bands) > ROM_BANK_BYTES:
        raise ValueError(
            f"{entry.slug} launcher art is oversize: "
            f"{len(bands)} > {ROM_BANK_BYTES}"
        )
    return LauncherArt(
        bands=bytes(bands),
        progress_variant_count=len(progress),
    )


def emit_launcher_art_source(
    entry: CartIndexEntry,
    art: LauncherArt,
    bank: int,
) -> str:
    if (
        art.progress_variant_count <= 0
        or len(art.bands)
        != (art.progress_variant_count + 1) * LAUNCHER_BAND_BYTES
    ):
        raise ValueError(f"{entry.slug} launcher art is malformed")
    rows = []
    for offset in range(0, len(art.bands), 32):
        rows.append(
            "    "
            + ", ".join(
                f"{value}U"
                for value in art.bands[offset : offset + 32]
            )
        )
    values = ",\n".join(rows)
    return (
        f"#pragma bank {bank}\n\n"
        "#include <stdint.h>\n\n"
        f"const uint8_t {entry.prefix}_ps_gbc_launcher_art"
        f"[{len(art.bands)}] = {{\n"
        f"{values}\n"
        "};\n"
    )


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
        "bool ps_gbc_cart_copy_launcher_card(\n"
        "    uint8_t index,\n"
        "    ps_gbc_launcher_card* card) BANKED;\n"
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
    art_declarations = "\n".join(
        f"extern const uint8_t {entry.prefix}_ps_gbc_launcher_art[];"
        for entry in entries
    )
    rows = ",\n".join(
        "    {"
        f"{entry.descriptor_bank}U, "
        f"&{entry.prefix}_ps_gbc_generated_descriptor, "
        f"0x{entry.source_hash:08x}UL, "
        f"{_c_string(entry.title, 32)}, "
        f"{entry.launcher_art_bank}U, "
        f"{entry.prefix}_ps_gbc_launcher_art, "
        f"{entry.launcher_card.board_level_count + 2}U"
        "}"
        for entry in entries
    )
    def unsigned_array(values: Sequence[int]) -> str:
        return "{" + ", ".join(f"{value}U" for value in values) + "}"

    card_rows = ",\n".join(
        "    {"
        f"{_c_string(entry.title, 32)}, "
        f"{unsigned_array(entry.launcher_card.palette)}, "
        f"{unsigned_array(entry.launcher_card.background_tile)}, "
        f"{unsigned_array(entry.launcher_card.player_pixels)}, "
        f"{entry.launcher_card.level_count}U, "
        f"{entry.launcher_card.board_level_count}U, "
        f"{unsigned_array(entry.launcher_card.level_is_board_bits)}, "
        f"{'true' if entry.launcher_card.detail_colors_reduced else 'false'}"
        "}"
        for entry in entries
    )
    return (
        "#pragma bank 2\n\n"
        "#include \"generated_cart.h\"\n\n"
        f"{declarations}\n\n"
        f"{art_declarations}\n\n"
        "static const ps_gbc_cart_entry kCartEntries"
        "[PS_GBC_CART_GAME_COUNT] = {\n"
        f"{rows}\n"
        "};\n\n"
        "static const ps_gbc_launcher_card kLauncherCards"
        "[PS_GBC_CART_GAME_COUNT] = {\n"
        f"{card_rows}\n"
        "};\n\n"
        "bool ps_gbc_cart_copy_entry(\n"
        "    uint8_t index,\n"
        "    ps_gbc_cart_entry* entry\n"
        ") BANKED {\n"
        "    if (entry == NULL || index >= PS_GBC_CART_GAME_COUNT) "
        "return false;\n"
        "    *entry = kCartEntries[index];\n"
        "    return true;\n"
        "}\n\n"
        "bool ps_gbc_cart_copy_launcher_card(\n"
        "    uint8_t index,\n"
        "    ps_gbc_launcher_card* card\n"
        ") BANKED {\n"
        "    if (card == NULL || index >= PS_GBC_CART_GAME_COUNT) "
        "return false;\n"
        "    *card = kLauncherCards[index];\n"
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
    relocated = re.sub(
        rf"^(A\s+)_CODE_{re.escape(source_bank)}(\s+size\s+"
        r"[0-9A-Fa-f]+\b.*)$",
        rf"\1_CODE_{bank}\2",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    source_bank_number = int(source_bank)

    def relocate_bank_symbol(match: re.Match[str]) -> str:
        if int(match.group(2), 16) != source_bank_number:
            return match.group(0)
        return f"{match.group(1)}{bank:08X}{match.group(3)}"

    return OBJECT_BANK_SYMBOL.sub(relocate_bank_symbol, relocated)


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


def _launcher_card_from_manifest(manifest: dict[str, object]) -> LauncherCard:
    value = manifest.get("launcher_card")
    if not isinstance(value, dict):
        raise RuntimeError("GBC export manifest has no launcher_card")

    def integer_tuple(name: str, length: int, maximum: int) -> tuple[int, ...]:
        raw = value.get(name)
        if not isinstance(raw, list) or len(raw) != length:
            raise RuntimeError(
                f"launcher_card.{name} must contain {length} values"
            )
        result = tuple(int(item) for item in raw)
        if any(item < 0 or item > maximum for item in result):
            raise RuntimeError(
                f"launcher_card.{name} contains an out-of-range value"
            )
        return result

    level_count = int(value.get("level_count", -1))
    board_level_count = int(value.get("board_level_count", -1))
    if (
        level_count < 0
        or level_count > 255
        or board_level_count < 0
        or board_level_count > level_count
    ):
        raise RuntimeError("launcher_card level counts are invalid")
    return LauncherCard(
        palette=integer_tuple("palette", 4, 0x7FFF),
        background_tile=integer_tuple("background_tile_2bpp", 16, 0xFF),
        player_pixels=integer_tuple("player_pixels", 64, 0xFF),
        level_count=level_count,
        board_level_count=board_level_count,
        level_is_board_bits=integer_tuple(
            "level_is_board_bits", 32, 0xFF
        ),
        detail_colors_reduced=bool(
            value.get("detail_colors_reduced", False)
        ),
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
    launcher_art_objects: dict[str, Path] = {}

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
            launcher_art_bank=game_bank,
            launcher_card=_launcher_card_from_manifest(manifest),
        )
        launcher_art = render_launcher_art(
            entry,
            index,
            len(games),
        )
        launcher_art_source = (
            generated_root / f"{prefix}_launcher_art.c"
        )
        launcher_art_source.write_text(
            emit_launcher_art_source(entry, launcher_art, game_bank),
            encoding="utf-8",
        )
        launcher_art_object = (
            objects_root / f"{prefix}_launcher_art.o"
        )
        compile_source(
            lcc=lcc,
            source=launcher_art_source,
            object_path=launcher_art_object,
            include_directories=include_directories,
        )
        launcher_art_objects[prefix] = launcher_art_object
        all_game_objects.append(launcher_art_object)
        items.append(
            CartItem(
                name=f"{prefix}-launcher-art",
                size=object_code_size(launcher_art_object),
                objects=(launcher_art_object,),
            )
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
                "launcher_art_bytes": len(launcher_art.bands),
                "launcher_progress_variant_count":
                    launcher_art.progress_variant_count,
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

    for index, entry in enumerate(entries):
        launcher_art_object = launcher_art_objects[entry.prefix]
        launcher_art_bank = object_banks[launcher_art_object.name]
        entries[index] = replace(
            entry,
            launcher_art_bank=launcher_art_bank,
        )
        game_records[index]["launcher_art_bank"] = launcher_art_bank

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
