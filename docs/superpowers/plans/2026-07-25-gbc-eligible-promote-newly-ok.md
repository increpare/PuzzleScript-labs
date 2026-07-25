# GBC Eligible Promote Newly OK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate every cull-export-OK `good_games` title that is not already in `ELIGIBLE_GAMES` with a full GBDK ROM build (specialized retained, ≤512 KiB), then append all passers to the production eligible corpus.

**Architecture:** Reuse the existing firmware `make -C firmware/gbc` path from `scripts/build_gbc_eligible_roms.py`. Extend the cull audit to emit a machine-readable OK list, ROM-build each candidate into `build/gbc/eligible-promote/`, then merge passers into both twin `ELIGIBLE_GAMES` lists and re-run `make gbc_eligible`.

**Tech Stack:** `puzzlescript_cpp export-gbc`, GBDK via `firmware/gbc/Makefile`, Python scripts under `scripts/`, ledger under `docs/performance/`.

**Spec:** [`docs/superpowers/specs/2026-07-25-gbc-eligible-promote-newly-ok-design.md`](../specs/2026-07-25-gbc-eligible-promote-newly-ok-design.md)

---

## File map

| File | Role |
|------|------|
| `scripts/audit_gbc_good_games_export.py` | Cull/strict export audit; add `--json-out` for OK paths |
| `scripts/validate_gbc_promote_candidates.py` | **Create:** ROM-build candidates; write pass/fail JSON |
| `scripts/build_gbc_eligible_roms.py` | Production `ELIGIBLE_GAMES` + ROM rebuild |
| `scripts/bench_gbc_eligible_solutions.py` | Twin `ELIGIBLE_GAMES` (must stay identical) |
| `Makefile` | Help text that hard-codes “14” |
| `docs/performance/gbc-optimization-ledger.md` | Promote / ROM-fail table |
| `build/gbc/eligible-promote/` | Scratch ROM builds for candidates (gitignored via `build/`) |
| `build/gbc/eligible/` | Production eligible artifacts after final rebuild |

Slug rule (match existing eligible): lowercase the stem, replace spaces with `-`, keep other punctuation as in current list (`Pushy-V Pully-H` → `pushy-v-pully-h`).

```python
def game_slug(source: Path) -> str:
    return source.stem.strip().lower().replace(" ", "-")
```

---

### Task 1: Audit JSON output

**Files:**
- Modify: `scripts/audit_gbc_good_games_export.py`

- [ ] **Step 1: Add `--json-out PATH` that writes full per-game results**

After the existing count loop, also collect rows. When `--json-out` is set, write:

```python
# at end of main(), before return 0:
results: list[dict] = []  # append inside the loop:
# results.append({
#   "source": str(source.relative_to(repository)).replace("\\", "/"),
#   "name": source.name,
#   "ok": ok,
#   "class": label,
#   "detail": detail,
# })

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
```

Add imports: `import json`. Add argparse:

```python
parser.add_argument("--json-out", type=Path, default=None)
```

Keep existing stdout summary behavior unchanged.

- [ ] **Step 2: Smoke the flag on a tiny subset (optional sanity)**

No separate unit test harness; run full cull audit in Task 2.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit_gbc_good_games_export.py
git commit -m "$(cat <<'EOF'
Add JSON output to GBC good_games export audit.

EOF
)"
```

---

### Task 2: Fresh cull audit → candidate list

**Files:**
- Create (artifact): `build/gbc/good-games-export-audit-cull.json`

- [ ] **Step 1: Ensure compiler exists**

```bash
test -x build/native/puzzlescript_cpp || cmake --build native/build --target puzzlescript_cpp -j8
# Prefer repo convention if binary lives under build/native:
ls -la build/native/puzzlescript_cpp native/build/puzzlescript_cpp 2>/dev/null
```

Use whichever path `audit_gbc_good_games_export.py` finds (`PUZZLESCRIPT_CPP` or `build/native/puzzlescript_cpp`).

- [ ] **Step 2: Run cull audit with JSON out**

```bash
python3 scripts/audit_gbc_good_games_export.py --cull --verbose \
  --json-out build/gbc/good-games-export-audit-cull.json
```

Expected: `ok` count around **35** (ledger baseline after Milestone A). If materially lower, stop and diagnose before promoting.

- [ ] **Step 3: Emit candidate TSV (not yet in ELIGIBLE)**

```bash
python3 <<'PY'
import json
from pathlib import Path

audit = json.loads(Path("build/gbc/good-games-export-audit-cull.json").read_text())
# Import list by exec'ing the tuple from the builder
ns = {}
exec(Path("scripts/build_gbc_eligible_roms.py").read_text().split("SOLUTION_FIXTURES")[0], ns)
eligible_sources = {src.replace("\\", "/") for _, src in ns["ELIGIBLE_GAMES"]}

def slug(name: str) -> str:
    return Path(name).stem.strip().lower().replace(" ", "-")

ok = [r for r in audit["results"] if r["ok"]]
candidates = [r for r in ok if r["source"] not in eligible_sources]
print(f"ok={len(ok)} eligible={len(eligible_sources)} candidates={len(candidates)}")
out = Path("build/gbc/eligible-promote-candidates.json")
out.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "format": "puzzlescript-gbc-eligible-promote-candidates-v1",
    "candidates": [
        {"slug": slug(r["name"]), "source": r["source"], "name": r["name"]}
        for r in sorted(candidates, key=lambda r: r["source"])
    ],
}
out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
print(f"wrote {out}")
for c in payload["candidates"]:
    print(f"  {c['slug']}\t{c['source']}")
PY
```

Expected: on the order of **~21** candidates (35 − 14). If zero, stop — nothing to promote.

- [ ] **Step 4: Commit audit helper only if Task 1 not yet committed; do not commit `build/` artifacts**

(No commit for `build/` JSON.)

---

### Task 3: Candidate ROM validator script

**Files:**
- Create: `scripts/validate_gbc_promote_candidates.py`

- [ ] **Step 1: Add script that ROM-builds each candidate like `build_gbc_eligible_roms.py`**

Implement a focused script (reuse patterns from `build_gbc_eligible_roms.py`: find make/compiler/GBDK, `make -B -C firmware/gbc GAME=... EXPORT_GBC_FLAGS=--cull-oversize-levels`, copy `.gb`/`.map`/manifest, require `specialized_turn` and `rom_bytes <= 524288`).

```python
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
```

- [ ] **Step 2: Commit the validator**

```bash
git add scripts/validate_gbc_promote_candidates.py
git commit -m "$(cat <<'EOF'
Add GBC eligible promotion ROM validator.

EOF
)"
```

---

### Task 4: Run ROM validation on candidates

**Files:**
- Artifact: `build/gbc/eligible-promote/promote-validation.json`

- [ ] **Step 1: Confirm GBDK**

```bash
test -d "${GBDK_HOME:-.codex_tmp/toolchains/gbdk}" && echo GBDK_ok
```

Expected: directory exists. If not, set `GBDK_HOME` to the local toolchain.

- [ ] **Step 2: Validate all candidates**

```bash
python3 scripts/validate_gbc_promote_candidates.py --continue \
  --candidates build/gbc/eligible-promote-candidates.json \
  --out build/gbc/eligible-promote
```

Expected: prints per-game ok/FAIL; writes `promote-validation.json` with `promoted` list. Wall-clock may be tens of minutes.

- [ ] **Step 3: Print promote summary**

```bash
python3 -c 'import json;from pathlib import Path;r=json.loads(Path("build/gbc/eligible-promote/promote-validation.json").read_text());print("promoted",r["promoted_count"]);print("failed",r["failed_count"]);
[print(" OK",p["slug"]) for p in r["promoted"]];
[print(" FAIL",x["slug"],x.get("error")) for x in r["records"] if not x.get("promoted")]'
```

If `promoted_count == 0`, stop and inspect a failing `build.log` before editing `ELIGIBLE_GAMES`.

---

### Task 5: Append passers to twin `ELIGIBLE_GAMES` lists

**Files:**
- Modify: `scripts/build_gbc_eligible_roms.py` (tuple `ELIGIBLE_GAMES`, argparse description string mentioning “14”)
- Modify: `scripts/bench_gbc_eligible_solutions.py` (tuple `ELIGIBLE_GAMES` — must match exactly)

- [ ] **Step 1: Generate the new tuple entries from the validation report**

```bash
python3 <<'PY'
import json
from pathlib import Path
r = json.loads(Path("build/gbc/eligible-promote/promote-validation.json").read_text())
for p in sorted(r["promoted"], key=lambda x: x["slug"]):
    print(f'    ("{p["slug"]}", "{p["source"]}"),')
print("COUNT", len(r["promoted"]))
PY
```

- [ ] **Step 2: Append those entries to both `ELIGIBLE_GAMES` tuples**

Keep the original 14 first (stable order), then append new slugs sorted by slug. Update the builder argparse description from “14 documented” to “documented compatible good_games” (no hard-coded count), e.g.:

```python
description=(
    "Rebuild production GBC ROMs for the documented compatible "
    "good_games (strict + cull-oversize)."
)
```

Ensure `bench_gbc_eligible_solutions.py` tuple is byte-for-byte the same ordering/content as the builder.

- [ ] **Step 3: Verify the two lists match**

```bash
python3 <<'PY'
from pathlib import Path

def load_tuple(path: str):
    ns = {}
    text = Path(path).read_text()
    # Stop before next top-level assignment after ELIGIBLE_GAMES
    start = text.index("ELIGIBLE_GAMES")
    chunk = text[start:]
    end = chunk.index("\n\n")
    exec(chunk[:end], ns)
    return ns["ELIGIBLE_GAMES"]

a = load_tuple("scripts/build_gbc_eligible_roms.py")
b = load_tuple("scripts/bench_gbc_eligible_solutions.py")
assert a == b, (len(a), len(b), set(a)^set(b))
print("ELIGIBLE_GAMES match:", len(a))
PY
```

Expected: `ELIGIBLE_GAMES match: <14+promoted>`.

- [ ] **Step 4: Commit list updates**

```bash
git add scripts/build_gbc_eligible_roms.py scripts/bench_gbc_eligible_solutions.py
git commit -m "$(cat <<'EOF'
Promote ROM-validated good_games into GBC ELIGIBLE_GAMES.

EOF
)"
```

---

### Task 6: Makefile help + ledger

**Files:**
- Modify: `Makefile` (help lines that say “14”)
- Modify: `docs/performance/gbc-optimization-ledger.md`

- [ ] **Step 1: Update Makefile help**

Replace hard-coded “14” in the `gbc_eligible` help echo with a dynamic count or neutral wording, e.g.:

```makefile
	@echo "  make gbc_eligible                  Rebuild documented GBC-compatible good_games ROMs"
```

Also update the comment near `GBC_ELIGIBLE_CULL_FLAG` if it says “14-game eligible corpus”.

- [ ] **Step 2: Append ledger section**

Add under the existing any/layer-coupled audit note:

```markdown
### GBC eligible promote after Milestone A (2026-07-25)

Validation: `scripts/validate_gbc_promote_candidates.py` (cull + specialized + ≤512 KiB).

| Result | Count | Notes |
| --- | ---: | --- |
| Cull export OK (audit) | N | from `good-games-export-audit-cull.json` |
| Already eligible | 14 | unchanged baseline |
| ROM-validated & promoted | P | listed below |
| ROM failed (not promoted) | F | reasons below |

**Promoted:** `slug1`, `slug2`, …

**Not promoted (export OK, ROM fail):**

| slug | error |
| --- | --- |
| … | build_failed / specialized_turn_false / rom_too_large |

`ELIGIBLE_GAMES` size is now **14+P**. Host solution-replay scoreboard for new titles is follow-up (not a promote gate).
```

Fill N/P/F and tables from `promote-validation.json` and the audit JSON (do not leave placeholders).

- [ ] **Step 3: Commit docs/Makefile**

```bash
git add Makefile docs/performance/gbc-optimization-ledger.md
git commit -m "$(cat <<'EOF'
Document GBC eligible promotion results in ledger.

EOF
)"
```

---

### Task 7: Full `make gbc_eligible` green

**Files:**
- Artifact: `build/gbc/eligible/rom-build-report.json`
- Artifact: `build/gbc/eligible/specialized-scoreboard.json`

- [ ] **Step 1: Rebuild full eligible corpus**

```bash
make gbc_eligible GBC_CONTINUE=1
```

Expected: every entry in `ELIGIBLE_GAMES` succeeds; report `successful == len(ELIGIBLE_GAMES)`.

- [ ] **Step 2: Assert report invariants**

```bash
python3 <<'PY'
import json
from pathlib import Path
ns={}
exec(Path("scripts/build_gbc_eligible_roms.py").read_text().split("SOLUTION_FIXTURES")[0], ns)
n=len(ns["ELIGIBLE_GAMES"])
r=json.loads(Path("build/gbc/eligible/rom-build-report.json").read_text())
assert r["summary"]["games"]==n
ok=[g for g in r["games"] if g.get("success")]
assert len(ok)==n, (len(ok), n)
assert all(g.get("specialized_turn") for g in ok)
assert all(g.get("rom_bytes", 0) <= 524288 for g in ok)
print(f"gbc_eligible OK: {n}/{n} specialized ROMs")
PY
```

Expected: `gbc_eligible OK: N/N specialized ROMs`.

- [ ] **Step 3: Final commit only if Task 5/6 left anything; otherwise done**

If report-only tweaks were needed, commit them. Do not commit `build/gbc/**` binaries.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Fresh cull audit | Task 2 |
| Candidates = OK − eligible | Task 2 |
| Full ROM + specialized + ≤512 KiB | Tasks 3–4 |
| Update both `ELIGIBLE_GAMES` | Task 5 |
| Makefile + ledger | Task 6 |
| `make gbc_eligible` green | Task 7 |
| No host-replay gate | Explicit non-goal; not in tasks |
| No promote of ROM failures | Task 4/5 only append `promoted` |

## Placeholder scan

None intentional. Ledger tables in Task 6 must be filled from real JSON at execution time.
