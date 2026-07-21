#!/usr/bin/env python3
"""Find first input index where Lean replay diverges from JS trace snapshot."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from lean_parity_run import parity_lock, run_parity_smoke  # noqa: E402


def settled_snapshot(snapshots: list[dict], input_index: int) -> dict:
    """Last snapshot for this input (after again substeps settle)."""
    cands = [s for s in snapshots if s.get("input_index") == input_index]
    if cands:
        return cands[-1]
    return snapshots[input_index + 1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--fixtures", type=Path, default=None)
    parser.add_argument("--timeout", type=float, default=120.0, help="Per-step parity_smoke timeout")
    parser.add_argument(
        "--wait-lock",
        action="store_true",
        help="Wait for /tmp/puzzlescript-lean-parity.lock instead of exiting if held",
    )
    args = parser.parse_args()

    repo = args.repo_root
    lean_dir = repo / "lean"
    fixtures = args.fixtures or (repo / "build" / "js-parity-data")
    if not fixtures.is_absolute():
        fixtures = (repo / fixtures).resolve()
    manifest = json.loads((fixtures / "fixtures.json").read_text(encoding="utf-8"))
    fx = next(f for f in manifest["simulation_fixtures"] if f["name"] == args.fixture)
    trace = json.loads((fixtures / fx["trace_file"]).read_text(encoding="utf-8"))
    snapshots = trace["trace"]["snapshots"]
    inputs = fx["inputs"]

    wl = lean_dir / ".parity_bisect_one.txt"
    wl.write_text(args.fixture + "\n", encoding="utf-8")

    with parity_lock(wait=args.wait_lock):
        for i in range(len(inputs)):
            expected = settled_snapshot(snapshots, i)["serialized_level"]
            try:
                proc = run_parity_smoke(
                    [
                        "lake",
                        "exe",
                        "parity_smoke",
                        "--fixtures",
                        str(fixtures),
                        "--whitelist",
                        str(wl),
                        "--max-inputs",
                        str(i + 1),
                        "--print-serialize",
                    ],
                    cwd=lean_dir,
                    timeout=args.timeout,
                )
            except subprocess.TimeoutExpired:
                print(f"TIMEOUT at input {i} ({inputs[i]})", file=sys.stderr)
                return 1
            got = proc.stdout
            if proc.returncode != 0:
                print(f"FAIL at input {i} ({inputs[i]}): lean error\n{proc.stderr}", file=sys.stderr)
                return 1
            if got.rstrip("\n") != expected.rstrip("\n"):
                print(f"DIVERGE at input_index={i} token={inputs[i]!r}")
                print("--- JS trace serialized ---")
                print(expected)
                print("--- Lean got ---")
                print(got)
                return 0
        print("All steps match trace")
        final = snapshots[-1]["serialized_level"]
        try:
            proc = run_parity_smoke(
                [
                    "lake",
                    "exe",
                    "parity_smoke",
                    "--fixtures",
                    str(fixtures),
                    "--whitelist",
                    str(wl),
                    "--print-serialize",
                ],
                cwd=lean_dir,
                timeout=args.timeout,
            )
        except subprocess.TimeoutExpired:
            print("TIMEOUT on full replay", file=sys.stderr)
            return 1
        if proc.stdout.rstrip("\n") != final.rstrip("\n"):
            print("Full replay differs from final trace snapshot")
            return 0
        print("Full replay matches final snapshot")
        return 0


if __name__ == "__main__":
    sys.exit(main())
