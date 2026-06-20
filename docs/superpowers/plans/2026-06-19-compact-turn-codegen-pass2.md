# Compact Turn Codegen Pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve compiled compact-turn C++ kernel throughput with a second measured codegen optimization pass.

**Architecture:** Re-baseline the focused perf suite, use runtime counters to identify one generic generated-kernel hotspot, add a failing expectation for that hotspot, then implement the smallest codegen/runtime optimization that improves it without changing solver semantics. Correctness and perf gates stay separate so solver search noise does not hide runtime regressions.

**Tech Stack:** C++17 native compiler/runtime, generated compact-turn C++, Node.js perf harnesses, Make/CMake targets.

---

## File Structure

- Modify: `native/src/compiler/compact_turn_codegen.cpp`
  - Emits compact-turn generated C++ and is the primary target for rule-dispatch, precheck, and replacement-helper optimizations.
- Modify as needed: `native/include/puzzlescript/puzzlescript.h`, `native/src/runtime/core.cpp`, `native/src/cli/main.cpp`, `native/src/solver/main.cpp`
  - Adds runtime-counter fields only if fresh profiling needs more attribution.
- Modify as needed: `src/tests/compact_turn_codegen_perf_suite_node.js`
  - Reports any added counters and derived ratios.
- Modify: `src/tests/compact_turn_codegen_perf_expectations.json`
  - Adds or tightens the red/green perf expectation for the chosen hotspot.
- Modify if needed: `Makefile`
  - Adds a narrow helper target only if the existing perf targets cannot exercise the selected metric.

## Task 1: Fresh Baseline And Hotspot Selection

- [x] **Step 1: Verify branch and cleanliness**

Run:

```bash
git status --short --branch
```

Expected: branch is `codex/compact-turn-codegen-pass2` and no modified files except this spec/plan if they have not yet been committed.

- [x] **Step 2: Build current native tools**

Run:

```bash
make build
```

Expected: build succeeds.

- [x] **Step 3: Run the focused perf suite**

Run:

```bash
make compact_turn_codegen_perf_suite
```

Expected: command succeeds and writes `build/compact-turn-codegen-perf-suite.json`.

- [x] **Step 4: Rank current hotspots**

Run:

```bash
node -e '
const fs = require("fs");
const report = JSON.parse(fs.readFileSync("build/compact-turn-codegen-perf-suite.json", "utf8"));
for (const c of report.cases) {
  const r = c.compiled.result;
  const i = c.interpreter.result;
  const cc = c.compiled.counters;
  const gen = Math.max(1, r.generated || 0);
  const igen = Math.max(1, i.generated || 0);
  const us = (r.step_ms * 1000) / gen;
  const ius = (i.step_ms * 1000) / igen;
  const ms = (key) => ((cc[key] || 0) / 1e6).toFixed(1);
  console.log(`${c.key} compiled=${us.toFixed(2)}us interp=${ius.toFixed(2)}us speedup=${(ius / us).toFixed(2)}x`);
  console.log(`  phases setup=${ms("compact_turn_setup_ns")} early=${ms("compact_turn_early_rules_ns")} move=${ms("compact_turn_movement_ns")} late=${ms("compact_turn_late_rules_ns")}`);
  console.log(`  calls=${cc.compact_turn_rule_apply_calls} changed=${cc.compact_turn_rule_apply_changed} no_match=${cc.compact_turn_rule_apply_no_match} mask_fail=${cc.compact_turn_rule_mask_precheck_failures}`);
}
'
```

Expected: output identifies one dominant generic hotspot. Prefer a hotspot shared by at least two cases.

- [x] **Step 5: Commit the baseline plan artifacts**

Run:

```bash
git add docs/superpowers/specs/2026-06-19-compact-turn-codegen-pass2-design.md docs/superpowers/plans/2026-06-19-compact-turn-codegen-pass2.md
git commit -m "docs: plan compact turn codegen pass 2"
```

Expected: commit succeeds.

## Task 2: Add A Red Perf/Shape Gate

- [x] **Step 1: Choose the metric**

Use the Task 1 report to choose exactly one acceptance metric. The default choice is a `compiledUsPerGeneratedMax` or phase-specific max in `src/tests/compact_turn_codegen_perf_expectations.json` for the selected case. If phase-specific expectations are needed and unsupported, add one named expectation field to `src/tests/compact_turn_codegen_perf_suite_node.js`.

- [x] **Step 2: Add or tighten the expectation**

Edit `src/tests/compact_turn_codegen_perf_expectations.json` so the selected current baseline fails but the target is realistic. Example for a phase target:

```json
"Double-Entry Bookkeeping Simulator.txt#17": {
  "compiledUsPerGeneratedMax": 10.0,
  "compiledLateRulesMsMax": 575.0
}
```

The exact values must be based on Task 1 baseline output.

- [x] **Step 3: Verify RED**

Run:

```bash
make compact_turn_codegen_perf_expectations
```

Expected: fails because the selected metric is above the new target.

- [x] **Step 4: Commit the failing perf gate**

Run:

```bash
git add src/tests/compact_turn_codegen_perf_expectations.json src/tests/compact_turn_codegen_perf_suite_node.js
git commit -m "test: tighten compact turn codegen hotspot expectation"
```

Expected: commit records only the test/harness change.

## Task 3: Implement One Generic Codegen Optimization

- [x] **Step 1: Inspect generated-code source around the chosen hotspot**

Run targeted searches:

```bash
rg "rule_mask|simple_replacement|apply_rule|emit.*rule|compact_turn_count" native/src/compiler/compact_turn_codegen.cpp
```

Expected: identify the exact emitter functions for the selected metric.

- [x] **Step 2: Implement the smallest optimization**

Modify `native/src/compiler/compact_turn_codegen.cpp` only at the relevant emitter/helper boundary. Keep the optimization generic, deterministic, and semantics-preserving. Preferred candidates are:

- phase-level or rule-level skip checks that avoid entering generated rule apply functions when required object or movement masks are absent;
- replacement-helper specialization for common no-op or fixed-cell update cases;
- avoiding redundant derived-state rebuilds when the generated code can prove no relevant object or movement state changed.

- [x] **Step 3: Build**

Run:

```bash
make build
```

Expected: build succeeds.

- [x] **Step 4: Verify GREEN on the focused perf gate**

Run:

```bash
make compact_turn_codegen_perf_expectations
```

Expected: passes or improves enough to justify adjusting the expectation to the stable achieved value.

- [x] **Step 5: Run correctness gates**

Run:

```bash
make compact_turn_native_parity
make compact_turn_codegen_solver_parity
```

Expected: both pass.

- [x] **Step 6: Commit the optimization**

Run:

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/include/puzzlescript/puzzlescript.h native/src/runtime/core.cpp native/src/cli/main.cpp native/src/solver/main.cpp src/tests/compact_turn_codegen_perf_suite_node.js src/tests/compact_turn_codegen_perf_expectations.json
git commit -m "perf: optimize compact turn codegen hotspot"
```

Expected: commit includes only files actually changed.

## Task 4: Curve Validation And Write-Up

- [x] **Step 1: Run solver timeout curve validation**

Run:

```bash
make solver_timeout_curve SOLVER_TIMEOUT_CURVE_MAX_MS=1000 SOLVER_TIMEOUT_CURVE_PROGRESS=quiet COMPILED_RULES_PERF=true
```

Expected: compiled portfolio and compiled HDA do not regress below interpreter counterparts at 1000ms.

- [x] **Step 2: Summarize before/after focused metrics**

Run:

```bash
node -e '
const fs = require("fs");
const report = JSON.parse(fs.readFileSync("build/compact-turn-codegen-perf-suite.json", "utf8"));
for (const c of report.cases) {
  const r = c.compiled.result;
  const i = c.interpreter.result;
  const gen = Math.max(1, r.generated || 0);
  const igen = Math.max(1, i.generated || 0);
  const us = (r.step_ms * 1000) / gen;
  const ius = (i.step_ms * 1000) / igen;
  console.log(`${c.key}: compiled=${us.toFixed(2)}us/generated interpreter=${ius.toFixed(2)}us/generated speedup=${(ius / us).toFixed(2)}x generated=${r.generated}`);
}
'
```

Expected: output is suitable for the final user write-up.

- [x] **Step 3: Final status**

Report changed files, before/after numbers, correctness/perf commands run, and any remaining bottlenecks.

## Task 5: Follow-Up Solver Setup Cache Optimization

- [x] **Step 1: Add a setup-specific red gate**

Add a `compiledSetupMsMax` expectation for `gem soketeer.txt#21` and verify it fails before the solver setup optimization.

- [x] **Step 2: Avoid solver-mode discard snapshots**

Split compact-turn snapshot requirements so solver-mode `cancel` and `restart` discard outcomes do not force a turn-start object snapshot. Keep snapshots for non-solver command semantics, probes, rigid turns, player-movement requirements, and `again`.

- [x] **Step 3: Reuse compact-turn solver scratch storage**

Route native compact-turn solver attempts through the existing per-edge `childScratch.scratch` buffer, marking object-derived caches dirty before each parent-state run so generated kernels rebuild from the correct board while retaining vector capacity.

- [x] **Step 4: Make late-rule perf expectation rate-based**

Replace the total late-rule milliseconds guard for `Double-Entry Bookkeeping Simulator.txt#17` with a per-generated-state late-rule rate guard, since faster setup can generate more states before timeout.

- [x] **Step 5: Verify focused perf gate**

Run:

```bash
make compact_turn_codegen_perf_expectations
```

Expected: passes with `gem soketeer.txt#21` setup below the tightened threshold.

- [x] **Step 6: Run native coverage/parity**

Run:

```bash
make compact_turn_native_parity
```

Expected: passes for all native compact-turn corpus games.

- [x] **Step 7: Run solver parity**

Run:

```bash
make compact_turn_codegen_solver_parity
```

Expected: passes with no compact solver parity mismatches.

- [x] **Step 8: Commit the follow-up optimization**

Run:

```bash
git add native/src/compiler/compact_turn_codegen.cpp native/src/solver/main.cpp src/tests/compact_turn_codegen_perf_suite_node.js src/tests/compact_turn_codegen_perf_expectations.json docs/superpowers/plans/2026-06-19-compact-turn-codegen-pass2.md
git commit -m "perf: reduce compact turn solver setup cost"
```

Expected: commit succeeds after all verification gates pass.

## Task 6: Hybrid Replacement Fast-Path Noop Optimization

- [x] **Step 1: Reject unconditional replacement-mask simplification**

Tried simplifying replacement masks against LHS-known present/missing bits. `make compact_turn_codegen_perf_expectations` passed, but focused perf was mixed and did not reduce top-level replacement-attempt counters, so the experiment was backed out.

- [x] **Step 2: Add noop-biased generated replacement helpers**

Updated generated simple replacement fast paths so uncertain replacements first scan for the first changed mask word. Common noop attempts now skip before-state copies and writes; changed attempts still record exact before/after state before dirty-cache updates.

- [x] **Step 3: Preserve eager behavior for guaranteed-changing replacements**

Added a compile-time proof for replacements that must change a matched cell. Those calls use eager helper variants with the previous single-pass behavior, avoiding regressions on high-change cases such as `heroes_of_sokoban_3.txt#23`.

- [x] **Step 4: Verify focused perf**

Ran:

```bash
make compact_turn_codegen_perf_expectations
make compact_turn_codegen_perf_suite
```

Latest no-rebuild focused sample:

- `big dog and little dog.txt#11`: compiled `53.00us/generated` versus previous baseline about `53.47us/generated`.
- `Double-Entry Bookkeeping Simulator.txt#17`: compiled `8.92us/generated` versus previous baseline about `9.35us/generated`.
- `gem soketeer.txt#21`: compiled `14.27us/generated` versus previous baseline about `14.48us/generated`.
- `heroes_of_sokoban_3.txt#23`: compiled `1.45us/generated`, preserving the previous high-change baseline.

- [x] **Step 5: Verify correctness**

Ran:

```bash
make compact_turn_native_parity
make compact_turn_codegen_solver_parity
```

Expected: native parity passes and solver parity reports `153/153` games with `0` oracle failures.

## Task 7: Sparse Movement-Anchor Cell Index

- [x] **Step 1: Identify the remaining movement-anchor scan hotspot**

Focused profiling after Task 6 still showed movement-anchor-heavy rules paying full-board scans just to choose and iterate candidate cells. The clearest affected cases were `Voitex Rasteriser 2.txt#1` and `big dog and little dog.txt#11`.

- [x] **Step 2: Add generated movement-bit cell indexes**

Added `Scratch::movementCellBits` and `Scratch::movementCellCounts`, plus generated rebuild/prepare/update helpers. The index is movement-bit-major and is rebuilt lazily from `liveMovements` when dirty.

- [x] **Step 3: Route movement-anchor matching through the sparse index**

Updated fixed-row movement-anchor collection to choose anchors from movement-cell counts and iterate only indexed cells for selected movement bits. Generated movement writes update the index when possible and mark it dirty when broad invalidation is cheaper or safer.

- [x] **Step 4: Verify focused perf**

Ran:

```bash
make compact_turn_codegen_perf_expectations
make compact_turn_codegen_perf_suite
```

Latest no-rebuild focused sample versus the post-Task-6 sample:

- `Voitex Rasteriser 2.txt#1`: `3.50us/generated` to `2.07us/generated`, about `1.69x` faster.
- `big dog and little dog.txt#11`: `53.00us/generated` to `18.91us/generated`, about `2.80x` faster.
- `gem soketeer.txt#21`: `14.27us/generated` to `12.02us/generated`, about `1.19x` faster.
- `manic_ammo.txt#26`: `3.81us/generated` to `3.43us/generated`, about `1.11x` faster.
- `Double-Entry Bookkeeping Simulator.txt#17`: effectively neutral at about `9.02us/generated`.
- `easyenigma.txt#1`: effectively neutral/slightly better at about `22.46us/generated`.

- [x] **Step 5: Verify correctness**

Ran:

```bash
make compact_turn_native_parity
make compact_turn_codegen_solver_parity
```

Solver parity passed with `games=153/153`, `levels=2513`, `compact_turn_unhandled=0`, and `compact_turn_oracle_failures=0`.

## Task 8: Inline Simple Pattern Preconditions

- [x] **Step 1: Profile generated match call overhead**

Focused generated-source inspection showed candidate-heavy rules still called the generic `compact_turn_pattern_matches_*` helper from fixed-row collection and still-match rechecks, even for plain cell patterns that only test constant present/missing object or movement masks.

- [x] **Step 2: Inline simple pattern checks**

Added a generated inline path for cell patterns with no `any` masks and no layer-coupled movement clauses. The emitter now writes direct cell object/movement mask tests into fixed-row collection, single-row still-match checks, multi-row tuple rechecks, and row-collection helpers, while keeping the generic helper for complex patterns.

- [x] **Step 3: Skip empty object anchors**

Updated object-anchor selection so a chosen zero-count anchor suppresses the fallback row scan, matching the movement-anchor behavior and avoiding pointless full-row work when a required anchor object is absent.

- [x] **Step 4: Inline board mask prechecks**

Generated rule and row board-mask prechecks now use constant mask expressions against `scratch.boardMask` / `scratch.boardMovementMask` instead of routing through the generic required-mask helper.

- [x] **Step 5: Verify focused perf**

Ran:

```bash
make compact_turn_codegen_perf_expectations
```

Latest focused sample versus the post-Task-7 sample:

- `Double-Entry Bookkeeping Simulator.txt#17`: `8.91us/generated` to `8.53us/generated`, about `1.04x` faster.
- `gem soketeer.txt#21`: `12.30us/generated` to `11.83us/generated`, about `1.04x` faster.
- `big dog and little dog.txt#11`: `18.84us/generated` to `18.30us/generated`, about `1.03x` faster.
- `Voitex Rasteriser 2.txt#1`: `2.17us/generated` to `2.00us/generated`, about `1.09x` faster.
- `manic_ammo.txt#26`: `3.48us/generated` to `3.38us/generated`, about `1.03x` faster.

- [x] **Step 6: Verify correctness**

Ran:

```bash
make compact_turn_native_parity
make compact_turn_codegen_solver_parity
```

Solver parity passed with `games=153/153`, `levels=2513`, `compact_turn_unhandled=0`, and `compact_turn_oracle_failures=0`.

## Task 9: Rarest Conjunctive Object-Anchor Scan

- [x] **Step 1: Reject mixed fixed-row collector reuse**

Tried reusing the row-collection helper from mixed fixed-row codegen. `make compact_turn_codegen_perf_expectations` failed on `Double-Entry Bookkeeping Simulator.txt#17`, with late-rule cost around `6.73us/generated` against the `6.00us/generated` guard, so the codegen refactor was backed out.

- [x] **Step 2: Reject unconditional simple helper inlining**

Tried making generated `compact_turn_simple_replacement_fast_path_*` helpers `inline`. The focused perf gate still failed on `Double-Entry Bookkeeping Simulator.txt#17`, with late-rule cost around `6.69us/generated`, so the experiment was backed out.

- [x] **Step 3: Split object-anchor groups by semantics**

Updated compact object-anchor metadata so fixed object requirements are marked as `requiresAll=true`, while `any` object alternatives are marked as `requiresAll=false`. This preserves `any` semantics while letting generated code treat conjunctive anchors as "all objects must be present in the same cell."

- [x] **Step 4: Enumerate only the rarest object for conjunctive anchors**

For `requiresAll` object-anchor groups, generated code now estimates the group by the minimum object-cell count and scans only the rarest object's indexed cells. For `any` groups, generated code keeps the existing summed estimate and enumerates every alternative, avoiding missed matches.

- [x] **Step 5: Verify focused perf**

Ran:

```bash
make compact_turn_codegen_perf_expectations
```

Latest focused sample:

- `Double-Entry Bookkeeping Simulator.txt#17`: `8.53us/generated` after Task 8 to `7.27us/generated`, about `1.17x` faster; late rules were about `4.91us/generated`, below the `6.00` guard.
- `gem soketeer.txt#21`: `11.83us/generated` after Task 8 to `10.47us/generated`, about `1.13x` faster.
- `manic_ammo.txt#26`: effectively neutral at `3.41us/generated`.
- `Voitex Rasteriser 2.txt#1`: effectively neutral at `2.06us/generated`.

- [x] **Step 6: Verify correctness**

Ran:

```bash
make compact_turn_codegen_solver_parity
make compact_turn_native_parity
```

Solver parity passed with `games=153/153`, `levels=2513`, `compact_turn_unhandled=0`, and `compact_turn_oracle_failures=0`. Native parity passed with `native=182/182`.

## Task 10: Covered Positive Line-Precheck Elision

- [x] **Step 1: Update stale generated-source shape guard**

The object-only dirty-shape fixture now emits an eager object helper after Task 6. Updated the generated-source assertion to accept either the eager or non-eager object helper spelling.

- [x] **Step 2: Reject unsafe post-match recheck elision**

Tried removing the non-random single-cell `matchIndex != 0` still-match recheck. The generated-source test passed and focused perf remained within expectations, but the sample was mixed: `Double-Entry Bookkeeping Simulator.txt#17`, `gem soketeer.txt#21`, and some `heroes_of_sokoban_3` cases got slightly worse. The production change was backed out.

- [x] **Step 3: Add red shape guard for covered positive object anchors**

Added a dirty-shape assertion that object-anchor scans omit `compact_turn_line_has_required_masks_*` when the selected positive object anchors already cover all positive object row preconditions. This failed before the codegen change.

- [x] **Step 4: Add missing-precondition safety guard**

The first implementation skipped too broadly and `make compact_turn_codegen_solver_parity SOLVER_COMPACT_PARITY_GAME=alternatey.txt` found `2` compact-turn oracle failures. Root cause: rows with missing object/movement line preconditions still need the row precheck even when positive object anchors are covered. Added `missingObjectMaskWords` and `missingMovementMaskWords` to `CompactRowMaskInfo`, and only elide the line precheck for pure positive-object row preconditions with no movement, missing, or `any` line requirements.

- [x] **Step 5: Verify focused perf**

Ran:

```bash
make compact_turn_codegen_perf_expectations
```

Latest focused sample:

- `manic_ammo.txt#26`: compiled `3.46us/generated`.
- `Voitex Rasteriser 2.txt#1`: compiled `2.06us/generated`.
- `big dog and little dog.txt#11`: compiled `18.74us/generated`.
- `Double-Entry Bookkeeping Simulator.txt#17`: compiled `7.31us/generated`.
- `easyenigma.txt#11`: compiled `22.30us/generated`.
- `gem soketeer.txt#21`: compiled `10.60us/generated`.

- [x] **Step 6: Verify correctness**

Ran:

```bash
make compact_turn_codegen_dirty_shape
make compact_turn_codegen_solver_parity SOLVER_COMPACT_PARITY_GAME=alternatey.txt
make compact_turn_native_parity
make compact_turn_codegen_solver_parity
```

Full solver parity passed with `games=153/153`, `levels=2513`, `compact_turn_unhandled=0`, and `compact_turn_oracle_failures=0`. It reported `19` timeout regressions, so this batch is correctness-clean but not a timeout-curve fix.

## Task 11: Flatten Generated Rule-Mask Precheck Branches

- [x] **Step 1: Add red generated-source guard**

Added a dirty-shape assertion that generated non-random rulegroup chunks no longer contain the `bool precheckPassed_*` temporary used to bridge from a failed rule-mask precheck into a second branch. This failed before the emitter change.

- [x] **Step 2: Emit direct precheck `if/else`**

Changed non-random rulegroup chunk codegen from:

```cpp
bool precheckPassed_N = true;
if (!rule_precheck(scratch)) { ... precheckPassed_N = false; }
if (precheckPassed_N) { ... }
```

to a direct:

```cpp
if (!rule_precheck(scratch)) { ... } else { ... }
```

This removes one generated temporary and one generated branch from each hot rule-mask precheck site.

- [x] **Step 3: Verify focused perf**

Ran:

```bash
make compact_turn_codegen_perf_expectations
make compact_turn_codegen_perf_expectations
```

The second no-rebuild sample was mixed but acceptable:

- `manic_ammo.txt#26`: `3.37us/generated`.
- `Double-Entry Bookkeeping Simulator.txt#17`: `7.24us/generated`.
- `easyenigma.txt#11`: `22.19us/generated`.
- `big dog and little dog.txt#11`: `18.76us/generated`.
- `gem soketeer.txt#21`: `10.76us/generated`.

- [x] **Step 4: Verify correctness**

Ran:

```bash
make compact_turn_codegen_dirty_shape
make compact_turn_native_parity
make compact_turn_codegen_solver_parity
```

Full solver parity passed with `games=153/153`, `levels=2513`, `compact_turn_unhandled=0`, and `compact_turn_oracle_failures=0`. It reported `19` timeout regressions.
