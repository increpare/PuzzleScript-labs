# GBC Solver→Host Parity Differential Diagnosis Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every known host GBC solution-replay failure, determine the exact divergence point (native solver vs GBC interpreter vs specialized turn) and land a minimal fix or an honest classification (out of scope / harness bug / game feature unsupported).

**Architecture:** Use the existing host replay bench (`puzzlescript_gbc_solution_replay_bench` + `scripts/bench_gbc_eligible_solutions.py`) with culled single-level solve games, `--dump-trace` board hashes, and ordered differentials: (1) does native C++ win the same solution? (2) does GBC interpreter win? (3) does specialized win? First mismatched turn/hash localizes the bug. Prefer one game per investigation slice; do not pile fixes.

**Tech Stack:** `puzzlescript_solver`, `puzzlescript_cpp` export-gbc, host GBC core / specialized `.c`, `bench_gbc_eligible_solutions.py`, dump-trace hashes.

**Worktree:** `.worktrees/gbc-any-layer-coupled` on branch `gbc-any-layer-coupled-codegen`.

**Related:** Milestone A any/layer-coupled codegen plan; this plan is about **parity bugs exposed by solver replay**, not new language features.

---

## Inventory (as of 2026-07-25)

### Already diagnosed / fixed (land before new digs)

| ID | Item | Status | Root cause |
|---|---|---|---|
| F0a | Host bench multi-pack link | **Fixed** (`8d83fee0`) in `scripts/bench_gbc_eligible_solutions.py` | Specialized host link only compiled `generated_specialized_turn.c`, omitting `generated_specialized_turn_rules_*.c` → undefined `_ps_gbc_specialized_rule_pack_N` |
| F0b | Culled single-level solve | **Fixed** (`8d83fee0`) in same script | Blank-line LEVELS split wrong; now uses IR `line_number` + one-level temp corpus so solver `--level 0` ≡ GBC board ordinal 0 |
| P1 | `pushit` specialized lose / interpreter win | **Fixed** (`8d83fee0`) in `compact_turn_codegen.cpp` | After seed, resolve marked only `player_cells[0]`; insert-only anchors leave stale empty cell first → seeded movement never enters `move_bits` → second input no-op |
| S1 | `Explodoban.txt` specialized lose | **Fixed** (`036f68f1`) | `object_bytes_per_cell==2` but `resolve_seeded_player` / mark-after-seed used `session->board[cell]` (byte index) → never saw player → no moves. `again=` dump asymmetry was a red herring (hashes matched after fix). |
| S2 | `Attractor Net.txt` specialized lose | **Fixed** (this plan Task 2) | Multi-player aggregate: `ps_gbc_specialized_seed_player_movement` returned after the first live player cell, so only one of nine pieces moved. |

### Open — specialized-only (interpreter wins, specialized loses)

*(none remaining from the initial inventory)*

### Open — both GBC paths lose (interpreter and specialized)

| ID | Game | Evidence | Leading hypothesis |
|---|---|---|---|
| B1 | `crate guardian.txt` | Culled solve finds solution; host interpreter `won=false` | Native↔GBC semantic gap (again / realtime / win / message), or wrong retained board / level start rules |
| B2 | `crate swap.txt` | Same pattern | Same class as B1 |
| B3 | `flesh-handed hot casserole delivery bot.txt` | Same pattern | Same class as B1 |
| B4 | `Muraphilic Monophobic Multiban.txt` | 3-move “solution” still loses on interpreter | Likely wrong win / trivial false solve / `again` drain; treat carefully |

### Confirmed healthy (regression anchors)

| ID | Game | Notes |
|---|---|---|
| OK1 | `pushit` (after F0b+P1) | 41-move culled solve; hashes match all turns |
| OK2 | `an ok multiban level.txt` | 59-move; exercises layer-coupled apply |
| OK3 | Milestone A fixture oracles | `gbc_any_mask_oracle_smoke`, `gbc_layer_coupled_apply_oracle_smoke` |
| OK4 | Several eligible-14 | e.g. 15-push-pull, gust-of-wind, push-pull, dollyban, … (2s timeout; some timeout-only) |

---

## File map

| File | Role |
|---|---|
| `scripts/bench_gbc_eligible_solutions.py` | Culled solve + host compile/link + replay; multi-pack link |
| `native/tests/gbc_solution_replay_bench.cpp` | Host replay; `--dump-trace` hashes/boards; again drain + message ack |
| `native/src/compiler/compact_turn_codegen.cpp` | Specialized seed/resolve/apply/again emit (P1 fix lives here) |
| `native/src/gbc/core.c` / `facade_rules.c` | Interpreter apply/resolve/`again` reference |
| `docs/performance/gbc-optimization-ledger.md` | Record findings after each closed ID |

---

## Differential diagnosis protocol (every open ID)

Use this exact order. Do **not** skip to “fix specialized” until step 3 fails.

1. **Reproduce** — culled single-level solve (2s+ if needed), export with `--cull-oversize-levels`, host baseline + specialized, record won flags.
2. **Native oracle** — replay the same input tokens on native `FullState` / `puzzlescript_cpp` replay for that one-level game.  
   - Native lose → solver/fixture/cull extract bug (harness), not GBC.  
   - Native win → continue.
3. **Interpreter vs specialized** — if baseline loses → class **B*** (GBC shared). If only specialized loses → class **S***.
4. **`--dump-trace`** — find first turn where `hash` / `again` / `changed` / board rows differ. Record turn index, input, again count, board cells that differ.
5. **Localize subsystem** from the first differing turn:
   - Seed player movement
   - Early rules / input specialization / any-masks / layer-coupled
   - Resolve (`move_bits`, player anchors)
   - Late rules
   - `again` / `pending_again` / tick drain
   - Win predicate
6. **Minimal fix or classify** — one root cause; add a focused regression (fixture + oracle or bench slug) when fixing.
7. **Commit** — one ID per commit when possible; update this plan checkboxes + ledger row.

---

### Task 0: Land pending harness + pushit fix

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (already edited)
- Modify: `scripts/bench_gbc_eligible_solutions.py` (already edited)

- [ ] **Step 1: Verify pushit still green**

```bash
# from worktree
./build/native/puzzlescript_cpp export-gbc src/tests/good_games/pushit.txt \
  --out /tmp/pushit_export --cull-oversize-levels
# solve+replay via bench slug pushit (see script); expect both won=True, no hash div
```

- [ ] **Step 2: Run Milestone A oracles + exporter tests**

```bash
cmake --build build/native --target \
  puzzlescript_gbc_exporter_tests \
  puzzlescript_gbc_any_mask_oracle_smoke \
  puzzlescript_gbc_layer_coupled_apply_oracle_smoke -j8
./build/native/puzzlescript_gbc_exporter_tests
./build/native/puzzlescript_gbc_any_mask_oracle_smoke
./build/native/puzzlescript_gbc_layer_coupled_apply_oracle_smoke
```

- [ ] **Step 3: Commit**

```bash
git add native/src/compiler/compact_turn_codegen.cpp scripts/bench_gbc_eligible_solutions.py
git commit -m "$(cat <<'EOF'
Fix specialized player-anchor resolve and culled solver replay sync.

Mark live player cells for movement resolve (not stale player_cells[0]),
link multi-pack specialized sources in the host bench, and solve retained
boards via IR-extracted one-level games.
EOF
)"
```

---

### Task 1: S1 — Explodoban specialized vs interpreter (2-byte board loads)

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (`emitGbdCBoardGet` in resolve_seeded + mark-after-seed)
- Modify: `native/tests/gbc_exporter.cpp` (two-byte object-cell emit regression)

- [x] **Step 1: Reproduce with dump-trace** — specialized stuck at start cell; baseline moved; `again=` differed but was not causal.
- [x] **Step 2: Localize** — Explodoban `object_bytes_per_cell: 2`; seed used uint16 view; `resolve_seeded_player` used `session->board[candidate]` (byte).
- [x] **Step 3: Fix** — width-aware board get in both sites.
- [x] **Step 4: Verify** — Explodoban 23-turn hashes match; both win; pushit still green; exporter two-byte assert.
- [ ] **Step 5: Commit**

---

### Task 2: S2 — Attractor Net specialized-only fail

**Files:**
- Modify: `native/src/compiler/compact_turn_codegen.cpp` (seed all player cells unless single-player certified)
- Modify: `native/tests/gbc_exporter.cpp` (multi-player seed continue assert on spawn-player fixture)

- [x] **Step 1: Culled solve + dump-trace** — turn 0: only one of nine player pieces moved left.
- [x] **Step 2: Classify** — seed early-return; not S1 twin (board widths already correct).
- [x] **Step 3: Fix + verify** — 43-turn hash match; Explodoban/pushit still green.
- [ ] **Step 4: Commit**

---

### Task 3: B-class triage — shared GBC interpreter losses

Games: B1 `crate guardian`, B2 `crate swap`, B3 `flesh-handed…`, B4 `muraphilic…`.

**Do not touch specialized until interpreter parity with native is understood.**

- [ ] **Step 1: For each game, native FullState replay of culled solution**

Table: `native_won`, `gbc_interp_won`, `gbc_spec_won`, first divergence turn (native vs interp).

- [ ] **Step 2: Bucket results**

| Bucket | Meaning | Next action |
|---|---|---|
| Native lose | Bad solve / wrong board extract | Fix harness (F0b follow-up) |
| Native win, interp lose @ again/tick | Host again drain / realtime | Fix bench or GBC again |
| Native win, interp lose @ rules | GBC exporter/runtime gap | New GBC bug ticket/fix |
| Native win, interp lose @ win | specialized_won / winconditions | Win codegen/interpreter |

- [ ] **Step 3: Pick the smallest B* game in the dominant bucket; full differential**
- [ ] **Step 4: Fix or document unsupported (e.g. requires realtime ticks beyond drain policy)**
- [ ] **Step 5: Commit harness or runtime fix; leave truly unsupported games listed in ledger**

---

### Task 4: Expand regression net

- [ ] **Step 1: Add bench mode or checked-in fixtures for closed IDs (P1, S1, …)**
- [ ] **Step 2: Optional: `make`/script target `gbc_solver_parity_smoke` over a small slug list**
- [ ] **Step 3: Ledger row summarizing open vs closed IDs**

```bash
git commit -m "$(cat <<'EOF'
Add GBC solver-parity regression coverage for closed replay bugs.

EOF
)"
```

---

## Suggested investigation order

1. Task 0 — land fixes (unblocks honest testing)
2. Task 1 — Explodoban (clearest specialized-only signal: again mismatch on turn 0)
3. Task 2 — Attractor Net (may collapse into S1)
4. Task 3 — B-class (shared path; may be multiple causes)
5. Task 4 — harden so these cannot regress silently

---

## Verification cheat sheet

```bash
# Worktree root
cmake --build build/native --target puzzlescript_cpp puzzlescript_solver \
  puzzlescript_gbc_exporter_tests puzzlescript_gbc_any_mask_oracle_smoke \
  puzzlescript_gbc_layer_coupled_apply_oracle_smoke -j8

# One-game parity (example)
python3 - <<'PY'
# temporarily set ELIGIBLE_GAMES to one slug, --timeout-ms 5000 --skip-rom
PY

# Dump-trace helper pattern is in prior session notes / agent transcript;
# compile_host_benches + --dump-trace on baseline vs specialized binaries.
```

---

## Spec coverage / success bar

| Outcome | Required |
|---|---|
| Every inventory ID closed or explicitly classified | Yes |
| P1 + F0a/F0b landed | Yes |
| S1 root cause named with turn-level evidence | Yes |
| B-class: at least dominant bucket understood | Yes |
| No silent “export OK ⇒ gameplay OK” claim without replay | Yes |

## Risks

- Treating B-class as specialized bugs wastes time — always check interpreter first.
- Culled one-level games can drop `run_rules_on_level_start` / preceding message context if that matters; if native also loses, revisit extract.
- `again` drain (500 ticks) may still differ from solver `AgainPolicy::Drain` for realtime games.
- Multi-bank specialized host link must stay in the bench (F0a).
