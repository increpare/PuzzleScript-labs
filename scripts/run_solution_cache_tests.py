#!/usr/bin/env python3
"""Replay checked-in eligible solutions on native C++ and host GBC."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import solution_cache as sc
from bench_gbc_eligible_solutions import (
    compile_host_benches,
    find_compiler,
    run_host_bench,
)


def find_cpp(repository: Path) -> Path:
    for candidate in (
        repository / "build" / "native" / "puzzlescript_cpp",
        repository / "build" / "native" / "puzzlescript_cpp.exe",
    ):
        if candidate.is_file():
            return candidate
    raise SystemExit("puzzlescript_cpp not found; build it first")


def replay_cpp(
    cpp: Path,
    repository: Path,
    entry: dict[str, Any],
) -> None:
    tokens = sc.read_tokens(repository / str(entry["solution_path"]))
    with tempfile.TemporaryDirectory(prefix="solution-cache-cpp-") as tmp:
        inputs = Path(tmp) / "inputs.json"
        inputs.write_text(json.dumps(tokens) + "\n", encoding="utf-8")
        cmd = [
            str(cpp),
            "run",
            str(repository / str(entry["source"])),
            "--headless",
            "--native-compile",
            "--final-only",
            "--require-win",
            "--level",
            str(int(entry["source_level"])),
            "--inputs-file",
            str(inputs),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=repository)
        if proc.returncode != 0:
            raise RuntimeError(
                f"C++ replay failed rc={proc.returncode}: "
                f"{(proc.stderr or proc.stdout).strip()}"
            )


def ensure_export(
    repository: Path,
    compiler: Path,
    slug: str,
    source: Path,
    export_root: Path,
) -> Path:
    export_dir = export_root / slug
    manifest = export_dir / "gbc_manifest.json"
    generated = export_dir / "generated_game.c"
    if manifest.is_file() and generated.is_file():
        return export_dir
    export_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(compiler),
        "export-gbc",
        str(source),
        "--out",
        str(export_dir),
        "--cull-oversize-levels",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=repository)
    if proc.returncode != 0:
        raise RuntimeError(
            f"export-gbc failed for {slug}: {(proc.stderr or proc.stdout).strip()}"
        )
    return export_dir


def replay_host_group(
    repository: Path,
    compiler: Path,
    export_root: Path,
    slug: str,
    source: Path,
    entries: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], bool, str]]:
    export_dir = ensure_export(repository, compiler, slug, source, export_root)
    results: list[tuple[dict[str, Any], bool, str]] = []
    with tempfile.TemporaryDirectory(prefix=f"solution-cache-host-{slug}-") as tmp:
        baseline, _specialized = compile_host_benches(
            repository, export_dir, Path(tmp)
        )
        for entry in entries:
            fixture = repository / str(entry["solution_path"])
            try:
                payload = run_host_bench(
                    baseline,
                    fixture,
                    slug,
                    int(entry["board_index"]),
                    iterations=1,
                )
                won = bool(payload.get("won"))
                results.append((entry, won, "" if won else "host won=false"))
            except Exception as exc:  # noqa: BLE001
                results.append((entry, False, str(exc)))
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument(
        "--cache-root",
        type=Path,
        default=sc.DEFAULT_CACHE_ROOT,
    )
    parser.add_argument(
        "--tag",
        default=sc.TAG_HOST_KNOWN_GOOD,
        help="manifest tag filter (default: host_known_good)",
    )
    parser.add_argument(
        "--export-dir",
        type=Path,
        default=Path("build/gbc/eligible/host-exports"),
    )
    parser.add_argument(
        "--skip-host",
        action="store_true",
        help="only run native C++ replays",
    )
    parser.add_argument(
        "--skip-cpp",
        action="store_true",
        help="only run host GBC replays",
    )
    parser.add_argument(
        "--thorough-host-policy",
        choices=("strict", "quarantine"),
        default="strict",
        help="quarantine: js_valid-only host misses are reported, not fatal",
    )
    parser.add_argument("--slug", action="append", default=[])
    args = parser.parse_args()

    repository = args.repository.resolve()
    root = sc.cache_root(repository, args.cache_root)
    manifest = sc.load_manifest(sc.manifest_path(root))
    entries = list(manifest.get("entries") or [])
    selected = sc.filter_entries(entries, tag=args.tag)
    if args.slug:
        wanted = set(args.slug)
        selected = [entry for entry in selected if entry.get("slug") in wanted]

    if not selected:
        print(f"solution_cache_tests: no entries for tag={args.tag}")
        return 1

    hard_failures: list[str] = []
    quarantined: list[str] = []

    for entry in selected:
        errors = sc.validate_entry_against_source(repository, entry)
        if errors:
            hard_failures.extend(
                f"{entry.get('slug')} board {entry.get('board_index')}: {err}"
                for err in errors
            )

    if hard_failures:
        for line in hard_failures:
            print(f"FAIL {line}")
        return 1

    cpp = None if args.skip_cpp else find_cpp(repository)
    compiler = None if args.skip_host else find_compiler(repository)
    export_root = (repository / args.export_dir).resolve()

    print(
        f"solution_cache_tests: tag={args.tag} entries={len(selected)} "
        f"cpp={not args.skip_cpp} host={not args.skip_host}",
        flush=True,
    )

    if cpp is not None:
        for index, entry in enumerate(selected, start=1):
            label = f"{entry['slug']} board={entry['board_index']} src={entry['source_level']}"
            try:
                replay_cpp(cpp, repository, entry)
                print(f"  [{index}/{len(selected)}] cpp ok {label}", flush=True)
            except Exception as exc:  # noqa: BLE001
                msg = f"cpp {label}: {exc}"
                hard_failures.append(msg)
                print(f"  FAIL {msg}", flush=True)

    if compiler is not None:
        by_slug: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for entry in selected:
            by_slug[str(entry["slug"])].append(entry)
        for slug, group in by_slug.items():
            group.sort(key=lambda item: int(item["board_index"]))
            source = repository / str(group[0]["source"])
            print(f"  host {slug}: {len(group)} board(s)", flush=True)
            try:
                results = replay_host_group(
                    repository,
                    compiler,
                    export_root,
                    slug,
                    source,
                    group,
                )
            except Exception as exc:  # noqa: BLE001
                hard_failures.append(f"host {slug}: {exc}")
                print(f"  FAIL host {slug}: {exc}", flush=True)
                continue
            for entry, won, detail in results:
                label = (
                    f"{entry['slug']} board={entry['board_index']} "
                    f"src={entry['source_level']}"
                )
                tags = entry.get("tags") or []
                if won:
                    print(f"    ok {label}", flush=True)
                    continue
                msg = f"host {label}: {detail or 'not won'}"
                if (
                    args.thorough_host_policy == "quarantine"
                    and sc.TAG_HOST_KNOWN_GOOD not in tags
                ):
                    quarantined.append(msg)
                    print(f"    quarantine {msg}", flush=True)
                else:
                    hard_failures.append(msg)
                    print(f"    FAIL {msg}", flush=True)

    print(
        f"solution_cache_tests: hard_failures={len(hard_failures)} "
        f"quarantined={len(quarantined)}",
        flush=True,
    )
    return 1 if hard_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
