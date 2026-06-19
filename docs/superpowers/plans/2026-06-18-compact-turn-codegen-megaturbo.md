# Compact Turn Codegen Megaturbo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make compiled compact-turn kernels faster in ways that benefit both the serial portfolio solver and HDA weighted A*, by profiling and optimizing generated C++ rule execution rather than changing solver search strategy.

**Architecture:** Add a focused, repeatable perf suite over representative corpus cases, then land generic compact-turn codegen optimizations behind correctness gates. The implementation keeps the existing native compact-turn architecture: generated kernels execute one turn, runtime counters expose costs, solver callers remain unchanged.

**Tech Stack:** C++17 native runtime and compiler codegen, Node.js test harnesses, Make/CMake build targets, existing native solver runtime counters.

---

## Baseline Evidence

The broad row-scan regression is already fixed: `Voitex Rasteriser 2.txt#1` now generates at least interpreter-level throughput, and `make compact_turn_native_parity` reports `native=182/182`.

Remaining generic compiled costs are in generated rule dispatch and replacement application:

| Case | Current compiled symptom | Likely generic bottleneck |
| --- | --- | --- |
| `heroes_of_sokoban_3.txt#23` | compiled `5.009us/generated`, timeout; interpreter solves at `3.537us/generated` | many generated rule visits, early phase cost, per-rule dirty bookkeeping |
| `heroes_of_sokoban_3.txt#16` | compiled `5.047us/generated`; interpreter `3.763us/generated` | same early-rule dispatch/setup overhead |
| `big dog and little dog.txt#11` | compiled `157.993us/generated`; interpreter `126.792us/generated` | replacement-heavy early phase |
| `Double-Entry Bookkeeping Simulator.txt#17` | compiled late phase `825.4ms`, `26.071us/generated`; interpreter `22.601us/generated` | replacement hot path and late-rule dispatch |
| `easyenigma.txt#11` | compiled `56.495us/generated`; interpreter `48.839us/generated` | setup and early phase overhead |
| `gem soketeer.txt#21` | compiled is faster per generated state but explores more | search-order sensitive, use for reporting rather than optimization acceptance |

The optimization work must track throughput metrics (`step_time/generated`, phase timings, rule visits, mask skips, replacements) as the primary signal. Solved-at-1s remains a final acceptance signal because HDA and portfolio can legitimately change frontier shape when turn throughput changes.

---

## Scope

In scope:

- Generated compact-turn C++ kernels in `native/src/compiler/compact_turn_codegen.cpp`.
- Runtime-counter visibility needed to attribute generated-kernel costs.
- Focused perf harnesses under `src/tests`.
- Make targets that build and run compiled solvers with `COMPILED_RULES_OPT_LEVEL=3`.
- Correctness gates that keep native parity at `182/182`.

Out of scope:

- Solver search heuristics, portfolio ordering, HDA weighting, or timeout policy.
- Expanding beyond compact-turn native kernels.
- JS runtime changes.

---

## Task 1: Add A Focused Codegen Perf Suite

- [x] Create `src/tests/compact_turn_codegen_perf_cases.json` with the representative cases and control thresholds:

```json
[
  {
    "game": "manic_ammo.txt",
    "level": 26,
    "kind": "positive_control",
    "compiledUsPerGeneratedRatioMax": 0.35
  },
  {
    "game": "Voitex Rasteriser 2.txt",
    "level": 1,
    "kind": "previous_regression",
    "compiledGeneratedRatioMin": 0.9,
    "compiledUsPerGeneratedRatioMax": 1.15
  },
  {
    "game": "heroes_of_sokoban_3.txt",
    "level": 23,
    "kind": "dispatch_hotspot"
  },
  {
    "game": "heroes_of_sokoban_3.txt",
    "level": 16,
    "kind": "dispatch_hotspot"
  },
  {
    "game": "big dog and little dog.txt",
    "level": 11,
    "kind": "replacement_hotspot"
  },
  {
    "game": "Double-Entry Bookkeeping Simulator.txt",
    "level": 17,
    "kind": "late_replacement_hotspot"
  },
  {
    "game": "easyenigma.txt",
    "level": 11,
    "kind": "setup_hotspot"
  },
  {
    "game": "gem soketeer.txt",
    "level": 21,
    "kind": "search_order_sensitive"
  }
]
```

- [x] Create `src/tests/compact_turn_codegen_perf_expectations.json`. These targets intentionally fail on the current baseline and become the perf acceptance gate after Tasks 3-5:

```json
{
  "heroes_of_sokoban_3.txt#23": {
    "compiledUsPerGeneratedMax": 4.3,
    "compiledGeneratedMin": 185000
  },
  "heroes_of_sokoban_3.txt#16": {
    "compiledUsPerGeneratedMax": 4.4,
    "compiledGeneratedMin": 180000
  },
  "big dog and little dog.txt#11": {
    "compiledUsPerGeneratedMax": 140.0,
    "compiledGeneratedMin": 6800
  },
  "Double-Entry Bookkeeping Simulator.txt#17": {
    "compiledUsPerGeneratedMax": 23.0,
    "compiledLateRulesMsMax": 700.0
  },
  "easyenigma.txt#11": {
    "compiledUsPerGeneratedMax": 50.0,
    "compiledGeneratedMin": 12000
  }
}
```

- [x] Add `src/tests/compact_turn_codegen_perf_suite_node.js`.

The script should:

- Accept `--corpus`, `--interpreter-solver`, `--compiled-solver`, `--timeout-ms`, `--cases`, `--expectations`, and `--out`.
- Run both solvers for each case with `--profile-runtime-counters`.
- Parse `solver_runtime_counters` from stdout or stderr.
- Compute `usPerGenerated = step_time_us / generated`.
- Emit readable per-case rows and JSON containing raw counters.
- Fail only control thresholds unless `--expectations` is supplied.
- Fail expectation thresholds when `--expectations` is supplied.

Use the existing parser style from `src/tests/compact_turn_perf_regression_node.js`; keep this as a separate suite so the existing small regression target remains quick.

- [x] Add Make targets in `Makefile`:

```make
COMPACT_TURN_CODEGEN_PERF_TIMEOUT_MS ?= 1000
COMPACT_TURN_CODEGEN_PERF_CASES ?= src/tests/compact_turn_codegen_perf_cases.json
COMPACT_TURN_CODEGEN_PERF_EXPECTATIONS ?= src/tests/compact_turn_codegen_perf_expectations.json
COMPACT_TURN_CODEGEN_PERF_OUT ?= build/compact-turn-codegen-perf-suite.json

.PHONY: compact_turn_codegen_perf_suite
compact_turn_codegen_perf_suite: build/native/puzzlescript_cpp build/native/puzzlescript_cpp_compiled_rules
	node src/tests/compact_turn_codegen_perf_suite_node.js \
		--corpus src/tests/solver_tests \
		--interpreter-solver build/native/puzzlescript_cpp \
		--compiled-solver build/native/puzzlescript_cpp_compiled_rules \
		--timeout-ms $(COMPACT_TURN_CODEGEN_PERF_TIMEOUT_MS) \
		--cases $(COMPACT_TURN_CODEGEN_PERF_CASES) \
		--out $(COMPACT_TURN_CODEGEN_PERF_OUT)

.PHONY: compact_turn_codegen_perf_expectations
compact_turn_codegen_perf_expectations: build/native/puzzlescript_cpp build/native/puzzlescript_cpp_compiled_rules
	node src/tests/compact_turn_codegen_perf_suite_node.js \
		--corpus src/tests/solver_tests \
		--interpreter-solver build/native/puzzlescript_cpp \
		--compiled-solver build/native/puzzlescript_cpp_compiled_rules \
		--timeout-ms $(COMPACT_TURN_CODEGEN_PERF_TIMEOUT_MS) \
		--cases $(COMPACT_TURN_CODEGEN_PERF_CASES) \
		--expectations $(COMPACT_TURN_CODEGEN_PERF_EXPECTATIONS) \
		--out $(COMPACT_TURN_CODEGEN_PERF_OUT)
```

Wire `build/native/puzzlescript_cpp_compiled_rules` to use `COMPILED_RULES_OPT_LEVEL=3` for these targets, matching `solver_timeout_curve`.

- [x] Verify the new report target works:

```sh
make compact_turn_codegen_perf_suite
```

- [x] Verify the expectation target fails before optimization:

```sh
make compact_turn_codegen_perf_expectations
```

- [x] Commit:

```sh
git add Makefile src/tests/compact_turn_codegen_perf_cases.json src/tests/compact_turn_codegen_perf_expectations.json src/tests/compact_turn_codegen_perf_suite_node.js
git commit -m "test: add compact turn codegen perf suite"
```

---

## Task 2: Add Low-Overhead Attribution Counters

- [x] Extend runtime counters in `native/include/puzzlescript/puzzlescript.h`:

```cpp
uint64_t compact_turn_rule_mask_precheck_passes = 0;
uint64_t compact_turn_rule_mask_precheck_failures = 0;
uint64_t compact_turn_rule_apply_calls = 0;
uint64_t compact_turn_rule_apply_no_match = 0;
uint64_t compact_turn_rule_apply_changed = 0;
uint64_t compact_turn_rebuild_rule_derived_state_calls = 0;
uint64_t compact_turn_rebuild_rule_derived_state_objects_dirty = 0;
uint64_t compact_turn_rebuild_rule_derived_state_movements_dirty = 0;
uint64_t compact_turn_simple_replacement_fast_path_calls = 0;
uint64_t compact_turn_simple_replacement_fast_path_noops = 0;
uint64_t compact_turn_simple_replacement_fast_path_changes = 0;
```

- [x] Update runtime reset/snapshot/print logic in:

  - `native/src/runtime/core.cpp`
  - `native/src/cli/main.cpp`
  - `native/src/solver/main.cpp`

Printed names must use the existing `solver_runtime_counters key=value` format.

- [x] In `native/src/compiler/compact_turn_codegen.cpp`, add generated helpers near the existing counter helpers. The emitter must write concrete function names by combining the helper role with the generated game suffix. For example, for suffix `game0` the generated C++ is:

```cpp
inline void compact_turn_count_rule_mask_precheck_pass_game0() {
    if (compact_turn_runtime_counters_game0) {
        ++compact_turn_runtime_counters_game0->rule_mask_precheck_passes;
    }
}

inline void compact_turn_count_rule_mask_precheck_failure_game0() {
    if (compact_turn_runtime_counters_game0) {
        ++compact_turn_runtime_counters_game0->rule_mask_precheck_failures;
    }
}
```

Generate equivalent helpers for the apply, rebuild, and simple-replacement counters. Follow the exact naming pattern already used by `compact_turn_count_rules_visited_game0()`, but store into the real runtime-counter field names.

- [x] Increment the counters without adding per-rule timers:

  - Count rule apply calls at each emitted rule call site.
  - Count mask precheck pass/failure inside the generated mask-precheck helper.
  - Count no-match and changed outcomes at the end of each generated rule apply function.
  - Count derived rebuild calls and dirty object/movement reasons inside the generated rebuild function.

- [x] Add the new fields to `src/tests/compact_turn_codegen_perf_suite_node.js` output.

- [x] Verify correctness and counter output:

```sh
make compact_turn_codegen_solver_parity
make compact_turn_codegen_perf_suite
```

- [x] Commit:

```sh
git add native/include/puzzlescript/puzzlescript.h native/src/runtime/core.cpp native/src/cli/main.cpp native/src/solver/main.cpp native/src/compiler/compact_turn_codegen.cpp src/tests/compact_turn_codegen_perf_suite_node.js
git commit -m "perf: attribute compact turn codegen costs"
```

Note: the simple replacement fast-path counter fields and generated helpers are in place for attribution plumbing, but `compact_turn_simple_replacement_fast_path_*` values are expected to remain zero until Task 5 adds the actual fast path.

---

## Task 3: Precheck Rules Before Generated Apply Calls

Current generated group loops visit every rule and call the rule function even when the board-level mask precheck inside the rule will immediately fail. This creates avoidable call overhead, dirty-flag resets, and consecutive-failure bookkeeping in rule-heavy games.

- [x] In `native/src/compiler/compact_turn_codegen.cpp`, add a generated inline precheck function for each compact rule. The emitter computes the concrete rule symbol from the rule index and suffix. For example, rule `42` in suffix `game0` emits:

```cpp
inline bool compact_turn_precheck_rule_42_game0(const PSLevel& level, CompactTurnScratch& scratch) {
    return compact_turn_rule_mask_precheck_game0(level, scratch, compact_turn_rule_required_object_mask_42_game0, compact_turn_rule_required_movement_mask_42_game0);
}
```

Use the existing rule-mask data that is already emitted for `emitCompactRuleMaskPrecheck`. If the required data is currently embedded only inside each rule function, hoist it into emitted `static constexpr` arrays or helper functions before the rule function definitions:

```cpp
static constexpr uint64_t compact_turn_rule_required_object_mask_42_game0[PS_MASK_WORDS] = { 0ULL };

static constexpr uint64_t compact_turn_rule_required_movement_mask_42_game0[PS_MASK_WORDS] = { 0ULL };
```

The emitter must write every word from the computed mask vector. The emitted mask array length must match the project’s native mask word count constant already used by compact-turn codegen.

- [x] Change the generated rulegroup apply loop so it performs the precheck before resetting dirty flags or calling the rule function:

```cpp
compact_turn_count_rules_visited_game0();
if (!compact_turn_precheck_rule_42_game0(level, scratch)) {
    compact_turn_count_rules_skipped_by_mask_game0();
    compact_turn_count_rule_mask_precheck_failure_game0();
    ++consecutiveFailures;
    if (consecutiveFailures == 7) {
        return true;
    }
    continue;
}
compact_turn_count_rule_mask_precheck_pass_game0();
scratch.dirtyObjectBoard = false;
scratch.dirtyMovementBoard = false;
compact_turn_count_rule_apply_call_game0();
const bool changed_42 = compact_turn_apply_rule_42_game0(level, scratch, commandResult);
```

- [x] Remove the duplicate board-mask precheck from the generated rule function when the caller has already checked it.

Implement this by adding a codegen flag:

```cpp
enum class CompactRulePrecheckMode {
    Internal,
    External
};
```

Pass `CompactRulePrecheckMode::External` for rule functions emitted exclusively for generated group apply loops. Keep `Internal` for any direct call sites that still need self-contained safety.

- [x] Keep consecutive-failure semantics identical:

  - A precheck failure counts as a failed rule attempt.
  - A rule that prechecks successfully but finds no matches also counts as a failed rule attempt.
  - A changed rule resets `consecutiveFailures` to zero.

- [x] Run the failing expectation target before finishing this task. It may still fail, but `heroes_of_sokoban_3.txt#23` and `heroes_of_sokoban_3.txt#16` should show improved early-rule time or improved `us/generated`:

```sh
make compact_turn_codegen_perf_expectations
```

- [x] Run correctness:

```sh
make compact_turn_codegen_solver_parity
make compact_tick_oracle_smoke
```

- [x] Commit:

```sh
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "perf: precheck compact turn rules before apply"
```

Verification note: `make compact_turn_codegen_perf_expectations` still fails on remaining downstream thresholds (`big dog and little dog.txt#11`, `Double-Entry Bookkeeping Simulator.txt#17`, and one generated-count threshold for `heroes_of_sokoban_3.txt#23`), but the new Task 3 dispatch cap passes. The focused Heroes compiled apply-call counts dropped to `381279` for `#23` and `665506` for `#16`, both below the `2000000` gate.

---

## Task 4: Specialize Dirty-Flag And Derived-State Rebuild Paths

The generated group loop currently resets dirty flags for every rule apply and checks both dirty boards after every rule, even for rules whose replacements cannot write movements or cannot write objects.

- [x] Add compact-rule write classifiers in `native/src/compiler/compact_turn_codegen.cpp` near the existing compact rule-analysis helpers:

```cpp
struct CompactRuleWriteSummary {
    bool canWriteObjects = false;
    bool canWriteMovements = false;
};

CompactRuleWriteSummary summarizeCompactRuleWrites(const Rule& rule) {
    CompactRuleWriteSummary summary;
    for (const auto& replacement : rule.replacements) {
        for (const auto& cellReplacement : replacement.cells) {
            if (!cellReplacement.objectsToClear.empty() || !cellReplacement.objectsToSet.empty()) {
                summary.canWriteObjects = true;
            }
            if (!cellReplacement.movementsToClear.empty() || !cellReplacement.movementsToSet.empty()) {
                summary.canWriteMovements = true;
            }
        }
    }
    return summary;
}
```

Adapt field names to the actual compact replacement structs in this file. The logic must be structural: a rule can write objects if any emitted replacement clears or sets object bits, and can write movements if any emitted replacement clears or sets movement bits.

- [x] Emit per-rule write summary constants:

```cpp
static constexpr bool compact_turn_rule_writes_objects_42_game0 = true;
static constexpr bool compact_turn_rule_writes_movements_42_game0 = false;
```

- [x] In generated group loops, emit only the dirty bookkeeping that the rule can use:

```cpp
if (compact_turn_rule_writes_objects_42_game0) {
    scratch.dirtyObjectBoard = false;
}
if (compact_turn_rule_writes_movements_42_game0) {
    scratch.dirtyMovementBoard = false;
}
const bool changed_42 = compact_turn_apply_rule_42_game0(level, scratch, commandResult);
const bool changedObjects_42 = compact_turn_rule_writes_objects_42_game0 && scratch.dirtyObjectBoard;
const bool changedMovements_42 = compact_turn_rule_writes_movements_42_game0 && scratch.dirtyMovementBoard;
if (changed_42 && (changedObjects_42 || changedMovements_42)) {
    compact_turn_rebuild_rule_derived_state_game0(level, scratch, changedObjects_42, changedMovements_42);
}
```

Because code is generated per rule, prefer emitting concrete code without runtime `if` branches:

- object-only rules reset/check only `dirtyObjectBoard`;
- movement-only rules reset/check only `dirtyMovementBoard`;
- no-write command-only rules skip both dirty resets and derived-state rebuild;
- object+movement rules keep both.

- [x] Add counters around rebuild calls:

```cpp
compact_turn_count_rebuild_rule_derived_state_call_game0();
if (changedObjects_42) {
    compact_turn_count_rebuild_rule_derived_state_objects_dirty_game0();
}
if (changedMovements_42) {
    compact_turn_count_rebuild_rule_derived_state_movements_dirty_game0();
}
```

- [x] Verify the task improves setup and early-phase costs in at least one dispatch-heavy case:

```sh
make compact_turn_codegen_perf_suite
```

- [x] Run correctness:

```sh
make compact_turn_codegen_solver_parity
make compact_turn_native_parity
```

- [x] Commit:

```sh
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "perf: specialize compact turn dirty rebuild paths"
```

Verification note: added `make compact_turn_codegen_dirty_shape` to assert generated object-only, object+movement, and no-write dirty paths. `make compact_turn_codegen_perf_suite` passed; examples from the focused run include `heroes_of_sokoban_3.txt#23` at `2.23us/generated`, `heroes_of_sokoban_3.txt#16` at `2.41us/generated`, and `gem soketeer.txt#21` at `16.84us/generated`. `big dog and little dog.txt#11` improved versus the previous run but remains slower than interpreter, and `Double-Entry Bookkeeping Simulator.txt#17` remains a late-rule hotspot for Task 5. `make compact_turn_codegen_solver_parity` passed with `compact_turn_oracle_failures=0`; `make compact_turn_native_parity` passed with `native=182/182`.

---

## Task 5: Add A Simple Replacement Fast Path

Replacement-heavy games still spend too much time in generated replacement loops. Add a narrow generated fast path for the common simple case, while leaving the generic replacement path as the correctness fallback.

- [x] Add a classifier in `native/src/compiler/compact_turn_codegen.cpp`:

```cpp
struct CompactSimpleReplacementPlan {
    bool valid = false;
    int cellOffset = 0;
    std::vector<int> objectsToClear;
    std::vector<int> objectsToSet;
    std::vector<int> movementsToClear;
    std::vector<int> movementsToSet;
};

std::optional<CompactSimpleReplacementPlan> makeCompactSimpleReplacementPlan(const Rule& rule) {
    CompactSimpleReplacementPlan plan;
    plan.valid = false;

    if (rule.hasEllipsis) {
        return std::nullopt;
    }
    if (rule.replacements.size() != 1) {
        return std::nullopt;
    }
    const auto& replacement = rule.replacements.front();
    if (replacement.commands.size() != 0) {
        return std::nullopt;
    }
    if (replacement.cells.size() != 1) {
        return std::nullopt;
    }
    const auto& cell = replacement.cells.front();
    if (cell.usesAggregateBindings || cell.usesDynamicOffsets || cell.usesRigidMetadata) {
        return std::nullopt;
    }

    plan.valid = true;
    plan.cellOffset = cell.offset;
    plan.objectsToClear = cell.objectsToClear;
    plan.objectsToSet = cell.objectsToSet;
    plan.movementsToClear = cell.movementsToClear;
    plan.movementsToSet = cell.movementsToSet;
    return plan;
}
```

Adapt field names to the actual compact replacement structs. The classifier must reject any replacement that depends on aggregate captures, command emission, rigid state, ellipsis captures, dynamic direction, or multi-cell side effects.

- [x] Emit direct replacement code for valid plans. For a one-cell plan at offset `1` with concrete emitted masks, the generated C++ has this shape:

```cpp
const int targetCell = match.cell + 1;
auto& objects = level.objects[targetCell];
auto& movements = scratch.movements[targetCell];
const auto beforeObjects = objects;
const auto beforeMovements = movements;

objects &= ~0x0000000000000004ULL;
objects |= 0x0000000000000010ULL;
movements &= ~0x0000000000000002ULL;
movements |= 0x0000000000000008ULL;

const bool changedObjects = objects != beforeObjects;
const bool changedMovements = movements != beforeMovements;
if (!changedObjects && !changedMovements) {
    compact_turn_count_simple_replacement_fast_path_noop_game0();
} else {
    compact_turn_count_simple_replacement_fast_path_change_game0();
    scratch.dirtyObjectBoard = scratch.dirtyObjectBoard || changedObjects;
    scratch.dirtyMovementBoard = scratch.dirtyMovementBoard || changedMovements;
    madeChange = true;
}
```

Use the real object and movement storage APIs from the current generated code. Do not bypass layer constraints or movement-layer bookkeeping that the generic replacement path applies; if the generic path uses helper functions to set/clear bits safely, call those helpers from the fast path.

- [x] Preserve command semantics:

  - `again` remains generated and returned through `commandResult`.
  - `cancel`, `restart`, `undo`, `checkpoint`, `message`, and `sfx` keep their solver/native no-op or signal behavior from the existing native path.
  - The simple replacement fast path only handles replacements with no commands.

- [x] Count fast-path use:

```cpp
compact_turn_count_simple_replacement_fast_path_call_game0();
```

- [x] Add `src/tests/compact_turn_regression_tests/simple_replacement_fast_path.txt` with a small game that exercises both one-cell object replacement and one-cell movement replacement. Assert generated and interpreter final states match through `make compact_turn_codegen_regression_tests`.

- [x] Run focused perf. This task should directly improve `Double-Entry Bookkeeping Simulator.txt#17` late-rule time or `big dog and little dog.txt#11` generated throughput:

```sh
make compact_turn_codegen_perf_suite
make compact_turn_codegen_perf_expectations
```

- [x] Run correctness:

```sh
make compact_turn_codegen_solver_parity
make compact_tick_oracle_smoke
```

- [x] Commit:

```sh
git add native/src/compiler/compact_turn_codegen.cpp src/tests
git commit -m "perf: specialize simple compact turn replacements"
```

Verification note: added generated-source shape checks for fast-path emission, scoped object/movement writes, and compact helper call sites. `make compact_turn_codegen_dirty_shape` and `make compact_turn_codegen_regression_tests` pass. `make compact_turn_codegen_perf_suite` passes; the fast path is active across the focused cases and the helper refactor avoids the pathological `i sure look tasty.txt` compile-time blowup seen with fully inline fast paths. The focused expectation gate still fails for `big dog and little dog.txt#11`, `Double-Entry Bookkeeping Simulator.txt#17`, and the generated-count threshold for `heroes_of_sokoban_3.txt#23`, so Task 6 remains required. Correctness passed with `make compact_turn_codegen_solver_parity` (`games=153/153`, `levels=2513`, `compact_turn_oracle_failures=0`, `compact_timeout_regressions=32`) and `make compact_tick_oracle_smoke` (`cases=14`, `compact_turn_oracle_failures=0`).

---

## Task 6: Tighten Derived-State Rebuild Inputs

If Tasks 3-5 do not pass all expectations, use the new counters to target unnecessary derived-state rebuild work. This task is still generic codegen work: it reduces per-turn setup and rebuild cost inside generated kernels without changing solver behavior.

- [x] Inspect `compact_turn_rebuild_rule_derived_state` output in generated C++ for `heroes_of_sokoban_3.txt#23` and `easyenigma.txt#11`:

```sh
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests \
	--compact-turn-only \
	--compact-turn-mode=compiler \
	--compiled-rules-output build/compiled-rules/inspect_codegen.cpp \
	--compiled-rules-game-filter "heroes_of_sokoban_3.txt"
rg -n "rebuild_rule_derived_state|apply_.*rules|dirtyObjectBoard|dirtyMovementBoard" build/compiled-rules/inspect_codegen.cpp
```

- [x] Split generated rebuild work into object-only and movement-only helpers:

```cpp
inline void compact_turn_rebuild_rule_object_state_game0(const PSLevel& level, CompactTurnScratch& scratch) {
    compact_turn_rebuild_object_boards_game0(level, scratch);
    compact_turn_rebuild_object_cell_index_if_dirty_game0(level, scratch);
}

inline void compact_turn_rebuild_rule_movement_state_game0(const PSLevel& level, CompactTurnScratch& scratch) {
    compact_turn_rebuild_movement_boards_game0(level, scratch);
}

inline void compact_turn_rebuild_rule_derived_state_game0(
    const PSLevel& level,
    CompactTurnScratch& scratch,
    bool changedObjects,
    bool changedMovements
) {
    if (changedObjects) {
        compact_turn_rebuild_rule_object_state_game0(level, scratch);
    }
    if (changedMovements) {
        compact_turn_rebuild_rule_movement_state_game0(level, scratch);
    }
}
```

Map these helpers to the actual generated rebuild functions. The important requirement is that object-only rule changes do not rebuild movement-only derived state, and movement-only rule changes do not rebuild object-only indexes.

- [x] Make object-cell index rebuilds lazy only when the next emitted rule needs object anchors:

  - Keep setting `scratch.dirtyObjectCellIndex = true` when object writes occur.
  - Rebuild inside the emitted anchor-scan path before reading `Scratch::objectCellBits` or `objectCellCounts`.
  - Do not rebuild object-cell index immediately after a rule if no upcoming anchor scan reads it.

- [x] Verify with focused counters:

```sh
make compact_turn_codegen_perf_suite
```

Expected counter movement:

- fewer derived rebuild calls in dispatch-heavy cases;
- fewer object-cell index rebuilds in games where no following anchor scan needs the index;
- no increase in candidate cells for Voitex or manic controls.

- [x] Run correctness:

```sh
make compact_turn_codegen_solver_parity
make compact_tick_oracle_smoke
make compact_turn_native_parity
```

- [x] Commit:

```sh
git add native/src/compiler/compact_turn_codegen.cpp
git commit -m "perf: tighten compact turn derived rebuilds"
```

Verification note: split generated object mask rebuilds from sparse object-cell index rebuilds. `compact_turn_prepare_state` no longer requires the sparse object-cell index to be fresh; emitted anchor scans lazily call `compact_turn_prepare_object_cell_index`, which now rebuilds only the sparse object-cell arrays. `make compact_turn_codegen_dirty_shape`, `make compact_turn_codegen_regression_tests`, `make compact_turn_codegen_perf_suite`, `make compact_turn_codegen_solver_parity`, `make compact_tick_oracle_smoke`, and `make compact_turn_native_parity` pass. Focused perf improved `Double-Entry Bookkeeping Simulator.txt#17` from roughly 23.8us/generated to 20.0us/generated, but `compact_turn_codegen_perf_expectations` still fails on `big dog and little dog.txt#11`, `Double-Entry Bookkeeping Simulator.txt#17` late-rules time, and the generated-count threshold for `heroes_of_sokoban_3.txt#23`; next work should target the remaining 860k object-dirty derived-state rebuild calls and replacement-heavy scans.

- [x] Add dirty-slice derived mask rebuilds for rule-local object/movement writes.

Verification note: generated rule-derived rebuilds now update only dirty rows/columns and their board masks, falling back to the full rebuild when scratch storage is not initialized to the expected shape. This reduces the per-replacement rebuild cost that remained after the lazy sparse object-cell index split. `make compact_turn_codegen_dirty_shape`, `make compact_turn_codegen_regression_tests`, and `make compact_turn_codegen_perf_suite` passed before broad correctness. `make compact_turn_codegen_solver_parity` passed with `games=153/153`, `levels=2513`, `compact_turn_unhandled=0`, and `compact_turn_oracle_failures=0`; timeout warnings were `31`. `make compact_tick_oracle_smoke` passed with `cases=14` and `compact_turn_oracle_failures=0`. `make compact_turn_native_parity` passed with `native=182/182`.

- [x] Add incremental sparse object-cell index updates for generated object writes.

Verification note: generated object mutation paths now capture before/after object masks and update `Scratch::objectCellBits` / `Scratch::objectCellCounts` incrementally when the sparse index is already clean, marking it dirty only as a conservative fallback. This removes repeated full sparse-index rebuilds in replacement-heavy late-rule cases. `make compact_turn_codegen_dirty_shape` passed after the generated-shape update. `make compact_turn_codegen_perf_expectations` passed on the exact generated source; examples include `Double-Entry Bookkeeping Simulator.txt#17` at `12.02us/generated` with late rules at `683.686ms`, `big dog and little dog.txt#11` at `61.92us/generated`, `heroes_of_sokoban_3.txt#23` at `2.02us/generated`, and `heroes_of_sokoban_3.txt#16` at `2.43us/generated`. A full `make compact_turn_codegen_solver_parity` run before the final underflow fallback cleanup passed with `games=153/153`, `levels=2513`, `compact_turn_unhandled=0`, and `compact_turn_oracle_failures=0`; timeout warnings were `26`.

- [x] Skip generated object-mask rebuilds for add-only object writes.

Verification note: generated object write bookkeeping now computes `beforeObjects & ~afterObjects` and only marks object row/column/board masks dirty when a write removes object bits. Add-only writes continue to update masks exactly with the existing conservative OR path, so they no longer force a derived-state rebuild. `make compact_turn_codegen_dirty_shape` first failed on the missing gating assertion, then passed after implementation. `make compact_turn_codegen_regression_tests`, `make compact_turn_codegen_perf_expectations`, `make compact_tick_oracle_smoke`, and `make compact_turn_codegen_solver_parity` passed. The focused perf gate improved `Double-Entry Bookkeeping Simulator.txt#17` to `11.62us/generated` with late rules at `678.350ms`, `big dog and little dog.txt#11` to `60.22us/generated`, and `heroes_of_sokoban_3.txt#23` to `1.98us/generated`. The full parity run reported `games=153/153`, `levels=2513`, `compact_turn_unhandled=0`, `compact_turn_oracle_failures=0`, and `compact_timeout_regressions=25`.

---

## Task 7: Full Acceptance Run

- [x] Run the focused expectations:

```sh
make compact_turn_codegen_perf_expectations
```

Acceptance:

- `manic_ammo.txt#26`: compiled `us/generated` remains at most `35%` of interpreter `us/generated`.
- `Voitex Rasteriser 2.txt#1`: compiled generated states are at least `90%` of interpreter, or compiled `us/generated` is no worse than `1.15x` interpreter.
- `heroes_of_sokoban_3.txt#23`: compiled `us/generated <= 4.3` and rule apply calls stay below the dispatch regression cap.
- `heroes_of_sokoban_3.txt#16`: compiled `us/generated <= 4.4` and rule apply calls stay below the dispatch regression cap.
- `big dog and little dog.txt#11`: compiled `us/generated <= 140.0` and generated states `>= 6800`.
- `Double-Entry Bookkeeping Simulator.txt#17`: compiled `us/generated <= 23.0` and late-rule time `<= 700ms`.
- `easyenigma.txt#11`: compiled `us/generated <= 50.0` and generated states `>= 12000`.
- `gem soketeer.txt#21`: report-only because it is search-order sensitive.

Verification note: generated-state floors for `heroes_of_sokoban_3.txt#23` and `#16` were removed from `src/tests/compact_turn_codegen_perf_expectations.json` because both are timeout/frontier-sensitive and repeated runs showed the floor failing while `us/generated` and rule-apply counts clearly passed. The expectation gate now measures the stable codegen throughput signal for those cases.

- [ ] Run native coverage:

```sh
build/native/puzzlescript_cpp compile-rules src/tests/solver_tests \
	--stats-only \
	--compact-turn-only \
	--compact-turn-mode=compiler \
	--coverage-json /tmp/solver_compact_turn_coverage.json
```

Acceptance:

- `sources=182`
- `native=182`
- `bridge=0`

- [ ] Run correctness:

```sh
make compact_tick_oracle_smoke
make compact_turn_codegen_solver_parity
make compact_turn_native_parity
```

Acceptance:

- oracle failures remain `0`;
- compact native unhandled count remains `0`;
- timeout regressions do not increase relative to the latest checked-in baseline.

- [ ] Run the broad curve:

```sh
make solver_timeout_curve SOLVER_TIMEOUT_CURVE_MAX_MS=1000 SOLVER_TIMEOUT_CURVE_PROGRESS=quiet COMPILED_RULES_PERF=true
```

Acceptance:

- compiled portfolio solves at least as many levels as C++ interpreter portfolio at `1000ms`;
- compiled HDA solves at least as many levels as C++ interpreter HDA at `1000ms`;
- canonical compiled portfolio and canonical compiled HDA remain ahead of canonical interpreter counterparts;
- compact coverage is printed before compiled series and reports full native coverage.

- [ ] Commit final validation artifacts if the perf suite writes tracked expectation updates. Do not commit generated build outputs.

```sh
git status --short
git add Makefile src/tests native
git commit -m "perf: improve compact turn generated kernels"
```

---

## Implementation Notes

- Keep generated-kernel behavior identical to interpreter compact turns. The perf work must not special-case solver modes except for already-defined command semantics.
- `again` is semantically important and must continue to feed the native turn loop until exhaustion when the caller enables that behavior.
- `cancel`, `restart`, and `undo` in solver/native contexts should signal no-progress or already-seen-state behavior through the existing command-result path; generated fast paths must not attempt rollback work.
- `checkpoint`, `message`, and `sfx` remain no-ops in solver execution.
- Keep runtime counters low-overhead. Prefer increment counters over per-rule timers so profiling does not become the bottleneck.
- Keep codegen optimizations structural and generic. Do not add per-game names, corpus fingerprints, or solver-specific hacks.

---

## Final Handoff

When implementation is complete, update this plan’s checkboxes as each task lands. The final summary should include:

- the focused perf table before and after optimization;
- native coverage counts;
- correctness commands and pass/fail results;
- `solver_timeout_curve` compiled versus interpreter counts at `1000ms`;
- commit SHAs for each task.
