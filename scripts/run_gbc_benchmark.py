#!/usr/bin/env python3
"""Run an instrumented CGB performance ROM and read hardware timing from SRAM."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import time


PERF_MAGIC = 0x46434250
PERF_RECORD = struct.Struct("<IHHIBBBB")
PERF_PHASE_MAGIC = 0x32434250
PERF_PHASE_RECORD = struct.Struct("<IHHHH7I6I")
PERF_INTERACTION_MAGIC = 0x49434250
PERF_INTERACTION_RECORD = struct.Struct("<I5I")
PERF_SCHEDULE_MAGIC = 0x53434250
PERF_SCHEDULE_RECORD = struct.Struct("<IHH7H")
PERF_RENDER_DETAIL_MAGIC = 0x44434250
PERF_RENDER_DETAIL_RECORD = struct.Struct("<IHHH2x5I5H5I5H5I5H")
PERF_PHASE_NAMES = (
    "snapshot",
    "setup",
    "early_rules",
    "movement",
    "late_rules",
    "commands",
    "win",
)
PERF_SCHEDULE_NAMES = (
    "group_invocations",
    "group_passes",
    "repeat_passes",
    "rule_visits",
    "repeat_rule_visits",
    "changing_passes",
    "repeat_changing_passes",
)
PERF_RENDER_PHASE_NAMES = (
    "compose",
    "cache_lookup",
    "encode",
    "tile_upload",
    "map_write",
)
PERF_RENDER_COUNTER_NAMES = (
    "dirty_cells",
    "cache_hits",
    "cache_misses",
    "dedicated_fallbacks",
    "uploaded_quartets",
)
PERF_RENDER_SAMPLE_NAMES = (
    "initial_render",
    "walk_render",
    "push_render",
)
SRAM_BANK_SIZE = 8 * 1024
SRAM_BANK = 3
PERF_OFFSET = 16
PERF_PHASE_OFFSET = 32
PERF_INTERACTION_OFFSET = 96
PERF_SCHEDULE_OFFSET = 160
PERF_RENDER_DETAIL_OFFSET = 192


def default_mgba() -> Path | None:
    executable = shutil.which("mgba-sdl") or shutil.which("mgba-sdl.exe")
    if executable:
        return Path(executable)
    mac_app = Path("/Applications/mGBA.app/Contents/MacOS/mGBA")
    if mac_app.is_file():
        return mac_app
    candidate = (
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "mGBA"
        / "mgba-sdl.exe"
    )
    return candidate if candidate.is_file() else None


def parse_benchmark_sram(data: bytes) -> dict[str, object]:
    bank_offset = SRAM_BANK * SRAM_BANK_SIZE
    perf_offset = bank_offset + PERF_OFFSET
    if len(data) < perf_offset + PERF_RECORD.size:
        raise RuntimeError("benchmark record missing")
    record = PERF_RECORD.unpack_from(data, perf_offset)
    magic, version, iterations, ticks, minimum, maximum, width, changed = record
    if magic != PERF_MAGIC or version != 1 or iterations == 0:
        raise RuntimeError(
            "invalid benchmark record "
            f"magic=0x{magic:08x} version={version} iterations={iterations}"
        )

    phase_offset = bank_offset + PERF_PHASE_OFFSET
    if len(data) < phase_offset + PERF_PHASE_RECORD.size:
        raise RuntimeError("phase benchmark record missing")
    phase_record = PERF_PHASE_RECORD.unpack_from(data, phase_offset)
    (
        phase_magic,
        phase_version,
        phase_iterations,
        render_iterations,
        phase_count,
        *phase_values,
    ) = phase_record
    if (
        phase_magic != PERF_PHASE_MAGIC
        or phase_version != 1
        or phase_iterations != iterations
        or phase_count != len(PERF_PHASE_NAMES)
        or render_iterations == 0
    ):
        raise RuntimeError(
            "invalid phase benchmark record "
            f"magic=0x{phase_magic:08x} version={phase_version} "
            f"logic_iterations={phase_iterations} "
            f"render_iterations={render_iterations} "
            f"phase_count={phase_count}"
        )
    phase_ticks = phase_values[: len(PERF_PHASE_NAMES)]
    render_values = phase_values[len(PERF_PHASE_NAMES) :]

    interaction_offset = bank_offset + PERF_INTERACTION_OFFSET
    if len(data) < interaction_offset + PERF_INTERACTION_RECORD.size:
        raise RuntimeError("interaction benchmark record missing")
    interaction_record = PERF_INTERACTION_RECORD.unpack_from(
        data, interaction_offset
    )
    if interaction_record[0] != PERF_INTERACTION_MAGIC:
        raise RuntimeError(
            "invalid interaction benchmark record "
            f"magic=0x{interaction_record[0]:08x}"
        )

    schedule_values = [0] * len(PERF_SCHEDULE_NAMES)
    schedule_offset = bank_offset + PERF_SCHEDULE_OFFSET
    if len(data) >= schedule_offset + PERF_SCHEDULE_RECORD.size:
        schedule_record = PERF_SCHEDULE_RECORD.unpack_from(data, schedule_offset)
        schedule_magic, schedule_version, schedule_count, *values = schedule_record
        if schedule_magic == PERF_SCHEDULE_MAGIC:
            if (
                schedule_version != 1
                or schedule_count != len(PERF_SCHEDULE_NAMES)
            ):
                raise RuntimeError(
                    "invalid schedule benchmark record "
                    f"magic=0x{schedule_magic:08x} version={schedule_version} "
                    f"counter_count={schedule_count}"
                )
            schedule_values = values

    detail_offset = bank_offset + PERF_RENDER_DETAIL_OFFSET
    if len(data) < detail_offset + PERF_RENDER_DETAIL_RECORD.size:
        raise RuntimeError("render detail benchmark record missing")
    detail_record = PERF_RENDER_DETAIL_RECORD.unpack_from(data, detail_offset)
    detail_magic, detail_version, render_phase_count, render_counter_count = (
        detail_record[:4]
    )
    if (
        detail_magic != PERF_RENDER_DETAIL_MAGIC
        or detail_version != 1
        or render_phase_count != len(PERF_RENDER_PHASE_NAMES)
        or render_counter_count != len(PERF_RENDER_COUNTER_NAMES)
    ):
        raise RuntimeError(
            "invalid render detail benchmark record "
            f"magic=0x{detail_magic:08x} version={detail_version} "
            f"phase_count={render_phase_count} "
            f"counter_count={render_counter_count}"
        )
    detail_values = detail_record[4:]
    sample_stride = render_phase_count + render_counter_count
    render_detail = {}
    for sample_index, sample_name in enumerate(PERF_RENDER_SAMPLE_NAMES):
        sample_start = sample_index * sample_stride
        sample_phases = detail_values[
            sample_start : sample_start + render_phase_count
        ]
        counter_start = sample_start + render_phase_count
        sample_counts = detail_values[
            counter_start : counter_start + render_counter_count
        ]
        render_detail[sample_name] = {
            "phase_ticks": dict(zip(PERF_RENDER_PHASE_NAMES, sample_phases)),
            "counts": dict(zip(PERF_RENDER_COUNTER_NAMES, sample_counts)),
        }

    return {
        "iterations": iterations,
        "ticks": ticks,
        "minimum": minimum,
        "maximum": maximum,
        "width": width,
        "changed": changed,
        "render_iterations": render_iterations,
        "phase_ticks": dict(zip(PERF_PHASE_NAMES, phase_ticks)),
        "render_ticks": render_values[0],
        "composition_ticks": render_values[1],
        "tile_upload_ticks": render_values[2],
        "map_upload_ticks": render_values[3],
        "palette_upload_ticks": render_values[4],
        "repeated_text_ticks": render_values[5],
        "interaction_ticks": dict(
            zip(
                (
                    "initial_render",
                    "walk_logic",
                    "walk_render",
                    "push_logic",
                    "push_render",
                ),
                interaction_record[1:],
            )
        ),
        "schedule_counts": dict(zip(PERF_SCHEDULE_NAMES, schedule_values)),
        "render_detail": render_detail,
    }


def run_once(
    emulator: Path,
    source_rom: Path,
    timeout: float,
) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="puzzlescript-gbc-bench-") as temp_name:
        temp = Path(temp_name)
        rom = temp / "bench.gb"
        save = temp / "bench.sav"
        shutil.copy2(source_rom, rom)
        environment = os.environ.copy()
        # SDL dummy drivers are for mgba-sdl. The macOS .app is Qt/Cocoa and
        # fails to write SRAM under dummy video in some environments.
        if emulator.name.lower() in {"mgba-sdl", "mgba-sdl.exe"}:
            environment["SDL_VIDEODRIVER"] = "dummy"
            environment["SDL_AUDIODRIVER"] = "dummy"
        process = subprocess.Popen(
            [
                str(emulator),
                "-C",
                "videoSync=0",
                "-C",
                "audioSync=0",
                rom.name,
            ],
            cwd=temp,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + timeout
        record_found = False
        while time.monotonic() < deadline and process.poll() is None:
            if save.is_file():
                data = save.read_bytes()
                offset = SRAM_BANK * SRAM_BANK_SIZE + PERF_OFFSET
                if len(data) >= offset + PERF_RECORD.size:
                    candidate = PERF_RECORD.unpack_from(data, offset)
                    if candidate[0] == PERF_MAGIC:
                        record_found = True
                        break
            time.sleep(0.01)
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        if not record_found:
            raise RuntimeError(f"benchmark record missing for {source_rom}")
        try:
            return parse_benchmark_sram(save.read_bytes())
        except RuntimeError as error:
            raise RuntimeError(f"{error} for {source_rom}") from error


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rom", type=Path)
    parser.add_argument("--mgba", type=Path)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--json-out", type=Path)
    args = parser.parse_args()
    emulator = args.mgba or default_mgba()
    if emulator is None or not emulator.is_file():
        raise SystemExit("mGBA SDL executable was not found")
    if not args.rom.is_file():
        raise SystemExit(f"ROM was not found: {args.rom}")
    records = [run_once(emulator, args.rom, args.timeout) for _ in range(args.runs)]
    if any(record != records[0] for record in records[1:]):
        raise SystemExit(
            "emulated benchmark records were not deterministic: "
            + json.dumps(records, sort_keys=True)
        )
    record = records[0]
    ticks_per_turn = record["ticks"] / record["iterations"]
    render_ticks_per_frame = record["render_ticks"] / record["render_iterations"]
    composition_ticks_per_frame = (
        record["composition_ticks"] / record["render_iterations"]
    )
    tile_upload_ticks_per_frame = (
        record["tile_upload_ticks"] / record["render_iterations"]
    )
    map_upload_ticks_per_frame = (
        record["map_upload_ticks"] / record["render_iterations"]
    )
    palette_upload_ticks_per_frame = (
        record["palette_upload_ticks"] / record["render_iterations"]
    )
    print(
        "gbc-benchmark "
        f"runs={args.runs} width={record['width']} iterations={record['iterations']} "
        f"timer_ticks={record['ticks']} ticks_per_turn={ticks_per_turn:.3f} "
        f"min={record['minimum']} max={record['maximum']}"
    )
    print(
        "gbc-phases "
        + " ".join(
            f"{name}={ticks / record['iterations']:.3f}"
            for name, ticks in record["phase_ticks"].items()
        )
    )
    print(
        "gbc-render "
        f"iterations={record['render_iterations']} "
        f"walk_render={record['interaction_ticks']['walk_render']} "
        f"push_render={record['interaction_ticks']['push_render']} "
        f"alternating_render_diagnostic={render_ticks_per_frame:.3f} "
        f"composition={composition_ticks_per_frame:.3f} "
        f"tile_upload={tile_upload_ticks_per_frame:.3f} "
        f"map_upload={map_upload_ticks_per_frame:.3f} "
        f"palette_upload={palette_upload_ticks_per_frame:.3f} "
        f"repeated_text={record['repeated_text_ticks']}"
    )
    print(
        "gbc-interaction "
        + " ".join(
            f"{name}={ticks}({ticks / 4096.0:.6f}s)"
            for name, ticks in record["interaction_ticks"].items()
        )
    )
    if args.json_out is not None:
        output = {
            "format": "puzzlescript-gbc-benchmark-v2",
            "rom": str(args.rom),
            "runs": args.runs,
            "record": record,
            "derived": {
                "ticks_per_turn": ticks_per_turn,
                "phase_ticks_per_turn": {
                    name: ticks / record["iterations"]
                    for name, ticks in record["phase_ticks"].items()
                },
                "render_ticks_per_frame": render_ticks_per_frame,
                "composition_ticks_per_frame": composition_ticks_per_frame,
                "tile_upload_ticks_per_frame": tile_upload_ticks_per_frame,
                "map_upload_ticks_per_frame": map_upload_ticks_per_frame,
                "palette_upload_ticks_per_frame": palette_upload_ticks_per_frame,
                **{
                    f"{name}_ticks": ticks
                    for name, ticks in record["interaction_ticks"].items()
                },
                "diagnostic": {
                    "alternating_render_ticks_per_frame": (
                        render_ticks_per_frame
                    ),
                },
                "headline_render": {
                    "walk_render_ticks": (
                        record["interaction_ticks"]["walk_render"]
                    ),
                    "push_render_ticks": (
                        record["interaction_ticks"]["push_render"]
                    ),
                },
            },
        }
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(
            json.dumps(output, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
