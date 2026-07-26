#!/usr/bin/env python3
"""Report HOME, per-bank and static WRAM usage for a linked GBC cartridge.

Usage:
    python3 scripts/report_gbc_layout.py firmware/gbc/puzzlescript_gbc.map
    python3 scripts/report_gbc_layout.py <map> --build-dir firmware/gbc/build
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

MAP_AREA = re.compile(
    r"^([._A-Za-z][._A-Za-z0-9]*)\s+([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{8})\s+="
)
BANK_AREA = re.compile(r"_CODE_\d+")

HOME_LIMIT = 16 * 1024
BANK_LIMIT = 16 * 1024
STATIC_WRAM_LIMIT = 6 * 1024


def layout(map_path: Path) -> dict[str, Any]:
    home_high = 0
    wram_high = 0xC000
    banks: dict[str, int] = {}
    for line in map_path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = MAP_AREA.match(line)
        if not match:
            continue
        name = match.group(1)
        address = int(match.group(2), 16)
        size = int(match.group(3), 16)
        if BANK_AREA.fullmatch(name):
            banks[name] = size
        if name.startswith("_HEADER") or address < 0x4000:
            home_high = max(home_high, address + size)
        if 0xC000 <= address < 0xE000:
            wram_high = max(wram_high, address + size)
    return {
        "home_bytes": home_high,
        "banks": banks,
        "static_wram_bytes": wram_high - 0xC000,
        "module_home": {},
    }


def module_home(build_dir: Path) -> dict[str, int]:
    """Per-object HOME contribution, read from SDCC .o area records."""
    totals: dict[str, int] = {}
    for obj in sorted(build_dir.glob("*.o")):
        total = 0
        for line in obj.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.startswith("A "):
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            if parts[1] in ("_CODE", "_HOME"):
                total += int(parts[3], 16)
        if total:
            totals[obj.name] = total
    return totals


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("map", type=Path)
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = layout(args.map)
    if args.build_dir is not None and args.build_dir.is_dir():
        result["module_home"] = module_home(args.build_dir)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0

    largest = max(result["banks"].values(), default=0)
    print(f"HOME         {result['home_bytes']:6} / {HOME_LIMIT}")
    print(f"largest bank {largest:6} / {BANK_LIMIT}")
    print(f"static WRAM  {result['static_wram_bytes']:6} / {STATIC_WRAM_LIMIT}")
    for name in sorted(result["banks"], key=lambda k: int(k.rsplit("_", 1)[1])):
        print(f"  {name:12} {result['banks'][name]:6}")
    for name, size in sorted(result["module_home"].items()):
        print(f"  HOME {name:28} {size:6}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
