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
    with tempfile.TemporaryDirectory() as tmp:
        map_path = Path(tmp) / "sample.map"
        map_path.write_text(MAP_SAMPLE, encoding="utf-8")
        result = report_gbc_layout.layout(map_path)

    assert result["home_bytes"] == 0x200 + 13902, result["home_bytes"]
    assert result["banks"] == {"_CODE_1": 7305, "_CODE_2": 3199}, result["banks"]
    assert result["static_wram_bytes"] == (0xC0A0 - 0xC000) + 1814, result["static_wram_bytes"]
    print("report_gbc_layout_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
