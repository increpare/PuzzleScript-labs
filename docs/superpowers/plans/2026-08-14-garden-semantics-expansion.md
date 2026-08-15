# Garden Semantics Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the garden into a semantics fuzzer: oracle unmutated fixtures against recorded output and compiler messages, generate extra inputs, and add mutators that still often compile.

**Architecture:** The parent sends oracles only during baseline preflight. Extra inputs are chosen with the garden RNG in `run.js` / `mutateFixture` and stored on the mutant. New mutators are named functions in `garden.js` beside the existing ones. Requires harness honesty and worker oracles to already be on this branch.

**Tech Stack:** Node.js built-ins, existing fixture arrays as oracles.

**Worktree:** `.worktrees/compiler-monster-garden`

**Spec:** `docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md` (semantic-mismatch, generated inputs, structure-aware mutators)

---

## File map

- Modify: `src/tests/monster_garden/garden.js` (parseArguments, mutators, maybe `oracleJobFields`)
- Modify: `src/tests/monster_garden/worker.js` (compare expected output / errors after a healthy run)
- Modify: `src/tests/monster_garden/run.js` (extra inputs, pass oracles only on baseline)
- Modify: `src/tests/monster_garden/tests.js`
- Modify: `DEVELOPMENT.md`

---

### Task 1: `--extra-inputs` and generated suffixes

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Modify: `src/tests/monster_garden/run.js`
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add tests**

```js
test('extra inputs are generated deterministically and appended after the truncated prefix', function() {
    assert.strictEqual(garden.parseArguments([]).extraInputs, 0);
    assert.throws(function() { garden.parseArguments(['--extra-inputs', '0']); }, /extra-inputs/);
    const rng = new garden.Random(1);
    const recorded = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const first = garden.extendInputs(recorded, rng, { maxInputs: 8, extraInputs: 3 });
    const rng2 = new garden.Random(1);
    const second = garden.extendInputs(recorded, rng2, { maxInputs: 8, extraInputs: 3 });
    assert.deepStrictEqual(first, second);
    assert.strictEqual(first.length, 11);
    assert.deepStrictEqual(first.slice(0, 8), recorded.slice(0, 8));
    first.slice(8).forEach(function(value) {
        assert.notStrictEqual([0, 1, 2, 3, 4, 'tick'].indexOf(value), -1);
    });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

In `parseArguments` default `extraInputs: 0`. Add `--extra-inputs` using `needPositiveInt` (so `0` is rejected; omit the flag for none).

```js
const EXTRA_INPUT_CHOICES = [0, 1, 2, 3, 4, 'tick'];

function extendInputs(recorded, rng, options) {
    const maxInputs = options && options.maxInputs ? options.maxInputs : recorded.length;
    const extraInputs = options && options.extraInputs ? options.extraInputs : 0;
    const prefix = (recorded || []).slice(0, maxInputs);
    const extras = [];
    for (let i = 0; i < extraInputs; i++) {
        extras.push(rng.pick(EXTRA_INPUT_CHOICES));
    }
    return prefix.concat(extras);
}
```

Export `extendInputs`. In `run.js`, after `mutateFixture` succeeds:

```js
        mutant.inputs = garden.extendInputs(mutant.inputs, rng, {
            maxInputs: options.maxInputs,
            extraInputs: options.extraInputs
        });
```

Use the same `extendInputs` call for the baseline preflight so baseline and mutant share the executed sequence (same rng consumption must happen **before** mutation if extras should match). Order in `main`:

1. Pick fixture
2. `executedInputs = garden.extendInputs(fixture.inputs, rng, options)` — this consumes rng
3. Mutate fixture (consumes rng for mutator choice)
4. Preflight baseline with `source: fixture.source, inputs: executedInputs`
5. Evaluate mutant with `source: mutant.source, inputs: executedInputs`

Do **not** call `extendInputs` twice. Assign `executedInputs` once and set `mutant.inputs = executedInputs` as well.

If mutation throws inapplicable, rng has already been consumed for extras — that is acceptable and keeps seeds stable.

- [ ] **Step 4: Run tests**

Expected: PASS. Re-run the one-mutant CLI test; stdout must still match across two runs with the same seed.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/run.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Append deterministic extra inputs to garden jobs.

EOF
)"
```

---

### Task 2: Semantic oracles on baseline preflight

**Files:**
- Modify: `src/tests/monster_garden/worker.js`
- Modify: `src/tests/monster_garden/run.js`
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add worker tests** using SAMPLE. SAMPLE has no recorded expected output in testdata; construct the oracle from a first run, then assert a wrong oracle mismatches:

```js
test('expectedOutput mismatches are semantic-mismatch', function() {
    const ok = workerResult({
        source: SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(ok.kind, 'ok', JSON.stringify(ok));
    const parsed = JSON.parse(ok.fingerprint);
    const mismatch = workerResult({
        source: SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8,
        expectedOutput: 'not-the-board'
    });
    assert.strictEqual(mismatch.kind, 'semantic-mismatch', JSON.stringify(mismatch));
    const match = workerResult({
        source: SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8,
        expectedOutput: parsed.board
    });
    assert.strictEqual(match.kind, 'ok', JSON.stringify(match));
});

test('compiler-message oracles compare stripped messages', function() {
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const item = corpus.find(function(row) { return row.name === 'Background missing'; });
    assert(item);
    const match = workerResult({
        source: item.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8,
        expectedErrors: item.expectedErrors,
        expectedErrorCount: item.expectedErrorCount
    });
    assert.strictEqual(match.kind, 'compiler-error', JSON.stringify(match));
    const mismatch = workerResult({
        source: item.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8,
        expectedErrors: ['this message is not produced'],
        expectedErrorCount: 2
    });
    assert.strictEqual(mismatch.kind, 'semantic-mismatch', JSON.stringify(mismatch));
});
```

- [ ] **Step 2: Run tests; expect FAIL** (oracles ignored)

- [ ] **Step 3: Implement oracle checks in the worker**

After compile diagnostics are known, if `job.expectedErrorCount != null || job.expectedErrors`:

- Strip tags from `global.errorStrings` with a small function that removes `/<[^>]+>/g` (do not use the engine `stripHTMLTags`, which needs a DOM).
- If `job.expectedErrorCount != null` and `global.errorCount !== job.expectedErrorCount`, or any expected string is missing from the stripped list, return `semantic-mismatch` with `detail` describing the first missing message or the count delta. Fingerprint stays the diagnostic fingerprint.
- If the oracle matches, return `compiler-error` or `compiler-warning` as usual (not `ok`).

After a successful playable run about to return `ok`, if `typeof job.expectedOutput === 'string'`:

- Compare `job.expectedOutput` to `convertLevelToString()` (the `board` field). If different, `kind: 'semantic-mismatch'`, `detail: 'expectedOutput'`. Skip this comparison on message/title/`textMode` levels.

Parent: `evaluateMutant` should accept an optional `oracle` object. Baseline preflight passes:

```js
        const baselineJobExtras = fixture.kind === 'simulation'
            ? { expectedOutput: fixture.expectedOutput }
            : { expectedErrors: fixture.expectedErrors, expectedErrorCount: fixture.expectedErrorCount };
```

Mutant evaluation does **not** pass those fields.

If a simulation fixture’s recorded `expectedOutput` was captured with the **full** input list and baseline only runs `maxInputs` + extras, the oracle will false-positive. Rule: send `expectedOutput` only when `options.extraInputs === 0` and `fixture.inputs.length <= options.maxInputs`. Otherwise omit it. Document that in DEVELOPMENT.md.

- [ ] **Step 4: Run tests**

Expected: PASS. If `'Background missing'` messages in the worker do not contain the fixture strings because of HTML, the strip function must make `indexOf` work; assert using `errorStrings` from a no-oracle run if needed.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/worker.js src/tests/monster_garden/run.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Oracle unmutated garden fixtures against recorded output and messages.

EOF
)"
```

---

### Task 3: Structure-aware mutators

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Extend the mutator-name test** (`'mutators have stable names and either change the source or return null'`) so the new names appear in `garden.mutators`. Add:

```js
test('structure-aware mutators usually keep a compiling sample compiling', function() {
    const names = ['duplicate-rule-line', 'swap-object-colors', 'nudge-level-cell', 'flip-win-quantifier'];
    names.forEach(function(name) {
        const mutator = garden.mutators.find(function(item) { return item.name === name; });
        assert(mutator, name);
        const rng = new garden.Random(7);
        const applied = mutator.apply(SAMPLE, rng);
        assert(applied);
        assert.notStrictEqual(applied.source, SAMPLE);
        const result = workerResult({
            source: applied.source,
            inputs: [0],
            level: 0,
            randomSeed: 'garden-seed',
            replay: false,
            maxInputs: 8
        });
        assert.notStrictEqual(result.kind, 'crash', name + ' ' + JSON.stringify(result));
    });
});
```

`SAMPLE` in `tests.js` has OBJECTS, a LEGEND, RULES with `[ > Player | Wall ] -> [ > Player | Wall ]`, empty WINCONDITIONS, and a LEVELS map. If `flip-win-quantifier` returns `null` on SAMPLE (no `all`/`some`), that is allowed: the test should then use a local source that contains `all crate on target` for that one mutator instead of requiring SAMPLE to grow a win condition.

- [ ] **Step 2: Run tests; expect FAIL** (unknown mutators)

- [ ] **Step 3: Implement the four mutators**

`duplicate-rule-line`: in RULES, collect body lines that contain `->`. Duplicate one chosen line immediately after itself. Detail: `duplicated rule line N`.

`swap-object-colors`: in OBJECTS, find tokens that are whole-line color names matching `/^[A-Za-z][A-Za-z0-9]*$/` on lines that are not object names (object names are the first non-empty line of a block). Simpler reliable approach: find two distinct matches of the color word regexp `\b(black|white|gray|grey|red|green|blue|yellow|pink|orange|brown|purple)\b` in OBJECTS (case insensitive) and swap those two occurrences. If fewer than two, return null.

`nudge-level-cell`: in LEVELS, collect map characters that appear in the LEGEND as `X =` single-character keys (lines matching `/^([^\s=])\s*=/`). Pick a map cell whose character is one of those keys and replace it with a different key. Ignore `message` lines. If the LEVELS section has no 2D map, return null.

`flip-win-quantifier`: in WINCONDITIONS, replace the first `\ball\b` with `some` or the first `\bsome\b` with `all`. Return null if neither appears.

Register them on the `mutators` array **after** the existing nine, in the order listed above.

- [ ] **Step 4: Run tests**

Expected: PASS. `run.js --list-mutators` now prints 13 names. Existing seam-mutator tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Add validity-preserving garden mutators.

EOF
)"
```

---

### Task 4: Docs and a short verification run

**Files:**
- Modify: `DEVELOPMENT.md`

- [ ] **Step 1: Update the garden section** of `DEVELOPMENT.md` to mention:

- `--extra-inputs N` (default 0)
- baseline preflight oracles (`semantic-mismatch` / `baseline`)
- new mutator names
- `report.json` fields `inputs`, `level`, `engineSeed`, `originalResult`, `minimizedResult`, `baselineSignature`
- `regression.js` now includes inputs, level, and seed

Do not claim the garden is part of the normal test suite.

- [ ] **Step 2: Run**

```
node src/tests/monster_garden/tests.js
node src/tests/monster_garden/run.js --list-mutators
node src/tests/monster_garden/run.js --seed 12345 --count 5 --no-replay --timeout-ms 20000
```

Expected: all garden tests pass; 13 mutator names; the count-5 run exits 0 and prints a JSON tally. If `semantic-mismatch` or `baseline` appears, that is a real finding, not a test failure.

- [ ] **Step 3: Commit docs**

```bash
git add DEVELOPMENT.md
git commit -m "$(cat <<'EOF'
Document garden oracles, extra inputs, and new mutators.

EOF
)"
```

---

## Self-review

- Semantic oracle vs expected output / messages: Task 2
- Generated extra inputs: Task 1
- Structure-aware mutators: Task 3
- Repro already includes job fields from the harness plan; gitRev already added there
- Do not modify the compiler or fixture files
