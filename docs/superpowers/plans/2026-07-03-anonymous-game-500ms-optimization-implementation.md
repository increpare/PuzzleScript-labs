# Anonymous Game 500ms Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 2026-07-03 solver assessment into measured JS-first probes and the first safe optimization candidates for improving 500ms solver throughput.

**Architecture:** Keep the superior-model assessment as the source of hypotheses, then add small env-gated instrumentation and report changes before changing solver semantics. Only prototype movement-aware pruning behind an opt-in flag, and prove it with existing simulation tests plus paired solver comparisons before considering it for default use.

**Tech Stack:** Node.js solver harness (`src/tests/run_solver_tests_js.js`), PuzzleScript JS engine (`src/js/engine.js`), solver static optimizer (`src/tests/solver_static_opt.js`), existing JSON report builder (`src/tests/build_solver_forensics_report.js`), existing Node smoke tests.

---

## Source Inputs

- Assessment: `docs/solver-forensics/2026-07-03-anonymous-game-500ms-optimization-plan.md`
- Prior report: `docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md`
- Local single-game evidence: `build/solver-forensics/anonymous-js-first-500ms/`
- Single-game corpus fixture: `build/solver-forensics/anonymous-js-first-500ms/input-corpus/ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt`

## File Map

- Modify `src/tests/build_solver_forensics_report.js`: refine per-level triage so native-solved-after-500ms levels are not hidden inside generic step-cost timeouts; include new measurement fields in summaries when present.
- Modify `src/tests/build_solver_forensics_report_node.js`: regression coverage for the new triage category and new optional summary fields.
- Modify `src/tests/run_solver_tests_js.js`: add env-gated `again` multiplier counters, per-rule hotspot counters, and optional adaptive strategy fields.
- Modify `src/tests/js_solver_instrumentation_pack_node.js`: smoke-test the new instrumentation fields without requiring a hard corpus run.
- Create `src/tests/movement_aware_prune_solver_compare_node.js`: paired off/on solver comparison for the movement-aware prune prototype.
- Modify `src/js/engine.js`: add an opt-in movement-aware version of the existing inner-loop incremental prune guard.
- Modify `src/tests/JS_SOLVER_NEXT.md`: append dated results and decisions from the probes.
- Create `docs/solver-forensics/2026-07-03-anonymous-game-500ms-experiment-results.md`: concise results log for X1-X7 evidence.

---

### Task 1: Refine Native-Solved Triage In The Report Builder

**Files:**
- Modify: `src/tests/build_solver_forensics_report.js`
- Modify: `src/tests/build_solver_forensics_report_node.js`
- Output: `docs/solver-forensics/2026-07-03-anonymous-game-500ms-experiment-results.md`

- [ ] **Step 1: Write the failing triage test**

In `src/tests/build_solver_forensics_report_node.js`, change the native level 3 fixture so it is solved after 500ms:

```js
const nativeRun = {
    results: [
        { game: 'hard.txt', level: 0, status: 'skipped_message', elapsed_ms: 0 },
        { game: 'hard.txt', level: 1, status: 'solved', elapsed_ms: 90, generated: 15, expanded: 4, step_ms: 4, heuristic_ms: 1 },
        { game: 'hard.txt', level: 2, status: 'solved', elapsed_ms: 300, generated: 900, expanded: 200, step_ms: 100, heuristic_ms: 10 },
        { game: 'hard.txt', level: 3, status: 'solved', elapsed_ms: 1500, generated: 700, expanded: 250, step_ms: 10, heuristic_ms: 70 },
    ],
};
```

Then update the level 3 assertion:

```js
assert.strictEqual(triage.find((row) => row.level === 3).category, 'js_missed_native_solved_after_500ms');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node src/tests/build_solver_forensics_report_node.js
```

Expected: failure showing level 3 is still classified as `high_heuristic_cost_timeout` or `high_step_cost_timeout`.

- [ ] **Step 3: Implement native-solved triage categories**

In `src/tests/build_solver_forensics_report.js`, replace the native solved check in `triageCategory` with helper logic:

```js
function nativeSolvedCategory(row, nativeMaps) {
    let solvedAfter500 = false;
    for (const map of nativeMaps) {
        const native = map.get(rowKey(row));
        if (!native || native.status !== 'solved') {
            continue;
        }
        if (numeric(native, 'elapsed_ms') <= 500) {
            return 'js_missed_native_solved';
        }
        solvedAfter500 = true;
    }
    return solvedAfter500 ? 'js_missed_native_solved_after_500ms' : null;
}

function triageCategory(row, nativeMaps) {
    if (row.status === 'solved' && numeric(row, 'elapsed_ms') <= 500) return 'solved_under_500ms';
    if (row.status === 'solved') return 'solved_after_500ms';
    const nativeCategory = nativeSolvedCategory(row, nativeMaps);
    if (nativeCategory) return nativeCategory;
    const generated = numeric(row, 'generated');
    const stepMs = numeric(row, 'step_ms');
    const heuristicMs = numeric(row, 'heuristic_ms');
    if (stepMs >= heuristicMs && stepMs >= 50) return 'high_step_cost_timeout';
    if (heuristicMs > stepMs && heuristicMs >= 20) return 'high_heuristic_cost_timeout';
    if (generated >= 1000) return 'high_expansion_timeout';
    return row.status || 'other';
}
```

- [ ] **Step 4: Run the report-builder test**

Run:

```bash
node src/tests/build_solver_forensics_report_node.js
```

Expected: `build_solver_forensics_report_node passed`.

- [ ] **Step 5: Commit**

```bash
git add src/tests/build_solver_forensics_report.js src/tests/build_solver_forensics_report_node.js
git commit -m "fix: distinguish native-solved solver triage levels"
```

---

### Task 2: Add Again-Pass And ProcessInput Counters

**Files:**
- Modify: `src/tests/run_solver_tests_js.js`
- Modify: `src/tests/js_solver_instrumentation_pack_node.js`

- [ ] **Step 1: Write the smoke test**

In `src/tests/js_solver_instrumentation_pack_node.js`, add this block after the existing baseline JSON run:

```js
const againProfiled = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions'],
    {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: Object.assign({}, process.env, { PUZZLESCRIPT_SOLVER_AGAIN_PROFILE: '1' }),
    },
));
assert.ok(Number.isFinite(againProfiled.results[0].process_input_calls), 'process_input_calls should be numeric');
assert.ok(Number.isFinite(againProfiled.results[0].again_passes), 'again_passes should be numeric');
assert.ok(againProfiled.results[0].process_input_calls >= againProfiled.results[0].generated);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node src/tests/js_solver_instrumentation_pack_node.js
```

Expected: failure because `process_input_calls` and `again_passes` are absent.

- [ ] **Step 3: Add result fields**

In `src/tests/run_solver_tests_js.js`, near `SOLVER_STEP_PROFILE`, add:

```js
const SOLVER_AGAIN_PROFILE = process.env.PUZZLESCRIPT_SOLVER_AGAIN_PROFILE === '1';
```

In `createSolverResult`, add:

```js
        process_input_calls: 0,
        again_passes: 0,
```

In compile-error result objects and `totals(results)`, add the same fields with zero defaults and sums:

```js
        process_input_calls: 0,
        again_passes: 0,
```

```js
        out.process_input_calls += result.process_input_calls || 0;
        out.again_passes += result.again_passes || 0;
```

- [ ] **Step 4: Count processInput calls and again passes**

Change `settleAgain` to accept the current result and return a pass count:

```js
function settleAgain(stepProfile = null) {
    let passes = 0;
    // Some corpus games intentionally use `again` as animation. robot arm has
    // a reachable 3-cycle, so the cap is load-bearing for solver harnesses.
    for (; passes < 500 && againing; passes++) {
        againing = false;
        if (SOLVER_AGAIN_PROFILE && stepProfile) {
            stepProfile.process_input_calls = (stepProfile.process_input_calls || 0) + 1;
        }
        processInput(-1, undefined, undefined, true);
    }
    if (SOLVER_AGAIN_PROFILE && stepProfile) {
        stepProfile.again_passes = (stepProfile.again_passes || 0) + passes;
    }
    return passes;
}
```

In `stepSolverAction`, increment the primary call and pass the profile into `settleAgain`:

```js
        } else {
            if (SOLVER_AGAIN_PROFILE && stepProfile) {
                stepProfile.process_input_calls = (stepProfile.process_input_calls || 0) + 1;
            }
            changed = Boolean(processInput(action.input, undefined, undefined, true));
        }
```

```js
        settleAgain(stepProfile);
```

- [ ] **Step 5: Run tests**

Run:

```bash
node src/tests/js_solver_instrumentation_pack_node.js
node src/tests/run_tests_node.js
```

Expected:
- `js_solver_instrumentation_pack_node passed`
- `Passed:  753`, `Failed:  0`, `Errors:  0`

- [ ] **Step 6: Commit**

```bash
git add src/tests/run_solver_tests_js.js src/tests/js_solver_instrumentation_pack_node.js
git commit -m "test: measure solver again pass multiplier"
```

---

### Task 3: Add Per-Rule Hotspot Counters

**Files:**
- Modify: `src/tests/run_solver_tests_js.js`
- Modify: `src/tests/js_solver_instrumentation_pack_node.js`

- [ ] **Step 1: Write the smoke test**

In `src/tests/js_solver_instrumentation_pack_node.js`, add:

```js
const hotspotProfiled = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions'],
    {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: Object.assign({}, process.env, {
            PUZZLESCRIPT_SOLVER_STEP_PROFILE: '1',
            PUZZLESCRIPT_SOLVER_RULE_HOTSPOTS: '1',
        }),
    },
));
assert.ok(Array.isArray(hotspotProfiled.results[0].rule_hotspots), 'rule_hotspots should be an array');
assert.ok(hotspotProfiled.results[0].rule_hotspots.length > 0, 'rule_hotspots should include at least one rule');
assert.ok(Number.isFinite(hotspotProfiled.results[0].rule_hotspots[0].try_apply_calls), 'hotspot calls should be numeric');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node src/tests/js_solver_instrumentation_pack_node.js
```

Expected: failure because `rule_hotspots` is absent.

- [ ] **Step 3: Add hotspot helpers**

In `src/tests/run_solver_tests_js.js`, near the profiler globals, add:

```js
const SOLVER_RULE_HOTSPOTS = process.env.PUZZLESCRIPT_SOLVER_RULE_HOTSPOTS === '1';
let currentSolverRuleHotspots = null;

function solverRuleHotspotKey(rule) {
    const line = Number.isFinite(rule && rule.lineNumber) ? rule.lineNumber : -1;
    const group = Number.isFinite(rule && rule.groupNumber) ? rule.groupNumber : -1;
    const direction = rule && rule.direction !== undefined ? String(rule.direction) : '';
    return `${line}:${group}:${direction}`;
}

function solverRuleHotspotFor(rule) {
    if (!SOLVER_RULE_HOTSPOTS || !currentSolverRuleHotspots) {
        return null;
    }
    const key = solverRuleHotspotKey(rule);
    let row = currentSolverRuleHotspots.get(key);
    if (!row) {
        row = {
            key,
            line: Number.isFinite(rule && rule.lineNumber) ? rule.lineNumber : -1,
            group: Number.isFinite(rule && rule.groupNumber) ? rule.groupNumber : -1,
            direction: rule && rule.direction !== undefined ? String(rule.direction) : '',
            try_apply_calls: 0,
            changed: 0,
            match_ms: 0,
            apply_ms: 0,
        };
        currentSolverRuleHotspots.set(key, row);
    }
    return row;
}

function finalizeRuleHotspots(modeResult) {
    if (!SOLVER_RULE_HOTSPOTS || !modeResult || !modeResult._ruleHotspots) {
        if (modeResult) modeResult.rule_hotspots = [];
        return modeResult;
    }
    modeResult.rule_hotspots = Array.from(modeResult._ruleHotspots.values())
        .sort((left, right) =>
            (right.match_ms + right.apply_ms) - (left.match_ms + left.apply_ms)
            || right.try_apply_calls - left.try_apply_calls
            || left.key.localeCompare(right.key)
        )
        .slice(0, 25);
    delete modeResult._ruleHotspots;
    return modeResult;
}
```

In `createSolverResult`, add:

```js
        rule_hotspots: [],
```

- [ ] **Step 4: Wire the wrapper counters**

In `installSolverRuleMatchApplyProfiler`, capture the generated rule in `generateFindMatchesFunction`:

```js
    Rule.prototype.generateFindMatchesFunction = function () {
        const rule = this;
        const fn = originalGenerateFindMatches.call(this);
        return function solverProfiledFindMatches() {
            if (!currentSolverStepProfile) {
                return fn.apply(this, arguments);
            }
            const t0 = performance.now();
            try {
                return fn.apply(this, arguments);
            } finally {
                const elapsed = performance.now() - t0;
                currentSolverStepProfile.step_profile_rule_match_ms += elapsed;
                const hotspot = solverRuleHotspotFor(rule);
                if (hotspot) hotspot.match_ms += elapsed;
                if (solverInTryApply) {
                    solverTryApplyMatchMs += elapsed;
                }
            }
        };
    };
```

In the `Rule.prototype.tryApply` wrapper, update the row:

```js
    Rule.prototype.tryApply = function (level) {
        if (!currentSolverStepProfile) {
            return originalTryApply.call(this, level);
        }
        const hotspot = solverRuleHotspotFor(this);
        if (hotspot) hotspot.try_apply_calls++;
        solverTryApplyMatchMs = 0;
        solverInTryApply = true;
        const t0 = performance.now();
        let changed = false;
        try {
            changed = originalTryApply.call(this, level);
            return changed;
        } finally {
            solverInTryApply = false;
            const total = performance.now() - t0;
            const applyMs = Math.max(0, total - solverTryApplyMatchMs);
            currentSolverStepProfile.step_profile_rule_apply_ms += applyMs;
            if (hotspot) {
                hotspot.apply_ms += applyMs;
                if (changed) hotspot.changed++;
            }
        }
    };
```

- [ ] **Step 5: Set the active hotspot map around solver actions**

In `stepSolverAction`, extend the profile save/restore:

```js
    const previousStepProfile = currentSolverStepProfile;
    const previousRuleHotspots = currentSolverRuleHotspots;
    currentSolverStepProfile = stepProfile;
    currentSolverRuleHotspots = SOLVER_RULE_HOTSPOTS && stepProfile ? stepProfile._ruleHotspots : null;
```

In the `finally` block:

```js
        currentSolverStepProfile = previousStepProfile;
        currentSolverRuleHotspots = previousRuleHotspots;
```

In each mode runner, initialize the map after `createSolverResult`:

```js
        if (SOLVER_RULE_HOTSPOTS) {
            modeResult._ruleHotspots = new Map();
        }
```

Before every `return modeResult` from a mode runner, wrap it:

```js
                    return finalizeRuleHotspots(modeResult);
```

At the ordinary end of a mode runner:

```js
        modeResult.solution_length = modeResult.solution.length;
        modeResult.elapsed_ms = Date.now() - searchStarted;
        return finalizeRuleHotspots(modeResult);
```

- [ ] **Step 6: Run tests**

Run:

```bash
node src/tests/js_solver_instrumentation_pack_node.js
node src/tests/run_tests_node.js
```

Expected:
- `js_solver_instrumentation_pack_node passed`
- `Passed:  753`, `Failed:  0`, `Errors:  0`

- [ ] **Step 7: Commit**

```bash
git add src/tests/run_solver_tests_js.js src/tests/js_solver_instrumentation_pack_node.js
git commit -m "test: add JS solver per-rule hotspot counters"
```

---

### Task 4: Run Cheap Decision Probes

**Files:**
- Create: `docs/solver-forensics/2026-07-03-anonymous-game-500ms-experiment-results.md`
- Use output dir: `build/solver-forensics/anonymous-js-first-500ms/experiments/`

- [ ] **Step 1: Create the output directory**

Run:

```bash
mkdir -p build/solver-forensics/anonymous-js-first-500ms/experiments
```

Expected: command exits 0.

- [ ] **Step 2: Run X1 static-opt parity probe**

Run:

```bash
node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus \
  --game ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt \
  --timeout-ms 500 \
  --solver-opt all \
  --solver-opt-parity \
  --quiet \
  --json \
  --no-solutions \
  > build/solver-forensics/anonymous-js-first-500ms/experiments/js-static-opt-all-parity-500ms.json
```

Expected: exit 0 and JSON with `totals.solver_optimization` present. If it exits nonzero with `solver_opt_parity`, stop and inspect the mismatch before continuing.

- [ ] **Step 3: Run X3 again multiplier probe**

Run:

```bash
PUZZLESCRIPT_SOLVER_AGAIN_PROFILE=1 node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus \
  --game ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt \
  --timeout-ms 500 \
  --quiet \
  --json \
  --no-solutions \
  > build/solver-forensics/anonymous-js-first-500ms/experiments/js-again-profile-500ms.json
```

Expected: JSON totals include `process_input_calls` and `again_passes`.

- [ ] **Step 4: Run X2 per-rule hotspot probe on level 13**

Run:

```bash
PUZZLESCRIPT_SOLVER_STEP_PROFILE=1 PUZZLESCRIPT_SOLVER_RULE_HOTSPOTS=1 node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus \
  --game ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt \
  --level 13 \
  --timeout-ms 500 \
  --quiet \
  --json \
  --no-solutions \
  > build/solver-forensics/anonymous-js-first-500ms/experiments/js-rule-hotspots-level13-500ms.json
```

Expected: first result has a non-empty `rule_hotspots` array sorted by match+apply milliseconds.

- [ ] **Step 5: Run X4 guidance-parity probes**

Run one long JS solve on each native-proved level:

```bash
for level in 3 19 31 63 81; do \
  node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus \
    --game ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt \
    --level "$level" \
    --timeout-ms 120000 \
    --quiet \
    --json \
    --no-solutions \
    > "build/solver-forensics/anonymous-js-first-500ms/experiments/js-guidance-level-${level}-120000ms.json"; \
done
```

Expected: each command exits 0. If a level solves, compare its `expanded` count with the historical native compiled run.

- [ ] **Step 6: Summarize the probe results**

Create `docs/solver-forensics/2026-07-03-anonymous-game-500ms-experiment-results.md` directly from the JSON outputs:

```bash
node -e '
const fs = require("fs");
const base = "build/solver-forensics/anonymous-js-first-500ms/experiments";
const read = (name) => JSON.parse(fs.readFileSync(`${base}/${name}`, "utf8"));
const one = (json) => (json.results || [])[0] || {};
const pct = (count, total) => total > 0 ? `${((100 * count) / total).toFixed(1)}%` : "0.0%";
const staticOpt = read("js-static-opt-all-parity-500ms.json");
const again = read("js-again-profile-500ms.json");
const hotspots = read("js-rule-hotspots-level13-500ms.json");
const guidanceLevels = [3, 19, 31, 63, 81];
const guidanceRows = guidanceLevels.map((level) => {
  const row = one(read(`js-guidance-level-${level}-120000ms.json`));
  return `- Level ${level}: status=${row.status}, elapsed_ms=${row.elapsed_ms}, expanded=${row.expanded}, generated=${row.generated}, solution_length=${row.solution_length}`;
});
const topHotspots = ((one(hotspots).rule_hotspots) || []).slice(0, 5).map((row, index) =>
  `- ${index + 1}. key=${row.key}, line=${row.line}, try_apply_calls=${row.try_apply_calls}, changed=${row.changed}, match_ms=${Number(row.match_ms || 0).toFixed(1)}, apply_ms=${Number(row.apply_ms || 0).toFixed(1)}`
);
const s = staticOpt.totals || {};
const a = again.totals || {};
const h = one(hotspots);
const solvedGuidance = guidanceLevels.filter((level) => one(read(`js-guidance-level-${level}-120000ms.json`)).status === "solved").length;
const p2Decision = topHotspots.length > 0 ? "continue; rule hotspot evidence exists for the prune/codegen decision" : "pause; rule hotspot evidence is missing";
const p3Decision = solvedGuidance > 0 ? "continue as an explicit probe; long-run JS solved at least one native-proved level" : "keep explicit only; long-run JS did not add guidance evidence";
const doc = `# Anonymous Game 500ms Optimization Experiments

Source assessment: \`docs/solver-forensics/2026-07-03-anonymous-game-500ms-optimization-plan.md\`

## X1 Static Opt

- Command: Task 4 Step 2 static-opt parity run
- Solved: ${s.solved || 0}/${(s.solved || 0) + (s.timeout || 0) + (s.exhausted || 0) + (s.errors || 0)}
- Step ms: ${Number(s.step_ms || 0).toFixed(1)}
- Removed cosmetic objects: ${s.removed_cosmetic_objects || 0}
- Removed collision layers: ${s.removed_collision_layers || 0}
- Optimization gated: ${s.solver_optimization_gated ? "yes" : "no"}

## X2 Rule Hotspots

- Command: Task 4 Step 4 level-13 rule-hotspot run
- Level 13 status: ${h.status}, generated=${h.generated}, expanded=${h.expanded}
- Top rules:
${topHotspots.join("\n")}

## X3 Again Multiplier

- Command: Task 4 Step 3 again-profile run
- process_input_calls: ${a.process_input_calls || 0}
- generated: ${a.generated || 0}
- again_passes: ${a.again_passes || 0}
- again passes per generated step: ${a.generated > 0 ? ((a.again_passes || 0) / a.generated).toFixed(3) : "0.000"}

## X4 Guidance Parity

- Levels checked: ${guidanceLevels.join(", ")}
- JS solved levels: ${solvedGuidance}/${guidanceLevels.length} (${pct(solvedGuidance, guidanceLevels.length)})
${guidanceRows.join("\n")}

## Decision

- Continue with P2 movement-aware prune: ${p2Decision}
- Continue with P3 adaptive strategy: ${p3Decision}
- Refresh corpus baseline before default changes: yes
`;
fs.writeFileSync("docs/solver-forensics/2026-07-03-anonymous-game-500ms-experiment-results.md", doc);
'
```

Expected: the results doc contains concrete numbers and no blank result fields.

- [ ] **Step 7: Commit**

```bash
git add docs/solver-forensics/2026-07-03-anonymous-game-500ms-experiment-results.md
git commit -m "docs: record anonymous game solver probes"
```

---

### Task 5: Prototype Movement-Aware Inner-Loop Pruning Behind A Flag

**Files:**
- Modify: `src/js/engine.js`
- Create: `src/tests/movement_aware_prune_solver_compare_node.js`

- [ ] **Step 1: Write the paired compare helper**

Create `src/tests/movement_aware_prune_solver_compare_node.js` by adapting `src/tests/input_specialization_solver_compare_node.js`. Use these env toggles:

```js
function runSolver(corpus, runnerArgs, enabled) {
    const env = {
        ...process.env,
        PUZZLESCRIPT_INCREMENTAL_PRUNE: enabled ? '1' : '0',
        PUZZLESCRIPT_MOVEMENT_AWARE_PRUNE: enabled ? '1' : '0',
    };
    const child = spawnSync(
        process.execPath,
        [
            RUNNER,
            corpus,
            ...runnerArgs,
            '--quiet',
            '--json',
            '--solutions-dir',
            path.join('build', 'movement-aware-prune', enabled ? 'solutions-on' : 'solutions-off'),
        ],
        { env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 },
    );
    if (child.status !== 0) {
        throw new Error(`solver run failed (${enabled ? 'on' : 'off'}): ${child.stderr || child.stdout}`);
    }
    return JSON.parse(child.stdout);
}
```

Keep `compareRuns` strict for already-solved levels: status, solution, `expanded`, and `generated` must match. For baseline timeouts, allow the feature-on run to solve or exhaust.

- [ ] **Step 2: Run the helper before implementation and verify it fails usefully**

Run:

```bash
node src/tests/movement_aware_prune_solver_compare_node.js src/tests/solver_smoke_tests --timeout-ms 250 --game push_goal.txt
```

Expected before implementation: either no feature effect or a helper-level failure that shows the new file runs. Fix helper errors before touching `engine.js`.

- [ ] **Step 3: Implement the opt-in guard**

In `src/js/engine.js`, inside `applyRuleGroup`, replace the current guard:

```js
            if (PRUNE_INNER_LOOP
                && !rule.forceAlwaysRun
                && rule.readMovements.iszero()
                && !rule.readObjects.anyBitsInCommon(priorObjects)) {
```

with:

```js
            const MOVEMENT_AWARE_PRUNE = typeof process !== 'undefined' && process.env
                && process.env.PUZZLESCRIPT_MOVEMENT_AWARE_PRUNE === '1';
            const noRecentObjectReads = !rule.readObjects.anyBitsInCommon(priorObjects);
            const noRecentMovementReads = MOVEMENT_AWARE_PRUNE
                ? !rule.readMovements.anyBitsInCommon(priorMovements)
                : rule.readMovements.iszero();
            if (PRUNE_INNER_LOOP
                && !rule.forceAlwaysRun
                && noRecentMovementReads
                && noRecentObjectReads) {
```

If this adds measurable overhead in non-prune runs, hoist `MOVEMENT_AWARE_PRUNE` once near the start of `applyRuleGroup` instead of recomputing it per rule.

- [ ] **Step 4: Run simulation tests with pruning on and off**

Run:

```bash
node src/tests/run_tests_node.js
PUZZLESCRIPT_INCREMENTAL_PRUNE=1 PUZZLESCRIPT_MOVEMENT_AWARE_PRUNE=1 node src/tests/run_tests_node.js
```

Expected both times:
- `Passed:  753`
- `Failed:  0`
- `Errors:  0`

- [ ] **Step 5: Run paired solver comparison on smoke corpus**

Run:

```bash
node src/tests/movement_aware_prune_solver_compare_node.js src/tests/solver_smoke_tests --timeout-ms 250
```

Expected: helper exits 0 and reports equal solved-or-better behavior for feature-on.

- [ ] **Step 6: Run paired solver comparison on full solver corpus**

Run:

```bash
node src/tests/movement_aware_prune_solver_compare_node.js src/tests/solver_tests --timeout-ms 250
```

Expected: helper exits 0. If it reports divergence on an already-solved baseline level, stop and inspect the first divergent game before using the optimization numbers.

- [ ] **Step 7: Run single-game P2 bench**

Run:

```bash
PUZZLESCRIPT_INCREMENTAL_PRUNE=1 PUZZLESCRIPT_MOVEMENT_AWARE_PRUNE=1 node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus \
  --game ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt \
  --timeout-ms 500 \
  --quiet \
  --json \
  --no-solutions \
  > build/solver-forensics/anonymous-js-first-500ms/experiments/js-movement-aware-prune-500ms.json
```

Expected: compare `totals.step_ms`, `totals.generated`, and solved count against `js-baseline-1.json`.

- [ ] **Step 8: Commit only if comparisons are clean**

```bash
git add src/js/engine.js src/tests/movement_aware_prune_solver_compare_node.js
git commit -m "perf: prototype movement-aware rule pruning"
```

---

### Task 6: Add A Small Adaptive Strategy Probe

**Files:**
- Modify: `src/tests/run_solver_tests_js.js`
- Modify: `src/tests/js_solver_instrumentation_pack_node.js`

- [ ] **Step 1: Write option parsing test coverage in the smoke test**

In `src/tests/js_solver_instrumentation_pack_node.js`, add:

```js
const adaptive = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions', '--adaptive-step-cost'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
));
assert.strictEqual(adaptive.results[0].adaptive_step_cost, true);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node src/tests/js_solver_instrumentation_pack_node.js
```

Expected: unsupported argument `--adaptive-step-cost`.

- [ ] **Step 3: Add the option and result field**

In `parseArgs`, add `adaptiveStepCost: false` to defaults and parse:

```js
        } else if (arg === '--adaptive-step-cost') {
            options.adaptiveStepCost = true;
```

In `usage`, add ` [--adaptive-step-cost]` and one sentence:

```js
        '  --adaptive-step-cost: after a small timing probe, bias expensive-step levels toward greedy search.\n';
```

In `createSolverResult`, add:

```js
        adaptive_step_cost: false,
```

- [ ] **Step 4: Implement conservative adaptive behavior in `runMode`**

Inside `runMode`, set the field:

```js
        modeResult.adaptive_step_cost = !!options.adaptiveStepCost;
```

Before pushing child nodes, compute a local mode:

```js
                let priorityMode = mode;
                if (options.adaptiveStepCost
                    && mode === 'weighted-astar'
                    && modeResult.generated >= 64
                    && modeResult.step_ms > 0
                    && modeResult.step_ms / modeResult.generated > 0.2) {
                    priorityMode = 'greedy';
                }
```

Then use `priorityMode` in the existing `frontier.push` calls:

```js
priority: priorityForMode(priorityMode, childDepth, childHeuristic, options.astarWeight || 2),
```

This is intentionally a probe, not a default change.

- [ ] **Step 5: Run smoke and single-game benches**

Run:

```bash
node src/tests/js_solver_instrumentation_pack_node.js
node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus \
  --game ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt \
  --timeout-ms 500 \
  --adaptive-step-cost \
  --quiet \
  --json \
  --no-solutions \
  > build/solver-forensics/anonymous-js-first-500ms/experiments/js-adaptive-step-cost-500ms.json
```

Expected: smoke test passes; single-game JSON has `adaptive_step_cost: true` in results.

- [ ] **Step 6: Commit**

```bash
git add src/tests/run_solver_tests_js.js src/tests/js_solver_instrumentation_pack_node.js
git commit -m "test: add adaptive step-cost solver probe"
```

---

### Task 7: Refresh Reports And Decide What To Land

**Files:**
- Modify: `docs/solver-forensics/2026-07-03-anonymous-game-500ms-experiment-results.md`
- Modify: `docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md` only if regenerating with new artifacts
- Modify: `src/tests/JS_SOLVER_NEXT.md`

- [ ] **Step 1: Refresh the single-game report if new artifacts are stable**

Run the report builder with the original artifacts plus any accepted probe JSONs. Keep historical corpus rows labeled historical:

```bash
node src/tests/build_solver_forensics_report.js \
  --game-name ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt \
  --out-report docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md \
  --out-summary build/solver-forensics/anonymous-js-first-500ms/summary.json \
  --out-triage-csv build/solver-forensics/anonymous-js-first-500ms/level-triage.csv \
  --js-baseline "JS baseline run 1:build/solver-forensics/anonymous-js-first-500ms/js-baseline-1.json" \
  --js-baseline "JS baseline run 2:build/solver-forensics/anonymous-js-first-500ms/js-baseline-2.json" \
  --js-baseline "JS baseline run 3:build/solver-forensics/anonymous-js-first-500ms/js-baseline-3.json" \
  --js-step-profile "JS step profile:build/solver-forensics/anonymous-js-first-500ms/js-step-profile.json" \
  --js-noop-probe "JS no-op probe:build/solver-forensics/anonymous-js-first-500ms/js-noop-probe.json" \
  --js-cpu-ready "JS detail timing off:build/solver-forensics/anonymous-js-first-500ms/js-cpu-ready.json" \
  --native-series "C++ portfolio interpreter:build/solver-forensics/anonymous-js-first-500ms/native-portfolio.json" \
  --native-series "C++ HDA x8 interpreter:build/solver-forensics/anonymous-js-first-500ms/native-hda-8.json" \
  --native-series "C++ portfolio compiled historical:build/solver-forensics/anonymous-js-first-500ms/historical/single-game-cpp-portfolio-compiled-5000ms.json" \
  --native-series "C++ HDA x8 compiled historical:build/solver-forensics/anonymous-js-first-500ms/historical/single-game-cpp-hda-8-compiled-30000ms.json" \
  --corpus-series "Corpus JS historical:build/solver-forensics/anonymous-js-first-500ms/historical/corpus-js.json:historical" \
  --corpus-series "Corpus C++ portfolio historical:build/solver-forensics/anonymous-js-first-500ms/historical/corpus-cpp-portfolio.json:historical" \
  --corpus-series "Corpus C++ HDA x8 historical:build/solver-forensics/anonymous-js-first-500ms/historical/corpus-cpp-hda-8.json:historical" \
  --corpus-series "Corpus C++ portfolio compiled historical:build/solver-forensics/anonymous-js-first-500ms/historical/corpus-cpp-portfolio-compiled.json:historical" \
  --corpus-series "Corpus C++ HDA x8 compiled historical:build/solver-forensics/anonymous-js-first-500ms/historical/corpus-cpp-hda-8-compiled.json:historical"
```

Expected: report regenerates without whitespace errors.

- [ ] **Step 2: Append a dated JS_SOLVER_NEXT entry**

Append a measured section to `src/tests/JS_SOLVER_NEXT.md` from the generated artifacts:

```bash
node -e '
const fs = require("fs");
const base = "build/solver-forensics/anonymous-js-first-500ms/experiments";
const read = (name) => JSON.parse(fs.readFileSync(`${base}/${name}`, "utf8"));
const maybe = (name) => fs.existsSync(`${base}/${name}`) ? read(name) : null;
const one = (json) => json && (json.results || [])[0] || {};
const staticOpt = read("js-static-opt-all-parity-500ms.json");
const again = read("js-again-profile-500ms.json");
const hotspots = read("js-rule-hotspots-level13-500ms.json");
const movement = maybe("js-movement-aware-prune-500ms.json");
const adaptive = maybe("js-adaptive-step-cost-500ms.json");
const guidanceLevels = [3, 19, 31, 63, 81];
const guidanceRows = guidanceLevels.map((level) => {
  const row = one(read(`js-guidance-level-${level}-120000ms.json`));
  return `${level}:${row.status}/expanded=${row.expanded}/generated=${row.generated}/len=${row.solution_length}`;
});
const top = ((one(hotspots).rule_hotspots) || [])[0] || {};
const s = staticOpt.totals || {};
const a = again.totals || {};
const m = movement ? movement.totals || {} : null;
const ad = adaptive ? adaptive.totals || {} : null;
const section = `

## 2026-07-03 anonymous-game 500ms probes

- Static opt parity on \`ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt\`: solved=${s.solved || 0}, step_ms=${Number(s.step_ms || 0).toFixed(1)}, removed_collision_layers=${s.removed_collision_layers || 0}, gated=${s.solver_optimization_gated ? "yes" : "no"}.
- Again multiplier: process_input_calls=${a.process_input_calls || 0}, generated=${a.generated || 0}, again_passes=${a.again_passes || 0}.
- Level 13 hotspots: top key=${top.key || "none"}, line=${top.line === undefined ? "none" : top.line}, match_ms=${Number(top.match_ms || 0).toFixed(1)}, apply_ms=${Number(top.apply_ms || 0).toFixed(1)}.
- Guidance parity levels 3/19/31/63/81: ${guidanceRows.join("; ")}.
- Movement-aware prune probe: ${m ? `solved=${m.solved || 0}, step_ms=${Number(m.step_ms || 0).toFixed(1)}, generated=${m.generated || 0}` : "not run in this batch"}.
- Adaptive step-cost probe: ${ad ? `solved=${ad.solved || 0}, step_ms=${Number(ad.step_ms || 0).toFixed(1)}, generated=${ad.generated || 0}` : "not run in this batch"}.
`;
fs.appendFileSync("src/tests/JS_SOLVER_NEXT.md", section);
'
```

Expected: the appended section contains measured values or an explicit `not run in this batch` label for optional probes.

- [ ] **Step 3: Run final verification**

Run:

```bash
node src/tests/build_solver_forensics_report_node.js
node src/tests/js_solver_instrumentation_pack_node.js
node src/tests/run_tests_node.js
git diff --check
```

Expected:
- `build_solver_forensics_report_node passed`
- `js_solver_instrumentation_pack_node passed`
- `Passed:  753`, `Failed:  0`, `Errors:  0`
- `git diff --check` exits 0

- [ ] **Step 4: Commit final docs**

```bash
git add docs/solver-forensics/2026-07-03-anonymous-game-500ms-experiment-results.md docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md src/tests/JS_SOLVER_NEXT.md
git commit -m "docs: record 500ms solver optimization decisions"
```

---

## Decision Rules

- Land instrumentation if tests pass; it is opt-in and useful even when a hypothesis fails.
- Land movement-aware prune only if `run_tests_node.js` passes with the flag on and paired solver comparisons show no divergence on already-solved baseline levels.
- Keep adaptive step-cost as an explicit CLI probe unless a refreshed corpus run shows flat-or-better solve count and reduced timeouts.
- Do not make historical corpus claims from stale artifacts; refresh corpus JS at 500ms before claiming corpus-level wins.
- Do not optimize heuristic scoring, clone, hash, or queue paths from this assessment; the cited evidence says rule stepping dominates this game.

## Execution Handoff

Plan complete when this file is saved. Recommended execution is subagent-driven: one task per fresh worker, with review between tasks because Task 5 changes engine semantics.
