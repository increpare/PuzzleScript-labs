#!/usr/bin/env python3
"""Focused tests for eligible GBC corpus build command construction."""

from __future__ import annotations

from pathlib import Path

import build_gbc_eligible_roms


def main() -> int:
    command = build_gbc_eligible_roms.firmware_build_command(
        make=Path("/tools/make"),
        firmware=Path("/repo/firmware/gbc"),
        source=Path("/repo/game.txt"),
        gbdk_home=Path("/tools/gbdk"),
        compiler=Path("/repo/build/native/puzzlescript_cpp"),
        python=Path("/tools/python"),
        cull=True,
    )

    assert command[:4] == [
        "/tools/make",
        "-B",
        "-C",
        "/repo/firmware/gbc",
    ]
    assert "build-rom" in command
    assert "EXPORT_GBC_FLAGS=--cull-oversize-levels" in command

    print("build_gbc_eligible_roms_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
