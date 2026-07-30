#!/usr/bin/env python3
"""Focused tests for GBC compilation-cart structural gates."""

from __future__ import annotations

from copy import deepcopy
import tempfile
from pathlib import Path

import check_gbc_cart


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
SHARING_CHECK_LABELS = (
    "compact facade aliases",
    "compact facade same-bank capacity",
    "compact facade duplicate omission",
    "compact facade sharing metadata",
)


def write_object(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def compact_facade_owner_text(
    bank: int,
    *,
    missing_alias: str | None = None,
    wrong_alias: str | None = None,
) -> str:
    definitions = [
        *(
            f"S _g21_{suffix} Def{address:08X}"
            for address, suffix in enumerate(
                COMPACT_FACADE_SUFFIXES,
                start=1,
            )
        ),
        *(
            f"S _g31_{suffix} Def"
            f"{address + (1 if suffix == wrong_alias else 0):08X}"
            for address, suffix in enumerate(
                COMPACT_FACADE_SUFFIXES,
                start=1,
            )
            if suffix != missing_alias
        ),
    ]
    return (
        "XL4\n"
        f"H 1 areas {len(definitions):X} global symbols\n"
        "M generated_compact_facade\n"
        f"A _CODE_{bank} size 15D flags 0 addr 0\n"
        + "\n".join(definitions)
        + "\n"
        "T 00 00 00 00 C9\n"
        "R 00 00 08 00\n"
    )


def banked_object_text(bank: int, size: int) -> str:
    return (
        "XL4\n"
        "H 1 areas 1 global symbols\n"
        "M generated_facade_rules\n"
        "S .__.ABS. Def00000000\n"
        f"A _CODE_{bank} size {size:X} flags 0 addr 0\n"
        "T 00 00 00 00 C9\n"
        "R 00 00 08 00\n"
    )


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

        rom = bytearray(4 * 1024 * 1024)
        rom[0x143] = 0xC0
        rom[0x147] = 0x1B
        rom[0x148] = 0x07
        rom[0x149] = 0x03
        manifest = {
            "format": "puzzlescript-gbc-cart-v1",
            "game_count": 2,
            "index_bank": 2,
            "highest_game_bank": 5,
            "packed_banks": [
                {"bank": 3, "used": 12000, "items": ["g00-core-data"]},
                {"bank": 4, "used": 13000, "items": ["g01-core-data"]},
                {"bank": 5, "used": 8000, "items": ["specialized"]},
            ],
            "object_banks": {
                "g00_generated_core.o": 3,
                "g00_generated_game.o": 3,
                "g01_generated_core.o": 4,
                "g01_generated_game.o": 4,
            },
            "games": [
                {
                    "index": 0,
                    "prefix": "g00",
                    "source_hash": 0x11111111,
                    "descriptor_bank": 3,
                    "specialized": True,
                },
                {
                    "index": 1,
                    "prefix": "g01",
                    "source_hash": 0x22222222,
                    "descriptor_bank": 4,
                    "specialized": True,
                },
            ],
        }
        areas = {
            "_CODE": (0x0200, 0x1000),
            "_HOME": (0x1200, 0x0800),
            "_CODE_1": (0x14000, 6000),
            "_CODE_2": (0x24000, 256),
            "_CODE_3": (0x34000, 12000),
            "_CODE_4": (0x44000, 13000),
            "_CODE_5": (0x54000, 8000),
        }
        valid_objects = [
            write_object(
                build_dir / "g00_generated_core.o",
                "A _DATA size 0 flags 0 addr 0\n"
                "A _CODE_3 size 100 flags 0 addr 0\n",
            ),
            write_object(
                build_dir / "g00_generated_game.o",
                "A _BSS size 0 flags 0 addr 0\n"
                "A _CODE_3 size 100 flags 0 addr 0\n",
            ),
            write_object(
                build_dir / "g01_generated_core.o",
                "A _INITIALIZED size 0 flags 0 addr 0\n"
                "A _CODE_4 size 100 flags 0 addr 0\n",
            ),
            write_object(
                build_dir / "g01_generated_game.o",
                "A _DATA size 0 flags 0 addr 0\n"
                "A _CODE_4 size 100 flags 0 addr 0\n",
            ),
        ]
        checks = check_gbc_cart.evaluate_cart(
            bytes(rom),
            manifest,
            areas,
            valid_objects,
            expected_games=2,
        )
        assert all(check.passed for check in checks), [
            check.label for check in checks if not check.passed
        ]

        over_home = dict(areas)
        over_home["_HOME"] = (0x1F00, 0x0200)
        checks = check_gbc_cart.evaluate_cart(
            bytes(rom), manifest, over_home, valid_objects, expected_games=2
        )
        assert not check_gbc_cart.check_named(checks, "HOME").passed

        over_bank = dict(areas)
        over_bank["_CODE_5"] = (0x54000, 16385)
        checks = check_gbc_cart.evaluate_cart(
            bytes(rom), manifest, over_bank, valid_objects, expected_games=2
        )
        assert not check_gbc_cart.check_named(checks, "ROM bank sizes").passed

        bad_manifest = dict(manifest)
        bad_manifest["highest_game_bank"] = 256
        checks = check_gbc_cart.evaluate_cart(
            bytes(rom), bad_manifest, areas, valid_objects, expected_games=2
        )
        assert not check_gbc_cart.check_named(checks, "bank range").passed

        bad_rom = bytearray(rom)
        bad_rom[0x143] = 0x80
        checks = check_gbc_cart.evaluate_cart(
            bytes(bad_rom), manifest, areas, valid_objects, expected_games=2
        )
        assert not check_gbc_cart.check_named(checks, "cartridge header").passed

        bad_games = dict(manifest)
        bad_games["games"] = [
            dict(manifest["games"][0]),
            {
                **manifest["games"][1],
                "prefix": "g00",
                "source_hash": 0x11111111,
                "specialized": False,
            },
        ]
        checks = check_gbc_cart.evaluate_cart(
            bytes(rom), bad_games, areas, valid_objects, expected_games=2
        )
        assert not check_gbc_cart.check_named(checks, "game identities").passed
        assert not check_gbc_cart.check_named(checks, "specialization").passed

        dirty_object = write_object(
            build_dir / "g01_generated_game.o",
            "A _DATA size 1 flags 0 addr 0\n"
            "A _CODE_4 size 100 flags 0 addr 0\n",
        )
        checks = check_gbc_cart.evaluate_cart(
            bytes(rom),
            manifest,
            areas,
            [*valid_objects[:-1], dirty_object],
            expected_games=2,
        )
        assert not check_gbc_cart.check_named(
            checks, "per-game static WRAM"
        ).passed

        valid_objects[-1] = write_object(
            build_dir / "g01_generated_game.o",
            "A _DATA size 0 flags 0 addr 0\n"
            "A _CODE_4 size 100 flags 0 addr 0\n",
        )
        owner_compact = build_dir / "g21_generated_compact_facade.o"
        owner_rules = build_dir / "g21_generated_facade_rules.o"
        member_compact = build_dir / "g31_generated_compact_facade.o"
        member_rules = build_dir / "g31_generated_facade_rules.o"
        sharing_manifest = deepcopy(manifest)
        sharing_manifest["object_banks"] = {
            **manifest["object_banks"],
            owner_compact.name: 142,
            owner_rules.name: 142,
            member_rules.name: 142,
        }
        sharing_manifest["compact_facade_sharing"] = {
            "mode": "same-bank-alias-canary-v1",
            "owner": "g21",
            "members": ["g21", "g31"],
            "normalized_sha256": "a" * 64,
            "implementation_bytes": 349,
            "gross_removed_bytes": 349,
            "bank": 142,
            "aliases": sorted(
                f"g31_{suffix}" for suffix in COMPACT_FACADE_SUFFIXES
            ),
        }

        def canary_checks(
            candidate_manifest: dict[str, object],
            *,
            owner_text: str | None = None,
            owner_rules_bank: int = 142,
            owner_rules_size: int = 1000,
            member_rules_bank: int = 142,
            member_rules_size: int = 1200,
            owner_rules_text: str | None = None,
            member_rules_text: str | None = None,
            retain_member: bool = False,
        ) -> list[check_gbc_cart.CartCheck]:
            write_object(
                owner_compact,
                (
                    compact_facade_owner_text(142)
                    if owner_text is None
                    else owner_text
                ),
            )
            write_object(
                owner_rules,
                (
                    banked_object_text(
                        owner_rules_bank,
                        owner_rules_size,
                    )
                    if owner_rules_text is None
                    else owner_rules_text
                ),
            )
            write_object(
                member_rules,
                (
                    banked_object_text(
                        member_rules_bank,
                        member_rules_size,
                    )
                    if member_rules_text is None
                    else member_rules_text
                ),
            )
            linked_objects = [
                *valid_objects,
                owner_compact,
                owner_rules,
                member_rules,
            ]
            if retain_member:
                write_object(
                    member_compact,
                    banked_object_text(142, 349),
                )
                linked_objects.append(member_compact)
            else:
                member_compact.unlink(missing_ok=True)
            return check_gbc_cart.evaluate_cart(
                bytes(rom),
                candidate_manifest,
                areas,
                linked_objects,
                expected_games=2,
            )

        checks = canary_checks(sharing_manifest)
        missing_labels = set(SHARING_CHECK_LABELS) - {
            check.label for check in checks
        }
        assert not missing_labels, f"missing sharing checks: {missing_labels}"
        assert all(
            check_gbc_cart.check_named(checks, label).passed
            for label in SHARING_CHECK_LABELS
        )

        default_checks = check_gbc_cart.evaluate_cart(
            bytes(rom),
            manifest,
            areas,
            valid_objects,
            expected_games=2,
        )
        assert all(
            check_gbc_cart.check_named(default_checks, label).passed
            for label in SHARING_CHECK_LABELS
        )

        checks = canary_checks(
            sharing_manifest,
            owner_text=compact_facade_owner_text(
                142,
                missing_alias=COMPACT_FACADE_SUFFIXES[0],
            ),
        )
        assert not check_gbc_cart.check_named(
            checks, "compact facade aliases"
        ).passed

        checks = canary_checks(
            sharing_manifest,
            owner_text=compact_facade_owner_text(
                142,
                wrong_alias=COMPACT_FACADE_SUFFIXES[1],
            ),
        )
        assert not check_gbc_cart.check_named(
            checks, "compact facade aliases"
        ).passed

        checks = canary_checks(sharing_manifest, retain_member=True)
        assert not check_gbc_cart.check_named(
            checks, "compact facade duplicate omission"
        ).passed

        retained_mapping = deepcopy(sharing_manifest)
        retained_mapping["object_banks"][member_compact.name] = 142
        checks = canary_checks(retained_mapping)
        assert not check_gbc_cart.check_named(
            checks, "compact facade duplicate omission"
        ).passed

        checks = canary_checks(
            sharing_manifest,
            member_rules_bank=143,
        )
        assert not check_gbc_cart.check_named(
            checks, "compact facade same-bank capacity"
        ).passed

        forged_bank_mapping = deepcopy(sharing_manifest)
        forged_bank_mapping["object_banks"][member_rules.name] = 143
        checks = canary_checks(forged_bank_mapping)
        assert not check_gbc_cart.check_named(
            checks, "compact facade same-bank capacity"
        ).passed

        unknown_mode = deepcopy(sharing_manifest)
        unknown_mode["compact_facade_sharing"]["mode"] = "future-mode"
        checks = canary_checks(unknown_mode)
        assert not check_gbc_cart.check_named(
            checks, "compact facade sharing metadata"
        ).passed

        checks = canary_checks(
            sharing_manifest,
            owner_rules_size=8000,
            member_rules_size=8036,
        )
        assert not check_gbc_cart.check_named(
            checks, "compact facade same-bank capacity"
        ).passed

        unsorted_aliases = deepcopy(sharing_manifest)
        unsorted_aliases["compact_facade_sharing"]["aliases"].reverse()
        checks = canary_checks(unsorted_aliases)
        assert not check_gbc_cart.check_named(
            checks, "compact facade sharing metadata"
        ).passed

        malformed_records: list[object] = [None, {}]
        for field in sharing_manifest["compact_facade_sharing"]:
            missing_field = deepcopy(
                sharing_manifest["compact_facade_sharing"]
            )
            del missing_field[field]
            malformed_records.append(missing_field)
        for malformed in malformed_records:
            malformed_manifest = deepcopy(sharing_manifest)
            malformed_manifest["compact_facade_sharing"] = malformed
            checks = canary_checks(malformed_manifest)
            assert not check_gbc_cart.check_named(
                checks, "compact facade sharing metadata"
            ).passed, malformed

        valid_owner_text = compact_facade_owner_text(142)
        owner_header = "H 1 areas 10 global symbols\n"
        malformed_owners = (
            (
                "missing XL4",
                valid_owner_text.removeprefix("XL4\n"),
            ),
            (
                "missing H",
                valid_owner_text.replace(owner_header, ""),
            ),
            (
                "symbol-count mismatch",
                valid_owner_text.replace(
                    owner_header,
                    "H 1 areas F global symbols\n",
                ),
            ),
            (
                "duplicate H",
                valid_owner_text.replace(
                    owner_header,
                    owner_header + owner_header,
                ),
            ),
            (
                "malformed H",
                valid_owner_text.replace(
                    owner_header,
                    "H nope areas 10 global symbols\n",
                ),
            ),
            (
                "trailing symbol garbage",
                valid_owner_text.replace(
                    "S _g21_ps_gbc_facade_get_movements "
                    "Def00000001",
                    "S _g21_ps_gbc_facade_get_movements "
                    "Def00000001 garbage",
                ),
            ),
            (
                "malformed area",
                valid_owner_text.replace(
                    "A _CODE_142 size 15D flags 0 addr 0",
                    "A _CODE_142 size 15D flags 0",
                ),
            ),
        )
        for problem, malformed_owner in malformed_owners:
            checks = canary_checks(
                sharing_manifest,
                owner_text=malformed_owner,
            )
            assert not check_gbc_cart.check_named(
                checks, "compact facade aliases"
            ).passed, f"{problem} owner alias evidence was accepted"
            assert not check_gbc_cart.check_named(
                checks, "compact facade same-bank capacity"
            ).passed, f"{problem} owner bank evidence was accepted"

        valid_caller_text = banked_object_text(142, 1000)
        caller_header = "H 1 areas 1 global symbols\n"
        malformed_callers = (
            (
                "missing XL4",
                valid_caller_text.removeprefix("XL4\n"),
            ),
            (
                "missing H",
                valid_caller_text.replace(caller_header, ""),
            ),
            (
                "symbol-count mismatch",
                valid_caller_text.replace(
                    caller_header,
                    "H 1 areas 0 global symbols\n",
                ),
            ),
            (
                "duplicate H",
                valid_caller_text.replace(
                    caller_header,
                    caller_header + caller_header,
                ),
            ),
            (
                "malformed H",
                valid_caller_text.replace(
                    caller_header,
                    "H 1 areas nope global symbols\n",
                ),
            ),
            (
                "trailing symbol garbage",
                valid_caller_text.replace(
                    "S .__.ABS. Def00000000",
                    "S .__.ABS. Def00000000 garbage",
                ),
            ),
            (
                "trailing area garbage",
                valid_caller_text.replace(
                    "A _CODE_142 size 3E8 flags 0 addr 0",
                    "A _CODE_142 size 3E8 flags 0 addr 0 garbage",
                ),
            ),
        )
        for problem, malformed_caller in malformed_callers:
            checks = canary_checks(
                sharing_manifest,
                owner_rules_text=malformed_caller,
            )
            assert not check_gbc_cart.check_named(
                checks, "compact facade same-bank capacity"
            ).passed, f"{problem} caller evidence was accepted"

    print("check_gbc_cart_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
