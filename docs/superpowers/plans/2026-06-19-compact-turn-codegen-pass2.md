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

- [ ] **Step 3: Final status**

Report changed files, before/after numbers, correctness/perf commands run, and any remaining bottlenecks.
