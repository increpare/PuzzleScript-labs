#!/usr/bin/env python3
"""Fail a GBA build when linked sections exceed the cartridge memory contract."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REGIONS = {
    "ewram": (0x02000000, 0x02040000, 224 * 1024),
    "iwram": (0x03000000, 0x03008000, 24 * 1024),
    "rom": (0x08000000, 0x0A000000, 32 * 1024 * 1024),
}

ADDRESS_SIZE = re.compile(r"^\s*(?:\.[^\s]+\s+)?(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)(?:\s|$)")


def region_usage(text: str) -> dict[str, int]:
    high_water = {name: start for name, (start, _end, _limit) in REGIONS.items()}
    for line in text.splitlines():
        match = ADDRESS_SIZE.match(line)
        if not match:
            continue
        address = int(match.group(1), 16)
        size = int(match.group(2), 16)
        for name, (start, end, _limit) in REGIONS.items():
            if start <= address < end:
                high_water[name] = max(high_water[name], min(address + size, end))
                break
    return {name: high_water[name] - REGIONS[name][0] for name in REGIONS}


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print("usage: check_gba_map.py path/to/game.map [path/to/game.gba]", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"GBA linker map not found: {path}", file=sys.stderr)
        return 2
    usage = region_usage(path.read_text(encoding="utf-8", errors="replace"))
    failed = False
    for name, used in usage.items():
        limit = REGIONS[name][2]
        remaining = limit - used
        print(f"gba-map {name}: used={used} limit={limit} remaining={remaining}")
        if used > limit:
            failed = True
            print(f"GBA {name.upper()} budget exceeded by {used - limit} bytes", file=sys.stderr)
    if len(sys.argv) == 3:
        rom_path = Path(sys.argv[2])
        if not rom_path.is_file():
            print(f"GBA ROM not found: {rom_path}", file=sys.stderr)
            return 2
        if b"SRAM_V113" not in rom_path.read_bytes():
            failed = True
            print("GBA ROM is missing its retained SRAM_V113 save-type signature", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
