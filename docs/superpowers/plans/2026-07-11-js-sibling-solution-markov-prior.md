# JS Sibling-Solution Markov Prior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in JS solver experiment that uses a prior solver-results artifact as a leave-one-level-out, first-order Markov model for stable input ordering, including `action` as a first-class input.

**Architecture:** A focused helper validates the training artifact and builds per-game transition tables. For each target level it subtracts that level's own solution, precomputes context-specific action arrays, and exposes a null fallback when no sibling evidence exists. `run_solver_tests_js.js` loads the artifact once per process, attaches per-level telemetry, and selects a precomputed array during ordinary and adaptive-portfolio expansion without changing actions, priorities, pruning, or defaults.

**Tech Stack:** Node.js CommonJS, PuzzleScript JS solver harness, built-in `assert`/`fs`/`child_process`, existing JSON benchmark store and paired-run driver.

---

## File Map

- Create `src/tests/lib/solver_sibling_markov_prior.js`: artifact validation, transition counting, leave-one-level-out target construction, stable input ordering.
- Create `src/tests/solver_sibling_markov_prior_node.js`: helper contract and CLI/search integration tests, including `action` at the root and as a context.
- Modify `src/tests/run_solver_tests_js.js`: CLI loading, search-loop consumption, telemetry, totals, and benchmark provenance.
- Create `src/tests/build_solver_sibling_prior_focus_manifest.js`: deterministic mixed-game preflight manifest materializer.
- Create `src/tests/build_solver_sibling_prior_focus_manifest_node.js`: manifest selection tests.
- Modify `Makefile`: include both new Node tests in `tests_js`.
- Modify `src/tests/JS_SOLVER_NEXT.md`: record the held-out signal, warm-start interpretation, and measured keep/reject decision.
- Modify `docs/solver-forensics/2026-07-03-project-strategy-recommendations.md`: update T4/TX3 roadmap status after measurement.

### Task 1: Leave-One-Level-Out Markov Helper

**Files:**
- Create: `src/tests/lib/solver_sibling_markov_prior.js`
- Create: `src/tests/solver_sibling_markov_prior_node.js`

- [ ] **Step 1: Write failing helper tests**

Create `src/tests/solver_sibling_markov_prior_node.js` with focused assertions:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    createSiblingMarkovPriorStore,
} = require('./lib/solver_sibling_markov_prior');

const actions = ['right', 'up', 'down', 'left', 'action']
    .map((token, input) => ({ token, input }));

const store = createSiblingMarkovPriorStore({
    results: [
        { game: 'alpha.txt', level: 0, status: 'solved', solution: ['right', 'right'] },
        { game: 'alpha.txt', level: 1, status: 'solved', solution: ['action', 'left', 'action', 'left'] },
        { game: 'alpha.txt', level: 2, status: 'timeout', solution: [] },
        { game: 'beta.txt', level: 0, status: 'solved', solution: ['up', 'up'] },
        { game: 'alpha.txt', level: 3, status: 'solved', solution: ['tick'] },
    ],
});

assert.strictEqual(store.ignoredRecords, 2, 'timeout and unsupported solutions are ignored');

const targetZero = store.forTarget('alpha.txt', 0, actions);
assert.strictEqual(targetZero.trainingLevels, 1, 'the target solution is excluded');
assert.deepStrictEqual(
    targetZero.actionsFor(null).map((action) => action.token),
    ['action', 'right', 'up', 'down', 'left'],
    'action can be learned as the first input'
);
assert.deepStrictEqual(
    targetZero.actionsFor('action').map((action) => action.token),
    ['left', 'right', 'up', 'down', 'action'],
    'action is also a first-class previous-input context'
);
assert.strictEqual(targetZero.actionsFor('up'), null, 'missing contexts preserve baseline order');

const targetTwo = store.forTarget('alpha.txt', 2, actions);
assert.strictEqual(targetTwo.trainingLevels, 2, 'all solved siblings train an unsolved target');
assert.deepStrictEqual(
    targetTwo.actionsFor(null).map((action) => action.token),
    ['right', 'action', 'up', 'down', 'left'],
    'equal counts preserve baseline order'
);

assert.strictEqual(store.forTarget('missing.txt', 0, actions), null);
assert.throws(
    () => createSiblingMarkovPriorStore({ results: [
        { game: 'dup.txt', level: 0, status: 'solved', solution: ['right'] },
        { game: 'dup.txt', level: 0, status: 'solved', solution: ['left'] },
    ] }),
    /duplicate solved training record dup\.txt#0/
);
assert.throws(() => createSiblingMarkovPriorStore({}), /expected top-level results array/);
```

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```bash
node src/tests/solver_sibling_markov_prior_node.js
```

Expected: FAIL with `Cannot find module './lib/solver_sibling_markov_prior'`.

- [ ] **Step 3: Implement the minimal helper**

Create `src/tests/lib/solver_sibling_markov_prior.js` with this public shape:

```js
'use strict';

const START_CONTEXT = '<start>';
const INPUT_TOKENS = new Set(['right', 'up', 'down', 'left', 'action']);

function transitionsFor(solution) {
    const transitions = new Map();
    let context = START_CONTEXT;
    for (const token of solution) {
        let counts = transitions.get(context);
        if (!counts) {
            counts = new Map();
            transitions.set(context, counts);
        }
        counts.set(token, (counts.get(token) || 0) + 1);
        context = token;
    }
    return transitions;
}

function createSiblingMarkovPriorStore(payload) {
    if (!payload || !Array.isArray(payload.results)) {
        throw new Error('solver sibling priors: expected top-level results array');
    }
    const games = new Map();
    const seenSolved = new Set();
    let ignoredRecords = 0;

    for (const result of payload.results) {
        if (!result || result.status !== 'solved'
            || typeof result.game !== 'string'
            || !Number.isInteger(result.level) || result.level < 0) {
            ignoredRecords++;
            continue;
        }
        const key = `${result.game}\u0000${result.level}`;
        if (seenSolved.has(key)) {
            throw new Error(`solver sibling priors: duplicate solved training record ${result.game}#${result.level}`);
        }
        seenSolved.add(key);
        if (!Array.isArray(result.solution) || result.solution.length === 0
            || result.solution.some((token) => !INPUT_TOKENS.has(token))) {
            ignoredRecords++;
            continue;
        }
        if (!games.has(result.game)) games.set(result.game, new Map());
        games.get(result.game).set(result.level, transitionsFor(result.solution));
    }

    return {
        ignoredRecords,
        forTarget(game, level, actions) {
            const levels = games.get(game);
            if (!levels) return null;
            const totals = new Map();
            let trainingLevels = 0;
            for (const [siblingLevel, transitions] of levels) {
                if (siblingLevel === level) continue;
                trainingLevels++;
                for (const [context, counts] of transitions) {
                    if (!totals.has(context)) totals.set(context, new Map());
                    const target = totals.get(context);
                    for (const [token, count] of counts) {
                        target.set(token, (target.get(token) || 0) + count);
                    }
                }
            }
            if (trainingLevels === 0) return null;
            const orderedByContext = new Map();
            for (const [context, counts] of totals) {
                const ordered = actions.map((action, baselineIndex) => ({
                    action,
                    baselineIndex,
                    count: counts.get(action.token) || 0,
                })).sort((left, right) =>
                    right.count - left.count || left.baselineIndex - right.baselineIndex
                );
                if (ordered.some((entry) => entry.count > 0)) {
                    orderedByContext.set(context, ordered.map((entry) => entry.action));
                }
            }
            return {
                trainingLevels,
                contextCount: orderedByContext.size,
                actionsFor(context) {
                    return orderedByContext.get(context === null ? START_CONTEXT : context) || null;
                },
            };
        },
    };
}

module.exports = { START_CONTEXT, createSiblingMarkovPriorStore };
```

- [ ] **Step 4: Run the helper test and verify GREEN**

Run `node src/tests/solver_sibling_markov_prior_node.js`.

Expected: the helper assertions pass. Add `console.log('solver_sibling_markov_prior_node passed');` after the final assertion so success is visible.

- [ ] **Step 5: Commit the helper checkpoint**

```bash
git add src/tests/lib/solver_sibling_markov_prior.js src/tests/solver_sibling_markov_prior_node.js
git commit -m "Add sibling solution Markov prior model"
```

### Task 2: CLI Loading and Telemetry Plumbing

**Files:**
- Modify: `src/tests/run_solver_tests_js.js`
- Modify: `src/tests/solver_sibling_markov_prior_node.js`

- [ ] **Step 1: Add failing CLI and default-telemetry assertions**

Extend the Node test to import `parseArgs` and assert:

```js
const path = require('path');
const { parseArgs } = require('./run_solver_tests_js');

const parsed = parseArgs([
    'node',
    'run_solver_tests_js.js',
    path.join(__dirname, 'solver_smoke_tests'),
    '--solver-sibling-priors',
    path.join(__dirname, 'training.json'),
]);
assert.strictEqual(parsed.solverSiblingPriorsPath, path.join(__dirname, 'training.json'));
```

Also run `runCorpus(parseArgs(...one_move...))` without the flag and assert the result fields are false/zero:

```js
assert.strictEqual(result.sibling_prior_enabled, false);
assert.strictEqual(result.sibling_prior_training_records_ignored, 0);
assert.strictEqual(result.sibling_prior_training_levels, 0);
assert.strictEqual(result.sibling_prior_contexts, 0);
assert.strictEqual(result.sibling_prior_ordered_expansions, 0);
assert.strictEqual(result.sibling_prior_fallback_expansions, 0);
```

- [ ] **Step 2: Run the Node test and verify RED**

Expected: FAIL because `--solver-sibling-priors` is unsupported and telemetry fields are absent.

- [ ] **Step 3: Add option parsing and one-time loading**

In `run_solver_tests_js.js`:

```js
const {
    createSiblingMarkovPriorStore,
} = require('./lib/solver_sibling_markov_prior');
```

Add `solverSiblingPriorsPath: null` and `solverSiblingPriorStore: null` to defaults. Parse the option with `path.resolve(args[++index])`, add it to the usage text, and add:

```js
function prepareSiblingMarkovPriors(options) {
    if (options.solverSiblingPriorsPath === null || options.solverSiblingPriorStore) return;
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(options.solverSiblingPriorsPath, 'utf8'));
    } catch (error) {
        throw new Error(`solver sibling priors: could not read ${options.solverSiblingPriorsPath}: ${error.message}`);
    }
    options.solverSiblingPriorStore = createSiblingMarkovPriorStore(payload);
}
```

Call it once at the top of `runCorpus(options)`, before collecting jobs. Do not add this value-bearing option to `takesValueArg`; unlike bench-store output arguments, it must be propagated unchanged to `--jobs` child processes.

- [ ] **Step 4: Add zero-valued result fields, totals, and bench provenance**

Add all six fields from the spec to `createSolverResult()`. Aggregate the five numeric fields in `totals()`, and set `sibling_prior_enabled` true if any result enables it. Add only the artifact path to `benchStoreConfig(options)`:

```js
solver_sibling_priors: options.solverSiblingPriorsPath,
```

This keeps provenance at run level rather than repeating the path on every result.

- [ ] **Step 5: Run the Node test and verify GREEN**

Run `node src/tests/solver_sibling_markov_prior_node.js`.

Expected: parser and default telemetry assertions pass.

- [ ] **Step 6: Commit CLI and telemetry plumbing**

```bash
git add src/tests/run_solver_tests_js.js src/tests/solver_sibling_markov_prior_node.js
git commit -m "Plumb sibling Markov priors into JS solver"
```

### Task 3: Stable Input Ordering in Search

**Files:**
- Modify: `src/tests/run_solver_tests_js.js`
- Modify: `src/tests/solver_sibling_markov_prior_node.js`

- [ ] **Step 1: Add a failing end-to-end `action` fixture test**

Extend the Node test with a temporary one-level game whose only win is the
`action` input. Write a training artifact containing a fictitious solved sibling
level with `['action', 'right']`, then spawn baseline and warm-start BFS runs.
Use this PuzzleScript source:

```text
title action prior fixture

objects
Background
black
Player
white
Goal
yellow

legend
. = Background
P = Player and Background

collisionlayers
Background
Player
Goal

rules
[ action Player ] -> [ Player Goal ]

winconditions
all Player on Goal

levels
P
```

Assert:

```js
assert.strictEqual(baseline.status, 'solved');
assert.deepStrictEqual(baseline.solution, ['action']);
assert.strictEqual(warm.status, 'solved');
assert.deepStrictEqual(warm.solution, ['action']);
assert(warm.generated < baseline.generated, 'action prior should try the winning input earlier');
assert.strictEqual(warm.sibling_prior_enabled, true);
assert.strictEqual(warm.sibling_prior_training_levels, 1);
assert(warm.sibling_prior_ordered_expansions > 0);
```

Add a second spawn with a malformed `{}` artifact and assert non-zero exit plus `expected top-level results array` on stderr.

- [ ] **Step 2: Run the test and verify RED**

Run `node src/tests/solver_sibling_markov_prior_node.js`.

Expected: baseline solves, but warm-start generated work and telemetry do not differ because search does not consume the prior yet.

- [ ] **Step 3: Attach one target prior per solve**

Inside `solveLevel`, after the level has loaded and before `runMode` is defined:

```js
const baselineActions = solverActionsForGame();
const siblingPrior = options.solverSiblingPriorStore
    ? options.solverSiblingPriorStore.forTarget(game, levelIndex, baselineActions)
    : null;

function attachSiblingPriorTelemetry(modeResult) {
    modeResult.sibling_prior_enabled = siblingPrior !== null;
    modeResult.sibling_prior_training_records_ignored = options.solverSiblingPriorStore
        ? options.solverSiblingPriorStore.ignoredRecords
        : 0;
    modeResult.sibling_prior_training_levels = siblingPrior ? siblingPrior.trainingLevels : 0;
    modeResult.sibling_prior_contexts = siblingPrior ? siblingPrior.contextCount : 0;
}

function actionsForNode(modeResult, node) {
    if (!siblingPrior) return baselineActions;
    const ordered = siblingPrior.actionsFor(node.input);
    if (ordered) {
        modeResult.sibling_prior_ordered_expansions++;
        return ordered;
    }
    modeResult.sibling_prior_fallback_expansions++;
    return baselineActions;
}
```

Call `attachSiblingPriorTelemetry(modeResult)` immediately after creating each ordinary or adaptive-portfolio mode result. Do not attach it to naive or push-space execution.

- [ ] **Step 4: Consume precomputed arrays in both standard loops**

Remove each function-wide `const actions = solverActionsForGame()` from ordinary and adaptive-portfolio search. Immediately before successor generation, select once per expanded node:

```js
const actions = actionsForNode(modeResult, node);
for (const action of actions) {
    // existing body unchanged
}
```

Do not sort in the hot loop. Do not mutate `DIRECTION_ACTIONS`,
`ACTIONS_WITH_ACTION`, or any cached baseline array.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node src/tests/solver_sibling_markov_prior_node.js
node src/tests/solver_novelty_node.js
node src/tests/solver_push_space_node.js
```

Expected: all pass. The first test proves `action` is tried first under a start-context prior and the resulting solution still replays.

- [ ] **Step 6: Commit search integration**

```bash
git add src/tests/run_solver_tests_js.js src/tests/solver_sibling_markov_prior_node.js
git commit -m "Order JS solver inputs with sibling Markov priors"
```

### Task 4: Deterministic Mixed-Game Preflight Slice

**Files:**
- Create: `src/tests/build_solver_sibling_prior_focus_manifest.js`
- Create: `src/tests/build_solver_sibling_prior_focus_manifest_node.js`
- Modify: `Makefile`

- [ ] **Step 1: Write the failing manifest test**

Create a test artifact with one mixed game, one all-solved game, one all-timeout game, and skipped/error rows. Assert that the builder returns every playable level from only the mixed game, sorted by game then level:

```js
const input = { results: [
    { game: 'mixed.txt', level: 1, status: 'timeout' },
    { game: 'mixed.txt', level: 0, status: 'solved', solution: ['action'] },
    { game: 'solved.txt', level: 0, status: 'solved', solution: ['right'] },
    { game: 'timeout.txt', level: 0, status: 'timeout' },
    { game: 'mixed.txt', level: 2, status: 'skipped_message' },
] };
assert.deepStrictEqual(buildMixedGameManifest(input, 500).targets, [
    { game: 'mixed.txt', level: 0 },
    { game: 'mixed.txt', level: 1 },
]);
```

- [ ] **Step 2: Run the manifest test and verify RED**

Run `node src/tests/build_solver_sibling_prior_focus_manifest_node.js`.

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the builder and CLI**

Export `buildMixedGameManifest(payload, timeoutMs)`. Treat `solved`, `timeout`, and `exhausted` as playable; select games containing at least one solved and one non-solved playable result. Return:

```js
{
    schema_version: 1,
    purpose: 'TX3 warm-start sibling-solution Markov prior preflight',
    timeout_ms: timeoutMs,
    targets: sortedTargets,
}
```

CLI contract:

```text
node src/tests/build_solver_sibling_prior_focus_manifest.js TRAINING_JSON OUT_JSON [--timeout-ms 500]
```

Use `fs.mkdirSync(path.dirname(outPath), { recursive: true })` and write formatted JSON.

- [ ] **Step 4: Add both tests to `tests_js` and verify GREEN**

Add:

```make
	$(NODE) src/tests/solver_sibling_markov_prior_node.js
	$(NODE) src/tests/build_solver_sibling_prior_focus_manifest_node.js
```

Run both Node tests, then run `make tests_js`.

Expected: all JS and auxiliary tests pass.

- [ ] **Step 5: Commit the reproducible slice tooling**

```bash
git add Makefile src/tests/build_solver_sibling_prior_focus_manifest.js src/tests/build_solver_sibling_prior_focus_manifest_node.js
git commit -m "Add sibling prior preflight slice builder"
```

### Task 5: Verification and Warm-Start Measurement

**Files:**
- Modify after measurement: `src/tests/JS_SOLVER_NEXT.md`
- Modify after measurement: `docs/solver-forensics/2026-07-03-project-strategy-recommendations.md`

- [ ] **Step 1: Run focused and broad correctness gates**

Run:

```bash
node src/tests/solver_sibling_markov_prior_node.js
node src/tests/build_solver_sibling_prior_focus_manifest_node.js
node src/tests/run_tests_node.js
make solver_smoke_tests
make solver_determinism_tests
make solver_parity_smoke
```

Expected: every command passes. The default solver path remains unchanged because no prior path is supplied.

- [ ] **Step 2: Materialize the mixed-game preflight manifest**

Run:

```bash
node src/tests/build_solver_sibling_prior_focus_manifest.js \
  build/native/n8-full-baseline-250ms.json \
  build/solver-bench/tx3-sibling-markov-mixed-games.json \
  --timeout-ms 500
```

Record the game and target counts printed by the builder. Confirm every candidate target excludes its own solution at prior construction time; the training artifact itself remains unchanged.

- [ ] **Step 3: Run paired serial preflight measurements**

Disable detailed hot-loop timing for both variants and keep the prior only on the candidate:

```bash
PUZZLESCRIPT_SOLVER_DETAIL_TIMING=0 node src/tests/run_js_solver_bench_pair.js \
  src/tests/solver_tests \
  --store build/solver-bench/tx3-sibling-markov-store.jsonl \
  --slice tx3-sibling-markov-mixed-games \
  --slice-manifest build/solver-bench/tx3-sibling-markov-mixed-games.json \
  --runs 2 \
  --out-dir build/solver-bench/tx3-sibling-markov-pairs \
  --baseline-variant cold \
  --candidate-variant warm-sibling-markov \
  --candidate-arg --solver-sibling-priors \
  --candidate-arg build/native/n8-full-baseline-250ms.json \
  -- --strategy portfolio --jobs 1 --quiet --json --no-solutions
```

Report each pair separately: solved delta, gained/lost target identities,
generated/expanded work on common timeouts, ordered/fallback expansions, and
solution replay status. Do not describe the warm result as a general solver
speedup.

- [ ] **Step 4: Apply the graduation gate**

Graduate only if both preflight pairs show either:

- a positive solve delta without a severe repeat loss; or
- a repeatable generated-work reduction on common timeout targets with no meaningful solve regression.

If neither condition holds, remove the runtime consumer and tests that require it, retain the helper audit or delete it according to maintenance value, and proceed to the decision documentation step.

- [ ] **Step 5: If graduated, run paired full-corpus measurements**

Run the same command without `--slice-manifest`, rename the slice to
`tx3-sibling-markov-full`, and retain `--runs 2`, 500 ms, serial execution, and
the cold/warm labels. Replay every candidate solve using the existing canonical
replay tooling. Apply the repository's solve-count noise band and report unions
plus per-target gains/losses.

- [ ] **Step 6: Document the measured decision**

Update `JS_SOLVER_NEXT.md` and the T4/TX3 roadmap row with:

- the Markov interpretation;
- explicit cross-run warm-cache provenance;
- `action` support;
- training, slice, and pair artifact paths;
- cold and warm results kept separate;
- the keep, explicit-only, generator-follow-up, or reject decision.

- [ ] **Step 7: Run final verification**

Re-run the focused test, `node src/tests/run_tests_node.js`, `make solver_smoke_tests`, and `make solver_determinism_tests`. Run `git diff --check` and inspect `git status --short`.

- [ ] **Step 8: Commit the decision checkpoint**

```bash
git add Makefile src/tests/run_solver_tests_js.js src/tests/lib/solver_sibling_markov_prior.js src/tests/solver_sibling_markov_prior_node.js src/tests/build_solver_sibling_prior_focus_manifest.js src/tests/build_solver_sibling_prior_focus_manifest_node.js src/tests/JS_SOLVER_NEXT.md docs/solver-forensics/2026-07-03-project-strategy-recommendations.md
git commit -m "Measure sibling solution Markov guidance"
```

If the consumer is rejected and removed, stage only the files that remain in the final measured state.
