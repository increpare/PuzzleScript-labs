#!/usr/bin/env python3
"""Focused tests for GBC cart capacity and generated-code metrics."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
from typing import Callable

import report_gbc_cart_metrics


def write_object(path: Path, size: int, bank: int) -> None:
    path.write_text(
        f"A _CODE_{bank} size {size:X} flags 0 addr 0\n",
        encoding="utf-8",
    )


def single_object_fixture(
    root: Path,
    *,
    object_text: str | None,
    manifest_bank: int = 3,
    packed_used: int = 10,
) -> tuple[Path, Path]:
    objects = root / "objects"
    objects.mkdir()
    object_name = "g00_generated_specialized_turn_rules_0.o"
    if object_text is not None:
        (objects / object_name).write_text(
            object_text,
            encoding="utf-8",
        )
    (
        objects / "g00_generated_specialized_turn_rules_0.asm"
    ).write_text(
        "_ps_gbc_specialized_rule_0:\n"
        "\tadd\tsp, #-8\n",
        encoding="utf-8",
    )
    manifest_path = root / "cart-manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "highest_game_bank": 3,
                "object_banks": {object_name: manifest_bank},
                "packed_banks": [{"bank": 3, "used": packed_used}],
            }
        ),
        encoding="utf-8",
    )
    return manifest_path, objects


def test_cart_and_codegen_metrics() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        objects = root / "objects"
        objects.mkdir()
        object_sizes = {
            "g00_generated_compact_facade.o": 16,
            "g00_generated_core.o": 64,
            "g00_generated_facade_rules.o": 12,
            "g00_generated_game.o": 32,
            "g00_generated_specialized_turn.o": 16,
            "g00_generated_specialized_turn_rules_0.o": 32,
            "g00_launcher_art.o": 64,
            "g00_launcher_selected_art.o": 64,
        }
        object_banks = {
            name: 3 if index < 4 else 4
            for index, name in enumerate(object_sizes)
        }
        for name, size in object_sizes.items():
            write_object(objects / name, size, object_banks[name])
        (
            objects / "g00_generated_specialized_turn_rules_0.asm"
        ).write_text(
            "_ps_gbc_specialized_rule_0:\n"
            "\tadd\tsp, #-32\n"
            "\tldhl\tsp, #0\n"
            "\tldhl\tsp, #7\n"
            "_ps_gbc_specialized_rule_1:\n"
            "\tadd\tsp, #-8\n"
            "    ldhl    sp, #1\n",
            encoding="utf-8",
        )
        manifest_path = root / "cart-manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "format": "puzzlescript-gbc-cart-v1",
                    "highest_game_bank": 4,
                    "object_banks": object_banks,
                    "packed_banks": [
                        {"bank": 3, "used": 100},
                        {"bank": 4, "used": 200},
                    ],
                }
            ),
            encoding="utf-8",
        )

        report = report_gbc_cart_metrics.build_report(
            manifest_path=manifest_path,
            objects_directory=objects,
        )

    assert report["packed_payload_bytes"] == 300
    assert report["allocated_payload_bytes"] == 32768
    assert report["allocated_slack_bytes"] == 32468
    assert report["highest_used_bank"] == 4
    assert report["physical_4mb_headroom_bytes"] == 4144852
    assert report["rule_functions"] == 2
    assert report["mean_frame_bytes"] == 20.0
    assert report["median_frame_bytes"] == 32
    assert report["max_frame_bytes"] == 32
    assert report["ldhl_sp_count"] == 3
    assert report["estimated_ldhl_sp_rom_bytes"] == 6
    assert report["rule_function_labels"] == 2
    assert report["rule_functions_with_frames"] == 2
    assert report["object_kinds"] == {
        "generated_compact_facade": {"bytes": 16, "count": 1},
        "generated_core": {"bytes": 64, "count": 1},
        "generated_facade_rules": {"bytes": 12, "count": 1},
        "generated_game": {"bytes": 32, "count": 1},
        "generated_specialized_rule_packs": {"bytes": 32, "count": 1},
        "generated_specialized_turn": {"bytes": 16, "count": 1},
        "launcher_art": {"bytes": 64, "count": 1},
        "launcher_selected_art": {"bytes": 64, "count": 1},
    }


def test_missing_expected_specialized_assembly_is_clear() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        objects = root / "objects"
        objects.mkdir()
        object_banks = {
            "g00_generated_specialized_turn_rules_0.o": 3,
            "g00_generated_specialized_turn_rules_1.o": 3,
        }
        write_object(
            objects / "g00_generated_specialized_turn_rules_0.o",
            10,
            3,
        )
        write_object(
            objects / "g00_generated_specialized_turn_rules_1.o",
            20,
            3,
        )
        (
            objects / "g00_generated_specialized_turn_rules_0.asm"
        ).write_text(
            "_ps_gbc_specialized_rule_0:\n"
            "\tadd\tsp, #-8\n",
            encoding="utf-8",
        )
        manifest_path = root / "cart-manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "highest_game_bank": 3,
                    "object_banks": object_banks,
                    "packed_banks": [{"bank": 3, "used": 30}],
                }
            ),
            encoding="utf-8",
        )

        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=manifest_path,
                objects_directory=objects,
            ),
            "missing expected specialized rule assembly",
        )


def test_unexpected_specialized_assembly_is_clear() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        objects = root / "objects"
        objects.mkdir()
        object_name = "g00_generated_specialized_turn_rules_0.o"
        write_object(objects / object_name, 30, 3)
        for name in (
            "g00_generated_specialized_turn_rules_0.asm",
            "stale_generated_specialized_turn_rules_9.asm",
        ):
            (objects / name).write_text(
                "_ps_gbc_specialized_rule_0:\n"
                "\tadd\tsp, #-8\n",
                encoding="utf-8",
            )
        manifest_path = root / "cart-manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "highest_game_bank": 3,
                    "object_banks": {object_name: 3},
                    "packed_banks": [{"bank": 3, "used": 30}],
                }
            ),
            encoding="utf-8",
        )

        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=manifest_path,
                objects_directory=objects,
            ),
            "unexpected specialized rule assembly",
        )


def test_missing_object_file_is_clear() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        manifest_path, objects = single_object_fixture(
            Path(temporary),
            object_text=None,
        )
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=manifest_path,
                objects_directory=objects,
            ),
            "object file could not be read",
        )


def test_zero_code_area_is_rejected() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        manifest_path, objects = single_object_fixture(
            Path(temporary),
            object_text="A _CODE_3 size 0 flags 0 addr 0\n",
            packed_used=0,
        )
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=manifest_path,
                objects_directory=objects,
            ),
            "expected exactly one non-empty banked code area, found 0",
        )


def test_multiple_code_areas_are_rejected() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        manifest_path, objects = single_object_fixture(
            Path(temporary),
            object_text=(
                "A _CODE_3 size A flags 0 addr 0\n"
                "A _CODE_4 size 14 flags 0 addr 0\n"
            ),
            packed_used=30,
        )
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=manifest_path,
                objects_directory=objects,
            ),
            "expected exactly one non-empty banked code area, found 2",
        )


def test_object_code_bank_must_match_manifest() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        manifest_path, objects = single_object_fixture(
            Path(temporary),
            object_text="A _CODE_4 size A flags 0 addr 0\n",
        )
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=manifest_path,
                objects_directory=objects,
            ),
            "code bank 4 does not match manifest bank 3",
        )


def test_object_bytes_must_match_packed_payload() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        manifest_path, objects = single_object_fixture(
            Path(temporary),
            object_text="A _CODE_3 size A flags 0 addr 0\n",
            packed_used=11,
        )
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=manifest_path,
                objects_directory=objects,
            ),
            "object code bytes 10 do not match packed payload bytes 11",
        )


def test_specialized_rule_helper_frames_are_included() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        objects = Path(temporary)
        (
            objects / "g00_generated_specialized_turn_rules_0.asm"
        ).write_text(
            "_ps_gbc_specialized_rule_0:\n"
            "_other_function::\n"
            "\tadd\tsp, #-64\n"
            "_ps_gbc_specialized_rule_1_matches_at:\n"
            "\tadd\tsp, #-6\n",
            encoding="utf-8",
        )

        metrics = report_gbc_cart_metrics.scan_specialized_assembly(
            [objects / "g00_generated_specialized_turn_rules_0.asm"]
        )

    assert metrics["rule_function_labels"] == 2
    assert metrics["rule_functions_with_frames"] == 1
    assert metrics["rule_functions"] == metrics["rule_functions_with_frames"]
    assert metrics["mean_frame_bytes"] == 6.0
    assert metrics["max_frame_bytes"] == 6


def assert_report_error(
    operation: Callable[[], object],
    expected_message: str,
) -> None:
    try:
        operation()
    except report_gbc_cart_metrics.ReportError as error:
        assert expected_message in str(error)
    else:
        raise AssertionError(
            f"expected ReportError containing {expected_message!r}"
        )


def test_manifest_errors_are_clear() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        objects = root / "objects"
        objects.mkdir()
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=root / "missing.json",
                objects_directory=objects,
            ),
            "manifest was not found",
        )

        invalid_json = root / "invalid-json.json"
        invalid_json.write_text("{", encoding="utf-8")
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=invalid_json,
                objects_directory=objects,
            ),
            "manifest is invalid JSON",
        )

        invalid_structure = root / "invalid-structure.json"
        invalid_structure.write_text("{}", encoding="utf-8")
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=invalid_structure,
                objects_directory=objects,
            ),
            "manifest is invalid",
        )


def test_missing_specialized_assembly_is_clear() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        objects = root / "objects"
        objects.mkdir()
        manifest_path = root / "cart-manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "highest_game_bank": 3,
                    "object_banks": {"g00_generated_core.o": 3},
                    "packed_banks": [{"bank": 3, "used": 0}],
                }
            ),
            encoding="utf-8",
        )
        assert_report_error(
            lambda: report_gbc_cart_metrics.build_report(
                manifest_path=manifest_path,
                objects_directory=objects,
            ),
            "no specialized rule assembly was found",
        )


def main() -> None:
    test_cart_and_codegen_metrics()
    test_missing_expected_specialized_assembly_is_clear()
    test_unexpected_specialized_assembly_is_clear()
    test_missing_object_file_is_clear()
    test_zero_code_area_is_rejected()
    test_multiple_code_areas_are_rejected()
    test_object_code_bank_must_match_manifest()
    test_object_bytes_must_match_packed_payload()
    test_specialized_rule_helper_frames_are_included()
    test_manifest_errors_are_clear()
    test_missing_specialized_assembly_is_clear()
    print("report_gbc_cart_metrics_test: ok")


if __name__ == "__main__":
    main()
