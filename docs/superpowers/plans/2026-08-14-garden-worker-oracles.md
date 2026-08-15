# Garden Worker Oracles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the garden worker check real engine state: one canonical seed per job, validated level indexes, rich fingerprints, invariants after every input, snapshot replay, warning-only compiles, and a reset between full runs.

**Architecture:** All engine contact stays in `worker.js`. Shared checks that unit tests can drive without spawning the compiler (`checkLevelInvariants`, `fingerprintFields` helpers if any) live in `garden.js`. Do not modify `src/js/compiler.js`. Requires harness honesty (`2026-08-14-garden-harness-honesty.md`) to already be merged on this branch.

**Tech Stack:** Node.js built-ins, existing worker shims, `vm.runInThisContext` compiler bundle.

**Worktree:** `.worktrees/compiler-monster-garden`

**Spec:** `docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md` (fingerprint, invariants, restore/replay, engineSeed, compiler-warning)

---

## File map

- Modify: `src/tests/monster_garden/worker.js`
- Modify: `src/tests/monster_garden/garden.js` (`checkLevelInvariants`)
- Modify: `src/tests/monster_garden/tests.js`
- Bridge additional globals in the worker preamble: `curlevel`, `curlevelTarget`, `winning`, `messageselected`, `messagetext`, `hasUsedCheckpoint`, `loadedLevelSeed`

Do not add expected-output oracles or extra mutators here (next plan).

---

### Task 1: Stronger `checkLevelInvariants`

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Replace the existing invariants test** with:

```js
test('level invariants accept a well-formed level and name the first broken field', function() {
    const good = {
        width: 2,
        height: 3,
        n_tiles: 6,
        objects: new Int32Array(12),
        movements: new Int32Array(6),
        commandQueue: [],
        rowCellContents: [0, 0, 0],
        colCellContents: [0, 0]
    };
    assert.strictEqual(garden.checkLevelInvariants(good, 2, 1), null);
    assert(/stride/.test(garden.checkLevelInvariants(good, 0, 1)));
    assert(/missing/.test(garden.checkLevelInvariants(null, 2, 1)));
    assert(/dimensions/.test(garden.checkLevelInvariants({
        width: 0, height: 3, n_tiles: 0, objects: new Int32Array(0), movements: new Int32Array(0)
    }, 2, 1)));
    assert(/n_tiles/.test(garden.checkLevelInvariants({
        width: 2, height: 3, n_tiles: 5, objects: new Int32Array(10), movements: new Int32Array(5)
    }, 2, 1)));
    assert(/objects/.test(garden.checkLevelInvariants({
        width: 2, height: 3, n_tiles: 6, objects: new Int32Array(5), movements: new Int32Array(6)
    }, 2, 1)));
    assert(/movements/.test(garden.checkLevelInvariants({
        width: 2, height: 3, n_tiles: 6, objects: new Int32Array(12)
    }, 2, 1)));
    assert(/commandQueue/.test(garden.checkLevelInvariants({
        width: 2, height: 3, n_tiles: 6,
        objects: new Int32Array(12), movements: new Int32Array(6),
        commandQueue: ['win']
    }, 2, 1)));
});
```

- [ ] **Step 2: Run tests; expect FAIL** (movements currently optional; `{length:12}` still accepted as objects)

- [ ] **Step 3: Replace `checkLevelInvariants`**

```js
function isIntArrayLike(value, length) {
    return value && typeof value.length === 'number' && value.length === length;
}

function checkLevelInvariants(level, strideObj, strideMov, state) {
    if (!(strideObj > 0) || !(strideMov > 0) || !Number.isInteger(strideObj) || !Number.isInteger(strideMov)) {
        return 'strides are invalid';
    }
    if (!level || typeof level !== 'object') {
        return 'level is missing';
    }
    if (!Number.isInteger(level.width) || !Number.isInteger(level.height) || !(level.width > 0) || !(level.height > 0)) {
        return 'level dimensions are invalid';
    }
    if (level.n_tiles !== level.width * level.height) {
        return 'n_tiles does not match width*height';
    }
    const expectedObjects = level.n_tiles * strideObj;
    if (!isIntArrayLike(level.objects, expectedObjects)) {
        return 'objects length is ' + (level.objects && level.objects.length) + ' expected ' + expectedObjects;
    }
    const expectedMovements = level.n_tiles * strideMov;
    if (!isIntArrayLike(level.movements, expectedMovements)) {
        return 'movements length is ' + (level.movements && level.movements.length) + ' expected ' + expectedMovements;
    }
    if (level.commandQueue && level.commandQueue.length) {
        return 'commandQueue is not empty';
    }
    if (level.rowCellContents && level.rowCellContents.length !== level.height) {
        return 'rowCellContents length is invalid';
    }
    if (level.colCellContents && level.colCellContents.length !== level.width) {
        return 'colCellContents length is invalid';
    }
    if (state && state.rigid) {
        if (!level.rigidMovementAppliedMask || level.rigidMovementAppliedMask.length !== level.n_tiles) {
            return 'rigidMovementAppliedMask length is invalid';
        }
        if (!level.rigidGroupIndexMask || level.rigidGroupIndexMask.length !== level.n_tiles) {
            return 'rigidGroupIndexMask length is invalid';
        }
    }
    if (state && state.idDict) {
        const objectCount = Object.keys(state.idDict).length;
        const maxBit = objectCount;
        for (let tile = 0; tile < level.n_tiles; tile++) {
            for (let word = 0; word < strideObj; word++) {
                const bits = level.objects[tile * strideObj + word];
                for (let bit = 0; bit < 32; bit++) {
                    const abs = word * 32 + bit;
                    if (abs >= maxBit && (bits & (1 << bit))) {
                        return 'object bit ' + abs + ' is set but idDict has ' + maxBit + ' entries';
                    }
                }
            }
        }
    }
    if (state && state.collisionMasks && state.collisionMasks.length) {
        for (let tile = 0; tile < level.n_tiles; tile++) {
            for (let layer = 0; layer < state.collisionMasks.length; layer++) {
                const mask = state.collisionMasks[layer];
                if (!mask || !mask.data) {
                    continue;
                }
                let count = 0;
                for (let word = 0; word < strideObj; word++) {
                    const bits = level.objects[tile * strideObj + word] & mask.data[word];
                    if (bits) {
                        count += bits.toString(2).replace(/0/g, '').length;
                    }
                }
                if (count > 1) {
                    return 'collision layer ' + layer + ' has ' + count + ' objects at tile ' + tile;
                }
            }
        }
    }
    return null;
}
```

If `state.collisionMasks` is not how the engine names layer masks, look up `state.layerMasks` in `src/js/compiler.js` / parser output and use that property. Do not invent a third name. If neither exists on real `state`, skip the occupancy loop (the unit test does not pass `state`).

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Tighten garden level invariant checks.

EOF
)"
```

---

### Task 2: Canonical engine seed, level index, and compiler-warning

**Files:**
- Modify: `src/tests/monster_garden/worker.js`
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add worker tests**

```js
test('the worker echoes a canonical engineSeed and rejects a non-integer level', function() {
    const withSeed = workerResult({
        source: SAMPLE,
        inputs: [],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(withSeed.kind, 'ok', JSON.stringify(withSeed));
    assert.strictEqual(withSeed.engineSeed, 'garden-seed');
    const invented = workerResult({
        source: SAMPLE,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(invented.kind, 'ok', JSON.stringify(invented));
    assert.strictEqual(typeof invented.engineSeed, 'string');
    assert(invented.engineSeed.length > 0);
    const badLevel = workerResult({
        source: SAMPLE,
        inputs: [],
        level: '0',
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(badLevel.kind, 'crash', JSON.stringify(badLevel));
});

test('warning-only compiles are compiler-warning, not ok', function() {
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const warning = corpus.find(function(item) {
        return item.kind === 'compiler-message' && item.expectedErrorCount === 0;
    });
    assert(warning, 'need a warning-only compiler-message fixture');
    const result = workerResult({
        source: warning.source,
        inputs: [],
        level: 0,
        randomSeed: null,
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'compiler-warning', JSON.stringify(result));
    assert.strictEqual(result.errorCount, 0);
    assert(Array.isArray(result.errorStrings));
    assert(result.errorStrings.length > 0);
});
```

Keep the existing `'the worker treats compile diagnostics as compiler-error'` test.

- [ ] **Step 2: Run tests; expect FAIL** (`engineSeed` missing; warning fixture is `ok`)

- [ ] **Step 3: In `worker.js`**

Bridge `curlevel`, `curlevelTarget`, `winning`, `messageselected`, `messagetext`, `hasUsedCheckpoint`, `loadedLevelSeed` in the `Object.defineProperties` list the same way `level` is bridged.

Add:

```js
function canonicalEngineSeed(job) {
    if (job.engineSeed != null && String(job.engineSeed).length > 0) {
        return String(job.engineSeed);
    }
    if (job.randomSeed != null && String(job.randomSeed).length > 0) {
        return String(job.randomSeed);
    }
    return 'garden-' + String(job.level) + '-' + String((job.inputs || []).length);
}

function validateJob(job) {
    if (!Number.isInteger(job.level)) {
        throw new Error('job.level must be an integer');
    }
}

function compilerDiagnosticKind() {
    if (global.errorCount > 0) {
        return 'compiler-error';
    }
    if (global.errorStrings && global.errorStrings.length > 0) {
        return 'compiler-warning';
    }
    return null;
}
```

At the start of `runJob`:

```js
    validateJob(job);
    job.engineSeed = canonicalEngineSeed(job);
```

`compile(['loadLevel', job.level], job.source, job.engineSeed)`.

After compile, if `compilerDiagnosticKind()` is set, return that kind with
`fingerprint: kind + ':' + errorCount + ':' + JSON.stringify(global.errorStrings || [])`,
`engineSeed`, and `errorStrings: (global.errorStrings || []).slice()`.

After a clean compile, if `!global.state || !Array.isArray(global.state.levels)` throw. If `job.level < 0 || job.level >= global.state.levels.length`, throw `new Error('job.level ' + job.level + ' is out of range')`.

A selected message record is `global.state.levels[job.level]` with `Object.prototype.hasOwnProperty.call(selected, 'message')`. `isTextOrMessageLevel` must use that, not “any truthy message field”, and must not treat an out-of-range index as a message.

Every `return` from `runOnce` / `runJob` includes `engineSeed: job.engineSeed`.

- [ ] **Step 4: Run tests**

Expected: PASS. Existing SAMPLE / zokoban / message-only tests still `ok`.

If the warning-only fixture still compiles with `errorCount > 0` in the worker (IDE=false), pick another fixture from the corpus with `expectedErrorCount === 0` that the worker actually classifies as warning, or construct a minimal source that triggers `logWarning` without `logError`. Search `logWarning(` in `src/js/compiler.js` for a short reproducible case (for example `throttle_movement` without `realtime_interval` is a runtime warning after compile — prefer a compile-time warning). If no compile-time warning-only path is easy, a source with an unused object is acceptable if it produces `errorStrings` and `errorCount === 0`.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/worker.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Canonicalize garden engine seeds and classify warning-only compiles.

EOF
)"
```

---

### Task 3: Rich fingerprints, per-step invariants, snapshot replay, and reset

**Files:**
- Modify: `src/tests/monster_garden/worker.js`
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add tests**

```js
test('ok fingerprints include rng and mode, not only the board string', function() {
    const result = workerResult({
        source: SAMPLE,
        inputs: [0],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
    const parsed = JSON.parse(result.fingerprint);
    assert.strictEqual(parsed.errorCount, 0);
    assert.strictEqual(typeof parsed.board, 'string');
    assert(Array.isArray(parsed.objects));
    assert(parsed.rng && typeof parsed.rng.i === 'number');
    assert.strictEqual(typeof parsed.titleScreen, 'boolean');
});

test('invariants are checked after each input', function() {
    const result = workerResult({
        source: SAMPLE,
        inputs: [0, 3],
        level: 0,
        randomSeed: 'garden-seed',
        replay: false,
        maxInputs: 8
    });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
});
```

Do not weaken `'the worker compiles a valid sample and returns a stable ok fingerprint'`: it still requires a string fingerprint containing structure. Update it to `JSON.parse` if the old `indexOf('\n')` assertion would fail.

- [ ] **Step 2: Run tests; expect FAIL** on JSON.parse of the old `errorCount + "\n" + board` fingerprint

- [ ] **Step 3: Implement worker helpers**

```js
function resetWorkerRuntime() {
    const keys = Object.keys(_storage);
    for (let i = 0; i < keys.length; i++) {
        delete _storage[keys[i]];
    }
    global.backups = [];
    global.againing = false;
    global.winning = false;
    global.messageselected = false;
    global.textMode = true;
    global.titleScreen = true;
    global.hasUsedCheckpoint = false;
    global.curlevelTarget = null;
}

function snapshotEngine() {
    const level = global.level;
    return {
        curlevel: global.curlevel,
        curlevelTarget: global.curlevelTarget,
        textMode: global.textMode,
        titleScreen: global.titleScreen,
        winning: global.winning,
        messageselected: global.messageselected,
        messagetext: global.messagetext,
        hasUsedCheckpoint: global.hasUsedCheckpoint,
        backups: (global.backups || []).slice(),
        rng: snapshotRng(),
        objects: level && level.objects ? new Int32Array(level.objects) : null,
        movements: level && level.movements ? new Int32Array(level.movements) : null,
        storage: Object.assign({}, _storage)
    };
}

function restoreEngine(snap) {
    if (!snap) {
        return;
    }
    global.curlevel = snap.curlevel;
    global.curlevelTarget = snap.curlevelTarget;
    global.textMode = snap.textMode;
    global.titleScreen = snap.titleScreen;
    global.winning = snap.winning;
    global.messageselected = snap.messageselected;
    global.messagetext = snap.messagetext;
    global.hasUsedCheckpoint = snap.hasUsedCheckpoint;
    global.backups = snap.backups.slice();
    restoreRng(snap.rng);
    if (global.level && snap.objects) {
        global.level.objects.set(snap.objects);
    }
    if (global.level && snap.movements && global.level.movements) {
        global.level.movements.set(snap.movements);
    }
    const keys = Object.keys(_storage);
    for (let i = 0; i < keys.length; i++) {
        delete _storage[keys[i]];
    }
    Object.keys(snap.storage).forEach(function(key) {
        _storage[key] = snap.storage[key];
    });
}

function fingerprintAfter(job) {
    const diagnostic = compilerDiagnosticKind();
    if (diagnostic) {
        return diagnostic + ':' + global.errorCount + ':' + JSON.stringify(global.errorStrings || []);
    }
    const message = isTextOrMessageLevel(job);
    return JSON.stringify({
        errorCount: global.errorCount,
        errorStrings: (global.errorStrings || []).slice(),
        curlevel: global.curlevel,
        textMode: !!global.textMode,
        titleScreen: !!global.titleScreen,
        winning: !!global.winning,
        messageselected: !!global.messageselected,
        messagetext: String(global.messagetext || ''),
        board: message ? null : global.convertLevelToString(),
        objects: message || !global.level || !global.level.objects ? null : Array.from(global.level.objects),
        movements: message || !global.level || !global.level.movements ? null : Array.from(global.level.movements),
        rng: snapshotRng()
    });
}
```

Change `applyInputs` to take `job` and after each input and after each `drainAgain` inner `processInput(-1)`, if not a message/title level, call `garden.checkLevelInvariants(global.level, global.STRIDE_OBJ, global.STRIDE_MOV, global.state)` and return that string if broken. `runOnce` should return `kind: 'invariant'` immediately when `applyInputs` reports a break.

Replace undo-based replay:

```js
        if (job.replay && prefix.length > 0 && first.prefixLength > 0) {
            restoreEngine(first.engineSnapshot);
            const replayBroken = applyInputs(prefix, job);
            if (replayBroken) {
                return { kind: 'invariant', error: null, fingerprint: fingerprintAfter(job), detail: replayBroken, errorCount: global.errorCount, engineSeed: job.engineSeed };
            }
            const replayed = fingerprintAfter(job);
            if (replayed !== first.fingerprint) {
                return {
                    kind: 'replay-divergence',
                    error: null,
                    fingerprint: first.fingerprint,
                    detail: replayed,
                    errorCount: first.errorCount,
                    engineSeed: job.engineSeed
                };
            }
        }
        resetWorkerRuntime();
        const second = runOnce(job);
```

`runOnce` must call `resetWorkerRuntime()` at the start (first line after setting unitTesting flags), snapshot after compile+drain (`engineSnapshot`), and include `engineSeed` on every result. Remove `undoToBaseline` from the replay path (keep the function if unused tests do not care; deleting it is fine).

Pass `global.state` into `checkLevelInvariants`.

- [ ] **Step 4: Run garden tests**

Expected: PASS, including `'unmutated legend of zokoban with replay is ok'`. If zokoban now reports `replay-divergence`, that is a worker bug in snapshot completeness — restore any extra fields the fingerprint includes (`winning`, objects, movements, rng). Do not weaken the zokoban test.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/worker.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Snapshot garden engine state for replay and per-step invariants.

EOF
)"
```

---

## Self-review

- Canonical seed: Task 2
- Level index / message vs title: Task 2
- compiler-warning: Task 2
- Fingerprint richness: Task 3
- Invariants after every input/AGAIN: Task 3
- Stronger checkLevelInvariants: Task 1
- Snapshot replay and localStorage reset: Task 3
- Expected-output oracle, extra inputs, new mutators: **not this plan**
