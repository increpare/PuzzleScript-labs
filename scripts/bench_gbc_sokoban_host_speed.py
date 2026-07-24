#!/usr/bin/env python3
"""Host speed gate: Sokoban specialized turn vs GBC interpreter.

Compiles dual host benches (interpreter baseline vs specialized) from the
checked-in gbc_sokoban export, replays the full 33-move solution fixture,
and exits 0 only when both paths win and specialized mean ms/turn is strictly
less than interpreter.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench_gbc_eligible_solutions import (  # noqa: E402
    compile_host_benches,
    pct_speedup,
    run_host_bench,
)

GENERATED_DIR = Path("build/native/generated/gbc_sokoban")
SPECIALIZED_TURN_C = GENERATED_DIR / "generated_specialized_turn.c"
FIXTURE = Path("native/tests/fixtures/gbc_sokoban_basic_solution.txt")
SLUG = "sokoban_basic"
BOARD_INDEX = 0
ITERATIONS = 20


def ensure_generated_export(repository: Path, cmake: Path, build_dir: Path) -> Path:
    generated_dir = (repository / GENERATED_DIR).resolve()
    specialized = generated_dir / "generated_specialized_turn.c"
    if specialized.is_file():
        return generated_dir

    if not cmake.is_file():
        cmake = Path("cmake")

    subprocess.run(
        [str(cmake), "-S", str(repository), "-B", str(build_dir)],
        check=True,
    )
    subprocess.run(
        [
            str(cmake),
            "--build",
            str(build_dir),
            "--target",
            "puzzlescript_gbc_solution_replay_bench",
        ],
        check=True,
    )
    if not specialized.is_file():
        raise SystemExit(
            f"missing {specialized.relative_to(repository)} after "
            "puzzlescript_gbc_solution_replay_bench build"
        )
    return generated_dir


def main() -> int:
    repository = Path(__file__).resolve().parents[1]
    build_dir = repository / "build"
    fixture = (repository / FIXTURE).resolve()
    if not fixture.is_file():
        raise SystemExit(f"solution fixture was not found: {fixture}")

    cmake = Path("cmake")
    generated_dir = ensure_generated_export(repository, cmake, build_dir)

    with tempfile.TemporaryDirectory(prefix="gbc_sokoban_host_speed_") as tmp:
        baseline_bin, specialized_bin = compile_host_benches(
            repository, generated_dir, Path(tmp)
        )
        before = run_host_bench(
            baseline_bin,
            fixture,
            SLUG,
            BOARD_INDEX,
            iterations=ITERATIONS,
        )
        after = run_host_bench(
            specialized_bin,
            fixture,
            SLUG,
            BOARD_INDEX,
            iterations=ITERATIONS,
        )

    before_ms = float(before.get("mean_ms_per_turn", 0.0))
    after_ms = float(after.get("mean_ms_per_turn", 0.0))
    report = {
        "before_ms": before_ms,
        "after_ms": after_ms,
        "speedup_pct": pct_speedup(before_ms, after_ms),
        "baseline_won": bool(before.get("won")),
        "specialized_won": bool(after.get("won")),
        "iterations": ITERATIONS,
        "replay_turns": int(before.get("replay_turns") or 0),
    }
    print(json.dumps(report, indent=2, sort_keys=True))

    if not report["baseline_won"] or not report["specialized_won"]:
        return 1
    return 0 if after_ms < before_ms else 1


if __name__ == "__main__":
    raise SystemExit(main())
