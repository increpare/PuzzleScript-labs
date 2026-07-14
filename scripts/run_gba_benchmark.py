#!/usr/bin/env python3
"""Run an instrumented PuzzleScript GBA ROM in mGBA and read its SRAM timings."""

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


MAGIC = 0x46505350  # "PSPF"
VERSION = 1
RESULT = struct.Struct("<IHHQHHIIQIIQIII")
GBA_HZ = 16_777_216


def default_mgba() -> Path | None:
    executable = shutil.which("mgba-sdl") or shutil.which("mgba-sdl.exe")
    if executable:
        return Path(executable)
    candidate = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "mGBA" / "mgba-sdl.exe"
    return candidate if candidate.is_file() else None


def read_result(path: Path) -> dict[str, int | float | bool] | None:
    try:
        data = path.read_bytes()
    except (FileNotFoundError, PermissionError, OSError):
        return None
    if len(data) < RESULT.size:
        return None
    fields = RESULT.unpack_from(data)
    if fields[0] != MAGIC or fields[1] != VERSION:
        return None
    (
        _magic,
        _version,
        flags,
        source_hash,
        level,
        _reserved,
        iterations,
        waitcnt,
        step_total,
        step_min,
        step_max,
        render_total,
        render_min,
        render_max,
        cycles_per_frame,
    ) = fields
    step_average = step_total / iterations
    render_average = render_total / iterations
    return {
        "source_hash": source_hash,
        "level": level,
        "iterations": iterations,
        "prefetch": bool(flags & 1),
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
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("--mgba", type=Path, default=default_mgba())
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if not args.rom.is_file():
        parser.error(f"ROM not found: {args.rom}")
    if args.mgba is None or not args.mgba.is_file():
        parser.error("mgba-sdl was not found; pass --mgba PATH")

    with tempfile.TemporaryDirectory(prefix="ps-gba-benchmark-") as temporary:
        directory = Path(temporary)
        rom = directory / "benchmark.gba"
        save = rom.with_suffix(".sav")
        shutil.copyfile(args.rom, rom)
        environment = os.environ.copy()
        environment["SDL_VIDEODRIVER"] = "dummy"
        environment["SDL_AUDIODRIVER"] = "dummy"
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        process = subprocess.Popen(
            [
                str(args.mgba),
                "-C", "mute=1",
                "-C", "audioSync=0",
                "-C", "videoSync=0",
                str(rom),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=environment,
            creationflags=creationflags,
        )
        result = None
        deadline = time.monotonic() + args.timeout
        try:
            while time.monotonic() < deadline:
                result = read_result(save)
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
        if result is None:
            raise RuntimeError(f"benchmark did not finish within {args.timeout:g} seconds")

    encoded = json.dumps(result, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
