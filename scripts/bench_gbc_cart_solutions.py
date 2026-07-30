#!/usr/bin/env python3
"""Benchmark first-board solutions inside the multi-game GBC cartridge."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import shutil
import struct
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import run_gbc_smoke
from bench_gbc_eligible_solutions import (
    find_solver,
    retained_board_source_levels,
    solve_retained_board_json,
    write_fixture,
)
from build_gbc_cart import build_cart
from build_gbc_eligible_roms import ELIGIBLE_GAMES


KEY_A = 1 << 0
# mCore::setKeys uses the libmGBA key indices: Right=4, Left=5.
KEY_RIGHT = 1 << 4
KEY_LEFT = 1 << 5
KEY_UP = 1 << 6
KEY_DOWN = 1 << 7
TOKEN_KEYS = {
    "up": KEY_UP,
    "left": KEY_LEFT,
    "down": KEY_DOWN,
    "right": KEY_RIGHT,
    "action": KEY_A,
}

BOOT_RELEASE_FRAMES = 10
MENU_RELEASE_FRAMES = 9
LAUNCH_RELEASE_FRAMES = 49
SOLUTION_RELEASE_FRAMES = 502
MAX_SOLUTION_TOKENS = 65535
CART_BENCH_MAGIC = 0x42424350
CART_BENCH_VERSION = 1
CART_BENCH_SRAM_BANK = 3
CART_BENCH_SRAM_OFFSET = 512
SRAM_BANK_BYTES = 8 * 1024
# The final three padding bytes make the on-SRAM ABI exactly 32 bytes without
# relying on the C compiler's struct packing.
CART_BENCH_RECORD = struct.Struct("<IHHIIIIIB3x")
REPORT_FORMAT = "puzzlescript-gbc-cart-solution-bench-v1"
TIMING_SOURCE = "cgb_4096hz_timer_via_libmgba"


@dataclass(frozen=True)
class CartBenchTelemetry:
    game_index: int
    user_turns: int
    redraws: int
    logic_ticks: int
    render_ticks: int
    max_turn_ticks: int
    won: bool


def source_hash(source: bytes) -> int:
    value = 2166136261
    for byte in source:
        value = ((value ^ byte) * 16777619) & 0xFFFFFFFF
    return value


def validate_benchmark_manifest(
    manifest: dict[str, Any],
    *,
    games: Sequence[tuple[str, str]],
    repository: Path,
) -> list[dict[str, Any]]:
    if not manifest.get("benchmark"):
        raise RuntimeError("cart manifest is not a benchmark build")
    if manifest.get("game_count") != len(games):
        raise RuntimeError(
            "benchmark cart game count does not match the requested corpus"
        )
    entries = manifest.get("games")
    if not isinstance(entries, list) or len(entries) != len(games):
        raise RuntimeError(
            "benchmark cart manifest has an incomplete game list"
        )
    for index, ((slug, source_relative), entry) in enumerate(
        zip(games, entries)
    ):
        if not isinstance(entry, dict):
            raise RuntimeError(
                f"benchmark cart manifest game {index} is malformed"
            )
        expected = {
            "index": index,
            "slug": slug,
            "source": source_relative,
        }
        for field, value in expected.items():
            if entry.get(field) != value:
                raise RuntimeError(
                    f"benchmark cart game {index} {field} is "
                    f"{entry.get(field)!r}, expected {value!r}"
                )
        source_path = repository / source_relative
        if not source_path.is_file():
            raise RuntimeError(
                f"benchmark source is missing for game {index}: "
                f"{source_relative}"
            )
        expected_hash = source_hash(source_path.read_bytes())
        if entry.get("source_hash") != expected_hash:
            raise RuntimeError(
                f"benchmark cart game {index} source hash is stale"
            )
    return entries


def build_key_script(game_index: int, tokens: Sequence[str]) -> list[int]:
    if game_index < 0:
        raise ValueError("game index must be non-negative")
    if len(tokens) > MAX_SOLUTION_TOKENS:
        raise ValueError(
            f"solution has {len(tokens)} tokens; maximum is "
            f"{MAX_SOLUTION_TOKENS}"
        )
    keys = [0] * BOOT_RELEASE_FRAMES

    def press(key: int, release_frames: int) -> None:
        keys.append(key)
        keys.extend([0] * release_frames)

    for _ in range(game_index):
        press(KEY_DOWN, MENU_RELEASE_FRAMES)
    # Launcher->game and title->board both do full-screen setup. Keep the
    # one-frame presses but allow those transitions to settle before input.
    press(KEY_A, LAUNCH_RELEASE_FRAMES)
    press(KEY_A, LAUNCH_RELEASE_FRAMES)
    for raw_token in tokens:
        token = raw_token.strip().lower()
        try:
            key = TOKEN_KEYS[token]
        except KeyError as error:
            raise ValueError(
                f"unsupported solution token: {raw_token!r}"
            ) from error
        press(key, SOLUTION_RELEASE_FRAMES)
    return keys


def parse_telemetry(
    data: bytes,
    *,
    expected_game_index: int,
) -> CartBenchTelemetry:
    if len(data) < CART_BENCH_RECORD.size:
        raise ValueError("cart benchmark telemetry is truncated")
    (
        magic,
        version,
        game_index,
        user_turns,
        redraws,
        logic_ticks,
        render_ticks,
        max_turn_ticks,
        won,
    ) = CART_BENCH_RECORD.unpack_from(data)
    if magic != CART_BENCH_MAGIC:
        raise ValueError(
            f"cart benchmark magic is invalid: 0x{magic:08x}"
        )
    if version != CART_BENCH_VERSION:
        raise ValueError(
            f"cart benchmark version is invalid: {version}"
        )
    if game_index != expected_game_index:
        raise ValueError(
            f"cart benchmark game index is {game_index}, "
            f"expected {expected_game_index}"
        )
    if user_turns == 0:
        raise ValueError("cart benchmark recorded zero user turns")
    if won not in (0, 1):
        raise ValueError(f"cart benchmark won flag is invalid: {won}")
    if max_turn_ticks > logic_ticks + render_ticks:
        raise ValueError(
            "cart benchmark maximum turn exceeds its total ticks"
        )
    return CartBenchTelemetry(
        game_index=game_index,
        user_turns=user_turns,
        redraws=redraws,
        logic_ticks=logic_ticks,
        render_ticks=render_ticks,
        max_turn_ticks=max_turn_ticks,
        won=bool(won),
    )


def _ratio(numerator: int, denominator: int) -> float | None:
    return None if denominator <= 0 else numerator / denominator


def summarize_rows(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    successful = [row for row in rows if row.get("success")]
    turns = sum(int(row["user_turns"]) for row in successful)
    redraws = sum(int(row["redraws"]) for row in successful)
    logic = sum(int(row["logic_ticks"]) for row in successful)
    render = sum(int(row["render_ticks"]) for row in successful)
    return {
        "games": len(rows),
        "successful_games": len(successful),
        "failed_games": len(rows) - len(successful),
        "user_turns": turns,
        "redraws": redraws,
        "logic_ticks": logic,
        "render_ticks": render,
        "weighted_logic_ticks_per_turn": _ratio(logic, turns),
        "weighted_interaction_ticks_per_turn": _ratio(
            logic + render, turns
        ),
        "weighted_render_ticks_per_redraw": _ratio(render, redraws),
    }


def worst_ten(
    rows: Sequence[dict[str, Any]],
    metric: str,
) -> list[dict[str, Any]]:
    eligible = [
        row
        for row in rows
        if row.get("success") and row.get(metric) is not None
    ]
    # Python's sort is stable. Ties therefore retain manifest/game-index order.
    ranked = sorted(
        eligible,
        key=lambda row: float(row[metric]),
        reverse=True,
    )
    return [
        {
            "index": int(row["index"]),
            "slug": str(row["slug"]),
            metric: float(row[metric]),
        }
        for row in ranked[:10]
    ]


def read_fixture(path: Path) -> list[str]:
    tokens = [
        line.strip().lower()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not tokens:
        raise ValueError(f"solution fixture is empty: {path}")
    for token in tokens:
        if token not in TOKEN_KEYS:
            raise ValueError(
                f"solution fixture has unsupported token {token!r}: {path}"
            )
    return tokens


def _relative(path: Path, repository: Path) -> str:
    try:
        return str(path.relative_to(repository))
    except ValueError:
        return str(path)


def load_or_solve_fixture(
    *,
    repository: Path,
    compiler: Path,
    solver: Path,
    cart_out: Path,
    slug: str,
    source_relative: str,
    timeout_ms: int,
) -> tuple[Path, list[str]]:
    fixture = (
        repository
        / "build"
        / "gbc"
        / "eligible"
        / "solution-fixtures"
        / slug
        / "board-0.txt"
    )
    if fixture.is_file():
        return fixture, read_fixture(fixture)

    export = cart_out / "exports" / slug
    manifest_path = export / "gbc_manifest.json"
    generated_game = export / "generated_game.c"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    boards = retained_board_source_levels(
        int(manifest.get("source_level_count") or 0),
        [int(value) for value in manifest.get("culled_level_indices") or []],
        generated_game,
    )
    if not boards:
        raise RuntimeError("benchmark cart contains no retained board")
    source = repository / source_relative
    with tempfile.TemporaryDirectory(
        prefix=f"gbc-cart-solve-{slug}-"
    ) as temporary:
        result = solve_retained_board_json(
            solver,
            compiler,
            source,
            boards[0],
            timeout_ms,
            Path(temporary),
        )
    status = str(result.get("status") or "unknown")
    tokens = [
        str(token).strip().lower()
        for token in result.get("solution") or []
    ]
    if status != "solved" or not tokens:
        raise RuntimeError(f"unsolved:{status}")
    for token in tokens:
        if token not in TOKEN_KEYS:
            raise RuntimeError(
                f"solver returned unsupported token {token!r}"
            )
    write_fixture(tokens, fixture)
    return fixture, tokens


def configure_key_runner(handle: ctypes.CDLL) -> None:
    handle.psgbc_run_with_keys.restype = ctypes.c_int
    handle.psgbc_run_with_keys.argtypes = [
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.c_uint,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_uint,
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_uint,
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_uint),
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.c_uint,
    ]


def run_game(
    *,
    handle: ctypes.CDLL,
    rom: Path,
    game_index: int,
    tokens: Sequence[str],
    maximum_warnings: int | None,
) -> tuple[CartBenchTelemetry, float, int]:
    keys = build_key_script(game_index, tokens)
    key_array = (ctypes.c_uint32 * len(keys))(*keys)
    with tempfile.TemporaryDirectory(
        prefix=f"puzzlescript-gbc-cart-bench-{game_index:02d}-"
    ) as temporary:
        directory = Path(temporary)
        local_rom = directory / "benchmark.gb"
        save = directory / "benchmark.sav"
        shutil.copy2(rom, local_rom)
        capacity = 1 << 20
        sram = (ctypes.c_ubyte * capacity)()
        sram_size = ctypes.c_uint(0)
        frames_run = ctypes.c_uint(0)
        pc = ctypes.c_uint(0)
        sp = ctypes.c_uint(0)
        started = time.monotonic()
        status = handle.psgbc_run_with_keys(
            str(local_rom).encode(),
            str(save).encode(),
            len(keys),
            sram,
            capacity,
            ctypes.byref(sram_size),
            ctypes.byref(frames_run),
            None,
            0,
            ctypes.byref(pc),
            ctypes.byref(sp),
            key_array,
            len(keys),
        )
        elapsed = time.monotonic() - started
        if status != 0:
            raise RuntimeError(
                "libmGBA benchmark backend failed: "
                + run_gbc_smoke.SHIM_ERRORS.get(
                    status, f"unknown status {status}"
                )
            )
        if not save.is_file():
            raise RuntimeError("libmGBA did not flush benchmark SRAM")
        data = save.read_bytes()
        warning_count = int(handle.psgbc_log_count())
        if maximum_warnings is not None:
            try:
                run_gbc_smoke.enforce_emulator_warning_limit(
                    warning_count,
                    maximum_warnings,
                )
            except SystemExit as error:
                raise RuntimeError(str(error)) from error
    offset = (
        CART_BENCH_SRAM_BANK * SRAM_BANK_BYTES
        + CART_BENCH_SRAM_OFFSET
    )
    telemetry = parse_telemetry(
        data[offset : offset + CART_BENCH_RECORD.size],
        expected_game_index=game_index,
    )
    return telemetry, elapsed, warning_count


def build_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "format": REPORT_FORMAT,
        "timing_source": TIMING_SOURCE,
        "summary": summarize_rows(rows),
        "games": rows,
        "worst_10_logic": worst_ten(rows, "logic_ticks_per_turn"),
        "worst_10_interaction": worst_ten(
            rows, "interaction_ticks_per_turn"
        ),
    }


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--compiler", type=Path)
    parser.add_argument("--gbdk-home", type=Path, required=True)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("build/gbc/cart/solution-bench-cart.json"),
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--reuse-cart",
        action="store_true",
        help="reuse an already-built benchmark ROM and manifest beside --out",
    )
    parser.add_argument("--timeout-ms", type=int, default=60000)
    parser.add_argument("--mgba-prefix", type=Path)
    parser.add_argument(
        "--max-emulator-warnings",
        type=int,
        help="fail a replay above this warning count (disabled by default)",
    )
    args = parser.parse_args()

    repository = args.repository.resolve()
    compiler = (
        args.compiler.resolve()
        if args.compiler is not None
        else repository / "build" / "native" / "puzzlescript_cpp"
    )
    gbdk_home = args.gbdk_home.resolve()
    out_path = (
        args.out.resolve()
        if args.out.is_absolute()
        else (repository / args.out).resolve()
    )
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    if args.timeout_ms < 1:
        parser.error("--timeout-ms must be positive")
    if (
        args.max_emulator_warnings is not None
        and args.max_emulator_warnings < 0
    ):
        parser.error("--max-emulator-warnings must be non-negative")

    games = list(ELIGIBLE_GAMES)
    if args.limit is not None:
        games = games[: args.limit]
    cart_out = out_path.parent
    try:
        if args.reuse_cart:
            rom = cart_out / (
                f"puzzlescript-compilation-benchmark-{len(games)}.gb"
            )
            manifest_path = cart_out / "cart-manifest.json"
            if not rom.is_file() or not manifest_path.is_file():
                raise RuntimeError(
                    "--reuse-cart requires an existing benchmark ROM and "
                    "cart-manifest.json beside --out"
                )
        else:
            rom, manifest_path = build_cart(
                repository=repository,
                compiler=compiler,
                gbdk_home=gbdk_home,
                out=cart_out,
                games=games,
                cull=True,
                autotest=False,
                benchmark=True,
            )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest_games = validate_benchmark_manifest(
            manifest,
            games=games,
            repository=repository,
        )
        solver = find_solver(repository)
        prefix, missing = run_gbc_smoke.find_libmgba_prefix(
            args.mgba_prefix
        )
        if prefix is None:
            raise RuntimeError(f"libmGBA is unavailable: {missing}")
        handle = run_gbc_smoke.load_libmgba_shim(
            prefix,
            repository / ".codex_tmp" / "mgba-shim",
        )
        configure_key_runner(handle)
    except (OSError, RuntimeError, ValueError, SystemExit) as error:
        print(f"gbc-cart-solution-bench: {error}")
        return 1

    rows: list[dict[str, Any]] = []
    for index, (slug, source_relative) in enumerate(games):
        source = repository / source_relative
        row: dict[str, Any] = {
            "index": index,
            "slug": slug,
            "source": source_relative,
            "source_hash": int(manifest_games[index]["source_hash"]),
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "success": False,
        }
        replay_started: float | None = None
        print(f"[{index + 1}/{len(games)}] {slug}", flush=True)
        try:
            fixture, tokens = load_or_solve_fixture(
                repository=repository,
                compiler=compiler,
                solver=solver,
                cart_out=cart_out,
                slug=slug,
                source_relative=source_relative,
                timeout_ms=args.timeout_ms,
            )
            row.update(
                {
                    "fixture": _relative(fixture, repository),
                    "fixture_turns": len(tokens),
                }
            )
            replay_started = time.monotonic()
            telemetry, elapsed, warning_count = run_game(
                handle=handle,
                rom=rom,
                game_index=index,
                tokens=tokens,
                maximum_warnings=args.max_emulator_warnings,
            )
            if not telemetry.won:
                raise RuntimeError("fixture replay did not win")
            if telemetry.logic_ticks == 0 or telemetry.render_ticks == 0:
                raise RuntimeError(
                    "benchmark timer produced a zero logic/render total"
                )
            row.update(
                {
                    "success": True,
                    "won": True,
                    "user_turns": telemetry.user_turns,
                    "redraws": telemetry.redraws,
                    "logic_ticks": telemetry.logic_ticks,
                    "render_ticks": telemetry.render_ticks,
                    "max_turn_ticks": telemetry.max_turn_ticks,
                    "logic_ticks_per_turn": (
                        telemetry.logic_ticks / telemetry.user_turns
                    ),
                    "interaction_ticks_per_turn": (
                        telemetry.logic_ticks + telemetry.render_ticks
                    )
                    / telemetry.user_turns,
                    "render_ticks_per_redraw": _ratio(
                        telemetry.render_ticks,
                        telemetry.redraws,
                    ),
                    "wall_seconds": elapsed,
                    "emulator_warnings": warning_count,
                }
            )
            print(
                f"  ok turns={telemetry.user_turns} "
                f"logic/turn={row['logic_ticks_per_turn']:.2f} "
                f"interaction/turn="
                f"{row['interaction_ticks_per_turn']:.2f}",
                flush=True,
            )
        except (OSError, RuntimeError, ValueError) as error:
            if replay_started is not None:
                row["wall_seconds"] = time.monotonic() - replay_started
                row["emulator_warnings"] = int(
                    handle.psgbc_log_count()
                )
            row["error"] = str(error)
            print(f"  FAIL {error}", flush=True)
        rows.append(row)
        _write_report(out_path, build_report(rows))

    report = build_report(rows)
    _write_report(out_path, report)
    print(
        f"wrote {out_path} "
        f"({report['summary']['successful_games']}/{len(rows)} successful)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
