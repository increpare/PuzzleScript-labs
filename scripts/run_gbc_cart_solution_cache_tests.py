#!/usr/bin/env python3
"""Thorough cart/libmGBA replay of every cached eligible board.

Builds one benchmark cart, then for each cached (game, board_index) entry
pre-seeds the target board ordinal in SRAM and replays that board's solution.

Hard-fail policy (aligned with host thorough quarantine):
- `host_known_good` without `cart_quarantine` → miss is fatal
- `js_valid` only, or `cart_quarantine` → miss is reported, not fatal
Every cached board is still attempted.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import solution_cache as sc
from bench_gbc_cart_solutions import (
    configure_key_runner,
    run_game,
    validate_benchmark_manifest,
)
from build_gbc_cart import build_cart
from build_gbc_eligible_roms import ELIGIBLE_GAMES
import run_gbc_smoke


def entry_hard_fail_on_miss(entry: dict[str, Any]) -> bool:
    tags = set(entry.get("tags") or [])
    if sc.TAG_CART_QUARANTINE in tags:
        return False
    return sc.TAG_HOST_KNOWN_GOOD in tags


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--cache-root", type=Path, default=sc.DEFAULT_CACHE_ROOT)
    parser.add_argument("--compiler", type=Path)
    parser.add_argument(
        "--gbdk-home",
        type=Path,
        default=Path(".codex_tmp/toolchains/gbdk"),
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("build/gbc/cart-solution-cache"),
    )
    parser.add_argument("--reuse-cart", action="store_true")
    parser.add_argument("--limit", type=int, help="limit games in the cart")
    parser.add_argument("--mgba-prefix", type=Path)
    parser.add_argument("--slug", action="append", default=[])
    args = parser.parse_args()

    repository = args.repository.resolve()
    root = sc.cache_root(repository, args.cache_root)
    manifest = sc.load_manifest(sc.manifest_path(root))
    entries = list(manifest.get("entries") or [])
    by_slug: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        errors = sc.validate_entry_against_source(repository, entry)
        if errors:
            print("FAIL manifest:", *errors, sep="\n  ")
            return 1
        by_slug[str(entry["slug"])].append(entry)

    games = list(ELIGIBLE_GAMES)
    if args.limit is not None:
        games = games[: args.limit]
    if args.slug:
        wanted = set(args.slug)
        games = [item for item in games if item[0] in wanted]

    compiler = (
        args.compiler.resolve()
        if args.compiler is not None
        else repository / "build" / "native" / "puzzlescript_cpp"
    )
    out_dir = (
        args.out_dir
        if args.out_dir.is_absolute()
        else (repository / args.out_dir).resolve()
    )
    gbdk_home = (
        args.gbdk_home
        if args.gbdk_home.is_absolute()
        else (repository / args.gbdk_home).resolve()
    )

    try:
        if args.reuse_cart:
            rom = out_dir / f"puzzlescript-compilation-benchmark-{len(games)}.gb"
            manifest_path = out_dir / "cart-manifest.json"
            if not rom.is_file() or not manifest_path.is_file():
                raise RuntimeError("--reuse-cart requires existing ROM+manifest")
        else:
            rom, manifest_path = build_cart(
                repository=repository,
                compiler=compiler,
                gbdk_home=gbdk_home,
                out=out_dir,
                games=games,
                cull=True,
                autotest=False,
                benchmark=True,
            )
        cart_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        validate_benchmark_manifest(
            cart_manifest, games=games, repository=repository
        )
        prefix, missing = run_gbc_smoke.find_libmgba_prefix(args.mgba_prefix)
        if prefix is None:
            raise RuntimeError(f"libmGBA unavailable: {missing}")
        handle = run_gbc_smoke.load_libmgba_shim(
            prefix, repository / ".codex_tmp" / "mgba-shim"
        )
        configure_key_runner(handle)
    except (OSError, RuntimeError, SystemExit) as exc:
        print(f"gbc_cart_solution_cache_tests: {exc}")
        return 1

    failures = 0
    quarantined = 0
    checked = 0
    for index, (slug, _source_relative) in enumerate(games):
        group = sorted(
            by_slug.get(slug, []),
            key=lambda item: int(item["board_index"]),
        )
        if not group:
            print(f"[{index + 1}/{len(games)}] {slug}: SKIP no cached boards")
            continue
        print(
            f"[{index + 1}/{len(games)}] {slug}: {len(group)} cached board(s)",
            flush=True,
        )
        for entry in group:
            board_index = int(entry["board_index"])
            tokens = sc.read_tokens(repository / str(entry["solution_path"]))
            hard = entry_hard_fail_on_miss(entry)
            try:
                telemetry, _elapsed, warning_count = run_game(
                    handle=handle,
                    rom=rom,
                    game_index=index,
                    tokens=tokens,
                    maximum_warnings=None,
                    board_index=board_index,
                )
                if not telemetry.won:
                    raise RuntimeError(
                        "cart replay did not win "
                        f"(turns={telemetry.user_turns})"
                    )
                checked += 1
                print(
                    f"  ok board={board_index} turns={telemetry.user_turns} "
                    f"warnings={warning_count}",
                    flush=True,
                )
            except Exception as exc:  # noqa: BLE001
                tags = ",".join(entry.get("tags") or [])
                if hard:
                    failures += 1
                    print(f"  FAIL board={board_index}: {exc}", flush=True)
                else:
                    quarantined += 1
                    print(
                        f"  quarantine board={board_index} tags={tags}: {exc}",
                        flush=True,
                    )

    print(
        f"gbc_cart_solution_cache_tests: checked={checked} "
        f"failures={failures} quarantined={quarantined}",
        flush=True,
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
