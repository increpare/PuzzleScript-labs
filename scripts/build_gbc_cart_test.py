#!/usr/bin/env python3
"""Focused tests for deterministic GBC compilation-cart bank packing."""

from __future__ import annotations

import sys
import tempfile
from contextlib import redirect_stderr
from dataclasses import replace
from io import StringIO
from inspect import signature
from pathlib import Path
from unittest.mock import patch

import build_gbc_cart


COMPACT_FACADE_SUFFIXES = (
    "ps_gbc_facade_get_movements",
    "ps_gbc_facade_set_movements",
    "ps_gbc_facade_get_objects",
    "ps_gbc_facade_cell_has_all",
    "ps_gbc_facade_set_objects",
    "ps_gbc_facade_cell_has_any",
    "ps_gbc_facade_cell_count",
    "ps_gbc_facade_mark_dirty",
)


def compact_facade_object_text(
    prefix: str,
    bank: int,
    *,
    code_size: int = 349,
) -> str:
    definitions = "\n".join(
        f"S _{prefix}_{suffix} Def{index:08X}"
        for index, suffix in enumerate(COMPACT_FACADE_SUFFIXES, start=1)
    )
    return (
        "XL4\n"
        "H B areas 8 global symbols\n"
        "M generated_compact_facade\n"
        f"A _CODE_{bank} size {code_size:X} flags 0 addr 0\n"
        f"{definitions}\n"
        "T 00 00 00 00 C9\n"
        "R 00 00 08 00\n"
    )


def banked_object_text(bank: int, size: int) -> str:
    return f"A _CODE_{bank} size {size:X} flags 0 addr 0\n"


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


def launcher_manifest(
    *,
    level_count: int,
    board_level_count: int,
    level_is_board_bits: list[int],
) -> dict[str, object]:
    return {
        "launcher_card": {
            "palette": [0] * 4,
            "background_tile_2bpp": [0] * 16,
            "player_pixels": [0] * 64,
            "level_count": level_count,
            "board_level_count": board_level_count,
            "level_is_board_bits": level_is_board_bits,
        }
    }


def main() -> int:
    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        game_source = root / "generated_game.c"
        cells_source = root / "generated_level_cells.c"
        game_source.write_text(
            "static const uint16_t kLevel1Cells[] = {1U, 2U};\n"
            "static const uint16_t kLevel3Cells[] = {3U};\n"
            "const void* levels[] = {kLevel1Cells, kLevel3Cells};\n",
            encoding="utf-8",
        )
        assert build_gbc_cart.split_interpreter_level_cells(
            game_source,
            cells_source,
            prefix="g00",
        )
        game_text = game_source.read_text(encoding="utf-8")
        cells_text = cells_source.read_text(encoding="utf-8")
        assert "extern const uint16_t g00_kLevel1Cells[]" in game_text
        assert "const uint16_t g00_kLevel1Cells[]" in cells_text
        assert "uint32_t" not in cells_text
    assert "head-skuller" in build_gbc_cart.SPECIALIZED_FORCE_INTERPRETER_SLUGS
    assert "unclean-residues" in build_gbc_cart.SPECIALIZED_FORCE_INTERPRETER_SLUGS
    assert "match-maker" in build_gbc_cart.SPECIALIZED_FORCE_INTERPRETER_SLUGS

    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        game_source = root / "generated_game.c"
        game_source.write_text(
            '#include "generated_game.h"\n'
            "static const uint8_t kObject0Pixels[] = {1U, 2U};\n"
            "static const uint8_t kObject1Pixels[] = {3U, 4U};\n"
            '{PS_GBC_LEVEL_MESSAGE, 0U, 0U, NULL, "One \\"hydrogen\\" atom"};\n'
            "const uint8_t* pixels[] = {kObject0Pixels, kObject1Pixels};\n",
            encoding="utf-8",
        )
        build_gbc_cart.strip_interpreter_precomposed(game_source)
        stripped = game_source.read_text(encoding="utf-8")
        assert "hydrogen" not in stripped
        assert "kStubObjectPixels" in stripped
        assert "kObject0Pixels[]" not in stripped

    options = build_gbc_cart.parse_options(
        ["--gbdk-home", "toolchains/gbdk"]
    )
    assert options.share_compact_facade_canary is False
    limit_stderr = StringIO()
    try:
        with patch.object(
            sys,
            "argv",
            [
                "build_gbc_cart.py",
                "--gbdk-home",
                "toolchains/gbdk",
                "--limit",
                "0",
            ],
        ):
            with redirect_stderr(limit_stderr):
                build_gbc_cart.main()
    except SystemExit as error:
        assert error.code == 2
    except NameError as error:
        raise AssertionError(
            f"--limit 0 raised NameError: {error}"
        ) from error
    else:
        raise AssertionError("--limit 0 was accepted")
    assert "--limit must be positive" in limit_stderr.getvalue()
    assert (
        signature(build_gbc_cart.build_cart)
        .parameters["share_compact_facade_canary"]
        .default
        is False
    )
    assert (
        build_gbc_cart.shared_compact_canary(
            ("g21", "g31"),
            enabled=False,
        )
        is None
    )
    for prefixes in ((), ("g21",), ("g31",), ("g31", "g21")):
        try:
            build_gbc_cart.shared_compact_canary(
                prefixes,
                enabled=True,
            )
        except ValueError as error:
            assert "requires exactly g21 and g31" in str(error)
        else:
            raise AssertionError(
                f"non-canonical canary prefixes were accepted: {prefixes}"
            )

    for member_bytes in (
        compact_facade_object_text("g31", 34)
        .replace("\n", "\r\n")
        .encode("ascii"),
        compact_facade_object_text("g31", 34).encode("ascii")
        + b"\x81\n",
    ):
        with tempfile.TemporaryDirectory() as temporary:
            objects = Path(temporary)
            owner_compact = (
                objects / "g21_generated_compact_facade.o"
            )
            owner_rules = objects / "g21_generated_facade_rules.o"
            member_compact = (
                objects / "g31_generated_compact_facade.o"
            )
            member_rules = objects / "g31_generated_facade_rules.o"
            owner_bytes = compact_facade_object_text(
                "g21", 24
            ).encode("ascii")
            if member_bytes.endswith(b"\x81\n"):
                owner_bytes += b"\x80\n"
            owner_compact.write_bytes(owner_bytes)
            owner_rules.write_bytes(
                banked_object_text(24, 1000).encode("ascii")
            )
            member_compact.write_bytes(member_bytes)
            member_rules.write_bytes(
                banked_object_text(34, 1200).encode("ascii")
            )
            try:
                build_gbc_cart.shared_compact_canary(
                    ("g21", "g31"),
                    enabled=True,
                    all_game_objects=(
                        owner_compact,
                        owner_rules,
                        member_compact,
                        member_rules,
                    ),
                )
            except (UnicodeError, ValueError):
                pass
            else:
                raise AssertionError(
                    "non-byte-identical compact facades were accepted"
                )
            assert owner_compact.read_bytes() == owner_bytes

    with tempfile.TemporaryDirectory() as temporary:
        objects = Path(temporary)
        owner_compact = objects / "g21_generated_compact_facade.o"
        owner_rules = objects / "g21_generated_facade_rules.o"
        member_compact = objects / "g31_generated_compact_facade.o"
        member_rules = objects / "g31_generated_facade_rules.o"
        unrelated = objects / "g00_generated_core.o"
        owner_compact_bytes = compact_facade_object_text(
            "g21", 24
        ).encode("ascii")
        owner_compact.write_bytes(owner_compact_bytes)
        owner_rules.write_text(
            banked_object_text(24, 1000),
            encoding="utf-8",
        )
        member_compact_text = compact_facade_object_text("g31", 34)
        member_compact.write_text(member_compact_text, encoding="utf-8")
        member_rules.write_text(
            banked_object_text(34, 1200),
            encoding="utf-8",
        )
        unrelated.write_text(
            banked_object_text(3, 100),
            encoding="utf-8",
        )
        sharing = build_gbc_cart.shared_compact_canary(
            ("g21", "g31"),
            enabled=True,
            all_game_objects=(
                unrelated,
                owner_compact,
                owner_rules,
                member_compact,
                member_rules,
            ),
        )
        assert sharing is not None
        before = item("before", 50)
        between = item("between", 60)
        owner_facade = build_gbc_cart.CartItem(
            name="g21-facade",
            size=349 + 1000,
            objects=(owner_compact, owner_rules),
        )
        member_facade = build_gbc_cart.CartItem(
            name="g31-facade",
            size=349 + 1200,
            objects=(member_compact, member_rules),
        )
        source_items = (
            before,
            owner_facade,
            between,
            member_facade,
        )
        applied_items, applied_link_objects = (
            build_gbc_cart.apply_shared_compact_canary(
                source_items,
                (
                    unrelated,
                    owner_compact,
                    owner_rules,
                    member_compact,
                    member_rules,
                ),
                sharing,
            )
        )
        assert applied_items == (before, between, sharing.item)
        assert applied_link_objects == sharing.link_objects
        malformed_owner = build_gbc_cart.CartItem(
            name="g21-facade",
            size=owner_facade.size,
            objects=(owner_rules, owner_compact),
        )
        invalid_item_lists = (
            ("missing", source_items[:-1]),
            (
                "duplicate",
                source_items + (owner_facade,),
            ),
            (
                "composition",
                (
                    before,
                    malformed_owner,
                    between,
                    member_facade,
                ),
            ),
        )
        for invariant, invalid_items in invalid_item_lists:
            try:
                build_gbc_cart.apply_shared_compact_canary(
                    invalid_items,
                    (
                        unrelated,
                        owner_compact,
                        owner_rules,
                        member_compact,
                        member_rules,
                    ),
                    sharing,
                )
            except ValueError as error:
                assert invariant in str(error)
            else:
                raise AssertionError(
                    f"{invariant} source facade items were accepted"
                )
        assert owner_compact.read_bytes() == owner_compact_bytes
        assert sharing.item.objects == (
            owner_compact,
            owner_rules,
            member_rules,
        )
        assert sharing.item.size == 349 + 1000 + 1200
        assert sharing.link_objects == (
            unrelated,
            owner_compact,
            owner_rules,
            member_rules,
        )
        assert member_compact not in sharing.link_objects
        assert member_compact.read_text(
            encoding="utf-8"
        ) == member_compact_text
        assert owner_compact.read_bytes() == owner_compact_bytes
        try:
            with patch.object(
                build_gbc_cart.os,
                "replace",
                side_effect=OSError("replace failed"),
            ):
                build_gbc_cart.write_shared_compact_canary_owner(
                    sharing
                )
        except OSError as error:
            assert "replace failed" in str(error)
        else:
            raise AssertionError("failed atomic replace was accepted")
        assert owner_compact.read_bytes() == owner_compact_bytes
        assert not tuple(
            objects.glob(f".{owner_compact.name}.*.tmp")
        )
        build_gbc_cart.write_shared_compact_canary_owner(sharing)
        owner_text = owner_compact.read_text(encoding="utf-8")
        assert "S _g31_ps_gbc_facade_cell_count Def" in owner_text
        assert len(sharing.aliases) == 8

        assert (
            build_gbc_cart.compact_facade_sharing_evidence(
                None,
                {},
            )
            == {}
        )
        evidence = build_gbc_cart.compact_facade_sharing_evidence(
            sharing,
            {
                owner_compact.name: 142,
                owner_rules.name: 142,
                member_rules.name: 142,
            },
        )
        sharing_manifest = evidence["compact_facade_sharing"]
        assert sharing_manifest == {
            "mode": "same-bank-alias-canary-v1",
            "owner": "g21",
            "members": ["g21", "g31"],
            "normalized_sha256": sharing.normalized_sha256,
            "implementation_bytes": 349,
            "gross_removed_bytes": 349,
            "bank": 142,
            "aliases": sorted(
                f"g31_{suffix}" for suffix in COMPACT_FACADE_SUFFIXES
            ),
        }

        owner_compact_text = compact_facade_object_text("g21", 24)
        owner_compact.write_text(owner_compact_text, encoding="utf-8")
        owner_rules.write_text(
            banked_object_text(24, 16_384 - 349),
            encoding="utf-8",
        )
        member_rules.write_text(
            banked_object_text(34, 1),
            encoding="utf-8",
        )
        try:
            build_gbc_cart.shared_compact_canary(
                ("g21", "g31"),
                enabled=True,
                all_game_objects=(
                    owner_compact,
                    owner_rules,
                    member_compact,
                    member_rules,
                ),
            )
        except ValueError as error:
            assert "oversize" in str(error)
            assert "16385 > 16384" in str(error)
        else:
            raise AssertionError("oversize shared facade item was accepted")
        assert owner_compact.read_text(
            encoding="utf-8"
        ) == owner_compact_text

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
    selected_card_band = build_gbc_cart.render_launcher_card_band(
        title="FIRST",
        card=launcher_card,
        game_index=1,
        game_count=46,
        progress="1/2",
        selected=True,
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
    assert build_gbc_cart.launcher_band_pixel(
        selected_card_band, 0, 0
    ) == 3
    assert build_gbc_cart.launcher_band_pixel(
        selected_card_band, 156, 15
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

    zero_level_card = build_gbc_cart._launcher_card_from_manifest(
        launcher_manifest(
            level_count=0,
            board_level_count=0,
            level_is_board_bits=[0] * 32,
        )
    )
    assert zero_level_card.level_count == 0
    cross_byte_bitmap = [0] * 32
    cross_byte_bitmap[1] = 1
    cross_byte_card = build_gbc_cart._launcher_card_from_manifest(
        launcher_manifest(
            level_count=9,
            board_level_count=1,
            level_is_board_bits=cross_byte_bitmap,
        )
    )
    assert cross_byte_card.level_is_board_bits[1] == 1
    maximum_bitmap = [0] * 32
    maximum_bitmap[31] = 1 << 6
    maximum_level_card = build_gbc_cart._launcher_card_from_manifest(
        launcher_manifest(
            level_count=255,
            board_level_count=1,
            level_is_board_bits=maximum_bitmap,
        )
    )
    assert maximum_level_card.level_is_board_bits[31] == 1 << 6

    invalid_launcher_bitmaps = (
        launcher_manifest(
            level_count=3,
            board_level_count=2,
            level_is_board_bits=[0b00000001] + [0] * 31,
        ),
        launcher_manifest(
            level_count=3,
            board_level_count=1,
            level_is_board_bits=[0b00001001] + [0] * 31,
        ),
        launcher_manifest(
            level_count=255,
            board_level_count=0,
            level_is_board_bits=[0] * 31 + [1 << 7],
        ),
        launcher_manifest(
            level_count=256,
            board_level_count=0,
            level_is_board_bits=[0] * 32,
        ),
    )
    for manifest in invalid_launcher_bitmaps:
        try:
            build_gbc_cart._launcher_card_from_manifest(manifest)
        except RuntimeError:
            pass
        else:
            raise AssertionError("invalid launcher board bitmap was accepted")

    entries = [
        build_gbc_cart.CartIndexEntry(
            slug="first",
            prefix="g00",
            title="FIRST",
            source_hash=0x12345678,
            descriptor_bank=3,
            session_bytes=768,
            launcher_art_bank=9,
            launcher_selected_art_bank=11,
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
            launcher_selected_art_bank=12,
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
    selected_launcher_art = (
        build_gbc_cart.render_launcher_selected_art(
            entries[0],
            0,
            2,
        )
    )
    assert selected_launcher_art.progress_variant_count == 4
    assert len(selected_launcher_art.bands) == (
        selected_launcher_art.progress_variant_count
        * build_gbc_cart.LAUNCHER_BAND_BYTES
    )
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
    selected_launcher_art_source = (
        build_gbc_cart.emit_launcher_selected_art_source(
            entries[0],
            selected_launcher_art,
            4,
        )
    )
    assert "#pragma bank 4" in selected_launcher_art_source
    assert (
        "const uint8_t g00_ps_gbc_launcher_selected_art"
        in selected_launcher_art_source
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
        "extern const uint8_t g00_ps_gbc_launcher_selected_art[];"
        in cart_source
    )
    assert (
        "extern const uint8_t g01_ps_gbc_launcher_selected_art[];"
        in cart_source
    )
    assert (
        '{3U, &g00_ps_gbc_generated_descriptor, 0x12345678UL, '
        '"FIRST", 9U, g00_ps_gbc_launcher_art, 11U, '
        'g00_ps_gbc_launcher_selected_art, 4U, 0U, 0U}'
    ) in cart_source
    assert (
        '{4U, &g01_ps_gbc_generated_descriptor, 0x90abcdefUL, '
        '"SECOND", 10U, g01_ps_gbc_launcher_art, 12U, '
        'g01_ps_gbc_launcher_selected_art, 4U, 0U, 0U}'
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
    assert "ps_gbc_rom_vram_dma(" in text_source
    assert "ps_gbc_rom_vram_dma_hblank(" in text_source
    assert "waitLauncherPageVBlank(" in page_body
    assert (
        "updateLauncherHeaderAttributes(selected_palette);"
        in page_body
    )
    assert page_body.count("(void)renderLauncherHeader(") == 1
    assert page_body.index("(void)renderLauncherHeader(") < (
        page_body.index("gLauncherPageUseHBlank = true;")
    )
    assert "updateLauncherSelectionLines(" not in page_body
    assert "prepareLauncherSelectionBand(" not in text_source
    assert "launcher_selected_art" in text_source
    dispatch_source = Path(
        "firmware/gbc/source/game_dispatch.c"
    ).read_text(encoding="utf-8")
    hblank_loop = dispatch_source.split(
        "while (transferred < block_count)", 1
    )[1].split(
        "uint8_t ps_gbc_rom_vram_dma_hblank(", 1
    )[0]
    assert "while (LY_REG >= 144U)" not in hblank_loop
    assert "if (LY_REG >= 144U) break;" in hblank_loop
    assert text_source.count(
        "if (remaining == 0U) continue;\n"
        "                gLauncherPageUseHBlank = false;"
    ) == 2
    assert text_source.count(
        "beginLauncherPageHBlankSpan()"
    ) == 2
    assert "static bool beginLauncherPageHBlankSpan(void)" in text_source
    assert "gLauncherPageHBlankStarted = false;" in page_body

    print("build_gbc_cart_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
