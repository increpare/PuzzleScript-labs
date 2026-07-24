#!/usr/bin/env python3
"""Build a specialized GBC ROM and bench solution-replay turn timing."""

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


DEFAULT_GAME = "src/demo/sokoban_basic.txt"
DEFAULT_SLUG = "sokoban_basic"
DEFAULT_FIXTURE = (
    "native/tests/fixtures/gbc_sokoban_basic_solution.txt"
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
    for candidate in (
        repository / "build" / "native" / "puzzlescript_cpp",
        repository / "build" / "native" / "puzzlescript_cpp.exe",
        repository / "build" / "native" / "Release" / "puzzlescript_cpp.exe",
    ):
        if candidate.is_file():
            return candidate
    return repository / "build" / "native" / "puzzlescript_cpp"


def find_bench_binary(repository: Path, build_dir: Path) -> Path:
    for candidate in (
        build_dir / "native" / "puzzlescript_gbc_solution_replay_bench",
        build_dir / "native" / "Release" / "puzzlescript_gbc_solution_replay_bench.exe",
        build_dir / "native" / "puzzlescript_gbc_solution_replay_bench.exe",
    ):
        if candidate.is_file():
            return candidate
    return build_dir / "native" / "puzzlescript_gbc_solution_replay_bench"


def resolve_gbdk(repository: Path, explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit
    env = os.environ.get("GBDK_HOME") or os.environ.get("GBDK")
    if env:
        return Path(env)
    candidate = repository / ".codex_tmp" / "toolchains" / "gbdk"
    if candidate.is_dir():
        return candidate
    raise SystemExit("GBDK was not found; set --gbdk-home or GBDK_HOME")


def load_manifest(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def run_host_bench(
    bench_binary: Path,
    fixture: Path,
    iterations: int,
) -> dict[str, Any]:
    process = subprocess.run(
        [
            str(bench_binary),
            "--fixture",
            str(fixture),
            "--iterations",
            str(iterations),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(process.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--game", type=Path, default=Path(DEFAULT_GAME))
    parser.add_argument("--slug", default=DEFAULT_SLUG)
    parser.add_argument("--fixture", type=Path, default=Path(DEFAULT_FIXTURE))
    parser.add_argument("--out", type=Path)
    parser.add_argument("--build-dir", type=Path, default=Path("build"))
    parser.add_argument("--make", type=Path)
    parser.add_argument("--gbdk-home", type=Path)
    parser.add_argument("--compiler", type=Path)
    parser.add_argument("--cmake", type=Path, default=Path("cmake"))
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()

    repository = args.repository.resolve()
    game = (repository / args.game).resolve() if not args.game.is_absolute() else args.game
    fixture = (
        repository / args.fixture
        if not args.fixture.is_absolute()
        else args.fixture
    )
    build_dir = (
        repository / args.build_dir
        if not args.build_dir.is_absolute()
        else args.build_dir
    )
    out_path = args.out or (
        repository / "build" / "gbc" / "bench" / f"{args.slug}-solution-replay.json"
    )
    out_path = out_path.resolve()

    if not game.is_file():
        raise SystemExit(f"game source was not found: {game}")
    if not fixture.is_file():
        raise SystemExit(f"solution fixture was not found: {fixture}")

    make = args.make or find_make()
    compiler = find_compiler(repository, args.compiler)
    gbdk_home = resolve_gbdk(repository, args.gbdk_home)
    if make is None or not make.is_file():
        raise SystemExit("GNU make was not found")
    if not compiler.is_file():
        raise SystemExit(f"PuzzleScript compiler was not found: {compiler}")

    firmware = repository / "firmware" / "gbc"
    rom_path = firmware / "puzzlescript_gbc.gb"
    map_path = firmware / "puzzlescript_gbc.map"
    manifest_path = firmware / "generated" / "gbc_manifest.json"

    if not args.skip_build:
        cmake = args.cmake
        subprocess.run(
            [str(cmake), "-S", str(repository), "-B", str(build_dir)],
            check=True,
        )
        subprocess.run(
            [
                str(cmake),
                "--build",
                str(build_dir),
                "--target",
                "puzzlescript_gbc_solution_replay_bench",
            ],
            check=True,
        )
        build_log = out_path.parent / f"{args.slug}.build.log"
        build_log.parent.mkdir(parents=True, exist_ok=True)
        command = [
            str(make),
            "-B",
            "-C",
            str(firmware),
            f"GAME={game.as_posix()}",
            f"GBDK_HOME={gbdk_home.as_posix()}",
            f"PUZZLESCRIPT_CPP={compiler.as_posix()}",
            f"PYTHON={Path(sys.executable).as_posix()}",
        ]
        process = subprocess.run(
            command,
            cwd=repository,
            capture_output=True,
            text=True,
        )
        build_log.write_text(process.stdout + process.stderr, encoding="utf-8")
        if process.returncode != 0:
            raise SystemExit(f"GBC ROM build failed; see {build_log}")

    if not rom_path.is_file() or not manifest_path.is_file():
        raise SystemExit("GBC ROM or manifest missing after build")

    bench_binary = find_bench_binary(repository, build_dir)
    if not bench_binary.is_file():
        raise SystemExit(f"host bench binary was not found: {bench_binary}")

    result = run_host_bench(bench_binary, fixture, args.iterations)
    manifest = load_manifest(manifest_path)
    fixed_rom, generated_bank, static_wram = map_usage(map_path)
    result.update(
        {
            "game": str(game.relative_to(repository)).replace("\\", "/"),
            "fixture": str(fixture.relative_to(repository)).replace("\\", "/"),
            "source_hash": int(manifest.get("source_hash", 0)),
            "specialized_turn": bool(manifest.get("specialized_turn", False)),
            "single_player_cell": bool(manifest.get("single_player_cell", False)),
            "rom_bytes": rom_path.stat().st_size,
            "linked_fixed_rom_bytes": fixed_rom,
            "linked_generated_rom_bank_bytes": generated_bank,
            "linked_static_wram_bytes": static_wram,
            "manifest_path": str(
                manifest_path.relative_to(repository)
            ).replace("\\", "/"),
            "rom_path": str(rom_path.relative_to(repository)).replace("\\", "/"),
            "map_path": str(map_path.relative_to(repository)).replace("\\", "/"),
            "estimated_game_rom_bank_bytes": int(
                manifest.get("estimated_game_rom_bank_bytes", 0)
            ),
            "estimated_session_bytes": int(
                manifest.get("estimated_session_bytes", 0)
            ),
        }
    )
    result["specialized"] = bool(result.get("specialized_turn", False))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out_path}", flush=True)
    print(
        f"mean_ms_per_turn={result['mean_ms_per_turn']:.3f} "
        f"pct_le_50ms={result['pct_le_50ms']:.1f}% "
        f"pct_le_80ms={result['pct_le_80ms']:.1f}% "
        f"won={result['won']}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
