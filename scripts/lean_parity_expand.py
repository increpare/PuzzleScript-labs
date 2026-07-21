#!/usr/bin/env python3
"""Run parity_smoke on clean candidates and expand parity_whitelist.txt with passing cases."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path


def load_lines(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]


def is_comment_line(line: str) -> bool:
    return (
        not line.strip()
        or line.startswith("##")
        or line == "#"
        or line.startswith("# ")
    )


def run_case(lean_dir: Path, fixtures: Path, name: str, timeout: float) -> tuple[str, str]:
    wl = lean_dir / ".parity_expand_one.txt"
    wl.write_text(name + "\n", encoding="utf-8")
    try:
        proc = subprocess.run(
            ["lake", "exe", "parity_smoke", "--fixtures", str(fixtures), "--whitelist", str(wl)],
            cwd=lean_dir,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return ("timeout", "")
    out = proc.stdout + proc.stderr
    if proc.returncode == 0 and "lean parity smoke: OK" in out:
        return ("ok", "")
    if m := re.search(r"FAIL [^\n]+: (.+)", out):
        return ("fail", m.group(1).split("\n")[0][:120])
    if "schema error" in out:
        m = re.search(r"schema error: ([^\n]+)", out)
        return ("schema", (m.group(1) if m else out)[:120])
    if "expected:" in out:
        return ("mismatch", "serialized mismatch")
    return ("fail", out.strip()[:120])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--fixtures", type=Path, default=None)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--write-whitelist", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    repo = args.repo_root
    lean_dir = repo / "lean"
    fixtures = args.fixtures or (repo / "build" / "js-parity-data")
    candidates_path = lean_dir / "parity_clean_candidates.txt"
    whitelist_path = lean_dir / "parity_whitelist.txt"

    manifest = json.loads((fixtures / "fixtures.json").read_text(encoding="utf-8"))
    by_name = {fx["name"]: fx for fx in manifest["simulation_fixtures"]}
    candidates = load_lines(candidates_path)
    whitelist = load_lines(whitelist_path)
    whitelist_set = set(whitelist)

    errors: Counter[str] = Counter()
    new_ok: list[str] = []

    for name in candidates:
        if name not in by_name:
            continue
        if name in whitelist_set:
            continue
        status, reason = run_case(lean_dir, fixtures, name, args.timeout)
        errors[status] += 1
        if status == "ok":
            new_ok.append(name)
            if args.verbose:
                print(f"OK {name}")
        elif args.verbose:
            print(f"{status.upper()} {name}: {reason}")

    print(f"Candidates in fixtures: {sum(1 for n in candidates if n in by_name)}")
    print(f"Whitelist before: {len(whitelist)}")
    print(f"Newly passing: {len(new_ok)}")
    print("Failure buckets (non-whitelisted only):")
    for key, count in errors.most_common():
        if key != "ok":
            print(f"  {count} {key}")

    if args.write_whitelist and new_ok:
        text = whitelist_path.read_text(encoding="utf-8")
        if not text.endswith("\n"):
            text += "\n"
        for name in sorted(new_ok):
            text += name + "\n"
        whitelist_path.write_text(text, encoding="utf-8")
        print(f"Appended {len(new_ok)} names to {whitelist_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
