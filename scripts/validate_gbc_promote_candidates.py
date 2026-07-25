#!/usr/bin/env python3
"""ROM-validate GBC eligible promotion candidates (cull + specialized + ≤512KiB)."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

MAX_ROM_BYTES = 512 * 1024


def find_make() -> Path | None:
    executable = shutil.which("make") or shutil.which("make.exe")
    return Path(executable) if executable else None


def find_compiler(repository: Path, explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit
    env = os.environ.get("PUZZLESCRIPT_CPP")
    if env:
        return Path(env)
    for candidate in (
        repository / "build" / "native" / "puzzlescript_cpp",
        repository / "native" / "build" / "puzzlescript_cpp",
    ):
        if candidate.is_file():
            return candidate
    return repository / "build" / "native" / "puzzlescript_cpp"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument(
        "--candidates",
        type=Path,
        default=Path("build/gbc/eligible-promote-candidates.json"),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("build/gbc/eligible-promote"),
    )
    parser.add_argument("--compiler", type=Path)
    parser.add_argument("--gbdk-home", type=Path)
    parser.add_argument(
        "--continue",
        dest="continue_on_error",
        action="store_true",
        default=True,
    )
    args = parser.parse_args()

    repository = args.repository.resolve()
    candidates_path = (
        args.candidates if args.candidates.is_absolute() else repository / args.candidates
    )
    out_root = args.out if args.out.is_absolute() else repository / args.out
    payload = json.loads(candidates_path.read_text(encoding="utf-8"))
    candidates = payload["candidates"]

    make = find_make()
    compiler = find_compiler(repository, args.compiler)
    gbdk_home = args.gbdk_home
    if gbdk_home is None:
        env_home = os.environ.get("GBDK_HOME") or os.environ.get("GBDK")
        gbdk_home = Path(env_home) if env_home else repository / ".codex_tmp" / "toolchains" / "gbdk"
    if make is None or not make.is_file():
        raise SystemExit("GNU make was not found")
    if not compiler.is_file():
        raise SystemExit(f"compiler not found: {compiler}")
    if not gbdk_home.is_dir():
        raise SystemExit(f"GBDK not found: {gbdk_home}")

    firmware = repository / "firmware" / "gbc"
    rom_path = firmware / "puzzlescript_gbc.gb"
    map_path = firmware / "puzzlescript_gbc.map"
    manifest_path = firmware / "generated" / "gbc_manifest.json"
    out_root.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    promoted: list[dict[str, str]] = []
    failures = 0

    for index, cand in enumerate(candidates, start=1):
        slug = cand["slug"]
        relative_source = cand["source"]
        source = repository / relative_source
        game_out = out_root / slug
        log_path = game_out / "build.log"
        record: dict[str, Any] = {
            "index": index,
            "slug": slug,
            "source": relative_source,
            "success": False,
            "promoted": False,
        }
        print(f"[{index}/{len(candidates)}] build {slug}", flush=True)
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
            "EXPORT_GBC_FLAGS=--cull-oversize-levels",
        ]
        process = subprocess.run(command, cwd=repository, capture_output=True, text=True)
        log_path.write_text(process.stdout + process.stderr, encoding="utf-8")
        record["log"] = str(log_path.relative_to(repository)).replace("\\", "/")

        if process.returncode != 0:
            record["error"] = "build_failed"
            records.append(record)
            failures += 1
            print(f"[{index}/{len(candidates)}] FAIL {slug} build_failed", flush=True)
            if not args.continue_on_error:
                break
            continue

        if not rom_path.is_file() or not manifest_path.is_file():
            record["error"] = "missing_artifact"
            records.append(record)
            failures += 1
            print(f"[{index}/{len(candidates)}] FAIL {slug} missing_artifact", flush=True)
            continue

        shutil.copy2(rom_path, game_out / f"{slug}.gb")
        if map_path.is_file():
            shutil.copy2(map_path, game_out / f"{slug}.map")
        shutil.copy2(manifest_path, game_out / "gbc_manifest.json")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        rom_bytes = (game_out / f"{slug}.gb").stat().st_size
        specialized = bool(manifest.get("specialized_turn", False))
        record.update(
            {
                "rom_bytes": rom_bytes,
                "specialized_turn": specialized,
                "board_level_count": int(manifest.get("board_level_count", 0)),
                "culled_level_count": int(manifest.get("culled_level_count", 0)),
            }
        )

        if not specialized:
            record["error"] = "specialized_turn_false"
            records.append(record)
            failures += 1
            print(f"[{index}/{len(candidates)}] FAIL {slug} specialized_turn_false", flush=True)
            continue
        if rom_bytes > MAX_ROM_BYTES:
            record["error"] = "rom_too_large"
            records.append(record)
            failures += 1
            print(f"[{index}/{len(candidates)}] FAIL {slug} rom_too_large {rom_bytes}", flush=True)
            continue

        record["success"] = True
        record["promoted"] = True
        records.append(record)
        promoted.append({"slug": slug, "source": relative_source})
        print(
            f"[{index}/{len(candidates)}] ok {slug} rom_bytes={rom_bytes} "
            f"boards={record['board_level_count']} culled={record['culled_level_count']}",
            flush=True,
        )

    report = {
        "format": "puzzlescript-gbc-eligible-promote-validation-v1",
        "max_rom_bytes": MAX_ROM_BYTES,
        "cull_oversize_levels": True,
        "candidates": len(candidates),
        "promoted_count": len(promoted),
        "failed_count": failures,
        "promoted": promoted,
        "records": records,
    }
    report_path = out_root / "promote-validation.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"promoted={len(promoted)} failed={failures} wrote {report_path}",
        flush=True,
    )
    # Non-zero only if every candidate failed and there was at least one candidate.
    return 1 if candidates and not promoted else 0


if __name__ == "__main__":
    raise SystemExit(main())
