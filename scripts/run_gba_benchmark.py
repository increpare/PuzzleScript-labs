#!/usr/bin/env python3
"""Run an instrumented PuzzleScript GBA ROM and read its cycle timings."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import time


MAGIC = 0x46505350  # "PSPF"
VERSION = 2
RESULT = struct.Struct("<IHHQHHIIQIIQIIII")
GBA_HZ = 16_777_216
LOG_RESULT = re.compile(
    r"PS_GBA_BENCH,([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{16}),"
    r"([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{16}),"
    r"([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{16}),([0-9a-f]{8}),"
    r"([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8})",
    re.IGNORECASE,
)
PHASE_RESULT = re.compile(
    r"PS_GBA_PHASE,([0-9a-f]{8}),([0-9a-f]{16}),([0-9a-f]{16}),"
    r"([0-9a-f]{16}),([0-9a-f]{16}),([0-9a-f]{16}),([0-9a-f]{16})",
    re.IGNORECASE,
)
AGAIN_RESULT = re.compile(
    r"PS_GBA_AGAIN,([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{16})",
    re.IGNORECASE,
)
REBUILD_RESULT = re.compile(
    r"PS_GBA_REBUILD,([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{16})",
    re.IGNORECASE,
)
GROUP_RESULT = re.compile(
    r"PS_GBA_GROUP,([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8}),"
    r"([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{16})",
    re.IGNORECASE,
)
ALLOCATION_RESULT = re.compile(
    r"PS_GBA_ALLOC,([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8}),"
    r"([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8}),"
    r"([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8}),([0-9a-f]{8}),"
    r"([0-9a-f]{8}),([0-9a-f]{8})",
    re.IGNORECASE,
)
PROGRESS_RESULT = re.compile(
    r"PS_GBA_PROGRESS,([0-9a-f]{8}),([0-9a-f]{8})",
    re.IGNORECASE,
)
PROGRESS_MAGIC = 0x47505350
PROGRESS_OFFSET = 0x80
PROGRESS_STRUCT = struct.Struct("<III")

PROGRESS_STAGES = {
    1: "setup",
    2: "early_rules",
    3: "movement",
    4: "late_rules",
    5: "win",
    6: "complete",
}

SETUP_PROGRESS_DETAILS = {
    0: "enter",
    1: "match_scratch_reserve",
    2: "movement_storage",
    3: "cache_ready_check",
    4: "object_cache_rebuild",
    5: "object_cache_rebuilt",
    6: "movement_cache_rebuild",
    7: "movement_cache_rebuilt",
    8: "scratch_ready",
    9: "turn_snapshot",
    10: "turn_snapshot_copied",
    11: "probe_snapshot_copied",
    12: "player_positions_collected",
    13: "movement_scratch_cleared",
    14: "rigid_scratch_cleared",
    15: "input_seeded",
}


def add_progress_fields(result: dict, stage: int, detail: int) -> None:
    result["progress_stage"] = stage
    result["progress_detail"] = detail
    result["progress_stage_name"] = PROGRESS_STAGES.get(stage, "unknown")
    if stage == 1:
        result["progress_probe"] = bool(detail & 0x80000000)
        setup_detail = detail & 0x7FFFFFFF
        result["progress_setup_detail"] = setup_detail
        result["progress_setup_detail_name"] = SETUP_PROGRESS_DETAILS.get(setup_detail, "unknown")
    elif stage in (2, 4):
        result["progress_group"] = detail >> 16
        result["progress_rule"] = detail & 0xFFFF


def describe_progress(stage: int, detail: int) -> str:
    stage_name = PROGRESS_STAGES.get(stage, "unknown")
    if stage == 1:
        probe = bool(detail & 0x80000000)
        setup_detail = detail & 0x7FFFFFFF
        detail_name = SETUP_PROGRESS_DETAILS.get(setup_detail, "unknown")
        return f"stage={stage_name}({stage}) detail={detail_name}({setup_detail}) probe={str(probe).lower()}"
    if stage in (2, 4):
        return f"stage={stage_name}({stage}) group={detail >> 16} rule={detail & 0xFFFF}"
    return f"stage={stage_name}({stage}) detail={detail}"


def default_mgba() -> Path | None:
    executable = shutil.which("mgba-sdl") or shutil.which("mgba-sdl.exe")
    if executable:
        return Path(executable)
    candidate = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "mGBA" / "mgba-sdl.exe"
    return candidate if candidate.is_file() else None


def make_result(
    version: int,
    flags: int,
    source_hash: int,
    level: int,
    iterations: int,
    waitcnt: int,
    step_total: int,
    step_min: int,
    step_max: int,
    render_total: int,
    render_min: int,
    render_max: int,
    cycles_per_frame: int,
    framebuffer_hash: int,
) -> dict[str, int | float | bool | str] | None:
    if version != VERSION or iterations == 0 or cycles_per_frame == 0:
        return None
    step_average = step_total / iterations
    render_average = render_total / iterations
    return {
        "source_hash": source_hash,
        "level": level,
        "iterations": iterations,
        "prefetch": bool(flags & 1),
        "reload_level_each_iteration": bool(flags & 2),
        "waitcnt": waitcnt,
        "step_cycles_average": step_average,
        "step_cycles_min": step_min,
        "step_cycles_max": step_max,
        "step_ms_average": step_average * 1000 / GBA_HZ,
        "step_frames_average": step_average / cycles_per_frame,
        "render_cycles_average": render_average,
        "render_cycles_min": render_min,
        "render_cycles_max": render_max,
        "render_ms_average": render_average * 1000 / GBA_HZ,
        "render_frames_average": render_average / cycles_per_frame,
        "framebuffer_hash": f"{framebuffer_hash:08x}",
    }


def read_sram_result(path: Path) -> dict[str, int | float | bool | str] | None:
    try:
        data = path.read_bytes()
    except (FileNotFoundError, PermissionError, OSError):
        return None
    if len(data) < RESULT.size:
        return None
    fields = RESULT.unpack_from(data)
    if fields[0] != MAGIC:
        return None
    return make_result(
        fields[1],
        fields[2],
        fields[3],
        fields[4],
        fields[6],
        fields[7],
        fields[8],
        fields[9],
        fields[10],
        fields[11],
        fields[12],
        fields[13],
        fields[14],
        fields[15],
    )


def read_log_result(path: Path) -> dict[str, int | float | bool | str] | None:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except (FileNotFoundError, PermissionError, OSError):
        return None
    benchmark_match = LOG_RESULT.search(text)
    if benchmark_match is None:
        return None
    values = [int(value, 16) for value in benchmark_match.groups()]
    result = make_result(*values)
    if result is None:
        return None
    phase_match = PHASE_RESULT.search(text)
    if phase_match is not None:
        phase_values = [int(value, 16) for value in phase_match.groups()]
        if phase_values[0] == 1:
            for name, cycles in zip(
                ("setup", "early_rules", "movement", "late_rules", "win", "canonicalize"),
                phase_values[1:],
            ):
                result[f"phase_{name}_cycles"] = cycles
                result[f"phase_{name}_ms"] = cycles * 1000 / GBA_HZ
    again_match = AGAIN_RESULT.search(text)
    if again_match is not None:
        again_values = [int(value, 16) for value in again_match.groups()]
        if again_values[0] == 1:
            result["again_probe_calls"] = again_values[1]
            result["again_probe_cycles"] = again_values[2]
            result["again_probe_ms"] = again_values[2] * 1000 / GBA_HZ
    rebuild_match = REBUILD_RESULT.search(text)
    if rebuild_match is not None:
        rebuild_values = [int(value, 16) for value in rebuild_match.groups()]
        if rebuild_values[0] == 1:
            result["rebuild_calls"] = rebuild_values[1]
            result["rebuild_cycles"] = rebuild_values[2]
            result["rebuild_ms"] = rebuild_values[2] * 1000 / GBA_HZ
    group_rows = []
    for group_match in GROUP_RESULT.finditer(text):
        values = [int(value, 16) for value in group_match.groups()]
        if values[0] != 1:
            continue
        _, probe, phase, group, source_line, calls, cycles = values
        kind = "rule" if phase in (3, 5) else "group"
        row = {
            "probe": bool(probe),
            "phase": "late" if phase in (4, 5) else "early",
            "kind": kind,
            "group": group >> 8 if kind == "rule" else group,
            "source_line": source_line,
            "calls": calls,
            "cycles": cycles,
            "ms": cycles * 1000 / GBA_HZ,
        }
        if kind == "rule":
            row["rule"] = group & 0xFF
        group_rows.append(row)
    if group_rows:
        result["rule_groups"] = sorted(group_rows, key=lambda row: row["cycles"], reverse=True)
    allocation_match = ALLOCATION_RESULT.search(text)
    if allocation_match is not None:
        allocation_values = [int(value, 16) for value in allocation_match.groups()]
        if allocation_values[0] == 1:
            names = (
                "allocation_calls",
                "allocation_bytes",
                "deallocation_calls",
                "heap_growth_bytes",
                "rules_visited",
                "candidate_cells_tested",
                "replacements_attempted",
                "replacements_applied",
                "row_scans",
                "ellipsis_scans",
                "progress_stage",
                "progress_detail",
            )
            result.update(zip(names, allocation_values[1:]))
            stage = allocation_values[-2]
            detail = allocation_values[-1]
            add_progress_fields(result, stage, detail)
    return result


def read_last_progress(path: Path) -> tuple[int, int] | None:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except (FileNotFoundError, PermissionError, OSError):
        return None
    matches = list(PROGRESS_RESULT.finditer(text))
    if not matches:
        return None
    return tuple(int(value, 16) for value in matches[-1].groups())


def read_sram_progress(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()
    except (FileNotFoundError, PermissionError, OSError):
        return None
    if len(data) < PROGRESS_OFFSET + PROGRESS_STRUCT.size:
        return None
    magic, stage, detail = PROGRESS_STRUCT.unpack_from(data, PROGRESS_OFFSET)
    if magic != PROGRESS_MAGIC:
        return None
    return stage, detail


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("--mgba", type=Path, default=default_mgba())
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--log", type=Path, help="copy the raw mGBA log here, including on timeout")
    args = parser.parse_args()
    if not args.rom.is_file():
        parser.error(f"ROM not found: {args.rom}")
    if args.mgba is None or not args.mgba.is_file():
        parser.error("mgba-sdl was not found; pass --mgba PATH")

    with tempfile.TemporaryDirectory(prefix="ps-gba-benchmark-") as temporary:
        directory = Path(temporary)
        rom = directory / "benchmark.gba"
        save = rom.with_suffix(".sav")
        log = directory / "benchmark.log"
        shutil.copyfile(args.rom, rom)
        environment = os.environ.copy()
        environment["SDL_VIDEODRIVER"] = "dummy"
        environment["SDL_AUDIODRIVER"] = "dummy"
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with log.open("wb") as output:
            process = subprocess.Popen(
                [
                    str(args.mgba),
                    "-l", "127",
                    "-C", "mute=1",
                    "-C", "audioSync=0",
                    "-C", "videoSync=0",
                    str(rom),
                ],
                stdout=output,
                stderr=subprocess.STDOUT,
                env=environment,
                creationflags=creationflags,
            )
            result = None
            deadline = time.monotonic() + args.timeout
            try:
                while time.monotonic() < deadline:
                    output.flush()
                    result = read_log_result(log) or read_sram_result(save)
                    if result is not None:
                        break
                    if process.poll() is not None:
                        raise RuntimeError(f"mGBA exited before producing a result (exit {process.returncode})")
                    time.sleep(0.05)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
        if args.log:
            args.log.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(log, args.log)
        if result is None:
            progress = read_last_progress(log) or read_sram_progress(save)
            if progress is None:
                raise RuntimeError(f"benchmark did not finish within {args.timeout:g} seconds")
            stage, detail = progress
            raise RuntimeError(
                f"benchmark did not finish within {args.timeout:g} seconds; "
                f"last progress {describe_progress(stage, detail)}"
            )

    encoded = json.dumps(result, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
