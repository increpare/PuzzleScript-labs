#!/usr/bin/env python3
"""Run an instrumented CGB performance ROM and read hardware timing from SRAM."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import time


PERF_MAGIC = 0x46434250
PERF_RECORD = struct.Struct("<IHHIBBBB")
SRAM_BANK_SIZE = 8 * 1024
SRAM_BANK = 3
PERF_OFFSET = 16


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
        return {
            "iterations": iterations,
            "ticks": ticks,
            "minimum": minimum,
            "maximum": maximum,
            "width": width,
            "changed": changed,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rom", type=Path)
    parser.add_argument("--mgba", type=Path)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=8.0)
    args = parser.parse_args()
    emulator = args.mgba or default_mgba()
    if emulator is None or not emulator.is_file():
        raise SystemExit("mGBA SDL executable was not found")
    if not args.rom.is_file():
        raise SystemExit(f"ROM was not found: {args.rom}")
    records = [run_once(emulator, args.rom, args.timeout) for _ in range(args.runs)]
    ticks = [record["ticks"] for record in records]
    if len(set(ticks)) != 1:
        raise SystemExit(f"emulated timer counts were not deterministic: {ticks}")
    record = records[0]
    ticks_per_turn = record["ticks"] / record["iterations"]
    print(
        "gbc-benchmark "
        f"runs={args.runs} width={record['width']} iterations={record['iterations']} "
        f"timer_ticks={record['ticks']} ticks_per_turn={ticks_per_turn:.3f} "
        f"min={record['minimum']} max={record['maximum']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
