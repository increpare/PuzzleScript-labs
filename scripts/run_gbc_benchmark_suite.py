#!/usr/bin/env python3
"""Build and run a representative, deterministic GBC performance suite."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

from check_gbc_rom import map_usage
from run_gbc_benchmark import default_mgba, run_once


DEFAULT_CASES = (
    ("sokoban", "src/demo/sokoban_basic.txt"),
    ("large_board", "src/tests/good_games/pushit.txt"),
    ("rule_heavy", "src/tests/good_games/Xorro The Chaos Warden.txt"),
    ("object_heavy", "src/tests/good_games/slot machine.txt"),
    ("two_movement_lanes", "src/tests/good_games/Voitex Rasteriser.txt"),
)


def find_make() -> Path | None:
    executable = shutil.which("make") or shutil.which("make.exe")
    if executable:
        return Path(executable)
    candidate = Path(r"C:\devkitPro\msys2\usr\bin\make.exe")
    return candidate if candidate.is_file() else None


def git_value(repository: Path, *args: str) -> str:
    process = subprocess.run(
        ["git", *args],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    )
    return process.stdout.strip()


def benchmark_derived(record: dict[str, Any]) -> dict[str, Any]:
    logic_iterations = int(record["iterations"])
    render_iterations = int(record["render_iterations"])
    return {
        "ticks_per_turn": record["ticks"] / logic_iterations,
        "phase_ticks_per_turn": {
            name: ticks / logic_iterations
            for name, ticks in record["phase_ticks"].items()
        },
        "render_ticks_per_frame": record["render_ticks"] / render_iterations,
        "composition_ticks_per_frame": (
            record["composition_ticks"] / render_iterations
        ),
        "tile_upload_ticks_per_frame": (
            record["tile_upload_ticks"] / render_iterations
        ),
        "map_upload_ticks_per_frame": (
            record["map_upload_ticks"] / render_iterations
        ),
        "palette_upload_ticks_per_frame": (
            record["palette_upload_ticks"] / render_iterations
        ),
        "repeated_text_ticks": record["repeated_text_ticks"],
        **{
            f"{name}_ticks": ticks
            for name, ticks in record["interaction_ticks"].items()
        },
    }


def percent_delta(before: float, after: float) -> float | None:
    if before == 0:
        return None
    return (after - before) * 100.0 / before


def compare_case(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    metrics = {}
    for name in (
        "ticks_per_turn",
        "render_ticks_per_frame",
        "composition_ticks_per_frame",
        "tile_upload_ticks_per_frame",
        "map_upload_ticks_per_frame",
        "palette_upload_ticks_per_frame",
        "repeated_text_ticks",
        "initial_render_ticks",
        "walk_logic_ticks",
        "walk_render_ticks",
        "push_logic_ticks",
        "push_render_ticks",
    ):
        if name not in baseline["derived"] or name not in candidate["derived"]:
            continue
        before = float(baseline["derived"][name])
        after = float(candidate["derived"][name])
        metrics[name] = {
            "baseline": before,
            "candidate": after,
            "delta": after - before,
            "delta_percent": percent_delta(before, after),
        }
    for name in (
        "estimated_session_bytes",
        "snapshot_sram_bytes",
        "estimated_game_rom_bank_bytes",
        "benchmark_fixed_rom_bytes",
        "benchmark_generated_rom_bank_bytes",
        "benchmark_static_wram_bytes",
    ):
        before = float(baseline["memory"][name])
        after = float(candidate["memory"][name])
        metrics[name] = {
            "baseline": before,
            "candidate": after,
            "delta": after - before,
            "delta_percent": percent_delta(before, after),
        }
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--make", type=Path)
    parser.add_argument("--gbdk-home", type=Path)
    parser.add_argument("--compiler", type=Path)
    parser.add_argument("--mgba", type=Path)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--phases", action="store_true")
    parser.add_argument("--case", action="append", choices=[case[0] for case in DEFAULT_CASES])
    parser.add_argument("--merge-input", action="append", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()

    repository = args.repository.resolve()
    if args.merge_input:
        merged_cases = []
        seen = set()
        phase_modes = set()
        for input_path in args.merge_input:
            data = json.loads(input_path.read_text(encoding="utf-8"))
            phase_modes.add(bool(data.get("phase_probes")))
            for case in data.get("cases", []):
                if case["name"] in seen:
                    raise SystemExit(f"duplicate merged case: {case['name']}")
                seen.add(case["name"])
                merged_cases.append(case)
        if len(phase_modes) != 1:
            raise SystemExit("merged inputs disagree about phase-probe mode")
        output: dict[str, Any] = {
            "format": "puzzlescript-gbc-benchmark-suite-v1",
            "label": args.label,
            "revision": git_value(repository, "rev-parse", "HEAD"),
            "dirty": bool(git_value(repository, "status", "--porcelain")),
            "runs": args.runs,
            "phase_probes": phase_modes.pop(),
            "cases": merged_cases,
        }
        if args.baseline is not None:
            baseline_data = json.loads(args.baseline.read_text(encoding="utf-8"))
            baseline_cases = {
                case["name"]: case for case in baseline_data.get("cases", [])
            }
            output["baseline"] = str(args.baseline)
            output["comparison"] = {
                case["name"]: compare_case(baseline_cases[case["name"]], case)
                for case in merged_cases
                if case["name"] in baseline_cases
            }
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(output, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {args.out}", flush=True)
        return 0

    make = args.make or find_make()
    gbdk_home = args.gbdk_home or (
        repository / ".codex_tmp" / "toolchains" / "gbdk"
    )
    compiler = args.compiler or (
        repository / "build-gbc-release" / "native" / "puzzlescript_cpp.exe"
    )
    emulator = args.mgba or default_mgba()
    if make is None or not make.is_file():
        raise SystemExit("GNU make was not found")
    if not gbdk_home.is_dir():
        raise SystemExit(f"GBDK was not found: {gbdk_home}")
    if not compiler.is_file():
        raise SystemExit(f"PuzzleScript compiler was not found: {compiler}")
    if emulator is None or not emulator.is_file():
        raise SystemExit("mGBA SDL executable was not found")

    selected = set(args.case or (case[0] for case in DEFAULT_CASES))
    cases = [case for case in DEFAULT_CASES if case[0] in selected]
    artifact_root = (
        repository / "build-gbc-release" / "benchmarks" / args.label
    )
    artifact_root.mkdir(parents=True, exist_ok=True)
    firmware = repository / "firmware" / "gbc"
    suffix = "-phases" if args.phases else ""
    rom = firmware / f"puzzlescript_gbc_autotest-perf-compact{suffix}.gb"
    map_path = firmware / f"puzzlescript_gbc_autotest-perf-compact{suffix}.map"
    results = []

    for index, (name, relative_source) in enumerate(cases, start=1):
        source = repository / relative_source
        if not source.is_file():
            raise SystemExit(f"benchmark source was not found: {source}")
        print(f"[{index}/{len(cases)}] build {name}", flush=True)
        log_path = artifact_root / f"{name}.build.log"
        command = [
            str(make),
            "-B",
            "-C",
            "firmware/gbc",
            "AUTOTEST=1",
            "PERF_BENCH=1",
            "PERF_WIDE=0",
            f"PERF_PHASES={1 if args.phases else 0}",
            f"GAME={source.as_posix()}",
            f"GBDK_HOME={gbdk_home.as_posix()}",
            f"PUZZLESCRIPT_CPP={compiler.as_posix()}",
            f"PYTHON={Path(sys.executable).as_posix()}",
            "EXPORT_GBC_FLAGS=--cull-oversize-levels",
        ]
        process = subprocess.run(
            command,
            cwd=repository,
            capture_output=True,
            text=True,
        )
        log_path.write_text(
            process.stdout + process.stderr,
            encoding="utf-8",
        )
        if process.returncode != 0:
            raise SystemExit(f"GBC build failed for {name}; see {log_path}")

        print(f"[{index}/{len(cases)}] mGBA {name}", flush=True)
        records = [
            run_once(emulator, rom, args.timeout)
            for _ in range(args.runs)
        ]
        if any(record != records[0] for record in records[1:]):
            raise SystemExit(
                f"nondeterministic benchmark for {name}: "
                + json.dumps(records, sort_keys=True)
            )
        record = records[0]
        manifest = json.loads(
            (firmware / "generated" / "gbc_manifest.json").read_text(
                encoding="utf-8"
            )
        )
        fixed_rom, generated_bank, static_wram = map_usage(map_path)
        result = {
            "name": name,
            "source": relative_source,
            "source_hash": int(manifest["source_hash"]),
            "shape": {
                "objects": int(manifest["object_count"]),
                "collision_layers": int(manifest["collision_layer_count"]),
                "movement_layers": int(manifest["movement_layer_count"]),
                "movement_bytes_per_cell": int(
                    manifest["movement_bytes_per_cell"]
                ),
                "object_bytes_per_cell": int(
                    manifest["object_bytes_per_cell"]
                ),
                "max_level_cells": int(manifest["max_level_cells"]),
                "rules": int(manifest["rule_count"]),
                "patterns": int(manifest["pattern_count"]),
                "single_pass_groups": int(
                    manifest.get("single_pass_group_count", 0)
                ),
                "input_specialized_groups": int(
                    manifest.get("input_specialized_group_count", 0)
                ),
                "object_presence_precheck_rules": int(
                    manifest.get("object_presence_precheck_rule_count", 0)
                ),
                "player_cell_anchor_rules": int(
                    manifest.get("player_cell_anchor_rule_count", 0)
                ),
            },
            "memory": {
                "estimated_session_bytes": int(
                    manifest["estimated_session_bytes"]
                ),
                "snapshot_sram_bytes": int(manifest["snapshot_sram_bytes"]),
                "estimated_game_rom_bank_bytes": int(
                    manifest["estimated_game_rom_bank_bytes"]
                ),
                "benchmark_fixed_rom_bytes": fixed_rom,
                "benchmark_generated_rom_bank_bytes": generated_bank,
                "benchmark_static_wram_bytes": static_wram,
            },
            "record": record,
            "derived": benchmark_derived(record),
        }
        results.append(result)
        print(
            f"    logic={result['derived']['ticks_per_turn']:.3f} "
            f"render={result['derived']['render_ticks_per_frame']:.3f} "
            f"session={result['memory']['estimated_session_bytes']} "
            f"game_bank={result['memory']['estimated_game_rom_bank_bytes']}",
            flush=True,
        )

    output: dict[str, Any] = {
        "format": "puzzlescript-gbc-benchmark-suite-v1",
        "label": args.label,
        "revision": git_value(repository, "rev-parse", "HEAD"),
        "dirty": bool(git_value(repository, "status", "--porcelain")),
        "runs": args.runs,
        "phase_probes": args.phases,
        "cases": results,
    }
    if args.baseline is not None:
        baseline_data = json.loads(args.baseline.read_text(encoding="utf-8"))
        baseline_cases = {
            case["name"]: case for case in baseline_data.get("cases", [])
        }
        output["baseline"] = str(args.baseline)
        output["comparison"] = {
            case["name"]: compare_case(baseline_cases[case["name"]], case)
            for case in results
            if case["name"] in baseline_cases
        }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(output, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
