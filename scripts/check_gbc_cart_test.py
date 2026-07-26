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

    print("check_gbc_cart_test: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
