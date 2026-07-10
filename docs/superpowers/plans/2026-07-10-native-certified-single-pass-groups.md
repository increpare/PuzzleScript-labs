# Native Certified Single-Pass Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure redundant native rule-group confirmation work and, when the measurement justifies it, skip that work for groups carrying the JS analyzer's `single_pass_safe` certificate.

**Architecture:** Checkpoint 1 extends the existing runtime-counter pipeline without changing execution. Checkpoint 2 preserves certified group IDs in the JS hint manifest, maps them to native early/late group indexes, and attaches opt-in flags to a cloned `Game`; `applyRuleGroup` then stops after the first pass only for flagged groups. Specialized backends and uncertified groups retain existing behavior.

**Tech Stack:** C++17 native runtime and solver, C API counters, Node.js analyzer/hint tooling and test harnesses, CMake/Make.

---

### Task 1: Add Confirmation-Pass Counter Contracts

**Files:**
- Modify: `src/tests/native_runtime_counters_node.js`
- Modify: `native/include/puzzlescript/puzzlescript.h`
- Modify: `native/src/runtime/core.hpp`
- Modify: `native/src/runtime/core.cpp`
- Modify: `native/src/solver/main.cpp`

- [ ] **Step 1: Write the failing counter-schema assertions**

Add these keys to `requiredKeys` in `native_runtime_counters_node.js`:

```js
'rule_group_invocations',
'rule_group_passes',
'rule_group_confirmation_passes',
'rule_group_confirmation_rule_visits',
```

Add focused invariants after parsing the default `push_goal.txt` probe:

```js
assert.ok(counters.rule_group_invocations > 0);
assert.ok(counters.rule_group_passes >= counters.rule_group_invocations);
assert.ok(counters.rule_group_confirmation_passes > 0);
assert.ok(counters.rule_group_confirmation_rule_visits >= counters.rule_group_confirmation_passes);
assert.ok(counters.rule_group_confirmation_rule_visits <= counters.rules_visited);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
make native_runtime_counters_tests
```

Expected: FAIL because the four counter keys are absent.

- [ ] **Step 3: Extend the public and internal counter schemas**

Append four `uint64_t` fields to `ps_runtime_counters`:

```cpp
uint64_t rule_group_invocations;
uint64_t rule_group_passes;
uint64_t rule_group_confirmation_passes;
uint64_t rule_group_confirmation_rule_visits;
```

Add matching `RuntimeCounterStorage` atomics, `RuntimeCounterId` values, reset cases, snapshot assignments, and `addRuntimeCounter` switch cases. Emit all four as `key=value` fields from the solver's existing `solver_runtime_counters` line.

- [ ] **Step 4: Count only terminal no-change confirmation passes**

In the interpreted, non-random `applyRuleGroup` path:

```cpp
addCounter(gRuntimeCounters.ruleGroupInvocations);
```

At each fixpoint-loop iteration, count a pass and track its rule visits:

```cpp
addCounter(gRuntimeCounters.ruleGroupPasses);
uint64_t rulesVisitedThisPass = 0;
```

Increment `rulesVisitedThisPass` beside `rulesVisited`. After the `for` loop,
count a confirmation only when the group had changed on an earlier iteration
and this iteration made no change:

```cpp
if (hasChanges && !madeChange) {
    addCounter(gRuntimeCounters.ruleGroupConfirmationPasses);
    addCounter(gRuntimeCounters.ruleGroupConfirmationRuleVisits, rulesVisitedThisPass);
}
```

This excludes productive follow-up fixpoint iterations.

- [ ] **Step 5: Build and verify GREEN**

Run:

```bash
cmake --build build --target puzzlescript_solver -j4
make native_runtime_counters_tests
make solver_smoke_tests
make solver_parity_smoke
```

Expected: all commands pass.

- [ ] **Step 6: Commit the measurement checkpoint**

```bash
git add native/include/puzzlescript/puzzlescript.h native/src/runtime/core.hpp native/src/runtime/core.cpp native/src/solver/main.cpp src/tests/native_runtime_counters_node.js
git commit -m "Measure rule group confirmation passes"
```

### Task 2: Measure and Decide Whether to Continue

**Files:**
- Generated: `build/native/n9-confirmation-counters-smoke-50.json`
- Generated: `build/native/n9-confirmation-counters-wide.json`
- Modify: `docs/solver-forensics/2026-07-03-native-interpreter-optimization-plan.md`
- Modify: `docs/solver-forensics/2026-07-03-project-strategy-recommendations.md`

- [ ] **Step 1: Capture named-slice counter artifacts**

Run one counter-enabled pass per target:

```bash
node src/tests/run_solver_level_benchmark.js build/native/puzzlescript_solver src/tests/solver_tests build/solver-bench/smoke-50.json --runs 1 --out build/native/n9-confirmation-counters-smoke-50.json --timeout-ms 500 --strategy portfolio --jobs 1 --profile-runtime-counters
node src/tests/run_solver_level_benchmark.js build/native/puzzlescript_solver build/native/nx1-anonymous-game-corpus build/native/nx1-anonymous-game-playable-levels.json --runs 1 --out build/native/n9-confirmation-counters-wide.json --timeout-ms 500 --strategy portfolio --jobs 1 --profile-runtime-counters
```

- [ ] **Step 2: Compute addressable rule-visit shares**

For each artifact, sum `rule_group_confirmation_rule_visits` and
`rules_visited` across samples and report:

```text
confirmation_visit_share = confirmation_rule_visits / rules_visited
```

Also report confirmation passes per generated state and the solved split.

- [ ] **Step 3: Apply the continuation gate**

Continue to Task 3 when either named slice has at least 5% confirmation-visit
share. If both are below 5%, document N9a as rejected, commit the documentation,
and stop without adding a consumer.

### Task 3: Preserve S2 Certificates in Native Hint Manifests

**Files:**
- Modify: `src/tests/run_native_solver_js_coverage.js`
- Modify: `src/tests/native_solver_js_coverage_node.js`
- Modify: `native/src/solver/heuristics.hpp`
- Modify: `native/src/solver/main.cpp`

- [ ] **Step 1: Write failing manifest tests**

Extend `native_solver_js_coverage_node.js` with an analyzed fixture containing
one forward-only and one backward-enabling group. Assert the generated game
entry preserves only the analyzer fact fields needed by native:

```js
assert.deepStrictEqual(
    game.facts.rulegroup_flow
        .filter(fact => fact.value.single_pass_safe)
        .map(fact => fact.subjects.groups[0]),
    ['early_group_0']
);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node src/tests/native_solver_js_coverage_node.js
```

Expected: FAIL because `rulegroup_flow` is not preserved.

- [ ] **Step 3: Serialize the minimal certificate facts**

Add `rulegroupFlowFactsFromReport(report)` beside
`winRelevanceFactsFromReport`. Preserve:

```js
{
    id: fact.id,
    subjects: { groups: stringArray(fact.subjects && fact.subjects.groups) },
    value: { single_pass_safe: fact.value.single_pass_safe === true },
}
```

Attach a non-empty array as `gameEntry.facts.rulegroup_flow`.

- [ ] **Step 4: Parse conservative early/late indexes**

Add to `StaticAnalysisHints`:

```cpp
std::vector<int32_t> singlePassEarlyGroupIndexes;
std::vector<int32_t> singlePassLateGroupIndexes;
```

In `parseStaticAnalysisHintsForGame`, accept only facts whose
`single_pass_safe` is true and whose sole group ID exactly matches
`early_group_<N>` or `late_group_<N>`. Keep only indexes within
`game.rules.size()` or `game.lateRules.size()`, then sort and deduplicate.
Malformed and out-of-range IDs contribute no certificate.

- [ ] **Step 5: Verify manifest and native parsing tests**

Run:

```bash
node src/tests/native_solver_js_coverage_node.js
make native_static_analysis_parity_tests
```

Expected: both pass.

### Task 4: Add the Opt-In Native Consumer

**Files:**
- Create: `src/tests/native_solver_single_pass_groups_node.js`
- Modify: `native/src/runtime/core.hpp`
- Modify: `native/src/runtime/core.cpp`
- Modify: `native/src/solver/main.cpp`
- Modify: `Makefile`

- [ ] **Step 1: Write failing native behavior tests**

Create a test that builds a temporary corpus and hint manifest from the checked
in `rulegroup_flow` forward/backward fixtures. Run baseline and candidate with
`--solver-certified-single-pass-groups` and assert:

```js
assert.deepStrictEqual(candidate.results[0].solution, baseline.results[0].solution);
assert.strictEqual(candidate.results[0].status, baseline.results[0].status);
assert.ok(candidateCounters.rule_group_confirmation_passes < baselineCounters.rule_group_confirmation_passes);
```

Run the backward-enabling fixture and assert candidate final status/solution
remain identical because its group is not certified. Run once with malformed
group IDs and assert confirmation counters are unchanged.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node src/tests/native_solver_single_pass_groups_node.js build/native/puzzlescript_solver
```

Expected: FAIL because the CLI option is unsupported.

- [ ] **Step 3: Add game-attached certificate flags**

Add to `GameInformation`:

```cpp
std::vector<uint8_t> solverSinglePassRuleGroups;
std::vector<uint8_t> solverSinglePassLateRuleGroups;
```

Add `Options::solverCertifiedSinglePassGroups` and parse
`--solver-certified-single-pass-groups`. Before solving, clone the game only
when the option is enabled and at least one valid hint exists; size the vectors
to the early/late rule-group counts and set certified indexes to `1`.

- [ ] **Step 4: Stop certified groups after their first pass**

In `applyRuleGroup`, read the flag using `groupIndex` and `late`. After the
first pass has processed every active rule and any changes have been committed,
break the fixpoint loop when the group is certified:

```cpp
if (madeChange && certifiedSinglePass) {
    hasChanges = true;
    break;
}
```

Do not alter random-group or specialized-backend branches.

- [ ] **Step 5: Wire the Make target and verify GREEN**

Add the new node test to the solver test targets, then run:

```bash
cmake --build build --target puzzlescript_solver -j4
node src/tests/native_solver_single_pass_groups_node.js build/native/puzzlescript_solver
make solver_smoke_tests
make solver_parity_smoke
make solver_determinism_tests
make simulation_tests_cpp
```

Expected: all pass.

### Task 5: Full Verification, Benchmark, and Decision

**Files:**
- Generated: `build/native/n9-single-pass-*.json`
- Modify: `docs/solver-forensics/2026-07-03-native-interpreter-optimization-plan.md`
- Modify: `docs/solver-forensics/2026-07-03-project-strategy-recommendations.md`
- Modify: `docs/solver-forensics/2026-07-03-static-analyzer-extension-proposals.md`
- Modify: `src/tests/JS_SOLVER_NEXT.md`

- [ ] **Step 1: Run the complete correctness gate**

```bash
node src/tests/run_tests_node.js
node src/tests/static_analysis_testdata_runner.js
node src/tests/run_static_analysis_runtime_contracts_node.js
make native_static_analysis_parity_tests
make native_runtime_counters_tests
make solver_smoke_tests
make solver_parity_smoke
make solver_determinism_tests
make simulation_tests_cpp
```

Expected: every command passes.

- [ ] **Step 2: Run three paired raw benchmark repetitions**

Use `run_solver_level_benchmark.js` with counters disabled for baseline and
candidate on `smoke-50` and the wide portfolio, three runs per target. Candidate
arguments are the generated hints plus
`--solver-certified-single-pass-groups`.

- [ ] **Step 3: Attribute the measured delta**

Repeat one counter-enabled candidate run and report confirmation passes/rule
visits removed, generated-state throughput, summed step time, solved splits,
and per-level flips against baseline.

- [ ] **Step 4: Record the decision**

Promote only when parity is clean and repeated throughput is positive outside
the named slice's noise band. Otherwise leave the option explicit or back out
the consumer while retaining the measurement counters. Update all four roadmap
surfaces with artifact paths and exact numbers.

- [ ] **Step 5: Commit and sync local master**

```bash
git add Makefile native src/tests docs/solver-forensics
git commit -m "Consume certified single-pass rule groups"
git -C /Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs merge --ff-only codex/n2-static-movement-anchor-masks
```
