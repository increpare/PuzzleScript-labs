#!/usr/bin/env python3
"""Focused tests for deterministic GBC compilation-cart bank packing."""

from __future__ import annotations

import tempfile
from dataclasses import replace
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
    packed_art = build_gbc_cart.pack_items(
        [item("g00-launcher-art", 12_800)],
        first_bank=3,
    )
    assert packed_art[0].used == 12_800
    assert [entry.name for entry in packed_art[0].items] == [
        "g00-launcher-art"
    ]

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

    source = (
        "S b_g00_ps_gbc_specialized_apply_turn_phases Def00000007\n"
        "S b_g00_ps_gbc_specialized_won Def00000007\n"
        "A _CODE_7 size 1234 flags 0 addr 0\n"
    )
    assert build_gbc_cart.relocate_code_area(source, 42) == (
        "S b_g00_ps_gbc_specialized_apply_turn_phases Def0000002A\n"
        "S b_g00_ps_gbc_specialized_won Def0000002A\n"
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

    launcher_card = build_gbc_cart.LauncherCard(
        palette=(1, 2, 3, 4),
        background_tile=tuple(range(16)),
        player_pixels=tuple([255] * 64),
        level_count=2,
        board_level_count=2,
        level_is_board_bits=(3,) + (0,) * 31,
        detail_colors_reduced=False,
    )
    assert build_gbc_cart.launcher_progress_labels(launcher_card) == (
        "--",
        "1/2",
        "2/2",
        "DONE",
    )
    header_band = build_gbc_cart.render_launcher_header_band(1, 46)
    card_band = build_gbc_cart.render_launcher_card_band(
        title="FIRST",
        card=launcher_card,
        game_index=1,
        game_count=46,
        progress="1/2",
    )
    assert len(header_band) == build_gbc_cart.LAUNCHER_BAND_BYTES
    assert len(card_band) == build_gbc_cart.LAUNCHER_BAND_BYTES
    assert build_gbc_cart.launcher_band_pixel(
        header_band, 0, 0
    ) == 0
    assert build_gbc_cart.launcher_band_pixel(
        header_band, 4, 15
    ) == 3
    assert build_gbc_cart.launcher_band_pixel(
        card_band, 158, 0
    ) == 3
    assert card_band == build_gbc_cart.render_launcher_card_band(
        title="FIRST",
        card=launcher_card,
        game_index=1,
        game_count=46,
        progress="1/2",
    )
    large_launcher_card = replace(
        launcher_card,
        level_count=17,
        board_level_count=17,
        level_is_board_bits=(0xFF, 0xFF, 0x01) + (0,) * 29,
    )
    assert len(
        build_gbc_cart.launcher_progress_labels(large_launcher_card)
    ) == 19

    entries = [
        build_gbc_cart.CartIndexEntry(
            slug="first",
            prefix="g00",
            title="FIRST",
            source_hash=0x12345678,
            descriptor_bank=3,
            session_bytes=768,
            launcher_art_bank=9,
            launcher_card=launcher_card,
        ),
        build_gbc_cart.CartIndexEntry(
            slug="second",
            prefix="g01",
            title="SECOND",
            source_hash=0x90ABCDEF,
            descriptor_bank=4,
            session_bytes=1024,
            launcher_art_bank=10,
            launcher_card=launcher_card,
        ),
    ]
    launcher_art = build_gbc_cart.render_launcher_art(
        entries[0],
        0,
        2,
    )
    assert launcher_art.progress_variant_count == 4
    assert len(launcher_art.bands) == (
        1 + launcher_art.progress_variant_count
    ) * build_gbc_cart.LAUNCHER_BAND_BYTES
    launcher_art_source = build_gbc_cart.emit_launcher_art_source(
        entries[0],
        launcher_art,
        3,
    )
    assert "#pragma bank 3" in launcher_art_source
    assert (
        "const uint8_t g00_ps_gbc_launcher_art"
        in launcher_art_source
    )
    assert (
        "launcher_art_bank"
        in Path(
            "native/include/puzzlescript/gbc_cart.h"
        ).read_text(encoding="utf-8")
    )

    header = build_gbc_cart.emit_cart_header(entries)
    assert "#define PS_GBC_CART_GAME_COUNT 2U" in header
    assert "#define PS_GBC_CART_MAX_SESSION_BYTES 1024U" in header
    assert "#define PS_GBC_CART_INDEX_BANK 2U" in header
    assert (
        "bool ps_gbc_cart_copy_entry(\n"
        "    uint8_t index,\n"
        "    ps_gbc_cart_entry* entry) BANKED;"
    ) in header
    assert (
        "bool ps_gbc_cart_copy_launcher_card(\n"
        "    uint8_t index,\n"
        "    ps_gbc_launcher_card* card) BANKED;"
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
    assert "extern const uint8_t g00_ps_gbc_launcher_art[];" in cart_source
    assert "extern const uint8_t g01_ps_gbc_launcher_art[];" in cart_source
    assert (
        '{3U, &g00_ps_gbc_generated_descriptor, 0x12345678UL, '
        '"FIRST", 9U, g00_ps_gbc_launcher_art, 4U}'
    ) in cart_source
    assert (
        '{4U, &g01_ps_gbc_generated_descriptor, 0x90abcdefUL, '
        '"SECOND", 10U, g01_ps_gbc_launcher_art, 4U}'
    ) in cart_source
    assert "static const ps_gbc_launcher_card kLauncherCards" in cart_source
    assert "{1U, 2U, 3U, 4U}" in cart_source
    assert "{0U, 1U, 2U, 3U, 4U, 5U, 6U, 7U" in cart_source
    assert (
        "bool ps_gbc_cart_copy_launcher_card(\n"
        "    uint8_t index,\n"
        "    ps_gbc_launcher_card* card"
    ) in cart_source

    text_source = Path(
        "firmware/gbc/source/text.c"
    ).read_text(encoding="utf-8")
    page_body = text_source.split(
        "void updateCartLauncherPage(", 1
    )[1]
    page_body = page_body.split("\n}", 1)[0]
    assert "DISPLAY_OFF" not in page_body
    assert "displayOffForFullRewrite" not in page_body
    assert "HDMA5_REG" in text_source

    print("build_gbc_cart_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
