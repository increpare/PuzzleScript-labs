# GBC Unrolled GbdC Sokoban Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ps_gbc_facade_apply_groups` in Sokoban's specialized turn with emitted per-rule match/apply C that uses façade get/set and literal pattern constants.

**Architecture:** After GBC packing, emit static rule functions with baked masks (from `PackedPattern`/`PackedRule`/`PackedGroup`), wire early/late through those instead of the table walker. Keep shared `ps_gbc_resolve_movements`. Prove with exporter structural assert + specialized oracle including a crate push.

**Tech Stack:** `compact_turn_codegen` / GBC exporter, host oracle, GBDK-compatible C.

**Spec:** [docs/superpowers/specs/2026-07-24-gbc-unrolled-gbdC-sokoban-slice-design.md](../specs/2026-07-24-gbc-unrolled-gbdC-sokoban-slice-design.md)

---

## File map

| File | Role |
|------|------|
| `native/src/compiler/compact_turn_codegen.hpp` | POD emit structs + `emitGbcSpecializedTurn` overload taking packed early/late |
| `native/src/compiler/compact_turn_codegen.cpp` | Emit unrolled rule/group functions; remove `apply_groups` from turn body |
| `native/src/gbc/exporter.cpp` | Pass packed patterns/rules/groups into specialized emit |
| `native/tests/gbc_exporter.cpp` | Assert **no** `ps_gbc_facade_apply_groups`; assert early-rule symbols |
| `native/tests/fixtures/gbc_sokoban_basic_replay.txt` | Include crate-push moves |
| `docs/performance/gbc-optimization-ledger.md` | Note structural win + optional host timing |

---

### Task 1: Failing structural test

**Files:**
- Modify: `native/tests/gbc_exporter.cpp`

- [ ] **Step 1:** Change specialized-turn require to expect `ps_gbc_facade_apply_groups` **absent**, and `ps_gbc_specialized_apply_early` (or similar) present.

- [ ] **Step 2:** Run `ctest --test-dir build/native -R puzzlescript_gbc_exporter --output-on-failure` — expect FAIL.

- [ ] **Step 3:** Commit test-only change (optional if same commit as impl; prefer with impl if branch WIP).

---

### Task 2: Emit unrolled early/late from packed tables

**Files:**
- Modify: `compact_turn_codegen.hpp/.cpp`, `exporter.cpp`

- [ ] **Step 1:** Add compact POD types mirroring packed pattern/rule/group fields needed for emission.

- [ ] **Step 2:** Implement emitters:
  - per-rule: match (literal masks + façade get) + apply replacement (literal clear/set + façade set + dirty)
  - per-group: input-quartet/single-pass selection matching `facade_rules.c`
  - `ps_gbc_specialized_apply_early/late`
  - turn body calls those + `ps_gbc_resolve_movements` — **no** `apply_groups`

- [ ] **Step 3:** Wire exporter to pass packed early/late into emit after packing.

- [ ] **Step 4:** Re-run exporter test — PASS.

---

### Task 3: Oracle + crate push

**Files:**
- Modify: `native/tests/fixtures/gbc_sokoban_basic_replay.txt`
- Possibly regenerate CMake GBC smoke export

- [ ] **Step 1:** Extend replay with moves that push a crate on level 0.

- [ ] **Step 2:** Rebuild oracle target; `ctest -R puzzlescript_gbc_specialized_oracle` PASS.

- [ ] **Step 3:** Host before/after on Sokoban solution (informational); ledger note.

---

### Task 4: Commit

- [ ] Commit emitter + tests + ledger with message focused on removing the walker from Sokoban specialized turns.
