#!/usr/bin/env python3
"""Build and bank-pack a multi-game PuzzleScript GBC cartridge."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence


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

