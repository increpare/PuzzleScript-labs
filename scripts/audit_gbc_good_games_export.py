#!/usr/bin/env python3
"""Classify GBC export-gbc outcomes for every src/tests/good_games fixture."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path


GOOD_GAMES_DIR = Path("src/tests/good_games")


def find_compiler(repository: Path, explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit
    env = os.environ.get("PUZZLESCRIPT_CPP")
    if env:
        return Path(env)
    candidates = (
        repository / "build" / "native" / "puzzlescript_cpp",
        repository / "build" / "native" / "puzzlescript_cpp.exe",
        repository / "build" / "native" / "Release" / "puzzlescript_cpp.exe",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return candidates[0]


def classify_error(message: str) -> str:
    text = message.strip()
    if not text:
        return "unknown"
    rules = (
        ("compile_failed", ("PuzzleScript compile failed",)),
        ("object_count", ("supports between 1 and 32 objects",)),
        ("collision_layers", ("at most 32 collision layers",)),
        ("movement_layers", ("6 movement-capable collision layers",)),
        ("aggregate_player", ("aggregate player masks",)),
        ("board_cull_all", ("GBC level culling removed every board level",)),
        (
            "board_oversize",
            (
                "board dimensions cannot exceed",
                "board levels must contain between 1 and 90 cells",
            ),
        ),
        (
            "any_layer_coupled",
            (
                "any/layer-coupled",
                "requires specialized turn for any/layer-coupled",
            ),
        ),
        ("property_aggregate", ("property/aggregate bindings",)),
        ("multi_row", ("multi-row rules are not in the v1 runtime",)),
        ("ellipsis", ("ellipsis patterns are not in the v1 runtime",)),
        ("rigid", ("rigid rules are not in the v1 runtime",)),
        ("random", ("random rule groups are not in the v1 runtime",)),
        ("dynamic_replacement", ("dynamic or random replacements are not in the v1 runtime",)),
        ("sprite", ("fixed 5x5 source cell",)),
        ("rom_budget", ("switchable-ROM-bank budget",)),
        ("wram_budget", ("4 KiB WRAM budget",)),
        ("unsupported_command", ("rejects unsupported command",)),
        ("no_board", ("requires at least one board level",)),
    )
    lowered = text.lower()
    for label, needles in rules:
        if any(needle.lower() in lowered for needle in needles):
            return label
    if "GBC export rejects rule on line" in text:
        return "rule_reject_other"
    return "other"


def export_one(
    compiler: Path,
    source: Path,
    *,
    cull: bool,
) -> tuple[bool, str, str]:
    with tempfile.TemporaryDirectory(prefix="gbc_audit_") as tmp:
        out_dir = Path(tmp)
        command = [
            str(compiler),
            "export-gbc",
            str(source),
            "--out",
            str(out_dir),
        ]
        if cull:
            command.append("--cull-oversize-levels")
        process = subprocess.run(
            command,
            capture_output=True,
            text=True,
        )
        output = (process.stdout + process.stderr).strip()
        if process.returncode == 0:
            return True, "ok", output
        return False, classify_error(output), output.splitlines()[-1] if output else ""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit GBC export outcomes for src/tests/good_games/*.txt"
    )
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--compiler", type=Path)
    parser.add_argument(
        "--cull",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Pass --cull-oversize-levels (default: strict export)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print one line per game",
    )
    parser.add_argument("--json-out", type=Path, default=None)
    args = parser.parse_args()

    repository = args.repository.resolve()
    compiler = find_compiler(repository, args.compiler)
    games_dir = repository / GOOD_GAMES_DIR
    if not compiler.is_file():
        raise SystemExit(f"PuzzleScript compiler was not found: {compiler}")
    if not games_dir.is_dir():
        raise SystemExit(f"good_games directory was not found: {games_dir}")

    sources = sorted(games_dir.glob("*.txt"))
    counts: Counter[str] = Counter()
    examples: dict[str, str] = {}
    results: list[dict] = []

    for index, source in enumerate(sources, start=1):
        ok, reason, detail = export_one(compiler, source, cull=args.cull)
        label = "ok" if ok else reason
        counts[label] += 1
        results.append({
            "source": str(source.relative_to(repository)).replace("\\", "/"),
            "name": source.name,
            "ok": ok,
            "class": label,
            "detail": detail,
        })
        if label not in examples and detail:
            examples[label] = detail
        if args.verbose:
            status = "OK" if ok else reason
            print(f"[{index}/{len(sources)}] {status} {source.name}", flush=True)
            if not ok and detail:
                print(f"  {detail}", flush=True)

    total = len(sources)
    ok_count = counts["ok"]
    print(f"good_games GBC export audit ({total} fixtures)", flush=True)
    print(f"  mode: {'cull-oversize-levels' if args.cull else 'strict'}", flush=True)
    print(f"  compiler: {compiler}", flush=True)
    print(f"  ok: {ok_count}/{total}", flush=True)
    print("  first-fail counts:", flush=True)
    for label, count in counts.most_common():
        if label == "ok":
            continue
        sample = examples.get(label, "")
        suffix = f"  e.g. {sample}" if sample else ""
        print(f"    {label}: {count}{suffix}", flush=True)

    if args.json_out is not None:
        out_path = args.json_out if args.json_out.is_absolute() else repository / args.json_out
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "format": "puzzlescript-gbc-good-games-export-audit-v1",
            "cull_oversize_levels": bool(args.cull),
            "compiler": str(compiler),
            "counts": dict(counts),
            "results": results,
        }
        out_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"wrote {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
