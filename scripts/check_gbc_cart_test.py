#!/usr/bin/env python3
"""Focused tests for GBC compilation-cart structural gates."""

from __future__ import annotations

import tempfile
from pathlib import Path

import check_gbc_cart


def write_object(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def main() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        build_dir = Path(temporary)
        core_object = write_object(
            build_dir / "g00_core.o",
            "XL4\n"
            "H B areas 2 global symbols\n"
            "M g00_core\n"
            "A _DATA size 168 flags 0 addr 0\n"
            "A _CODE_3 size 1ECC flags 0 addr 0\n",
        )
        clean_object = write_object(
            build_dir / "g01_core.o",
            "A _DATA size 0 flags 0 addr 0\n"
            "A _BSS size 0 flags 0 addr 0\n"
            "A _INITIALIZED size 0 flags 0 addr 0\n"
            "A _CODE_4 size 100 flags 0 addr 0\n",
        )

        assert check_gbc_cart.object_areas(core_object) == {
            "_DATA": 0x168,
            "_CODE_3": 0x1ECC,
        }
        assert check_gbc_cart.generated_static_areas(
            [core_object, clean_object]
        ) == {
            "g00_core.o": {"_DATA": 0x168},
        }

    print("check_gbc_cart_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
