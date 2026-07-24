# GBC Specialized Resolve + Win Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shape-gated GbdC emitters for `ps_gbc_specialized_resolve_movements` and `ps_gbc_specialized_won`, with win folded into `ps_gbc_finish_turn`, measured on Sokoban cart after each milestone.

**Architecture:** Extend `emitGbcSpecializedTurn` in `compact_turn_codegen.cpp` with eligibility predicates and two new emitters. Wire resolve into specialized turn phases; declare won in `specialized_turn.h` and call it from `core.c` when `PS_GBC_HAS_SPECIALIZED_WON`. Exporter records flags and defines the macro in `generated_game.h`.

**Tech Stack:** C++/GBDK C emitters, host oracle smoke, mGBA PERF_BENCH via `scripts/run_gbc_benchmark.py`.

**Spec:** [`docs/superpowers/specs/2026-07-24-gbc-specialized-resolve-and-win-design.md`](../specs/2026-07-24-gbc-specialized-resolve-and-win-design.md)

---

## File map

| File | Role |
|---|---|
| `native/src/compiler/compact_turn_codegen.cpp` | Eligibility + emit resolve/won; call resolve from turn phases |
| `native/src/compiler/compact_turn_codegen.hpp` | Optional public helpers if exporter needs eligibility |
| `native/src/gbc/specialized_turn.h` | Declare `ps_gbc_specialized_won` |
| `native/src/gbc/core.c` | Fold won; keep stub path when macro unset |
| `native/src/gbc/exporter.cpp` | `#define PS_GBC_HAS_SPECIALIZED_WON`, manifest flags |
| `native/tests/gbc_exporter.cpp` | Structural asserts for resolve/won when Sokoban qualifies |
| `docs/performance/gbc-optimization-ledger.md` | Three cart benches |

---

### Task 1: Specialized resolve emitter + wire

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp`
- Modify: `native/tests/gbc_exporter.cpp` (expect specialized resolve for Sokoban)

- [ ] **Step 1:** Add `gbcSpecializedResolveEligible(game)` — objectBits≤32, movementBytes≤1 (v1), no movement/failure SFX counts from analysis if available at Game level (or treat audio as exporter-side; for Game use `analyzeMovementLayers` + object count; skip if `movementToCollisionLayer` empty is OK; audio: check game sound tables if present on Game, else always allow and let exporter AND with audio counts).
- [ ] **Step 2:** Emit `ps_gbc_specialized_resolve_movements` — multi-pass like `core.c`, literal layer masks from `game.layerMasks` / movement↔collision map, direct board/movements/dirty; on player move set `player_cells[0]`+count=1 and `ps_gbc_specialized_player_cell` when single-player certified.
- [ ] **Step 3:** In `ps_gbc_specialized_apply_turn_phases`, call specialized resolve when eligible; else keep `ps_gbc_resolve_movements`. Drop redundant post-resolve player_cells[0] sync when resolve already updated anchors (keep refresh fallback for non-eligible).
- [ ] **Step 4:** Rebuild host; run `puzzlescript_gbc_specialized_oracle_smoke` (+ exporter structural test).
- [ ] **Step 5:** Cart PERF 3-run vs prior specialized (~130.93); ledger “resolve only”.

### Task 2: Specialized won + fold

**Files:**
- Modify: `compact_turn_codegen.cpp`, `specialized_turn.h`, `core.c`, `exporter.cpp`, tests

- [ ] **Step 1:** Add `gbcSpecializedWonEligible(game)` — win conditions only All/No/Some; filters fit in one object word.
- [ ] **Step 2:** Emit `bool ps_gbc_specialized_won(const ps_gbc_session*)` with literal filters/quantifiers.
- [ ] **Step 3:** Exporter `#define PS_GBC_HAS_SPECIALIZED_WON 1` when eligible+specialized turn; header declare; `finish_turn` uses it instead of `ps_gbc_won`.
- [ ] **Step 4:** Oracle + structural (no `ps_gbc_won` from specialized path — won is called from core with macro).
- [ ] **Step 5:** Cart PERF; ledger “won only” if measurable in isolation, else “resolve+won”.
- [ ] **Step 6:** Final both-enabled cart bench + ledger; must beat ~130.93.

### Task 3: Docs / export report

- [ ] Manifest JSON: `specialized_resolve`, `specialized_won`
- [ ] Ledger final summary row

**Verification commands:**
```bash
# Host oracle (from repo build conventions)
ctest -R gbc_specialized_oracle --test-dir build/native   # or make target used in this repo
python3 scripts/run_gbc_benchmark.py --mgba /Applications/mGBA.app/Contents/MacOS/mGBA --runs 3 --timeout 45 build/gbc/sokoban-cart-perf/sokoban-specialized-perf.gb
```

**Baseline to beat:** 130.93 ticks/turn specialized (pre-resolve/win specialize).
