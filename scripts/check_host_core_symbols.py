#!/usr/bin/env python3
"""Assert the host GBC core library exports unprefixed entry points.

Cartridge builds rename these through generated_namespace.h; the host library
must not, because one host test binary exercises all board widths.

Usage: python3 scripts/check_host_core_symbols.py build/native/libpuzzlescript_gbc_core.a
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REQUIRED = (
    "ps_gbc_step",
    "ps_gbc_session_init",
    "ps_gbc_load_level",
    "ps_gbc_resolve_movements",
)


def defined_symbols(archive: Path) -> set[str]:
    out = subprocess.run(
        ["nm", "-g", "--defined-only", str(archive)],
        capture_output=True, text=True, check=True,
    ).stdout
    names: set[str] = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 3:
            names.add(parts[2].lstrip("_"))
    return names


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_host_core_symbols.py <archive>", file=sys.stderr)
        return 2
    archive = Path(sys.argv[1])
    if not archive.is_file():
        print(f"missing archive: {archive}", file=sys.stderr)
        return 2

    names = defined_symbols(archive)
    missing = [name for name in REQUIRED if name not in names]
    stray = sorted(n for n in names if n.endswith("_ps_gbc_step"))

    if missing:
        print(f"FAIL host core is missing unprefixed symbols: {missing}", file=sys.stderr)
        return 1
    if stray:
        print(f"FAIL host core exports namespaced symbols: {stray}", file=sys.stderr)
        return 1
    print(f"ok host core exports {len(REQUIRED)} unprefixed entry points")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
