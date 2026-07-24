# GBC Specialized Size Shrink + Bank Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise eligible-14 specialized retention from 2/14 toward 14/14 by (1a) freeing / shrinking the specialized bank and (2) bank-splitting leftover oversize specialized turns, keeping interpreter fallback.

**Architecture:** Today `generated_specialized_turn.c`, `generated_game.c`, and much of the firmware UI all use `#pragma bank 1`, so near-miss failures (e.g. push-pull bank **16433**) are often **shared-bank pressure**, not a >16 KiB specialized object alone. First move specialized onto a dedicated bank; then shrink emit; then split early / late+resolve across banks for monsters (xorro / slot / gapfiller).

**Tech Stack:** GBDK/SDCC banking, `compact_turn_codegen.cpp` emitters, `firmware/gbc/Makefile`, `scripts/build_gbc_eligible_roms.py`, host oracle + `check_gbc_rom`.

**Spec:** [`docs/superpowers/specs/2026-07-24-gbc-specialized-size-and-bank-split-design.md`](../specs/2026-07-24-gbc-specialized-size-and-bank-split-design.md)

**Perf policy:** Small Sokoban tick regressions OK if they unlock other specialized games; large Sokoban hits for memory-only gains are not — prefer more banks or fallback. Flag double-digit % Sokoban regressions for review.

---

## File map

| File | Role |
|---|---|
| `native/src/compiler/compact_turn_codegen.cpp` | `#pragma bank` for specialized emit; later multi-file / multi-bank emit; shrink helpers |
| `native/src/gbc/exporter.cpp` / `.hpp` | Write one or more specialized `.c` files; manifest bank metadata |
| `native/src/gbc/specialized_turn.h` | BANKED entry points; any split declarations |
| `native/src/gbc/core.c` | Calls specialized entry (already BANKED); no change unless new entry name |
| `firmware/gbc/Makefile` | Compile/link all `generated_specialized_turn*.c`; fallback deletes all of them |
| `scripts/gbc_manifest_disable_specialized.py` | Unchanged reason strings OK; may record bank info later |
| `scripts/build_gbc_eligible_roms.py` | Scoreboard already tracks specialized vs fallback |
| `native/tests/gbc_exporter.cpp` | Structural asserts (pragma bank / multi-file when added) |
| `docs/performance/gbc-optimization-ledger.md` | Retention + bank sizes + Sokoban ticks when measured |

## Baseline (2026-07-24, post size-fallback)

| Metric | Value |
|---|---|
| Specialized kept | `no-forbidden-symbols`, `pushy-v-pully-h` |
| Fallback | 12 (`linked_rom_bank_or_total_over_budget`) |
| Near-miss largest bank | push-pull 16433, i-am-a-gust 16486, 15-push-pull 17258, fickle-fred 17429 |
| Monsters | xorro ~76856, slot ~41630, gapfiller ~37150, … |
| Bank layout today | UI + `generated_game.c` + specialized → `_CODE_1`; façade → `_CODE_2` |

After push-pull fallback, `_CODE_1` ≈ **6152** → specialized was sharing ~10 KiB of that bank with UI/game data. Dedicated banking should reclaim several near-misses before any emit shrink.

---

### Task 1: Dedicated specialized ROM bank

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (`emitGbcSpecializedSeedAndHelpers` pragma)
- Modify: `native/tests/gbc_exporter.cpp` (expect `#pragma bank 3` or chosen bank)
- Modify: `docs/performance/gbc-optimization-ledger.md`

**Bank choice:** Use **bank 3** for `generated_specialized_turn.c` (`#pragma bank 3`). Keep façade on bank 2, `generated_game` + UI on bank 1. Document in a comment next to the pragma why bank 3 (avoid colliding with façade bank 2 and UI/game bank 1).

- [ ] **Step 1: Change emit pragma**

In `emitGbcSpecializedSeedAndHelpers`, replace:

```c
#pragma bank 1
```

with:

```c
#pragma bank 3
```

(under the existing `#if defined(__SDCC) || defined(GBDK)` guard).

- [ ] **Step 2: Host structural test**

Assert Sokoban (or exporter fixture) specialized source contains `#pragma bank 3` and still exports `ps_gbc_specialized_apply_turn_phases`.

- [ ] **Step 3: Verify host oracle**

```bash
# from repo conventions — adjust to the target used on this branch
ctest -R gbc_specialized_oracle --test-dir build/native --output-on-failure
# or the puzzlescript_gbc_specialized_oracle_smoke binary used previously
```

Expected: PASS.

- [ ] **Step 4: Rebuild eligible corpus**

```bash
make gbc_eligible
python3 - <<'PY'
import json
from pathlib import Path
r=json.loads(Path('build/gbc/eligible/rom-build-report.json').read_text())
# adapt keys to actual report shape
print(json.dumps(r, indent=2)[:2000])
PY
```

Record: specialized retained count, per-game largest bank, fallback reasons.

Expected: several near-miss slugs keep specialized; monsters may still fallback.

- [ ] **Step 5: Spot-check maps**

For a newly retained near-miss (e.g. `push-pull`) and a still-failing monster:

```bash
python3 - <<'PY'
from pathlib import Path
import sys
sys.path.insert(0,'scripts')
from check_gbc_rom import map_banked_sizes
for slug in ['push-pull','pushy-v-pully-h','no-forbidden-symbols','slot-machine']:
    p=Path(f'build/gbc/eligible/{slug}/{slug}.map')
    if p.exists():
        print(slug, map_banked_sizes(p))
PY
```

Confirm specialized lives in `_CODE_3` and `_CODE_3` ≤ 16384 when retained.

- [ ] **Step 6: Sokoban cart smoke (optional if eligible rebuild is heavy)**

If specialized Sokoban cart target exists, rebuild once and confirm it still runs / oracle path OK. Full PERF_BENCH only required if this task changes call overhead materially (BANKED entry already used — expect small Δ).

- [ ] **Step 7: Ledger + commit**

Ledger row: bank-3 move, retained N/14, example bank sizes, note any Sokoban tick sample.

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/tests/gbc_exporter.cpp docs/performance/gbc-optimization-ledger.md docs/superpowers/plans/2026-07-24-gbc-specialized-size-and-bank-split.md docs/superpowers/specs/2026-07-24-gbc-specialized-size-and-bank-split-design.md
git commit -m "$(cat <<'EOF'
Move GBC specialized turn to dedicated ROM bank 3.

Frees bank 1 (UI + generated_game) so near-miss specialized carts can link without shrinking emit yet.
EOF
)"
```

---

### Task 2: Emit shrink — shared rule prologue / helpers

**Only if Task 1 leaves games still over `_CODE_3` but close, or retention stalled on mid-size titles.**

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (`emitGbcSpecializedRuleFunction` and helpers)
- Test: host oracle + `make gbc_eligible` delta
- Ledger row

**Facts to use:** On push-pull, ~75% of specialized `.c` bytes are the eight `ps_gbc_specialized_rule_*` bodies; direction pairs differ in few mask/delta lines but duplicate large scan prologues.

- [ ] **Step 1: Identify a safe factor**

Extract a shared static helper for the duplicated scan setup used by player-anchored single-row rules (the common xmax/ymax / player_cells walk), parameterized by values that actually differ — **or** emit one direction-parameterized rule function when the four direction clones only differ by compile-time direction constants that can be passed in.

Do **not** merge rules whose match/apply masks differ in control flow (only constants).

- [ ] **Step 2: Implement minimal factor for the common Sokoban-like / push-pull shape**

Gate the factor behind the same shapes already required for unrolled GbdC (single-row, no ellipsis, etc.) so xorro-class games are unchanged until a later pass.

- [ ] **Step 3: Measure**

```bash
# Compare specialized .c bytes and linked _CODE_3 before/after for:
# push-pull, fickle-fred, short-adventure-in-sticky-wall-land
make gbc_eligible
```

- [ ] **Step 4: Oracle + commit** if retention or bank headroom improved without large Sokoban regression.

If shrink does not move retention after one focused attempt, **stop 1a** and proceed to Task 3 (do not boil the ocean on dedupe).

---

### Task 3: Multi-bank specialized emit (early vs late+resolve)

**For games whose specialized object alone still exceeds 16 KiB after Tasks 1–2.**

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` — split emission into multiple translation units **or** multiple `#pragma bank` sections if SDCC supports one file / one bank only (GBDK: **one bank per .c file** → emit multiple files)
- Modify: `native/src/gbc/exporter.cpp` — write:
  - `generated_specialized_turn.c` (entry + seed + apply_turn_phases trampoline, bank 3)
  - `generated_specialized_turn_early.c` (early rules + `ps_gbc_specialized_apply_early`, bank 4)
  - `generated_specialized_turn_late.c` (late rules + resolve + won + apply_late, bank 5)
  Exact bank numbers may shift; keep them contiguous and document in manifest.
- Modify: `firmware/gbc/Makefile` — `SPECIALIZED_SRC` becomes a list; link all `.o`; size-fallback **deletes every** `generated_specialized_turn*.c` and their `.o` before relink
- Modify: `native/src/gbc/specialized_turn.h` — declare banked `ps_gbc_specialized_apply_early` / `_late` if they become cross-TU
- Tests: exporter structural (files exist + distinct pragma banks); oracle; eligible retention

- [ ] **Step 1: Makefile multi-file specialized support (before emit split)**

Teach Makefile to pick up `generated_specialized_turn*.c` (glob or explicit list from a tiny `specialized_sources.list` written by exporter). Fallback removes the whole set.

- [ ] **Step 2: Exporter writes split files when estimated need**

Simple v1 policy: **always** split unrolled specialized emits into entry / early / late+resolve files on banks 3/4/5. (Always-on split keeps one code path; accept small BANKED call cost per the perf policy.)

Alternative if always-on hurts Sokoban a lot: split only when a size heuristic fires (e.g. rule_count ≥ N or source bytes ≥ 12 KiB). Prefer measuring Sokoban after always-on; if ticks jump double-digit %, switch to heuristic.

- [ ] **Step 3: Wire BANKED calls**

`ps_gbc_specialized_apply_turn_phases` (bank 3) calls BANKED early (bank 4) and late/resolve (bank 5). Ensure no direct calls from banked specialized code into non-`NONBANKED` core helpers (existing constraint).

- [ ] **Step 4: Verify**

```bash
ctest -R gbc_specialized_oracle --test-dir build/native --output-on-failure
make gbc_eligible
```

Target: monsters that fit across banks keep specialized; total ROM ≤ 512 KiB; per-bank ≤ 16 KiB.

- [ ] **Step 5: PERF sample**

```bash
python3 scripts/run_gbc_benchmark.py --mgba /Applications/mGBA.app/Contents/MacOS/mGBA --runs 3 --timeout 45 build/gbc/sokoban-cart-perf/sokoban-specialized-perf.gb
```

Compare to ~48.9 ticks/turn. If regression is large and retention gain is only from always-on split, gate split with heuristic (see Step 2).

- [ ] **Step 6: Ledger + commit**

---

### Task 4: Scoreboard / docs closeout

- [ ] Ensure `build/gbc/eligible/specialized-scoreboard.json` (via `make gbc_eligible`) reflects final specialized vs fallback.
- [ ] Ledger summary table: slug → specialized? → largest bank → fallback reason.
- [ ] Spec status line can stay “Approved”; add “Implemented (Phase 1a/1b)” note in ledger only unless spec update requested.
- [ ] Stop when 14/14 specialized **or** only total-ROM / irreducible cases remain. Phase 2 language profile is a **new** brainstorm/spec.

---

## Verification cheat sheet

```bash
# Host
ctest -R gbc_specialized_oracle --test-dir build/native --output-on-failure

# Corpus
make gbc_eligible
# inspect build/gbc/eligible/rom-build-report.json and */*.map banks

# Cart perf (Sokoban)
python3 scripts/run_gbc_benchmark.py --mgba /Applications/mGBA.app/Contents/MacOS/mGBA --runs 3 --timeout 45 build/gbc/sokoban-cart-perf/sokoban-specialized-perf.gb
```

## Spec coverage check

| Spec item | Task |
|---|---|
| 1a shrink | Task 2 |
| 1b bank-split | Task 1 (dedicated bank) + Task 3 (multi-bank specialized) |
| Interpreter fallback kept | Task 3 Makefile; existing path |
| Retention maximize | Tasks 1–3 measurement steps |
| Sokoban perf policy | Task 3 Step 5; ledger judgment |
| Phase 2 out of scope | Task 4 stop condition |

## Risk notes

- **Wrong bank number:** Confirm GBDK maps show `_CODE_3` and MBC type in manifest supports enough banks (eligible games already sized for multi-bank carts).
- **SDCC one-bank-per-file:** Do not emit two `#pragma bank` values in one `.c`.
- **Fallback completeness:** Deleting only `generated_specialized_turn.c` after multi-file emit would leave orphan banked objects — Makefile must clear the glob.
