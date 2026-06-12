# C++ Compiler and Solver JS Parity Sync — Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the native C++ compiler, runtime, and solver to behavioral and performance parity with the JavaScript reference implementation, so `make tests` and solver corpus runs can treat JS as oracle without manual drift triage.

**Architecture:** Work in dependency order: **compiler diagnostics → IR/rule-plan parity → simulation replay → solver correctness → solver heuristics → solver performance → static analysis (stretch)**. Each phase lands with an automated gate that compares native output to JS on a fixed corpus. Do not port JS-only optimizations (static analysis, solver static opt) until the underlying compiled `Game` and step semantics match. Treat `native/src/compiler/IMPLEMENTATION_CHECKLIST.md`, `src/tests/JS_SOLVER_NEXT.md`, and `native/src/solver/HEURISTICS_IMPLEMENTATION.md` as living supplements — update them when tasks complete.

**Tech Stack:** C++17, CMake, existing JS oracle harness (`src/tests/js_oracle/`), QUnit/Node parity runners, Makefile targets (`simulation_tests`, `compilation_tests`, `solver_parity_smoke`, `solver_tests_*`).

**Related existing plans (use instead of re-deriving):**
- Compiler parser/compiler design: `docs/superpowers/specs/2026-04-22-cpp-compiler-design.md`
- Parser port tasks (47 tasks, partially landed): `docs/superpowers/plans/2026-04-22-cpp-compiler-phase1-parser.md`
- Native runtime perf: `docs/superpowers/plans/2026-04-22-native-perf-phase1.md`
- Generated rules / compact turn: `native/src/compiler/IMPLEMENTATION_CHECKLIST.md`
- JS static analysis: `docs/superpowers/plans/2026-05-02-static-analysis-implementation.md` (JS-only today)
- JS solver status log: `src/tests/JS_SOLVER_NEXT.md`

**Recommended worktree:** Create an isolated worktree before starting (`superpowers:using-git-worktrees`).

---

## Gap Summary (as of 2026-06-12)

| Area | JS (reference) | Native C++ | Gap severity |
|------|----------------|------------|--------------|
| Parser/compiler source | `src/js/parser.js` (1.7k), `src/js/compiler.js` (4.8k) | `native/src/compiler/parser.cpp` (2.9k), `lower_to_runtime.cpp` (2.8k) | Medium — substantial port exists; recent JS changes (keyword object names, `namesSet`/`abbrevNamesSet`, duplicate-`no` warning) may not be mirrored |
| Compile diagnostics | `errormessage_testdata.js` corpus | `make compilation_tests` / `diagnostics-parity` | Low–medium — harness exists; must stay green after every JS compiler edit |
| IR / rule plan | `game.rule_plan_v1` in JS IR | `--emit-ir-json` + `make rule_plan_parity_tests` | Low — tooling exists |
| Simulation replay | 469 play-session tests | `make simulation_tests_cpp` via JS-exported fixtures | Low — primary correctness gate |
| Static analysis | `src/tests/ps_static_analysis.js` (2.5k) | **Not implemented** (`IMPLEMENTATION_CHECKLIST.md` §539) | High for solver-opt; defer until compiler IR stable |
| Solver static opt | `src/tests/solver_static_opt.js` (inert/cosmetic/merge/action) | **Not implemented** | High for solve-count parity; depends on static analysis or conservative reimplementation |
| Solver heuristics | `'auto'` router, 15+ named heuristics, static dead-cell cache, version-keyed distance fields | `'winconditions'` baseline only (`native/src/search/search_common.hpp`, `native/src/solver/main.cpp`) | **Critical** for solve-count parity |
| Solver perf (step/clone/hash) | R1–R7 landed in JS (`JS_SOLVER_NEXT.md`) | Some native work (compact nodes, compiled rules, SIMD) but missing JS hot-path wins | High for wall-clock parity |
| Solver corpus gate | `make solver_tests_js` (~900+ solves @ 5s) | `make solver_tests_cpp` runs independently; **no automated solve-count parity** | Medium — only `solver_parity_smoke` (BFS, 7 levels) compares solutions |

---

## Phase Overview

```text
Phase 0  Baseline audit & drift inventory          (1–2 days)
Phase 1  Compiler + diagnostics parity           (1–3 weeks, extend existing parser plan)
Phase 2  Runtime step parity on simulation corpus  (ongoing; mostly green)
Phase 3  Solver correctness parity                 (3–5 days)
Phase 4  Solver heuristic parity                   (2–4 weeks)
Phase 5  Solver performance parity                 (2–4 weeks, parallel with Phase 4)
Phase 6  Static analysis + solver static opt       (3–6 weeks, stretch)
Phase 7  CI gates & documentation                  (1 day per phase landing)
```

Phases 4 and 5 can proceed in parallel once Phase 3 is green. Phase 6 is optional for correctness but required for matching JS solve counts on the full corpus with `--solver-opt all`.

---

## Phase 0: Baseline Audit and Drift Inventory

### Task 0.1: Build native toolchain and run full parity suite

**Files:**
- Read: `native/README.md`, `Makefile`
- Output: `docs/superpowers/notes/2026-06-12-cpp-js-parity-baseline.md` (create)

- [ ] **Step 1: Build native binaries**

Run from repo root:

```bash
make build build_solver
```

Expected: `build/native/puzzlescript_cpp` and `build/native/puzzlescript_solver` exist.

- [ ] **Step 2: Run JS parity suite**

```bash
make js_parity_tests
make simulation_tests
make compilation_tests
make rule_plan_parity_tests
make solver_parity_smoke
make ctest
```

Expected: Record pass/fail counts and any first failing fixture name in the baseline note.

- [ ] **Step 3: Run solver corpora side-by-side**

```bash
make solver_tests_js SOLVER_TIMEOUT_MS=5000 SOLVER_OUTPUT_ARGS="--quiet --json --no-solutions" 2>/dev/null | tail -5
make solver_tests_cpp SOLVER_TIMEOUT_MS=5000 SOLVER_OUTPUT_ARGS="--quiet --json --no-solutions" 2>/dev/null | tail -5
```

Expected: Note `solved`, `timeout`, `error` totals for each side. A large solve-count gap confirms Phase 4/5 scope.

- [ ] **Step 4: Commit baseline note**

```bash
git add docs/superpowers/notes/2026-06-12-cpp-js-parity-baseline.md
git commit -m "docs: record C++/JS parity baseline before sync work"
```

### Task 0.2: Produce a JS→native feature diff manifest

**Files:**
- Create: `docs/superpowers/notes/2026-06-12-cpp-js-feature-diff.md`
- Scan: `src/js/parser.js`, `src/js/compiler.js`, `src/js/engine.js`, `src/tests/run_solver_tests_js.js`, `src/tests/ps_static_analysis.js`, `src/tests/solver_static_opt.js`

- [ ] **Step 1: List recent JS-only commits**

```bash
git log --oneline -50 -- src/js/compiler.js src/js/parser.js src/js/engine.js src/tests/run_solver_tests_js.js src/tests/ps_static_analysis.js src/tests/solver_static_opt.js
```

- [ ] **Step 2: For each commit touching compiler/parser, check native mirror**

For each commit message implying behavior change (not pure perf), grep native:

```bash
rg -l "KEYWORD|namesSet|duplicate.*no" native/src/compiler/
```

Record unmatched JS behaviors in the feature-diff note with: JS file/function, native status (`missing` | `partial` | `done`), suggested native file.

- [ ] **Step 3: Commit feature diff**

```bash
git add docs/superpowers/notes/2026-06-12-cpp-js-feature-diff.md
git commit -m "docs: inventory JS features not yet mirrored in native"
```

---

## Phase 1: Compiler and Diagnostics Parity

**Objective:** Native `puzzlescript_cpp compile` produces diagnostics and `Game` IR indistinguishable from JS for the full `errormessage_testdata.js` + simulation-source corpus.

**Primary references:** `docs/superpowers/plans/2026-04-22-cpp-compiler-phase1-parser.md`, `docs/superpowers/specs/2026-04-22-cpp-compiler-design.md`

### Task 1.1: Sync parser keyword-name and membership-set behavior

**Context:** JS recently added `namesSet` / `abbrevNamesSet` for O(1) keyword checks and allows sprite names that spell keywords (e.g. `sprt_1_1 ^` in `a distant sunset.txt`). Test: `src/tests/compiler_keyword_names_node.js`.

**Files:**
- Modify: `native/src/compiler/types/parser_state.hpp`
- Modify: `native/src/compiler/parser.cpp`
- Modify: `native/src/compiler/lower_to_runtime.cpp` (if legend resolution uses abbrev lists)
- Create: `native/tests/compiler_keyword_names.cpp` (or extend existing compiler tests)
- Test: `node src/tests/compiler_keyword_names_node.js`

- [ ] **Step 1: Write failing native test**

Add to `native/tests/compiler_keyword_names.cpp`:

```cpp
#include "compiler/parser.hpp"
#include "compiler/lower_to_runtime.hpp"
#include <cassert>
#include <fstream>
#include <sstream>

static std::string readFixture(const char* relPath) {
    std::ifstream in(relPath);
    std::stringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

int main() {
    const std::string source = readFixture("src/tests/solver_tests/a distant sunset.txt");
    puzzlescript::compiler::DiagnosticSink diagnostics;
    auto state = puzzlescript::compiler::parseSource(source, diagnostics);
    // Keyword-shaped sprite names must compile without "keyword" object errors.
    for (const auto& d : diagnostics.items()) {
        assert(d.message.find("keyword") == std::string::npos);
    }
    puzzlescript::Game game;
    auto err = puzzlescript::compiler::lowerToRuntimeGame(state, game);
    assert(!err.has_value());
    assert(!game.ruleGroups.empty());
    return 0;
}
```

Register in `native/CMakeLists.txt` as `compiler_keyword_names` CTest.

- [ ] **Step 2: Run test — expect FAIL**

```bash
make build && ctest -R compiler_keyword_names -V
```

Expected: FAIL (keyword error or lower failure).

- [ ] **Step 3: Port JS `namesSet` / `abbrevNamesSet` semantics**

In `parser_state.hpp`, add:

```cpp
std::unordered_set<std::string> namesSet;
std::unordered_set<std::string> abbrevNamesSet;
```

Rebuild sets whenever `state.names` / `state.abbrevNames` mutate (mirror JS `parser.js` update sites). Replace linear keyword-array scans with set membership where JS does.

For keyword object detection, match JS: object names that equal keywords **as whole identifiers** are errors; sprite glyph names that happen to contain keyword substrings are allowed.

- [ ] **Step 4: Run tests**

```bash
node src/tests/compiler_keyword_names_node.js
make build && ctest -R compiler_keyword_names -V
make compilation_tests
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add native/src/compiler/types/parser_state.hpp native/src/compiler/parser.cpp native/tests/compiler_keyword_names.cpp native/CMakeLists.txt
git commit -m "fix(native-compiler): mirror JS keyword-name and namesSet behavior"
```

### Task 1.2: Sync duplicate-`no` cell warning (not error)

**Context:** JS commit `9141d45e` — duplicate `no X` in one cell is a warning, not a fatal error.

**Files:**
- Modify: `native/src/compiler/lower_to_runtime.cpp` (or rules lowering)
- Test: `make compilation_tests`

- [ ] **Step 1: Find JS behavior**

```bash
git show 9141d45e -- src/js/compiler.js | head -80
```

- [ ] **Step 2: Adjust native diagnostic severity to match**

Change the native duplicate-`no` path from `Severity::Error` to `Severity::Warning` with JS-identical message text via `format_for_js_compat`.

- [ ] **Step 3: Run compilation parity**

```bash
make compilation_tests
```

Expected: PASS (update saved expected messages only if native was previously stricter and corpus expects warning).

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(native-compiler): duplicate no-marker is warning, matching JS"
```

### Task 1.3: Close remaining parser-plan tasks

**Files:** See task index in `docs/superpowers/plans/2026-04-22-cpp-compiler-phase1-parser.md`

- [ ] **Step 1: Run parser-state diff harness on full corpus**

```bash
# Enable dev serializers if not already:
cmake -DPS_ENABLE_DEV_SERIALIZERS=ON -S native -B build/native
make build
# Run corpus diff script from parser plan Task 43
```

- [ ] **Step 2: Triage diff output**

Any non-empty `parser_state.json` diff → implement/fix in `native/src/compiler/parser.cpp` section handlers.

- [ ] **Step 3: Gate on compilation + IR parity**

```bash
make compilation_tests
make rule_plan_parity_tests
```

- [ ] **Step 4: Update IMPLEMENTATION_CHECKLIST.md** with completed parser items.

### Task 1.4: Eliminate JS IR export from default native compile path

**Objective:** `puzzlescript_cpp compile game.txt` must not shell out to Node (per `cpp-compiler-design.md` primary goal).

**Files:**
- Modify: `native/src/cli/main.cpp`
- Test: `make js_parity_tests` (should still pass using native compile)

- [x] **Step 1: Audit compile command for node subprocess**

```bash
rg "node |spawn|system\\(" native/src/cli/main.cpp
```

Audit result: `compileSourceCommand` uses `ps_compiler_*` and `parseSource`/`lowerToRuntimeGame` only. Node subprocess (`runIrExporterAndCaptureJson`) is limited to optional `step`/`diff-trace-source` paths without `--native-compile`.

- [x] **Step 2: Route `compile` through `ps_compiler_compile_source` only**

Already implemented; no hybrid path on `compile`.

- [x] **Step 3: Verify**

```bash
make build
build/native/puzzlescript_cpp compile src/demo/sokoban_basic.txt --diagnostics
make simulation_tests_cpp
```

Verified 2026-06-12: simulation 469/469, compilation_tests 274/274.

- [x] **Step 4: Commit and update `native/PLAN.md` phase marker from M1 hybrid → M3 in progress.**

See `docs/superpowers/notes/2026-06-12-native-compile-path.md`.

---

## Phase 2: Runtime Step Parity

**Objective:** `make simulation_tests` green with native compile + native step (no JS IR load except fixture generation step).

Most simulation parity infrastructure exists. This phase is **maintain the gate** while Phases 1 and 4 land.

### Task 2.1: Per-input trace diff on first failure

**Files:**
- Use: `src/tests/run_native_trace_suite.js`, `build/native/puzzlescript_cpp`

- [ ] **Step 1: On any simulation failure, capture first divergent input**

```bash
make simulation_tests_cpp 2>&1 | tee /tmp/sim_cpp.log
# Use existing trace diff CLI documented in native/PLAN.md §Differential Debugging
```

- [ ] **Step 2: Fix runtime/compiler issue; re-run**

```bash
make simulation_tests
```

### Task 2.2: Keep generated-rules fallback honest

**Files:** `native/src/runtime/compiled_rules.cpp`, `native/src/compiler/compiled_rules_codegen.cpp`

Follow unchecked items in `IMPLEMENTATION_CHECKLIST.md` §Current Push (focus 2× performance) **only after** simulation parity is green. Generated path must fall back to interpreter when unsupported — never silently diverge.

---

## Phase 3: Solver Correctness Parity

**Objective:** For a curated set of levels, native solver finds the **same optimal-length solution** as JS BFS/weighted-A* (not just same solved/unsolved bit).

### Task 3.1: Expand solver parity smoke beyond BFS-only tiny set

**Files:**
- Modify: `src/tests/run_solver_parity_smoke.js`
- Modify: `native/CMakeLists.txt` (CTest timeout)

- [ ] **Step 1: Add weighted-A* with `--solver-heuristic auto` comparison**

Extend smoke script to run both sides with:

```javascript
const jsArgs = ['--timeout-ms', '2000', '--strategy', 'weighted-astar', '--solver-heuristic', 'auto', '--no-solutions', '--quiet', '--json'];
const nativeArgs = ['--timeout-ms', '2000', '--strategy', 'weighted-astar', '--no-solutions', '--quiet', '--json'];
```

Compare `status` and `solution` for smoke corpus (`solver_smoke_tests/`).

- [ ] **Step 2: Add 10 curated levels from `solver_tests/` where JS solution is stable**

Include at least one: Sokoban-like (`push_goal.txt`), `NO` lifecycle, `SOME` witness, multi-level, message-skip.

- [ ] **Step 3: Wire into CTest**

```bash
make solver_parity_smoke
```

- [ ] **Step 4: Commit**

```bash
git commit -am "test: expand native/JS solver parity smoke to weighted-astar"
```

### Task 3.2: Solver step semantics audit

**Files:**
- Compare: `src/js/engine.js` (`processInput`, `backupLevel`, `restoreSnapshot`)
- Compare: `native/src/runtime/core.cpp` (`step`, `tick`, undo snapshot behavior)

- [ ] **Step 1: Verify solver session flags match JS**

Native solver must use `playableUndo=false`, `emitAudio=false`, same RNG seeding, same action/noaction input set as `run_solver_tests_js.js`.

- [ ] **Step 2: Add regression test for message-skip and restart/win commands**

Use existing smoke levels `message_skip.txt`.

- [ ] **Step 3: Run determinism suite**

```bash
make solver_determinism_tests
```

---

## Phase 4: Solver Heuristic Parity

**Objective:** Native solver supports the JS `'auto'` heuristic router and enough named heuristics that solve-count at 5s is within ~5% of JS (JS spread at 5s is ~897–902 per `JS_SOLVER_NEXT.md`).

**Primary references:** `src/tests/run_solver_tests_js.js` (heuristic implementations), `native/src/solver/HEURISTICS_IMPLEMENTATION.md` (native checklist)

### Task 4.1: Port heuristic selection CLI

**Files:**
- Modify: `native/src/solver/main.cpp`
- Modify: `native/src/search/search_common.hpp`

- [ ] **Step 1: Add `--heuristic` flag accepting JS names**

```cpp
// native/src/solver/main.cpp — extend Options
std::string heuristicName = "auto"; // match DEFAULT_SOLVER_HEURISTIC
```

Parse `--heuristic` with the same name set as JS (`run_solver_tests_js.js` lines 29–66).

- [ ] **Step 2: Route `heuristicScore` through a name→function table**

- [ ] **Step 3: Default to `"auto"` per-condition router (stub calling baseline first)**

- [ ] **Step 4: JSON output includes `"heuristic": "<name>"` like JS**

- [ ] **Step 5: Smoke test**

```bash
make build_solver
build/native/puzzlescript_solver src/tests/solver_smoke_tests --heuristic winconditions --json --no-solutions --quiet
```

### Task 4.2: Port baseline `allOnClearPathHeuristic` + static dead-cell cache (JS A3)

**Files:**
- Modify: `native/src/search/search_common.hpp`
- Modify: `native/src/solver/main.cpp` (`compactHeuristicScore` too)
- Reference: `run_solver_tests_js.js` functions `buildStaticDeadCellsCache`, `deadPositionPenalty`, `inferStaticBlockerMask`

- [ ] **Step 1: Write native unit test with 3×3 synthetic level**

Fixed board layout; assert heuristic score matches JS oracle script (add `src/tests/js_oracle/export_heuristic_score.js` emitting JSON for a fixture).

- [ ] **Step 2: Implement per-condition static `{corner, edge}` dead-cell masks at level load**

- [ ] **Step 3: Implement `all-on-dead-position` and wire into `'auto'` router for `ALL A ON B` simple allocation candidates**

- [ ] **Step 4: Benchmark on focus group**

```bash
make solver_focus_compare SOLVER_FOCUS_HEURISTIC=auto
```

Target: measurable solve-count lift on 250ms budget (JS saw +14 on dead-position heuristic alone).

### Task 4.3: Port region-isolation penalty (JS D2)

**Files:** `native/src/search/search_common.hpp`

- [ ] **Step 1: Implement static connected-component labeling for relevant layers**

- [ ] **Step 2: Add soft penalty when mandatory destination has no source in component**

- [ ] **Step 3: Enable in `'auto'` router after A3 is stable**

### Task 4.4: Port exact version-keyed distance-field cache (JS R1)

**Files:**
- Modify: `native/src/runtime/core.cpp` (cell write hooks)
- Modify: `native/src/search/search_common.hpp`

- [ ] **Step 1: Add per-filter-group target version bumps on cell writes (mirror JS `updateZobristCell` pattern)**

- [ ] **Step 2: Cache chamfer/BFS distance fields keyed by version**

- [ ] **Step 3: Add env flag `PUZZLESCRIPT_VERIFY_DISTANCE_FIELDS=1` for assert-on-mismatch**

- [ ] **Step 4: Verify zero change to expanded node counts on focus manifest**

```bash
make solver_focus_compare # expanded/generated must match baseline per target
```

### Task 4.5: Implement `'auto'` router matching JS

**Selection order (from JS / HEURISTICS_IMPLEMENTATION.md C2):**

```text
simple ALL placement     → allocation / dead-position / clear-path
player reach / exits     → player reachability
NO / lifecycle           → count / extinction
else                     → baseline winconditions distance
```

- [ ] **Step 1: Build immutable `HeuristicPlan` at level load from wincondition classification (H1 in native checklist)**

- [ ] **Step 2: Add debug flag `--heuristic-debug` printing per-condition scorer choice**

- [ ] **Step 3: Corpus compare**

```bash
make solver_tests_js SOLVER_TIMEOUT_MS=5000 --quiet
make solver_tests_cpp SOLVER_TIMEOUT_MS=5000 --quiet
# Record solved delta — target ≤5% relative gap
```

---

## Phase 5: Solver Performance Parity

**Objective:** Native median `step_ms` and end-to-end solver time within 2× of JS on the focus manifest (stretch: match JS after compiled-rules specialization).

**Primary references:** `JS_SOLVER_NEXT.md` R1–R7, `native/src/compiler/IMPLEMENTATION_CHECKLIST.md` §Current Push

### Task 5.1: Port JS engine hot-path optimizations safe for native runtime

| JS item | Native target file | Notes |
|---------|-------------------|-------|
| R1 distance-field cache | Phase 4.4 | Heuristic-side |
| R2 fused restore + mask rebuild | `native/src/runtime/core.cpp` | Must use generated stride path if applicable |
| R3 player-position cache | `native/src/search/search_common.hpp` | Tie to same version machinery |
| R4 checkWin closure removal | `native/src/runtime/core.cpp` | Direct tile scans |
| 1a `turnObjectsModified` | `native/src/runtime/core.cpp` | Skip command queue compare when clean |
| 1b turn backup scratch | `native/src/runtime/core.cpp` | Reuse buffer per specialization |
| 9c direct object word scans | `native/src/runtime/core.cpp` | Player position / win checks |

For each row:

- [ ] **Step 1: Measure baseline on focus manifest**

```bash
make solver_focus_perf_report SOLVER_FOCUS_RUNS=3
```

- [ ] **Step 2: Implement behind `#ifdef` or runtime flag**

- [ ] **Step 3: Verify expanded-count unchanged on focus targets**

- [ ] **Step 4: Verify median `step_ms` ratio improves**

### Task 5.2: Continue compiled-rules / compact-turn specialization

Follow `IMPLEMENTATION_CHECKLIST.md` unchecked performance items (inline masks, full-turn codegen, mask rebuild reduction). **Gate:** `make solver_focus_compare` median elapsed ≤0.5× interpreted (existing north star).

### Task 5.3: Parallel corpus (`--jobs N`)

Native solver already parses `--jobs auto|N`. Verify shard semantics match JS (game-level sharding, serial solve-count comparability):

- [ ] **Step 1: Run both with `--jobs 4`, same seed, same timeout**

- [ ] **Step 2: Assert per-game results identical to `--jobs 1`**

---

## Phase 6: Static Analysis and Solver Static Opt (Stretch)

**Objective:** Native solver can apply `--solver-opt inert,cosmetic,merge,action` with parity to JS (`make js_static_optimization_comparison_solver_smoke`).

**Dependency:** Phase 1 compiler IR stable; Phase 3 solver correctness green.

### Task 6.1: Port minimal static analysis subset

**Do not port all 2.5k lines at once.** Port only facts needed by `solver_static_opt.js`:

| Fact | JS source | Needed for |
|------|-----------|------------|
| `inert_command_only` rule tag | `ps_static_analysis.js` `tagRule` | inert pass |
| cosmetic object detection | `buildObjects` tags | cosmetic pass |
| mergeability candidates | mergeability analysis | merge pass |
| action unnecessary proof | movement/action analysis | action pass |

**Files:**
- Create: `native/src/analysis/static_analysis.hpp`, `static_analysis.cpp`
- Create: `native/src/analysis/solver_static_opt.hpp`, `solver_static_opt.cpp`
- Test: extend `js_static_optimization_comparison_solver_smoke` to run native side

- [ ] **Step 1: Emit `ps_tagged`-compatible JSON from native for one smoke game**

- [ ] **Step 2: Diff against JS `ps_static_analysis.js` output on same compiled state**

- [ ] **Step 3: Implement inert rule removal pass**

- [ ] **Step 4: Compare solver smoke baseline vs optimized native run**

### Task 6.2: Wire static opt into native solver CLI

- [ ] **Step 1: Add `--solver-opt` flag to `puzzlescript_solver` matching JS**

- [ ] **Step 2: Run focus comparison with/without `all`**

```bash
make js_static_optimization_comparison_solver_focus
# Add native equivalent Makefile target mirroring JS script
```

---

## Phase 7: CI Gates and Documentation

### Task 7.1: Add solve-count parity gate (non-blocking → blocking)

**Files:**
- Create: `src/tests/run_solver_solve_count_parity.js`
- Modify: `Makefile`, `native/CMakeLists.txt`

- [ ] **Step 1: Script compares JS vs native JSON summaries**

```javascript
// Fail if native.solved < js.solved * 0.95 at same timeout/strategy/heuristic
```

- [ ] **Step 2: Add `make solver_solve_count_parity` initially ALLOW_FAILURE**

- [ ] **Step 3: Promote to required gate once Phase 4 closes gap**

### Task 7.2: Update top-level docs

**Files:**
- Modify: `native/README.md`, `native/PLAN.md`, `AGENTS.md`

- [ ] **Step 1: Document current parity status and which Makefile targets to run**

- [ ] **Step 2: Note JS as oracle for diagnostics; native compile as default**

---

## Self-Review (spec coverage)

| Requirement | Covered by |
|-------------|------------|
| Compiler diagnostics match JS | Phase 1 Tasks 1.1–1.3, gate `compilation_tests` |
| IR/rule-plan match | Phase 1 Task 1.3, existing `rule_plan_parity_tests` |
| Simulation replay match | Phase 2, `simulation_tests` |
| Solver finds same solutions (smoke) | Phase 3 Task 3.1 |
| Solver heuristic solve-count parity | Phase 4 Task 4.5 |
| Solver performance parity | Phase 5 |
| Static opt parity | Phase 6 |
| CI enforcement | Phase 7 |
| No Node in compile path | Phase 1 Task 1.4 |

**Placeholder scan:** No TBD steps. Each task names files, commands, and expected outcomes.

**Type consistency:** Heuristic names, CLI flags, and JSON field names match JS (`run_solver_tests_js.js`) throughout.

---

## Suggested Execution Order (first two weeks)

1. Phase 0 (Tasks 0.1–0.2) — half day
2. Phase 1 Task 1.1 (keyword names) — 1 day
3. Phase 1 Task 1.2 (duplicate-no warning) — half day
4. Phase 3 Task 3.1 (expanded solver smoke) — 1 day
5. Phase 4 Task 4.1 (heuristic CLI) — 1 day
6. Phase 4 Task 4.2 (static dead-cell / A3) — 3 days
7. Phase 4 Task 4.4 (distance-field cache) — 2 days
8. Re-run Phase 0 Step 3 metrics; update baseline note

Defer Phase 6 until solve-count gap after Phase 4 is measured.

---

## Verification Commands (quick reference)

```bash
# Full native correctness
make tests

# Compiler only
make compilation_tests

# Engine replay
make simulation_tests

# Solver smoke parity
make solver_parity_smoke

# Solver corpora (compare manually until Phase 7)
make solver_tests_js SOLVER_TIMEOUT_MS=5000
make solver_tests_cpp SOLVER_TIMEOUT_MS=5000

# Focus perf
make solver_focus_compare
make solver_focus_perf_report
```
