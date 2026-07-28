#!/usr/bin/env python3
"""Focused tests for the GBC benchmark SRAM contract."""

from __future__ import annotations

import struct

import run_gbc_benchmark


def benchmark_sram(
    *,
    detail_magic: int = run_gbc_benchmark.PERF_RENDER_DETAIL_MAGIC,
    detail_version: int = 1,
    phase_count: int = len(run_gbc_benchmark.PERF_RENDER_PHASE_NAMES),
    counter_count: int = len(run_gbc_benchmark.PERF_RENDER_COUNTER_NAMES),
) -> bytes:
    base = run_gbc_benchmark.SRAM_BANK * run_gbc_benchmark.SRAM_BANK_SIZE
    data = bytearray(
        base
        + run_gbc_benchmark.PERF_RENDER_DETAIL_OFFSET
        + run_gbc_benchmark.PERF_RENDER_DETAIL_RECORD.size
    )
    run_gbc_benchmark.PERF_RECORD.pack_into(
        data,
        base + run_gbc_benchmark.PERF_OFFSET,
        run_gbc_benchmark.PERF_MAGIC,
        1,
        128,
        4096,
        0,
        0,
        1,
        1,
    )
    run_gbc_benchmark.PERF_PHASE_RECORD.pack_into(
        data,
        base + run_gbc_benchmark.PERF_PHASE_OFFSET,
        run_gbc_benchmark.PERF_PHASE_MAGIC,
        1,
        128,
        4,
        len(run_gbc_benchmark.PERF_PHASE_NAMES),
        *range(10, 17),
        17,
        18,
        19,
        20,
        21,
        22,
    )
    run_gbc_benchmark.PERF_INTERACTION_RECORD.pack_into(
        data,
        base + run_gbc_benchmark.PERF_INTERACTION_OFFSET,
        run_gbc_benchmark.PERF_INTERACTION_MAGIC,
        100,
        200,
        300,
        400,
        500,
    )
    samples: list[int] = []
    for sample in range(len(run_gbc_benchmark.PERF_RENDER_SAMPLE_NAMES)):
        samples.extend(sample * 10 + phase for phase in range(1, 6))
        samples.extend(sample * 100 + count for count in range(11, 16))
    run_gbc_benchmark.PERF_RENDER_DETAIL_RECORD.pack_into(
        data,
        base + run_gbc_benchmark.PERF_RENDER_DETAIL_OFFSET,
        detail_magic,
        detail_version,
        phase_count,
        counter_count,
        *samples,
    )
    return bytes(data)


def expect_runtime_error(data: bytes, text: str) -> None:
    try:
        run_gbc_benchmark.parse_benchmark_sram(data)
    except RuntimeError as error:
        assert text in str(error), str(error)
    else:
        raise AssertionError(f"expected RuntimeError containing {text!r}")


def test_valid_version_one_render_detail() -> None:
    record = run_gbc_benchmark.parse_benchmark_sram(benchmark_sram())

    assert record["iterations"] == 128
    assert record["interaction_ticks"]["walk_render"] == 300
    assert record["render_detail"] == {
        "initial_render": {
            "phase_ticks": {
                "compose": 1,
                "cache_lookup": 2,
                "encode": 3,
                "tile_upload": 4,
                "map_write": 5,
            },
            "counts": {
                "dirty_cells": 11,
                "cache_hits": 12,
                "cache_misses": 13,
                "dedicated_fallbacks": 14,
                "uploaded_quartets": 15,
            },
        },
        "walk_render": {
            "phase_ticks": {
                "compose": 11,
                "cache_lookup": 12,
                "encode": 13,
                "tile_upload": 14,
                "map_write": 15,
            },
            "counts": {
                "dirty_cells": 111,
                "cache_hits": 112,
                "cache_misses": 113,
                "dedicated_fallbacks": 114,
                "uploaded_quartets": 115,
            },
        },
        "push_render": {
            "phase_ticks": {
                "compose": 21,
                "cache_lookup": 22,
                "encode": 23,
                "tile_upload": 24,
                "map_write": 25,
            },
            "counts": {
                "dirty_cells": 211,
                "cache_hits": 212,
                "cache_misses": 213,
                "dedicated_fallbacks": 214,
                "uploaded_quartets": 215,
            },
        },
    }


def test_render_detail_rejects_invalid_magic() -> None:
    expect_runtime_error(
        benchmark_sram(detail_magic=0),
        "render detail benchmark record",
    )


def test_render_detail_rejects_wrong_phase_count() -> None:
    expect_runtime_error(
        benchmark_sram(phase_count=4),
        "phase_count=4",
    )


def test_render_detail_rejects_wrong_counter_count() -> None:
    expect_runtime_error(
        benchmark_sram(counter_count=4),
        "counter_count=4",
    )


def test_render_detail_rejects_truncated_sram() -> None:
    data = benchmark_sram()
    expect_runtime_error(
        data[: -run_gbc_benchmark.PERF_RENDER_DETAIL_RECORD.size // 2],
        "render detail benchmark record missing",
    )


def test_count_only_detail_allows_counts_with_zero_phase_ticks() -> None:
    data = bytearray(benchmark_sram())
    offset = (
        run_gbc_benchmark.SRAM_BANK * run_gbc_benchmark.SRAM_BANK_SIZE
        + run_gbc_benchmark.PERF_RENDER_DETAIL_OFFSET
    )
    values = list(
        run_gbc_benchmark.PERF_RENDER_DETAIL_RECORD.unpack_from(data, offset)
    )
    sample_stride = len(run_gbc_benchmark.PERF_RENDER_PHASE_NAMES) + len(
        run_gbc_benchmark.PERF_RENDER_COUNTER_NAMES
    )
    for sample in range(len(run_gbc_benchmark.PERF_RENDER_SAMPLE_NAMES)):
        phase_start = 4 + sample * sample_stride
        values[phase_start : phase_start + 5] = [0] * 5
    run_gbc_benchmark.PERF_RENDER_DETAIL_RECORD.pack_into(data, offset, *values)

    detail = run_gbc_benchmark.parse_benchmark_sram(bytes(data))["render_detail"]
    assert all(
        ticks == 0
        for sample in detail.values()
        for ticks in sample["phase_ticks"].values()
    )
    assert sum(
        count
        for sample in detail.values()
        for count in sample["counts"].values()
    ) > 0


def test_record_layout_matches_firmware_offsets() -> None:
    expected = struct.Struct("<IHHH2x5I5H5I5H5I5H")
    assert run_gbc_benchmark.PERF_RENDER_DETAIL_RECORD.format == expected.format
    assert run_gbc_benchmark.PERF_RENDER_DETAIL_RECORD.size == expected.size
    assert run_gbc_benchmark.PERF_RENDER_DETAIL_OFFSET == 192


def test_count_only_assembly_accepts_counter_hook_without_phase_hooks() -> None:
    assembly = """
        .globl _ps_gbc_perf_render_count
        call _ps_gbc_perf_render_count
    """
    run_gbc_benchmark.validate_render_phase_hook_assembly(
        assembly,
        phase_probes=False,
    )


def test_count_only_assembly_rejects_phase_hook_reference() -> None:
    assembly = """
        .globl _ps_gbc_perf_render_begin
        call _ps_gbc_perf_render_begin
    """
    try:
        run_gbc_benchmark.validate_render_phase_hook_assembly(
            assembly,
            phase_probes=False,
        )
    except RuntimeError as error:
        assert "count-only" in str(error)
        assert "render_begin" in str(error)
    else:
        raise AssertionError("expected count-only phase-hook validation failure")


def test_phase_assembly_requires_both_phase_hooks() -> None:
    assembly = """
        call _ps_gbc_perf_render_begin
        call _ps_gbc_perf_render_end
    """
    run_gbc_benchmark.validate_render_phase_hook_assembly(
        assembly,
        phase_probes=True,
    )

    try:
        run_gbc_benchmark.validate_render_phase_hook_assembly(
            "call _ps_gbc_perf_render_begin",
            phase_probes=True,
        )
    except RuntimeError as error:
        assert "phase-probe" in str(error)
        assert "render_end" in str(error)
    else:
        raise AssertionError("expected missing phase-hook validation failure")


def main() -> None:
    test_valid_version_one_render_detail()
    test_render_detail_rejects_invalid_magic()
    test_render_detail_rejects_wrong_phase_count()
    test_render_detail_rejects_wrong_counter_count()
    test_render_detail_rejects_truncated_sram()
    test_count_only_detail_allows_counts_with_zero_phase_ticks()
    test_record_layout_matches_firmware_offsets()
    test_count_only_assembly_accepts_counter_hook_without_phase_hooks()
    test_count_only_assembly_rejects_phase_hook_reference()
    test_phase_assembly_requires_both_phase_hooks()
    print("run_gbc_benchmark_test: ok")


if __name__ == "__main__":
    main()
