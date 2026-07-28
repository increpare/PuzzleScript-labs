#!/usr/bin/env python3
"""Focused tests for reproducible GBC benchmark-suite tool paths."""

from __future__ import annotations

import os
from pathlib import Path
import py_compile

import run_gbc_benchmark_suite


def benchmark_record(
    *,
    alternating_render_ticks: int = 17,
    walk_render_ticks: int = 513,
    push_render_ticks: int = 0,
) -> dict[str, object]:
    return {
        "iterations": 4,
        "ticks": 40,
        "render_iterations": 4,
        "phase_ticks": {"snapshot": 8},
        "schedule_counts": {"group_invocations": 12},
        "render_ticks": alternating_render_ticks,
        "composition_ticks": 16,
        "tile_upload_ticks": 12,
        "map_upload_ticks": 8,
        "palette_upload_ticks": 4,
        "repeated_text_ticks": 3,
        "interaction_ticks": {
            "initial_render": 1024,
            "walk_logic": 256,
            "walk_render": walk_render_ticks,
            "push_logic": 128,
            "push_render": push_render_ticks,
        },
        "render_detail": {
            "initial_render": {
                "phase_ticks": {
                    "compose": 0,
                    "cache_lookup": 0,
                    "encode": 0,
                    "tile_upload": 0,
                    "map_write": 0,
                },
                "counts": {
                    "dirty_cells": 90,
                    "cache_hits": 80,
                    "cache_misses": 10,
                    "dedicated_fallbacks": 0,
                    "uploaded_quartets": 10,
                },
            },
            "walk_render": {
                "phase_ticks": {
                    "compose": 0,
                    "cache_lookup": 0,
                    "encode": 0,
                    "tile_upload": 0,
                    "map_write": 0,
                },
                "counts": {
                    "dirty_cells": 2,
                    "cache_hits": 1,
                    "cache_misses": 1,
                    "dedicated_fallbacks": 0,
                    "uploaded_quartets": 1,
                },
            },
            "push_render": {
                "phase_ticks": {
                    "compose": 0,
                    "cache_lookup": 0,
                    "encode": 0,
                    "tile_upload": 0,
                    "map_write": 0,
                },
                "counts": {
                    "dirty_cells": 0,
                    "cache_hits": 0,
                    "cache_misses": 0,
                    "dedicated_fallbacks": 0,
                    "uploaded_quartets": 0,
                },
            },
        },
    }


def benchmark_case(
    *,
    alternating_render_ticks: int = 17,
    walk_render_ticks: int = 513,
    push_render_ticks: int = 0,
) -> dict[str, object]:
    derived = run_gbc_benchmark_suite.benchmark_derived(
        benchmark_record(
            alternating_render_ticks=alternating_render_ticks,
            walk_render_ticks=walk_render_ticks,
            push_render_ticks=push_render_ticks,
        )
    )
    return {
        "derived": derived,
        "memory": {
            "estimated_session_bytes": 1,
            "snapshot_sram_bytes": 2,
            "estimated_game_rom_bank_bytes": 3,
            "benchmark_fixed_rom_bytes": 4,
            "benchmark_generated_rom_bank_bytes": 5,
            "benchmark_static_wram_bytes": 6,
        },
    }


def test_script_compiles() -> None:
    py_compile.compile(
        run_gbc_benchmark_suite.__file__,
        doraise=True,
    )


def test_repository_relative_tool_paths() -> None:
    if os.name == "nt":
        repository = Path("C:/repo")
        compiler = Path("C:/repo/build/native/puzzlescript_cpp.exe")
        gbdk_home = Path("C:/repo/.codex_tmp/toolchains/gbdk")
    else:
        repository = Path("/repo")
        compiler = Path("/repo/build/native/puzzlescript_cpp")
        gbdk_home = Path("/repo/.codex_tmp/toolchains/gbdk")

    assert run_gbc_benchmark_suite.default_compiler(repository) == compiler
    assert run_gbc_benchmark_suite.resolve_tool_path(
        Path(".codex_tmp/toolchains/gbdk"),
        repository=repository,
    ) == gbdk_home


def test_derived_keeps_legacy_metrics_and_attributes_headline_render() -> None:
    derived = run_gbc_benchmark_suite.benchmark_derived(benchmark_record())

    assert derived["render_ticks_per_frame"] == 4.25
    assert derived["walk_render_ticks"] == 513
    assert derived["push_render_ticks"] == 0
    assert derived["diagnostic"] == {
        "alternating_render_ticks_per_frame": 4.25,
    }
    assert derived["headline_render"] == {
        "walk_render_ticks": 513,
        "push_render_ticks": 0,
    }


def test_compare_case_uses_real_interactions_not_alternating_diagnostic() -> None:
    comparison = run_gbc_benchmark_suite.compare_case(
        benchmark_case(
            alternating_render_ticks=17,
            walk_render_ticks=513,
            push_render_ticks=0,
        ),
        benchmark_case(
            alternating_render_ticks=1700,
            walk_render_ticks=600,
            push_render_ticks=20,
        ),
    )

    assert "render_ticks_per_frame" not in comparison
    assert comparison["walk_render_ticks"]["baseline"] == 513
    assert comparison["walk_render_ticks"]["candidate"] == 600
    assert comparison["push_render_ticks"]["baseline"] == 0
    assert comparison["push_render_ticks"]["candidate"] == 20


def test_compare_case_accepts_legacy_flat_baseline() -> None:
    baseline = benchmark_case()
    baseline["derived"].pop("diagnostic")
    baseline["derived"].pop("headline_render")

    comparison = run_gbc_benchmark_suite.compare_case(
        baseline,
        benchmark_case(walk_render_ticks=514),
    )

    assert comparison["walk_render_ticks"]["delta"] == 1


def test_count_only_render_detail_has_zero_phases_and_exact_events() -> None:
    run_gbc_benchmark_suite.validate_render_detail(
        benchmark_record(),
        phase_probes=False,
    )


def test_render_detail_rejects_inexact_counter_semantics() -> None:
    record = benchmark_record()
    record["render_detail"]["walk_render"]["counts"]["cache_hits"] = 2

    try:
        run_gbc_benchmark_suite.validate_render_detail(
            record,
            phase_probes=False,
        )
    except RuntimeError as error:
        assert "walk_render" in str(error)
        assert "cache_hits + cache_misses" in str(error)
    else:
        raise AssertionError("expected render counter validation failure")


def test_phase_render_detail_requires_timed_activity() -> None:
    record = benchmark_record()
    record["render_detail"]["walk_render"]["phase_ticks"] = {
        "compose": 10,
        "cache_lookup": 20,
        "encode": 30,
        "tile_upload": 40,
        "map_write": 50,
    }
    run_gbc_benchmark_suite.validate_render_detail(
        record,
        phase_probes=True,
    )


def main() -> None:
    test_script_compiles()
    test_repository_relative_tool_paths()
    test_derived_keeps_legacy_metrics_and_attributes_headline_render()
    test_compare_case_uses_real_interactions_not_alternating_diagnostic()
    test_compare_case_accepts_legacy_flat_baseline()
    test_count_only_render_detail_has_zero_phases_and_exact_events()
    test_render_detail_rejects_inexact_counter_semantics()
    test_phase_render_detail_requires_timed_activity()
    print("run_gbc_benchmark_suite_test: ok")


if __name__ == "__main__":
    main()
