#!/usr/bin/env python3
"""Focused tests for the scripted GBC compilation-cart smoke gate."""

from __future__ import annotations

import struct

import run_gbc_cart_smoke


def record(
    *,
    magic: int = run_gbc_cart_smoke.CART_MAGIC,
    launches: int = 2,
    returns: int = 1,
    first_index: int = 1,
    second_index: int = 2,
    first_hash: int = 0x11111111,
    second_hash: int = 0x22222222,
) -> bytes:
    return struct.pack(
        "<IHBBBB2xII",
        magic,
        run_gbc_cart_smoke.CART_VERSION,
        launches,
        returns,
        first_index,
        second_index,
        first_hash,
        second_hash,
    )


def expect_invalid(data: bytes, message: str) -> None:
    try:
        run_gbc_cart_smoke.parse_telemetry(
            data,
            expected_first_index=1,
            expected_second_index=2,
        )
    except ValueError:
        return
    raise AssertionError(message)


def main() -> int:
    keys = run_gbc_cart_smoke.build_key_script()
    assert len(keys) == run_gbc_cart_smoke.SCRIPT_FRAMES
    assert keys[100] == run_gbc_cart_smoke.KEY_A
    assert keys[150] == run_gbc_cart_smoke.KEY_A
    assert keys[200] == run_gbc_cart_smoke.KEY_A
    assert keys[250] == run_gbc_cart_smoke.KEY_UP
    assert keys[300] == run_gbc_cart_smoke.KEY_START
    assert keys[340] == run_gbc_cart_smoke.KEY_B
    assert keys[440] == run_gbc_cart_smoke.KEY_DOWN
    assert keys[510] == run_gbc_cart_smoke.KEY_A
    for frame in (
        99, 101, 149, 151, 199, 201, 249, 251,
        299, 301, 339, 341, 439, 441, 509, 511,
    ):
        assert keys[frame] == 0

    parsed = run_gbc_cart_smoke.parse_telemetry(
        record(),
        expected_first_index=1,
        expected_second_index=2,
    )
    assert parsed.launches == 2
    assert parsed.returns == 1
    assert parsed.first_hash == 0x11111111
    assert parsed.second_hash == 0x22222222

    expect_invalid(record(magic=0), "missing magic was accepted")
    expect_invalid(
        record(first_index=0, second_index=1),
        "wrong launched indices were accepted",
    )
    expect_invalid(
        record(second_hash=0x11111111),
        "identical game hashes were accepted",
    )
    expect_invalid(
        record(launches=1),
        "a missing second launch was accepted",
    )

    print("run_gbc_cart_smoke_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
