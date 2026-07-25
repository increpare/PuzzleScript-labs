#!/usr/bin/env python3
"""Unit test for report_gbc_layout. Run: python3 scripts/report_gbc_layout_test.py"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import report_gbc_layout


MAP_SAMPLE = """
Area                       Addr        Size        Decimal Bytes (Attributes)
--------------------       ----        ----        ------- ----- ------------
_CODE                  00000200    0000364E =       13902. bytes (REL,CON)

_HEADER0               00000000    00000001 =           1. bytes (ABS,CON)

_CODE_1                00014000    00001C89 =        7305. bytes (REL,CON)

_CODE_2                00024000    00000C7F =        3199. bytes (REL,CON)

_DATA                  0000C0A0    00000716 =        1814. bytes (REL,CON)
"""


def main() -> int:
    # Test 1: Original sample map
    with tempfile.TemporaryDirectory() as tmp:
        map_path = Path(tmp) / "sample.map"
        map_path.write_text(MAP_SAMPLE, encoding="utf-8")
        result = report_gbc_layout.layout(map_path)

    assert result["home_bytes"] == 0x200 + 13902, result["home_bytes"]
    assert result["banks"] == {"_CODE_1": 7305, "_CODE_2": 3199}, result["banks"]
    assert result["static_wram_bytes"] == (0xC0A0 - 0xC000) + 1814, result["static_wram_bytes"]

    # Test 2: Area at address 0 that is NOT _HEADER* (tests the fix for address 0 inclusion)
    map_at_zero = """
Area                       Addr        Size        Decimal Bytes (Attributes)
--------------------       ----        ----        ------- ----- ------------
_BOOT                  00000000    00000050 =          80. bytes (REL,CON)
_CODE                  00000050    00000100 =         256. bytes (REL,CON)
"""
    with tempfile.TemporaryDirectory() as tmp:
        map_path = Path(tmp) / "map_at_zero.map"
        map_path.write_text(map_at_zero, encoding="utf-8")
        result = report_gbc_layout.layout(map_path)
    assert result["home_bytes"] == 0x50 + 256, f"Expected {0x50 + 256}, got {result['home_bytes']}"

    # Test 3: Zero-size areas (should not affect calculations)
    map_zero_size = """
Area                       Addr        Size        Decimal Bytes (Attributes)
--------------------       ----        ----        ------- ----- ------------
_EMPTY                 00001000    00000000 =           0. bytes (REL,CON)
_CODE                  00000200    00001000 =        4096. bytes (REL,CON)
"""
    with tempfile.TemporaryDirectory() as tmp:
        map_path = Path(tmp) / "map_zero_size.map"
        map_path.write_text(map_zero_size, encoding="utf-8")
        result = report_gbc_layout.layout(map_path)
    assert result["home_bytes"] == 0x200 + 4096, f"Expected {0x200 + 4096}, got {result['home_bytes']}"

    # Test 4: _CODE area at address other than 0x200
    map_code_other_addr = """
Area                       Addr        Size        Decimal Bytes (Attributes)
--------------------       ----        ----        ------- ----- ------------
_CODE                  00000800    00000500 =        1280. bytes (REL,CON)
_CODE_1                00014000    00001000 =        4096. bytes (REL,CON)
"""
    with tempfile.TemporaryDirectory() as tmp:
        map_path = Path(tmp) / "map_code_other.map"
        map_path.write_text(map_code_other_addr, encoding="utf-8")
        result = report_gbc_layout.layout(map_path)
    assert result["home_bytes"] == 0x800 + 1280, f"Expected {0x800 + 1280}, got {result['home_bytes']}"
    assert result["banks"] == {"_CODE_1": 4096}, result["banks"]

    print("report_gbc_layout_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
