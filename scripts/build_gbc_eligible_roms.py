#!/usr/bin/env python3
"""Build production ROMs for the documented GBC-compatible good_games set."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

from check_gbc_rom import map_usage


# Ledger corpus: 7 strict exports + 7 games that need --cull-oversize-levels.
ELIGIBLE_GAMES: tuple[tuple[str, str], ...] = (
    ("15-push-pull-levels", "src/tests/good_games/15 push pull levels.txt"),
    ("i-am-a-gust-of-wind", "src/tests/good_games/i am a gust of wind.txt"),
    ("no-forbidden-symbols", "src/tests/good_games/no forbidden symbols.txt"),
    ("push-pull", "src/tests/good_games/push pull.txt"),
    ("pushy-v-pully-h", "src/tests/good_games/Pushy-V Pully-H.txt"),
    (
        "short-adventure-in-sticky-wall-land",
        "src/tests/good_games/short adventure in sticky wall land.txt",
    ),
    ("slot-machine", "src/tests/good_games/slot machine.txt"),
    ("dollyban", "src/tests/good_games/dollyban.txt"),
    ("fickle-fred", "src/tests/good_games/fickle fred.txt"),
    ("gapfiller", "src/tests/good_games/gapfiller.txt"),
    ("pushit", "src/tests/good_games/pushit.txt"),
    (
        "recondite-star-sector-sigma",
        "src/tests/good_games/Recondite Star Sector Sigma.txt",
    ),
    ("voitex-rasteriser", "src/tests/good_games/Voitex Rasteriser.txt"),
    ("xorro-the-chaos-warden", "src/tests/good_games/Xorro The Chaos Warden.txt"),
)

SOLUTION_FIXTURES: dict[str, Path] = {
    "sokoban_basic": Path("native/tests/fixtures/gbc_sokoban_basic_solution.txt"),
}

SPECIALIZED_FALLBACK_UNSUPPORTED = "compact_turn_unsupported"
SPECIALIZED_FALLBACK_MISSING = "specialized_turn_not_emitted"


def find_make() -> Path | None:
    executable = shutil.which("make") or shutil.which("make.exe")
    if executable:
        return Path(executable)
    candidate = Path(r"C:\devkitPro\msys2\usr\bin\make.exe")
    return candidate if candidate.is_file() else None


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
        repository / "build-gbc-release" / "native" / "puzzlescript_cpp.exe",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return candidates[0]


def truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def relpath(path: Path, repository: Path) -> str:
    return str(path.relative_to(repository)).replace("\\", "/")


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def find_bench_binary(repository: Path, build_dir: Path) -> Path | None:
    for candidate in (
        build_dir / "native" / "puzzlescript_gbc_solution_replay_bench",
        build_dir / "native" / "Release" / "puzzlescript_gbc_solution_replay_bench.exe",
        build_dir / "native" / "puzzlescript_gbc_solution_replay_bench.exe",
    ):
        if candidate.is_file():
            return candidate
    return None


def scoreboard_entry_from_record(
    record: dict[str, Any],
    repository: Path,
    bench_binary: Path | None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "slug": record["slug"],
        "source": record.get("source"),
        "specialized": False,
        "single_player_cell": False,
        "rom_bytes": None,
        "replay_turns": None,
        "mean_ms_per_turn": None,
        "pct_le_50ms": None,
        "pct_le_80ms": None,
        "fallback_reason": None,
        "timing_source": None,
    }
    if not record.get("success"):
        entry["fallback_reason"] = record.get("error", "build_failed")
        return entry

    manifest_path = repository / str(record["manifest"])
    rom_path = repository / str(record["rom"])
    if not manifest_path.is_file() or not rom_path.is_file():
        entry["fallback_reason"] = "missing_manifest_or_rom"
        return entry

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    specialized = bool(manifest.get("specialized_turn", False))
    entry["specialized"] = specialized
    entry["single_player_cell"] = bool(manifest.get("single_player_cell", False))
    map_path = repository / str(record.get("map", ""))
    if map_path.is_file():
        fixed_rom, generated_bank, _static_wram = map_usage(map_path)
        entry["rom_bytes"] = fixed_rom + generated_bank
        entry["linked_fixed_rom_bytes"] = fixed_rom
        entry["linked_generated_rom_bank_bytes"] = generated_bank
    else:
        entry["rom_bytes"] = rom_path.stat().st_size
    if not specialized:
        entry["fallback_reason"] = SPECIALIZED_FALLBACK_UNSUPPORTED
        if "specialized_turn" not in manifest:
            entry["fallback_reason"] = "manifest_missing_specialized_turn"

    fixture = SOLUTION_FIXTURES.get(record["slug"])
    if fixture is None or bench_binary is None:
        return entry

    fixture_path = repository / fixture
    if not fixture_path.is_file():
        return entry

    process = subprocess.run(
        [
            str(bench_binary),
            "--fixture",
            str(fixture_path),
            "--iterations",
            "1",
        ],
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        entry["fallback_reason"] = entry["fallback_reason"] or "solution_replay_failed"
        return entry

    bench = json.loads(process.stdout)
    entry.update(
        {
            "replay_turns": int(bench.get("replay_turns", 0)),
            "mean_ms_per_turn": float(bench.get("mean_ms_per_turn", 0.0)),
            "pct_le_50ms": float(bench.get("pct_le_50ms", 0.0)),
            "pct_le_80ms": float(bench.get("pct_le_80ms", 0.0)),
            "timing_source": bench.get("timing_source"),
        }
    )
    return entry


def write_specialized_scoreboard(
    repository: Path,
    out_root: Path,
    records: list[dict[str, Any]],
    build_dir: Path,
) -> Path:
    bench_binary = find_bench_binary(repository, build_dir)
    games = [
        scoreboard_entry_from_record(record, repository, bench_binary)
        for record in records
    ]
    scoreboard = {
        "format": "puzzlescript-gbc-specialized-scoreboard-v1",
        "summary": {
            "games": len(games),
            "specialized": sum(1 for game in games if game["specialized"]),
            "single_player_cell": sum(
                1 for game in games if game.get("single_player_cell")
            ),
            "with_replay_timing": sum(
                1 for game in games if game.get("mean_ms_per_turn") is not None
            ),
        },
        "games": games,
    }
    scoreboard_path = out_root / "specialized-scoreboard.json"
    write_report(scoreboard_path, scoreboard)
    return scoreboard_path


def load_existing_records(out_root: Path, repository: Path) -> list[dict[str, Any]]:
    report_path = out_root / "rom-build-report.json"
    if not report_path.is_file():
        raise SystemExit(f"missing build report: {report_path}")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    records = list(report.get("games", []))
    for slug, _relative_source in ELIGIBLE_GAMES:
        if any(record.get("slug") == slug for record in records):
            continue
        game_out = out_root / slug
        manifest = game_out / "gbc_manifest.json"
        rom = game_out / f"{slug}.gb"
        if manifest.is_file() and rom.is_file():
            records.append(
                {
                    "slug": slug,
                    "source": next(
                        source for name, source in ELIGIBLE_GAMES if name == slug
                    ),
                    "success": True,
                    "manifest": str(manifest.relative_to(repository)).replace("\\", "/"),
                    "rom": str(rom.relative_to(repository)).replace("\\", "/"),
                }
            )
    return records


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Rebuild production GBC ROMs for the 14 documented compatible "
            "good_games (strict + cull-oversize)."
        )
    )
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Artifact directory (default: <repo>/build/gbc/eligible)",
    )
    parser.add_argument("--make", type=Path)
    parser.add_argument("--gbdk-home", type=Path)
    parser.add_argument("--compiler", type=Path)
    parser.add_argument(
        "--cull",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Pass --cull-oversize-levels to export-gbc (default: on)",
    )
    parser.add_argument(
        "--continue",
        dest="continue_on_error",
        action="store_true",
        help="Build remaining games after a failure; still exit non-zero",
    )
    parser.add_argument(
        "--scoreboard-only",
        action="store_true",
        help="Regenerate specialized-scoreboard.json from existing eligible artifacts",
    )
    parser.add_argument(
        "--build-dir",
        type=Path,
        default=Path("build"),
        help="CMake build directory for optional host replay bench binary",
    )
    args = parser.parse_args()

    repository = args.repository.resolve()
    out_root = (args.out or (repository / "build" / "gbc" / "eligible")).resolve()
    build_dir = (
        repository / args.build_dir
        if not args.build_dir.is_absolute()
        else args.build_dir
    )

    if args.scoreboard_only:
        records = load_existing_records(out_root, repository)
        scoreboard_path = write_specialized_scoreboard(
            repository, out_root, records, build_dir.resolve()
        )
        print(f"wrote {relpath(scoreboard_path, repository)}", flush=True)
        return 0

    make = args.make or find_make()
    compiler = find_compiler(repository, args.compiler)
    gbdk_home = args.gbdk_home
    if gbdk_home is None:
        env_home = os.environ.get("GBDK_HOME") or os.environ.get("GBDK")
        if env_home:
            gbdk_home = Path(env_home)
        else:
            candidate = repository / ".codex_tmp" / "toolchains" / "gbdk"
            gbdk_home = candidate if candidate.is_dir() else None

    if make is None or not make.is_file():
        raise SystemExit("GNU make was not found")
    if not compiler.is_file():
        raise SystemExit(f"PuzzleScript compiler was not found: {compiler}")
    if gbdk_home is None or not gbdk_home.is_dir():
        raise SystemExit("GBDK was not found; set --gbdk-home or GBDK_HOME")

    firmware = repository / "firmware" / "gbc"
    rom_path = firmware / "puzzlescript_gbc.gb"
    map_path = firmware / "puzzlescript_gbc.map"
    manifest_path = firmware / "generated" / "gbc_manifest.json"
    out_root.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    failures = 0

    for index, (slug, relative_source) in enumerate(ELIGIBLE_GAMES, start=1):
        source = repository / relative_source
        game_out = out_root / slug
        log_path = game_out / "build.log"
        record: dict[str, Any] = {
            "index": index,
            "name": Path(relative_source).stem,
            "slug": slug,
            "source": relative_source.replace("\\", "/"),
            "success": False,
        }

        if not source.is_file():
            record["error"] = f"source not found: {source}"
            records.append(record)
            failures += 1
            print(f"[{index}/{len(ELIGIBLE_GAMES)}] missing {slug}", flush=True)
            if not args.continue_on_error:
                break
            continue

        print(
            f"[{index}/{len(ELIGIBLE_GAMES)}] build {slug}"
            + (" (cull)" if args.cull else " (strict)"),
            flush=True,
        )
        game_out.mkdir(parents=True, exist_ok=True)
        command = [
            str(make),
            "-B",
            "-C",
            str(firmware),
            f"GAME={source.as_posix()}",
            f"GBDK_HOME={gbdk_home.as_posix()}",
            f"PUZZLESCRIPT_CPP={compiler.as_posix()}",
            f"PYTHON={Path(sys.executable).as_posix()}",
        ]
        if args.cull:
            command.append("EXPORT_GBC_FLAGS=--cull-oversize-levels")
        else:
            command.append("EXPORT_GBC_FLAGS=")

        process = subprocess.run(
            command,
            cwd=repository,
            capture_output=True,
            text=True,
        )
        log_path.write_text(process.stdout + process.stderr, encoding="utf-8")
        record["log"] = relpath(log_path, repository)

        if process.returncode != 0:
            record["error"] = f"build failed; see {record['log']}"
            records.append(record)
            failures += 1
            print(f"[{index}/{len(ELIGIBLE_GAMES)}] FAIL {slug}", flush=True)
            if not args.continue_on_error:
                break
            continue

        missing = [
            artifact
            for artifact in (rom_path, map_path, manifest_path)
            if not artifact.is_file()
        ]
        if missing:
            record["error"] = f"missing artifact after build: {missing[0]}"
            records.append(record)
            failures += 1
            print(f"[{index}/{len(ELIGIBLE_GAMES)}] FAIL {slug}", flush=True)
            if not args.continue_on_error:
                break
            continue

        shutil.copy2(rom_path, game_out / f"{slug}.gb")
        shutil.copy2(map_path, game_out / f"{slug}.map")
        shutil.copy2(manifest_path, game_out / "gbc_manifest.json")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        record.update(
            {
                "success": True,
                "rom": relpath(game_out / f"{slug}.gb", repository),
                "map": relpath(game_out / f"{slug}.map", repository),
                "manifest": relpath(game_out / "gbc_manifest.json", repository),
                "source_level_count": int(manifest.get("source_level_count", 0)),
                "level_count": int(manifest.get("level_count", 0)),
                "board_level_count": int(manifest.get("board_level_count", 0)),
                "source_board_level_count": int(
                    manifest.get("source_board_level_count", 0)
                ),
                "culled_level_count": int(manifest.get("culled_level_count", 0)),
                "culled_level_indices": list(manifest.get("culled_level_indices", [])),
                "specialized_turn": bool(manifest.get("specialized_turn", False)),
                "single_player_cell": bool(manifest.get("single_player_cell", False)),
                "rom_bytes": (game_out / f"{slug}.gb").stat().st_size,
                "fallback_reason": (
                    None
                    if manifest.get("specialized_turn")
                    else SPECIALIZED_FALLBACK_UNSUPPORTED
                ),
            }
        )
        records.append(record)
        print(
            f"[{index}/{len(ELIGIBLE_GAMES)}] ok {slug}"
            f" culled={record['culled_level_count']}"
            f" boards={record['board_level_count']}/"
            f"{record['source_board_level_count']}",
            flush=True,
        )

    report = {
        "format": "puzzlescript-gbc-eligible-roms-v1",
        "cull_oversize_levels": args.cull,
        "compiler": str(compiler),
        "gbdk_home": str(gbdk_home),
        "out": relpath(out_root, repository),
        "summary": {
            "games": len(ELIGIBLE_GAMES),
            "attempted": len(records),
            "successful": sum(1 for record in records if record["success"]),
            "failed": failures,
        },
        "games": records,
    }
    report_path = out_root / "rom-build-report.json"
    write_report(report_path, report)
    scoreboard_path = write_specialized_scoreboard(
        repository, out_root, records, build_dir.resolve()
    )
    successful = report["summary"]["successful"]
    out_display = relpath(out_root, repository)
    print(f"wrote {relpath(report_path, repository)}", flush=True)
    print(f"wrote {relpath(scoreboard_path, repository)}", flush=True)
    print(
        f"ROMs: {successful}/{len(ELIGIBLE_GAMES)} under {out_display}/"
        f" (<slug>/<slug>.gb)",
        flush=True,
    )
    return 1 if failures else 0


if __name__ == "__main__":
    # Allow GBC_CULL=0 / GBC_CONTINUE=1 from the environment when Make wraps us.
    if "--cull" not in sys.argv and "--no-cull" not in sys.argv:
        if not truthy(os.environ.get("GBC_CULL", "1")):
            sys.argv.append("--no-cull")
    if "--continue" not in sys.argv and truthy(os.environ.get("GBC_CONTINUE")):
        sys.argv.append("--continue")
    raise SystemExit(main())
