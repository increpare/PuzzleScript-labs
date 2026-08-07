#!/usr/bin/env python3
"""Maintain the checked-in eligible solution cache.

Default: re-verify JS + reclassify host_known_good without solving.
Opt-in: --solve --timeout-ms N fills missing retained boards.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import solution_cache as sc
from bench_gbc_eligible_solutions import (
    ELIGIBLE_GAMES,
    compile_host_benches,
    find_compiler,
    find_solver,
    retained_board_source_levels,
    run_host_bench,
    solve_retained_board_json,
)


def js_replay_wins(repository: Path, source: Path, level: int, tokens: list[str]) -> bool:
    cmd = [
        "node",
        str(repository / "src" / "tests" / "replay_solution.js"),
        str(source),
        str(level),
        "--inputs",
        ",".join(tokens),
        "--json",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=repository)
    try:
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception:
        return False
    return bool(payload.get("solved"))


def load_or_export(
    repository: Path,
    compiler: Path,
    slug: str,
    source: Path,
    export_root: Path,
) -> Path:
    export_dir = export_root / slug
    manifest_path = export_dir / "gbc_manifest.json"
    generated_path = export_dir / "generated_game.c"
    if manifest_path.is_file() and generated_path.is_file():
        try:
            cached = json.loads(manifest_path.read_text(encoding="utf-8"))
            header = (
                repository / "native" / "include" / "puzzlescript" / "gbc.h"
            ).read_text(encoding="utf-8")
            match = re.search(
                r"#define\s+PS_GBC_GAME_ABI_VERSION\s+(\d+)", header
            )
            runtime_abi = int(match.group(1)) if match else None
            if runtime_abi is None or int(cached.get("abi_version") or -1) == runtime_abi:
                return export_dir
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass
    export_dir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            str(compiler),
            "export-gbc",
            str(source),
            "--out",
            str(export_dir),
            "--cull-oversize-levels",
        ],
        capture_output=True,
        text=True,
        cwd=repository,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or "export failed")
    return export_dir


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--cache-root", type=Path, default=sc.DEFAULT_CACHE_ROOT)
    parser.add_argument(
        "--export-dir",
        type=Path,
        default=Path("build/gbc/eligible/host-exports"),
    )
    parser.add_argument("--solve", action="store_true")
    parser.add_argument("--timeout-ms", type=int, default=3000)
    parser.add_argument("--slug", action="append", default=[])
    args = parser.parse_args()

    repository = args.repository.resolve()
    root = sc.cache_root(repository, args.cache_root)
    manifest_file = sc.manifest_path(root)
    if manifest_file.is_file():
        payload = sc.load_manifest(manifest_file)
        entries = list(payload.get("entries") or [])
    else:
        payload = {
            "format": "puzzlescript-eligible-solution-cache-v1",
            "corpus": "eligible_gbc",
            "entries": [],
        }
        entries = []

    by_key = {
        (str(entry["slug"]), int(entry["board_index"])): entry for entry in entries
    }
    compiler = find_compiler(repository)
    solver = find_solver(repository) if args.solve else None
    export_root = (repository / args.export_dir).resolve()
    wanted = set(args.slug)

    games = [
        (slug, source)
        for slug, source in ELIGIBLE_GAMES
        if not wanted or slug in wanted
    ]

    kept: list[dict[str, Any]] = []
    for slug, source_rel in games:
        source = repository / source_rel
        source_hash = sc.sha256_file(source)
        export_dir = load_or_export(repository, compiler, slug, source, export_root)
        manifest = json.loads(
            (export_dir / "gbc_manifest.json").read_text(encoding="utf-8")
        )
        boards = retained_board_source_levels(
            int(manifest.get("source_level_count") or 0),
            [int(v) for v in manifest.get("culled_level_indices") or []],
            export_dir / "generated_game.c",
        )
        with tempfile.TemporaryDirectory(prefix=f"refresh-host-{slug}-") as tmp:
            baseline, _ = compile_host_benches(repository, export_dir, Path(tmp))
            for board_index, source_level in enumerate(boards):
                key = (slug, board_index)
                entry = by_key.get(key)
                tokens: list[str] = []
                if entry is not None:
                    sol = repository / str(entry["solution_path"])
                    if sol.is_file():
                        tokens = sc.read_tokens(sol)
                if not tokens and args.solve and solver is not None:
                    print(f"solve {slug} board={board_index} src={source_level}", flush=True)
                    with tempfile.TemporaryDirectory(prefix="refresh-solve-") as solve_tmp:
                        result = solve_retained_board_json(
                            solver,
                            compiler,
                            source,
                            source_level,
                            args.timeout_ms,
                            Path(solve_tmp),
                        )
                    if str(result.get("status")) == "solved":
                        tokens = [str(t).lower() for t in (result.get("solution") or [])]
                if not tokens:
                    continue
                if not js_replay_wins(repository, source, source_level, tokens):
                    print(f"drop {slug} board={board_index}: js replay failed", flush=True)
                    continue
                rel = sc.solution_relpath(slug, board_index)
                sc.write_tokens(repository / rel, tokens)
                host_won = False
                try:
                    payload_host = run_host_bench(
                        baseline,
                        repository / rel,
                        slug,
                        board_index,
                        iterations=1,
                    )
                    host_won = bool(payload_host.get("won"))
                except Exception as exc:  # noqa: BLE001
                    print(f"host miss {slug} board={board_index}: {exc}", flush=True)
                tags = [sc.TAG_JS_VALID]
                if host_won:
                    tags.append(sc.TAG_HOST_KNOWN_GOOD)
                # Preserve maintainer cart quarantine across refresh/reclassify.
                if entry is not None and sc.TAG_CART_QUARANTINE in (
                    entry.get("tags") or []
                ):
                    tags.append(sc.TAG_CART_QUARANTINE)
                kept.append(
                    {
                        "slug": slug,
                        "source": source_rel,
                        "board_index": board_index,
                        "source_level": source_level,
                        "solution_path": rel,
                        "source_sha256": source_hash,
                        "tags": tags,
                        "replay_turns": len(tokens),
                    }
                )
                print(
                    f"keep {slug} board={board_index} tags={tags} turns={len(tokens)}",
                    flush=True,
                )

    if wanted:
        # Slug-scoped refresh: merge updated boards into the existing manifest
        # instead of dropping every other game.
        merged = {
            (str(entry["slug"]), int(entry["board_index"])): entry
            for entry in entries
            if str(entry.get("slug") or "") not in wanted
        }
        for entry in kept:
            merged[(str(entry["slug"]), int(entry["board_index"]))] = entry
        kept = list(merged.values())
    kept.sort(key=lambda item: (item["slug"], item["board_index"]))
    payload["entries"] = kept
    payload["counts"] = {
        "entries": len(kept),
        "js_valid": sum(1 for e in kept if sc.TAG_JS_VALID in e["tags"]),
        "host_known_good": sum(
            1 for e in kept if sc.TAG_HOST_KNOWN_GOOD in e["tags"]
        ),
        "cart_quarantine": sum(
            1 for e in kept if sc.TAG_CART_QUARANTINE in e["tags"]
        ),
    }
    sc.save_manifest(manifest_file, payload)
    print(f"wrote {manifest_file} counts={payload['counts']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
