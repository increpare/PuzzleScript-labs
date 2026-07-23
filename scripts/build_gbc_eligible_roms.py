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
    args = parser.parse_args()

    repository = args.repository.resolve()
    out_root = (args.out or (repository / "build" / "gbc" / "eligible")).resolve()
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
    print(f"wrote {report_path}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    # Allow GBC_CULL=0 / GBC_CONTINUE=1 from the environment when Make wraps us.
    if "--cull" not in sys.argv and "--no-cull" not in sys.argv:
        if not truthy(os.environ.get("GBC_CULL", "1")):
            sys.argv.append("--no-cull")
    if "--continue" not in sys.argv and truthy(os.environ.get("GBC_CONTINUE")):
        sys.argv.append("--continue")
    raise SystemExit(main())
