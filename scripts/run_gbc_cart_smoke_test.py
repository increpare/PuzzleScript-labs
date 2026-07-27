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
    assert keys[100] == run_gbc_cart_smoke.KEY_RIGHT
    assert keys[110] == run_gbc_cart_smoke.KEY_A
    assert keys[160] == run_gbc_cart_smoke.KEY_A
    assert keys[210] == run_gbc_cart_smoke.KEY_A
    assert keys[260] == run_gbc_cart_smoke.KEY_UP
    assert keys[310] == run_gbc_cart_smoke.KEY_START
    assert keys[350] == run_gbc_cart_smoke.KEY_B
    assert keys[410] == run_gbc_cart_smoke.KEY_LEFT
    assert keys[420] == run_gbc_cart_smoke.KEY_DOWN
    assert keys[430] == run_gbc_cart_smoke.KEY_A
    for frame in (
        99, 101, 109, 111, 159, 161, 209, 211, 259, 261,
        309, 311, 349, 351, 409, 411, 419, 421, 429, 431,
    ):
        assert keys[frame] == 0

    lcdc = [0xC1] * 32
    hashes = [0x11111111] * 32
    hashes[11:] = [0x22222222] * 21
    run_gbc_cart_smoke.validate_page_trace(
        lcdc,
        hashes,
        key_frame=10,
        stable_through=19,
    )
    blank_lcdc = lcdc.copy()
    blank_lcdc[11] = 0x41
    try:
        run_gbc_cart_smoke.validate_page_trace(
            blank_lcdc,
            hashes,
            key_frame=10,
            stable_through=19,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("an LCD-off page transition was accepted")
    slow_hashes = hashes.copy()
    slow_hashes[12] = 0x33333333
    try:
        run_gbc_cart_smoke.validate_page_trace(
            lcdc,
            slow_hashes,
            key_frame=10,
            stable_through=19,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("a multi-frame page transition was accepted")

    parsed = run_gbc_cart_smoke.parse_telemetry(
        record(first_index=8, second_index=1),
        expected_first_index=8,
        expected_second_index=1,
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
