#!/usr/bin/env python3
"""Multi-level eligible GBC solution benches with before/after speed and size.

For each eligible game:
  1. export-gbc (cull oversize boards)
  2. solve up to N retained board levels via puzzlescript_solver --json
  3. host-replay each solved level on interpreter (before) and specialized (after)
  4. link baseline vs specialized cartridges and compare map code sizes

Host timings are wall-clock of the GBC core on desktop — not cart/mGBA.
ROM size uses linked fixed+banked code bytes from the .map (not padded .gb).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_gbc_rom import map_banked_sizes, map_usage  # noqa: E402

# Keep in sync with build_gbc_eligible_roms.py
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
    ("all-green-and-blue-on-yellow", "src/tests/good_games/All Green and Blue on Yellow.txt"),
    ("all-green-to-blue", "src/tests/good_games/ALL GREEN TO BLUE.txt"),
    ("attractor-net", "src/tests/good_games/Attractor Net.txt"),
    ("chevron-lodger", "src/tests/good_games/Chevron Lodger.txt"),
    ("crate-guardian", "src/tests/good_games/crate guardian.txt"),
    ("crate-swap", "src/tests/good_games/crate swap.txt"),
    ("don't-let-your-goals-slip-away", "src/tests/good_games/Don't let your goals slip away.txt"),
    ("explodoban", "src/tests/good_games/Explodoban.txt"),
    ("flesh-handed-hot-casserole-delivery-bot", "src/tests/good_games/flesh-handed hot casserole delivery bot.txt"),
    ("hedgehog-stimulator", "src/tests/good_games/hedgehog stimulator.txt"),
    ("m-c-eschers-armageddon", "src/tests/good_games/m c eschers armageddon.txt"),
    ("match-maker", "src/tests/good_games/Match-Maker.txt"),
    ("muraphilic-monophobic-multiban", "src/tests/good_games/Muraphilic Monophobic Multiban.txt"),
    ("resin-caster", "src/tests/good_games/Resin-Caster.txt"),
    ("slime-vat-filler", "src/tests/good_games/slime vat filler.txt"),
    ("the-monsterous-autoshove", "src/tests/good_games/The Monsterous Autoshove.txt"),
    ("the-red-ring-of-immortality", "src/tests/good_games/The Red Ring of Immortality.txt"),
    ("two-step-pete", "src/tests/good_games/Two-Step Pete.txt"),
    ("unclean-residues", "src/tests/good_games/unclean residues.txt"),
    ("an-ok-multiban-level", "src/tests/good_games/an ok multiban level.txt"),
    ("head-skuller", "src/tests/good_games/head skuller.txt"),
    ("nightmarecroban", "src/tests/good_games/NIGHTMARECROBAN.txt"),
    ("pipe-puffer", "src/tests/good_games/pipe puffer.txt"),
    ("sokobond-demake", "src/tests/good_games/sokobond demake.txt"),
)


def find_solver(repository: Path) -> Path:
    for candidate in (
        repository / "build" / "native" / "puzzlescript_solver",
        repository / "build" / "native" / "puzzlescript_solver.exe",
    ):
        if candidate.is_file():
            return candidate
    raise SystemExit("puzzlescript_solver not found; build it first")


def find_compiler(repository: Path) -> Path:
    for candidate in (
        repository / "build" / "native" / "puzzlescript_cpp",
        repository / "build" / "native" / "puzzlescript_cpp.exe",
    ):
        if candidate.is_file():
            return candidate
    raise SystemExit("puzzlescript_cpp not found; build it first")


def find_make() -> Path:
    executable = shutil.which("make") or shutil.which("make.exe")
    if not executable:
        raise SystemExit("GNU make was not found")
    return Path(executable)


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


def write_fixture(tokens: list[str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(tokens) + ("\n" if tokens else ""), encoding="utf-8")


_LEVELS_HEADER_RE = re.compile(
    r"(?im)^([ \t]*=+[ \t]*\n[ \t]*LEVELS[ \t]*\n[ \t]*=+[ \t]*\n)"
)


def puzzlescript_preamble(source_text: str) -> str:
    match = _LEVELS_HEADER_RE.search(source_text)
    if match is None:
        raise RuntimeError("source has no LEVELS section")
    return source_text[: match.end()]


def extract_board_lines_via_ir(
    compiler: Path,
    source_path: Path,
    source_level_index: int,
) -> list[str]:
    """Return map rows for a board level using compiler IR line numbers.

    Blank-line LEVELS splitting is unreliable (message+map often share a
    block). IR `line_number` points at the first map row of board levels.
    """
    process = subprocess.run(
        [str(compiler), "compile", str(source_path), "--emit-ir-json"],
        capture_output=True,
        text=True,
    )
    if process.returncode != 0 or not process.stdout.strip():
        raise RuntimeError(
            f"compile --emit-ir-json failed for {source_path.name}: "
            f"{process.stderr or process.stdout or f'exit {process.returncode}'}"
        )
    payload = json.loads(process.stdout)
    levels = payload.get("game", {}).get("levels")
    if not isinstance(levels, list):
        raise RuntimeError(f"IR missing levels for {source_path.name}")
    if source_level_index < 0 or source_level_index >= len(levels):
        raise RuntimeError(
            f"source level {source_level_index} out of range "
            f"(IR has {len(levels)} levels in {source_path.name})"
        )
    level = levels[source_level_index]
    kind = str(level.get("kind") or "")
    if kind != "level":
        raise RuntimeError(
            f"source level {source_level_index} is {kind or 'non-board'} "
            f"(expected a board level)"
        )
    line_number = level.get("line_number")
    if not isinstance(line_number, int) or line_number < 1:
        raise RuntimeError(
            f"source level {source_level_index} missing IR line_number"
        )
    lines = source_path.read_text(encoding="utf-8").splitlines()
    start = line_number - 1
    if start >= len(lines):
        raise RuntimeError(
            f"IR line_number {line_number} past EOF in {source_path.name}"
        )
    height = level.get("height")
    board: list[str] = []
    for index in range(start, len(lines)):
        row = lines[index]
        if row.strip() == "":
            break
        lower = row.lstrip().lower()
        if lower.startswith("message"):
            break
        board.append(row)
        if isinstance(height, int) and height > 0 and len(board) >= height:
            break
    if not board:
        raise RuntimeError(
            f"no map rows at line {line_number} for level {source_level_index}"
        )
    return board


def write_single_level_solve_game(
    compiler: Path,
    source_path: Path,
    source_level_index: int,
    out_path: Path,
) -> None:
    """Write a one-level game containing only the retained board to solve.

    Solvers then use --level 0, which matches GBC board ordinal replay after
    messages are skipped by loadBoardByOrdinal.
    """
    source_text = source_path.read_text(encoding="utf-8")
    preamble = puzzlescript_preamble(source_text)
    board_lines = extract_board_lines_via_ir(
        compiler, source_path, source_level_index
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        preamble + "\n".join(board_lines) + "\n",
        encoding="utf-8",
    )


def solve_level_json(
    solver: Path,
    corpus: Path,
    game_name: str,
    level: int,
    timeout_ms: int,
) -> dict[str, Any]:
    cmd = [
        str(solver),
        str(corpus),
        "--game",
        game_name,
        "--level",
        str(level),
        "--timeout-ms",
        str(timeout_ms),
        "--jobs",
        "1",
        "--no-solutions",
        "--json",
        "--quiet",
    ]
    process = subprocess.run(cmd, capture_output=True, text=True)
    if not process.stdout.strip():
        raise RuntimeError(
            f"solver produced no JSON for {game_name} level {level}: "
            f"{process.stderr or process.stdout or f'exit {process.returncode}'}"
        )
    payload = json.loads(process.stdout)
    results = payload.get("results") if isinstance(payload, dict) else payload
    if not isinstance(results, list) or not results:
        raise RuntimeError(f"unexpected solver JSON for {game_name} level {level}")
    return results[0]


def solve_retained_board_json(
    solver: Path,
    compiler: Path,
    source_path: Path,
    source_level_index: int,
    timeout_ms: int,
    work_dir: Path,
) -> dict[str, Any]:
    """Solve the culled/retained board by building a one-level temp corpus game."""
    corpus = work_dir / "culled_solver_corpus"
    corpus.mkdir(parents=True, exist_ok=True)
    game_name = "retained_board.txt"
    write_single_level_solve_game(
        compiler, source_path, source_level_index, corpus / game_name
    )
    return solve_level_json(solver, corpus, game_name, 0, timeout_ms)


def parse_generated_level_kinds(generated_game_c: Path) -> list[str]:
    text = generated_game_c.read_text(encoding="utf-8", errors="replace")
    kinds: list[str] = []
    for match in re.finditer(r"\{(PS_GBC_LEVEL_(?:BOARD|MESSAGE))", text):
        kinds.append("board" if match.group(1).endswith("BOARD") else "message")
    return kinds


def retained_board_source_levels(
    source_level_count: int,
    culled_level_indices: list[int],
    generated_game_c: Path,
) -> list[int]:
    """Return source level indices for retained boards, in cartridge board order."""
    kinds = parse_generated_level_kinds(generated_game_c)
    culled = set(int(index) for index in culled_level_indices)
    boards: list[int] = []
    gbc_index = 0
    for source_level in range(source_level_count):
        if source_level in culled:
            continue
        if gbc_index >= len(kinds):
            break
        kind = kinds[gbc_index]
        gbc_index += 1
        if kind == "board":
            boards.append(source_level)
    return boards


def export_gbc(
    compiler: Path,
    source: Path,
    out_dir: Path,
    cull: bool,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [str(compiler), "export-gbc", str(source), "--out", str(out_dir)]
    if cull:
        cmd.append("--cull-oversize-levels")
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(process.stderr or process.stdout or "export-gbc failed")
    return json.loads((out_dir / "gbc_manifest.json").read_text(encoding="utf-8"))


def compile_host_benches(
    repository: Path,
    generated_dir: Path,
    work_dir: Path,
) -> tuple[Path, Path]:
    """Compile interpreter and specialized host bench binaries for one export."""
    cxx = shutil.which("c++") or shutil.which("clang++") or shutil.which("g++")
    cc = shutil.which("cc") or shutil.which("clang") or shutil.which("gcc")
    if cxx is None or cc is None:
        raise RuntimeError("no C/C++ compiler found")

    common_sources = [
        repository / "native" / "tests" / "gbc_solution_replay_bench.cpp",
        repository / "native" / "src" / "gbc" / "core.c",
        repository / "native" / "src" / "gbc" / "compact_facade.c",
        repository / "native" / "src" / "gbc" / "facade_rules.c",
        generated_dir / "generated_game.c",
    ]
    specialized_extras = sorted(generated_dir.glob("generated_specialized_turn*.c"))
    if not specialized_extras:
        raise RuntimeError("missing generated_specialized_turn*.c")

    def compile_variant(name: str, specialized: bool) -> Path:
        sources = list(common_sources)
        if specialized:
            # Multi-bank exports emit generated_specialized_turn.c plus
            # generated_specialized_turn_rules_N.c pack bodies.
            sources.extend(specialized_extras)
        objs: list[Path] = []
        defs = ["-DPS_GBC_GENERATED_BUILD=1"]
        if specialized:
            defs.append("-DPS_GBC_HAS_SPECIALIZED_TURN=1")
        for path in sources:
            obj = work_dir / f"{name}_{path.name}.o"
            if path.suffix == ".cpp":
                cmd = [
                    cxx,
                    "-std=c++17",
                    "-O2",
                    f"-DPS_REPO_ROOT=\"{repository.as_posix()}\"",
                    *defs,
                    f"-I{generated_dir}",
                    f"-I{repository / 'native' / 'include'}",
                    f"-I{repository / 'native' / 'src' / 'gbc'}",
                    "-c",
                    str(path),
                    "-o",
                    str(obj),
                ]
            else:
                cmd = [
                    cc,
                    "-std=c11",
                    "-O2",
                    *defs,
                    f"-I{generated_dir}",
                    f"-I{repository / 'native' / 'include'}",
                    f"-I{repository / 'native' / 'src' / 'gbc'}",
                    "-c",
                    str(path),
                    "-o",
                    str(obj),
                ]
            process = subprocess.run(cmd, capture_output=True, text=True)
            if process.returncode != 0:
                raise RuntimeError(
                    f"compile failed ({name}) {path.name}:\n"
                    f"{process.stderr or process.stdout}"
                )
            objs.append(obj)
        binary = work_dir / name
        link = subprocess.run(
            [cxx, "-O2", *[str(obj) for obj in objs], "-o", str(binary)],
            capture_output=True,
            text=True,
        )
        if link.returncode != 0:
            raise RuntimeError(f"link failed ({name}):\n{link.stderr or link.stdout}")
        return binary

    baseline = compile_variant("host_bench_baseline", specialized=False)
    specialized = compile_variant("host_bench_specialized", specialized=True)
    return baseline, specialized


def run_host_bench(
    binary: Path,
    fixture: Path,
    slug: str,
    board_index: int,
    iterations: int = 3,
) -> dict[str, Any]:
    run = subprocess.run(
        [
            str(binary),
            "--fixture",
            str(fixture),
            "--slug",
            slug,
            "--board-index",
            str(board_index),
            "--iterations",
            str(iterations),
        ],
        capture_output=True,
        text=True,
    )
    if run.returncode != 0:
        raise RuntimeError(f"bench failed:\n{run.stderr or run.stdout}")
    return json.loads(run.stdout)


def stage_generated(firmware: Path, export_dir: Path, include_specialized: bool) -> None:
    generated = firmware / "generated"
    if generated.exists():
        shutil.rmtree(generated)
    generated.mkdir(parents=True)
    for name in (
        "generated_game.c",
        "generated_game.h",
        "gbc_manifest.json",
    ):
        shutil.copy2(export_dir / name, generated / name)
    specialized = export_dir / "generated_specialized_turn.c"
    if include_specialized and specialized.is_file():
        shutil.copy2(specialized, generated / "generated_specialized_turn.c")


def build_rom_from_staged(
    repository: Path,
    make: Path,
    gbdk_home: Path,
    compiler: Path,
    firmware: Path,
    out_dir: Path,
    slug: str,
    label: str,
) -> dict[str, Any]:
    # Force clean objects so HAS_SPECIALIZED is re-evaluated.
    build_dir = firmware / "build"
    if build_dir.exists():
        shutil.rmtree(build_dir)
    for stale in firmware.glob("puzzlescript_gbc.*"):
        stale.unlink()

    command = [
        str(make),
        "-C",
        str(firmware),
        "build-rom",
        "SKIP_EXPORT=1",
        f"GBDK_HOME={gbdk_home.as_posix()}",
        f"PUZZLESCRIPT_CPP={compiler.as_posix()}",
        f"PYTHON={Path(sys.executable).as_posix()}",
    ]
    process = subprocess.run(command, cwd=repository, capture_output=True, text=True)
    log_path = out_dir / f"rom-{label}.log"
    log_path.write_text(process.stdout + process.stderr, encoding="utf-8")
    if process.returncode != 0:
        raise RuntimeError(f"ROM build ({label}) failed; see {log_path}")

    rom_src = firmware / "puzzlescript_gbc.gb"
    map_src = firmware / "puzzlescript_gbc.map"
    rom_dst = out_dir / f"{slug}-{label}.gb"
    map_dst = out_dir / f"{slug}-{label}.map"
    shutil.copy2(rom_src, rom_dst)
    shutil.copy2(map_src, map_dst)

    fixed, banked_sum, wram = map_usage(map_dst)
    banks = map_banked_sizes(map_dst)
    return {
        "rom": str(rom_dst.relative_to(repository)),
        "map": str(map_dst.relative_to(repository)),
        "padded_rom_bytes": rom_dst.stat().st_size,
        "fixed_rom_bytes": fixed,
        "banked_rom_bytes": banked_sum,
        "linked_code_bytes": fixed + banked_sum,
        "bank_sizes": banks,
        "static_wram_bytes": wram,
        "log": str(log_path.relative_to(repository)),
    }


def pct_speedup(before_ms: float, after_ms: float) -> float | None:
    if before_ms <= 0:
        return None
    return 100.0 * (before_ms - after_ms) / before_ms


def weighted_mean(rows: list[dict[str, Any]], key: str) -> float | None:
    total_turns = 0
    total = 0.0
    for row in rows:
        turns = int(row.get("replay_turns") or 0)
        value = row.get(key)
        if turns <= 0 or value is None:
            continue
        total_turns += turns
        total += float(value) * turns
    if total_turns == 0:
        return None
    return total / total_turns


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("build/gbc/eligible/solution-bench-compare.json"),
    )
    parser.add_argument(
        "--export-dir",
        type=Path,
        default=Path("build/gbc/eligible/host-exports"),
    )
    parser.add_argument(
        "--fixtures-dir",
        type=Path,
        default=Path("build/gbc/eligible/solution-fixtures"),
    )
    parser.add_argument(
        "--rom-dir",
        type=Path,
        default=Path("build/gbc/eligible/rom-compare"),
    )
    parser.add_argument(
        "--solver-corpus",
        type=Path,
        default=Path("src/tests/solver_tests"),
    )
    parser.add_argument("--timeout-ms", type=int, default=60000)
    parser.add_argument(
        "--max-levels",
        type=int,
        default=5,
        help="Max retained board levels to solve/bench per game (0 = all)",
    )
    parser.add_argument(
        "--skip-rom",
        action="store_true",
        help="Skip baseline/specialized cartridge rebuilds",
    )
    parser.add_argument(
        "--reuse-fixtures",
        action="store_true",
        help="Reuse existing solution fixtures when present (skip solver)",
    )
    parser.add_argument("--gbdk-home", type=Path)
    parser.add_argument("--cull", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--slug", action="append", default=[])
    args = parser.parse_args()

    repository = args.repository.resolve()
    solver = find_solver(repository)
    compiler = find_compiler(repository)
    make = find_make()
    gbdk_home = resolve_gbdk(repository, args.gbdk_home)
    corpus = (repository / args.solver_corpus).resolve()
    export_root = (repository / args.export_dir).resolve()
    fixtures_root = (repository / args.fixtures_dir).resolve()
    rom_root = (repository / args.rom_dir).resolve()
    out_path = (repository / args.out).resolve()
    firmware = repository / "firmware" / "gbc"

    wanted = set(args.slug)
    games = [
        (slug, source)
        for slug, source in ELIGIBLE_GAMES
        if not wanted or slug in wanted
    ]

    results: list[dict[str, Any]] = []
    for index, (slug, relative_source) in enumerate(games, start=1):
        entry: dict[str, Any] = {
            "slug": slug,
            "source": relative_source,
            "success": False,
            "levels": [],
        }
        print(f"[{index}/{len(games)}] {slug}", flush=True)
        source = repository / relative_source
        game_name = Path(relative_source).name
        if not source.is_file():
            entry["error"] = "source missing"
            results.append(entry)
            continue
        if not (corpus / game_name).is_file():
            entry["error"] = f"solver corpus missing: {game_name}"
            results.append(entry)
            continue

        export_dir = export_root / slug
        try:
            manifest = export_gbc(compiler, source, export_dir, args.cull)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"export failed: {exc}"
            results.append(entry)
            print(f"  FAIL export: {exc}", flush=True)
            continue

        entry["specialized_turn"] = bool(manifest.get("specialized_turn"))
        entry["single_player_cell"] = bool(manifest.get("single_player_cell"))
        entry["culled_level_indices"] = list(manifest.get("culled_level_indices") or [])
        entry["source_level_count"] = int(manifest.get("source_level_count") or 0)
        entry["board_level_count"] = int(manifest.get("board_level_count") or 0)
        if not entry["specialized_turn"]:
            entry["error"] = "specialized_turn_false"
            results.append(entry)
            print("  FAIL not specialized", flush=True)
            continue

        boards = retained_board_source_levels(
            entry["source_level_count"],
            entry["culled_level_indices"],
            export_dir / "generated_game.c",
        )
        if args.max_levels > 0:
            boards = boards[: args.max_levels]
        entry["retained_boards_attempted"] = boards
        print(
            f"  retained boards to try: {boards} "
            f"(cart boards={entry['board_level_count']})",
            flush=True,
        )

        if not args.skip_rom:
            rom_out = rom_root / slug
            rom_out.mkdir(parents=True, exist_ok=True)
            try:
                stage_generated(firmware, export_dir, include_specialized=False)
                entry["rom_baseline"] = build_rom_from_staged(
                    repository,
                    make,
                    gbdk_home,
                    compiler,
                    firmware,
                    rom_out,
                    slug,
                    "baseline",
                )
                stage_generated(firmware, export_dir, include_specialized=True)
                entry["rom_specialized"] = build_rom_from_staged(
                    repository,
                    make,
                    gbdk_home,
                    compiler,
                    firmware,
                    rom_out,
                    slug,
                    "specialized",
                )
                before = entry["rom_baseline"]["linked_code_bytes"]
                after = entry["rom_specialized"]["linked_code_bytes"]
                entry["rom_delta_bytes"] = after - before
                entry["rom_delta_pct"] = (
                    None if before <= 0 else 100.0 * (after - before) / before
                )
                print(
                    f"  ROM linked code: {before} -> {after} "
                    f"({entry['rom_delta_bytes']:+d} B, "
                    f"{entry['rom_delta_pct']:+.1f}%)",
                    flush=True,
                )
            except Exception as exc:  # noqa: BLE001
                entry["rom_error"] = str(exc)
                print(f"  WARN rom compare: {exc}", flush=True)

        with tempfile.TemporaryDirectory(prefix=f"gbc_bench_{slug}_") as tmp:
            try:
                baseline_bin, specialized_bin = compile_host_benches(
                    repository, export_dir, Path(tmp)
                )
            except Exception as exc:  # noqa: BLE001
                entry["error"] = f"host compile failed: {exc}"
                results.append(entry)
                print(f"  FAIL compile: {exc}", flush=True)
                continue

            level_rows: list[dict[str, Any]] = []
            for board_index, source_level in enumerate(boards):
                level_entry: dict[str, Any] = {
                    "board_index": board_index,
                    "source_level": source_level,
                    "success": False,
                }
                fixture = fixtures_root / f"{slug}-board{board_index}.txt"
                tokens: list[str] = []
                if args.reuse_fixtures and fixture.is_file():
                    tokens = [
                        line.strip().lower()
                        for line in fixture.read_text(encoding="utf-8").splitlines()
                        if line.strip()
                    ]
                    if tokens:
                        level_entry["solver_status"] = "reused_fixture"
                        level_entry["fixture"] = str(fixture.relative_to(repository))
                        level_entry["replay_turns"] = len(tokens)
                        print(
                            f"  L{board_index}/src{source_level} reuse fixture "
                            f"turns={len(tokens)}",
                            flush=True,
                        )
                if not tokens:
                    try:
                        # Solve a one-level culled game so solver level 0 matches
                        # GBC board ordinal (avoids message/cull index drift).
                        with tempfile.TemporaryDirectory(
                            prefix=f"gbc_solve_{slug}_b{board_index}_"
                        ) as solve_tmp:
                            result = solve_retained_board_json(
                                solver,
                                compiler,
                                source,
                                source_level,
                                args.timeout_ms,
                                Path(solve_tmp),
                            )
                    except Exception as exc:  # noqa: BLE001
                        level_entry["error"] = f"solve exception: {exc}"
                        level_rows.append(level_entry)
                        print(
                            f"  L{board_index}/src{source_level} FAIL solve: {exc}",
                            flush=True,
                        )
                        continue
                    status = str(result.get("status"))
                    tokens = [
                        str(token).lower() for token in (result.get("solution") or [])
                    ]
                    level_entry["solver_status"] = status
                    level_entry["solver_strategy"] = result.get("strategy")
                    level_entry["solved_via"] = "culled_single_level_game"
                    if status != "solved" or not tokens:
                        level_entry["error"] = f"unsolved:{status}"
                        level_rows.append(level_entry)
                        print(
                            f"  L{board_index}/src{source_level} FAIL {status}",
                            flush=True,
                        )
                        continue

                    write_fixture(tokens, fixture)
                    level_entry["fixture"] = str(fixture.relative_to(repository))
                    level_entry["replay_turns"] = len(tokens)

                try:
                    before = run_host_bench(
                        baseline_bin, fixture, slug, board_index
                    )
                    after = run_host_bench(
                        specialized_bin, fixture, slug, board_index
                    )
                except Exception as exc:  # noqa: BLE001
                    level_entry["error"] = f"bench failed: {exc}"
                    level_rows.append(level_entry)
                    print(
                        f"  L{board_index}/src{source_level} FAIL bench: {exc}",
                        flush=True,
                    )
                    continue

                before_ms = float(before.get("mean_ms_per_turn", 0.0))
                after_ms = float(after.get("mean_ms_per_turn", 0.0))
                speedup = pct_speedup(before_ms, after_ms)
                level_entry.update(
                    {
                        "success": bool(before.get("won") and after.get("won")),
                        "won_baseline": bool(before.get("won")),
                        "won_specialized": bool(after.get("won")),
                        "mean_ms_baseline": before_ms,
                        "mean_ms_specialized": after_ms,
                        "speedup_pct": speedup,
                        "pct_le_80ms_baseline": float(before.get("pct_le_80ms", 0.0)),
                        "pct_le_80ms_specialized": float(after.get("pct_le_80ms", 0.0)),
                    }
                )
                level_rows.append(level_entry)
                speedup_text = (
                    f"{speedup:+.1f}%" if speedup is not None else "n/a"
                )
                print(
                    f"  L{board_index}/src{source_level} turns={len(tokens)} "
                    f"ms {before_ms:.4f}->{after_ms:.4f} ({speedup_text}) "
                    f"won={level_entry['success']}",
                    flush=True,
                )

        entry["levels"] = level_rows
        ok_levels = [row for row in level_rows if row.get("success")]
        entry["levels_solved_and_benched"] = len(ok_levels)
        entry["mean_ms_baseline"] = weighted_mean(ok_levels, "mean_ms_baseline")
        entry["mean_ms_specialized"] = weighted_mean(ok_levels, "mean_ms_specialized")
        if (
            entry["mean_ms_baseline"] is not None
            and entry["mean_ms_specialized"] is not None
        ):
            entry["speedup_pct"] = pct_speedup(
                entry["mean_ms_baseline"], entry["mean_ms_specialized"]
            )
        entry["success"] = len(ok_levels) > 0
        results.append(entry)

    report = {
        "format": "puzzlescript-gbc-eligible-solution-bench-compare-v1",
        "timing_source": "host_gbc_core_wall_clock",
        "note": (
            "Before = GBC interpreter path; after = specialized turn hook. "
            "Host desktop timings are not cart-comparable. "
            "ROM size = linked fixed ROM high-water + sum of banked _CODE_N "
            "from the map (padded .gb is always 512 KiB with -yo32)."
        ),
        "timeout_ms": args.timeout_ms,
        "max_levels": args.max_levels,
        "cull_oversize_levels": args.cull,
        "summary": {
            "games": len(games),
            "games_with_any_level": sum(1 for row in results if row.get("success")),
            "levels_ok": sum(
                int(row.get("levels_solved_and_benched") or 0) for row in results
            ),
            "mean_speedup_pct_over_games": None,
            "mean_rom_delta_pct_over_games": None,
        },
        "games": results,
    }
    speedups = [
        float(row["speedup_pct"])
        for row in results
        if row.get("speedup_pct") is not None
    ]
    rom_deltas = [
        float(row["rom_delta_pct"])
        for row in results
        if row.get("rom_delta_pct") is not None
    ]
    if speedups:
        report["summary"]["mean_speedup_pct_over_games"] = sum(speedups) / len(speedups)
    if rom_deltas:
        report["summary"]["mean_rom_delta_pct_over_games"] = sum(rom_deltas) / len(
            rom_deltas
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"\nwrote {out_path}", flush=True)

    print(
        "\nslug                              lvls  ms_before  ms_after  speedup%  "
        "rom_before  rom_after  rom_delta%",
        flush=True,
    )
    for row in results:
        ms_b = row.get("mean_ms_baseline")
        ms_a = row.get("mean_ms_specialized")
        sp = row.get("speedup_pct")
        rom_b = (row.get("rom_baseline") or {}).get("linked_code_bytes")
        rom_a = (row.get("rom_specialized") or {}).get("linked_code_bytes")
        rom_p = row.get("rom_delta_pct")
        print(
            f"{row['slug']:<32} "
            f"{str(row.get('levels_solved_and_benched', 0)):>4} "
            f"{(f'{ms_b:.4f}' if ms_b is not None else '-'):>9} "
            f"{(f'{ms_a:.4f}' if ms_a is not None else '-'):>9} "
            f"{(f'{sp:+.1f}' if sp is not None else '-'):>8} "
            f"{(str(rom_b) if rom_b is not None else '-'):>10} "
            f"{(str(rom_a) if rom_a is not None else '-'):>10} "
            f"{(f'{rom_p:+.1f}' if rom_p is not None else '-'):>10}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
