#!/usr/bin/env python3
"""Makefile entrypoint: flock + process-group-safe `lake exe parity_smoke`."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from lean_parity_run import parity_lock, run_parity_smoke  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--whitelist", type=Path, required=True)
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="Optional overall timeout (seconds). Default: no limit (full whitelist).",
    )
    parser.add_argument("--wait-lock", action="store_true", default=True)
    parser.add_argument("--no-wait-lock", action="store_true", help="Fail if lock held")
    args = parser.parse_args()

    lean_dir = args.repo_root / "lean"
    wait = not args.no_wait_lock
    with parity_lock(wait=wait):
        build = subprocess.run(["lake", "build", "parity_smoke"], cwd=lean_dir)
        if build.returncode != 0:
            return build.returncode
        try:
            proc = run_parity_smoke(
                [
                    "lake",
                    "exe",
                    "parity_smoke",
                    "--fixtures",
                    str(args.fixtures),
                    "--whitelist",
                    str(args.whitelist),
                ],
                cwd=lean_dir,
                timeout=args.timeout,
                capture_output=False,
            )
        except subprocess.TimeoutExpired:
            print("lean_parity_smoke: timed out; killed process group", file=sys.stderr)
            return 124
        return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
