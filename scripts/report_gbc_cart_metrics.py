#!/usr/bin/env python3
"""Report reproducible GBC cart capacity and generated-code metrics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import statistics
import sys
from typing import Any


ROM_BANK_BYTES = 16 * 1024
FIRST_GAME_BANK = 3
LAST_ROM_BANK = 255
PHYSICAL_PAYLOAD_BYTES = (
    LAST_ROM_BANK - FIRST_GAME_BANK + 1
) * ROM_BANK_BYTES
OBJECT_CODE_AREA = re.compile(
    r"^A\s+_CODE(?:_\d+)?\s+size\s+([0-9A-Fa-f]+)\b",
    re.MULTILINE,
)
RULE_LABEL = re.compile(
    r"^\s*_ps_gbc_specialized_rule_[A-Za-z0-9_.$]+:\s*$"
)
SYMBOL_LABEL = re.compile(r"^\s*_[A-Za-z0-9_.$]+:{1,2}\s*$")
FRAME_ALLOCATION = re.compile(r"^\s*add\s+sp,\s*#-(\d+)\b")
LDHL_SP = re.compile(r"^\s*ldhl\s+sp,\s*#")


class ReportError(RuntimeError):
    """Raised when cart metrics cannot be reported reliably."""


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ReportError(f"manifest was not found: {path}")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ReportError(
            f"manifest is invalid JSON: {path}: {error}"
        ) from error
    if not isinstance(manifest, dict):
        raise ReportError(f"manifest is invalid: root is not an object: {path}")

    packed_banks = manifest.get("packed_banks")
    highest_game_bank = manifest.get("highest_game_bank")
    object_banks = manifest.get("object_banks")
    if (
        not isinstance(packed_banks, list)
        or not packed_banks
        or type(highest_game_bank) is not int
        or not isinstance(object_banks, dict)
    ):
        raise ReportError(
            "manifest is invalid: expected packed_banks, "
            "highest_game_bank, and object_banks"
        )

    bank_numbers: list[int] = []
    for packed_bank in packed_banks:
        if not isinstance(packed_bank, dict):
            raise ReportError(
                "manifest is invalid: packed bank is not an object"
            )
        bank = packed_bank.get("bank")
        used = packed_bank.get("used")
        if (
            type(bank) is not int
            or not FIRST_GAME_BANK <= bank <= LAST_ROM_BANK
            or type(used) is not int
            or not 0 <= used <= ROM_BANK_BYTES
        ):
            raise ReportError(
                "manifest is invalid: packed bank number or usage "
                "is out of range"
            )
        bank_numbers.append(bank)
    if (
        len(set(bank_numbers)) != len(bank_numbers)
        or highest_game_bank != max(bank_numbers)
    ):
        raise ReportError(
            "manifest is invalid: packed banks are duplicated or "
            "highest_game_bank does not match"
        )
    if any(
        not isinstance(name, str)
        or type(bank) is not int
        or not FIRST_GAME_BANK <= bank <= LAST_ROM_BANK
        for name, bank in object_banks.items()
    ):
        raise ReportError(
            "manifest is invalid: object_banks contains an invalid entry"
        )
    return manifest


def object_kind(name: str) -> str:
    if name.endswith("_launcher_selected_art.o"):
        return "launcher_selected_art"
    if name.endswith("_launcher_art.o"):
        return "launcher_art"
    if "_generated_specialized_turn_rules_" in name:
        return "generated_specialized_rule_packs"
    for suffix, kind in (
        ("_generated_compact_facade.o", "generated_compact_facade"),
        ("_generated_core.o", "generated_core"),
        ("_generated_facade_rules.o", "generated_facade_rules"),
        ("_generated_game.o", "generated_game"),
        ("_generated_specialized_turn.o", "generated_specialized_turn"),
    ):
        if name.endswith(suffix):
            return kind
    return "other"


def object_code_bytes(path: Path) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    return sum(
        int(match.group(1), 16)
        for match in OBJECT_CODE_AREA.finditer(text)
    )


def object_kind_metrics(
    manifest: dict[str, Any],
    objects_directory: Path,
) -> dict[str, dict[str, int]]:
    totals: dict[str, dict[str, int]] = {}
    for name in sorted(manifest.get("object_banks", {})):
        kind = object_kind(name)
        record = totals.setdefault(kind, {"bytes": 0, "count": 0})
        record["bytes"] += object_code_bytes(objects_directory / name)
        record["count"] += 1
    return {name: totals[name] for name in sorted(totals)}


def scan_specialized_assembly(
    objects_directory: Path,
) -> dict[str, int | float]:
    assembly_paths = sorted(
        objects_directory.glob(
            "*_generated_specialized_turn_rules_*.asm"
        )
    )
    if not assembly_paths:
        raise ReportError(
            "no specialized rule assembly was found in "
            f"{objects_directory}"
        )
    frame_bytes: list[int] = []
    rule_function_labels = 0
    rule_functions_with_frames = 0
    ldhl_sp_count = 0
    for path in assembly_paths:
        waiting_for_frame = False
        for line in path.read_text(
            encoding="utf-8",
            errors="replace",
        ).splitlines():
            if RULE_LABEL.match(line):
                rule_function_labels += 1
                waiting_for_frame = True
                continue
            if SYMBOL_LABEL.match(line):
                waiting_for_frame = False
                continue
            if LDHL_SP.match(line):
                ldhl_sp_count += 1
            if waiting_for_frame:
                match = FRAME_ALLOCATION.match(line)
                if match:
                    frame_bytes.append(int(match.group(1)))
                    rule_functions_with_frames += 1
                    waiting_for_frame = False

    return {
        "estimated_ldhl_sp_rom_bytes": ldhl_sp_count * 2,
        "ldhl_sp_count": ldhl_sp_count,
        "max_frame_bytes": max(frame_bytes, default=0),
        "mean_frame_bytes": (
            statistics.fmean(frame_bytes) if frame_bytes else 0.0
        ),
        "median_frame_bytes": (
            statistics.median_high(frame_bytes) if frame_bytes else 0
        ),
        "rule_function_labels": rule_function_labels,
        # Backward-compatible alias for the original synthetic-report field.
        "rule_functions": rule_functions_with_frames,
        "rule_functions_with_frames": rule_functions_with_frames,
        "specialized_assembly_files": len(assembly_paths),
    }


def build_report(
    *,
    manifest_path: Path,
    objects_directory: Path,
) -> dict[str, Any]:
    manifest = load_manifest(manifest_path)
    packed_banks = manifest["packed_banks"]
    packed_payload_bytes = sum(
        int(bank["used"]) for bank in packed_banks
    )
    allocated_payload_bytes = len(packed_banks) * ROM_BANK_BYTES
    assembly_metrics = scan_specialized_assembly(objects_directory)
    report: dict[str, Any] = {
        "allocated_payload_bytes": allocated_payload_bytes,
        "allocated_slack_bytes": (
            allocated_payload_bytes - packed_payload_bytes
        ),
        "format": "puzzlescript-gbc-cart-codegen-metrics-v1",
        "highest_used_bank": int(manifest["highest_game_bank"]),
        "object_kinds": object_kind_metrics(
            manifest,
            objects_directory,
        ),
        "packed_bank_count": len(packed_banks),
        "packed_payload_bytes": packed_payload_bytes,
        "physical_4mb_headroom_bytes": (
            PHYSICAL_PAYLOAD_BYTES - packed_payload_bytes
        ),
        "physical_payload_capacity_bytes": PHYSICAL_PAYLOAD_BYTES,
    }
    report.update(assembly_metrics)
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--objects", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    try:
        report = build_report(
            manifest_path=args.manifest,
            objects_directory=args.objects,
        )
    except ReportError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
