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
PERF_PHASE_RECORD = struct.Struct("<IHHHH7I5I")
PERF_PHASE_NAMES = (
    "snapshot",
    "setup",
    "early_rules",
    "movement",
    "late_rules",
    "commands",
    "win",
)
SRAM_BANK_SIZE = 8 * 1024
SRAM_BANK = 3
PERF_OFFSET = 16
PERF_PHASE_OFFSET = 32


def default_mgba() -> Path | None:
    executable = shutil.which("mgba-sdl") or shutil.which("mgba-sdl.exe")
    if executable:
        return Path(executable)
    candidate = (
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "mGBA"
        / "mgba-sdl.exe"
    )
    return candidate if candidate.is_file() else None


def run_once(emulator: Path, source_rom: Path, timeout: float) -> dict[str, int]:
    with tempfile.TemporaryDirectory(prefix="puzzlescript-gbc-bench-") as temp_name:
        temp = Path(temp_name)
        rom = temp / "bench.gb"
        save = temp / "bench.sav"
        shutil.copy2(source_rom, rom)
        environment = os.environ.copy()
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
        record = None
        while time.monotonic() < deadline and process.poll() is None:
            if save.is_file():
                data = save.read_bytes()
                offset = SRAM_BANK * SRAM_BANK_SIZE + PERF_OFFSET
                if len(data) >= offset + PERF_RECORD.size:
                    candidate = PERF_RECORD.unpack_from(data, offset)
                    if candidate[0] == PERF_MAGIC:
                        record = candidate
                        break
            time.sleep(0.01)
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        if record is None:
            raise RuntimeError(f"benchmark record missing for {source_rom}")
        magic, version, iterations, ticks, minimum, maximum, width, changed = record
        if version != 1 or iterations == 0:
            raise RuntimeError(
                f"invalid benchmark record version={version} iterations={iterations}"
            )
        data = save.read_bytes()
        phase_offset = SRAM_BANK * SRAM_BANK_SIZE + PERF_PHASE_OFFSET
        if len(data) < phase_offset + PERF_PHASE_RECORD.size:
            raise RuntimeError(f"phase benchmark record missing for {source_rom}")
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
                f"logic_iterations={phase_iterations} render_iterations={render_iterations} "
                f"phase_count={phase_count}"
            )
        phase_ticks = phase_values[: len(PERF_PHASE_NAMES)]
        render_values = phase_values[len(PERF_PHASE_NAMES) :]
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
        }


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
        f"full={render_ticks_per_frame:.3f} "
        f"composition={composition_ticks_per_frame:.3f} "
        f"tile_upload={tile_upload_ticks_per_frame:.3f} "
        f"map_upload={map_upload_ticks_per_frame:.3f} "
        f"palette_upload={palette_upload_ticks_per_frame:.3f}"
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
