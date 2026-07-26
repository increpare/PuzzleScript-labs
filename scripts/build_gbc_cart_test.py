#!/usr/bin/env python3
"""Focused tests for deterministic GBC compilation-cart bank packing."""

from __future__ import annotations

import tempfile
from pathlib import Path

import build_gbc_cart


def item(
    name: str,
    size: int,
    *,
    pinned_bank: int | None = None,
) -> build_gbc_cart.CartItem:
    return build_gbc_cart.CartItem(
        name=name,
        size=size,
        objects=(Path(f"{name}.o"),),
        pinned_bank=pinned_bank,
    )


def main() -> int:
    banks = build_gbc_cart.pack_items(
        [
            item("g00-core", 10 * 1024, pinned_bank=3),
            item("g01-core", 11 * 1024, pinned_bank=4),
            item("nine", 9 * 1024),
            item("seven", 7 * 1024),
            item("eight", 8 * 1024),
        ],
        first_bank=3,
    )
    by_number = {bank.number: bank for bank in banks}
    assert [entry.name for entry in by_number[3].items] == ["g00-core"]
    assert [entry.name for entry in by_number[4].items] == ["g01-core"]
    assert any(
        {entry.name for entry in bank.items} == {"nine", "seven"}
        for bank in banks
    )
    assert not any(
        {entry.name for entry in bank.items} == {"nine", "eight"}
        for bank in banks
    )

    equal = build_gbc_cart.pack_items(
        [item("zeta", 1024), item("alpha", 1024)],
        first_bank=7,
    )
    assert [entry.name for entry in equal[0].items] == ["alpha", "zeta"]

    try:
        build_gbc_cart.pack_items(
            [item("oversize", 16 * 1024 + 1)],
            first_bank=3,
        )
    except ValueError as error:
        assert "oversize" in str(error)
    else:
        raise AssertionError("oversize item was accepted")

    try:
        build_gbc_cart.pack_items(
            [item("last", 16 * 1024), item("past", 1)],
            first_bank=255,
        )
    except ValueError as error:
        assert "255" in str(error)
    else:
        raise AssertionError("bank range overflow was accepted")

    source = "A _CODE_7 size 1234 flags 0 addr 0\n"
    assert build_gbc_cart.relocate_code_area(source, 42) == (
        "A _CODE_42 size 1234 flags 0 addr 0\n"
    )
    for invalid in (
        "A _CODE_7 size 0 flags 0 addr 0\n",
        "A _CODE_7 size 1 flags 0 addr 0\n"
        "A _CODE_8 size 1 flags 0 addr 0\n",
    ):
        try:
            build_gbc_cart.relocate_code_area(invalid, 9)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid code areas were accepted")

    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "item.o"
        path.write_text(source, encoding="utf-8")
        assert build_gbc_cart.object_code_size(path) == 0x1234
        build_gbc_cart.relocate_object_code_area(path, 15)
        assert "_CODE_15 size 1234" in path.read_text(encoding="utf-8")

    entries = [
        build_gbc_cart.CartIndexEntry(
            slug="first",
            prefix="g00",
            title="FIRST",
            source_hash=0x12345678,
            descriptor_bank=3,
            session_bytes=768,
        ),
        build_gbc_cart.CartIndexEntry(
            slug="second",
            prefix="g01",
            title="SECOND",
            source_hash=0x90ABCDEF,
            descriptor_bank=4,
            session_bytes=1024,
        ),
    ]
    header = build_gbc_cart.emit_cart_header(entries)
    assert "#define PS_GBC_CART_GAME_COUNT 2U" in header
    assert "#define PS_GBC_CART_MAX_SESSION_BYTES 1024U" in header
    assert "#define PS_GBC_CART_INDEX_BANK 2U" in header
    assert (
        "bool ps_gbc_cart_copy_entry(\n"
        "    uint8_t index,\n"
        "    ps_gbc_cart_entry* entry) BANKED;"
    ) in header
    cart_source = build_gbc_cart.emit_cart_source(entries)
    assert "#pragma bank 2" in cart_source
    assert (
        "extern const ps_gbc_game_descriptor "
        "g00_ps_gbc_generated_descriptor;"
    ) in cart_source
    assert (
        "extern const ps_gbc_game_descriptor "
        "g01_ps_gbc_generated_descriptor;"
    ) in cart_source
    assert (
        '{3U, &g00_ps_gbc_generated_descriptor, 0x12345678UL, "FIRST"}'
    ) in cart_source
    assert (
        '{4U, &g01_ps_gbc_generated_descriptor, 0x90abcdefUL, "SECOND"}'
    ) in cart_source

    print("build_gbc_cart_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
