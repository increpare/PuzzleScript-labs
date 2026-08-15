# Garden Harness Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the monster garden tell the truth: valid flags, unique fixture identity, a real child protocol, causal baseline preflight, shrink that cannot change the bug, and artifacts that reproduce the job.

**Architecture:** Keep `garden.js` as the pure helper and `run.js` as the parent. Do not change `worker.js` semantics in this plan except where `runChild` parsing already treats its JSON as opaque. Do not modify `src/js/compiler.js`. Work only in the `compiler-monster-garden` worktree.

**Tech Stack:** Node.js built-ins, existing `assert` + `test()` garden tests.

**Worktree:** `.worktrees/compiler-monster-garden`

**Spec:** `docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md` (harness sections: CLI, corpus identity, child protocol, baseline preflight, failure signature, shrinking, artifacts)

**Follow-on:** After this plan, `2026-08-14-garden-worker-oracles.md` then `2026-08-14-garden-semantics-expansion.md`.

---

## File map

- Modify: `src/tests/monster_garden/garden.js`
- Modify: `src/tests/monster_garden/run.js`
- Modify: `src/tests/monster_garden/tests.js`
- Modify: `DEVELOPMENT.md` (artifact/report fields, baseline tally)
- Do not modify: `src/js/compiler.js`, `src/tests/monster_garden/worker.js`

`KNOWN_RESULT_KINDS` is defined in this plan and includes `compiler-warning` and `semantic-mismatch` so later plans do not have to reopen the protocol whitelist.

---

### Task 0: Commit the timeout-cap and skip-policy already in the worktree

**Files:**
- Already modified: `src/tests/monster_garden/garden.js`, `run.js`, `tests.js`, `docs/superpowers/specs/2026-08-14-compiler-monster-garden-design.md`

These changes reject `--timeout-ms` above `2147483647` and only skip `/inapplicable/` mutation errors. They are already implemented and tested. Do not stage the spec or plan documents in this commit; those land with later tasks / a docs commit.

- [ ] **Step 1: Run garden tests**

Run: `node src/tests/monster_garden/tests.js`

Expected: all tests pass (21/21 or the current count printed by the runner).

- [ ] **Step 2: Commit only the timeout/skip code**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/run.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Reject oversized garden timeouts and skip only inapplicable mutations.

EOF
)"
```

---

### Task 1: Reject empty flags and seed aliasing

**Files:**
- Modify: `src/tests/monster_garden/garden.js` (`parseArguments`, `needValue`)
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add failing assertions** to the existing `'arguments have reproducible defaults and reject unsafe numeric values'` test:

```js
    assert.throws(function() { garden.parseArguments(['--mutator', '']); }, /mutator/);
    assert.throws(function() { garden.parseArguments(['--seed', '']); }, /seed/);
    assert.throws(function() { garden.parseArguments(['--seed', '4294967296']); }, /seed/);
    assert.strictEqual(garden.parseArguments(['--seed', '4294967295']).seed, 4294967295);
```

- [ ] **Step 2: Run the garden tests and confirm that test fails**

Run: `node src/tests/monster_garden/tests.js`

Expected: FAIL in `arguments have reproducible defaults...` (`--mutator ''` currently yields `mutators: []`, `--seed ''` becomes `0`, `--seed 4294967296` is accepted).

- [ ] **Step 3: Implement the checks**

In `needValue`, after reading `argv[i + 1]`, if the flag is `--seed` or `--mutator` do not special-case there. Instead in the `--seed` branch:

```js
            case '--seed': {
                const raw = needValue(argv, i, 'seed');
                if (!/^\d+$/.test(raw)) {
                    throw new Error('seed must be a non-negative integer');
                }
                const value = Number(raw);
                if (!Number.isInteger(value) || value < 0 || value > 4294967295) {
                    throw new Error('seed must be a non-negative integer at most 4294967295');
                }
                result.seed = value;
                i++;
                break;
            }
```

In the `--mutator` branch, after `filter(Boolean)`, if `selected.length === 0` throw `new Error('mutator list is empty')`. Keep the unknown-name loop.

- [ ] **Step 4: Run tests**

Run: `node src/tests/monster_garden/tests.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Reject empty garden flags and seeds that alias modulo 2^32.

EOF
)"
```

---

### Task 2: Unique corpus identity

**Files:**
- Modify: `src/tests/monster_garden/garden.js` (`loadCorpus`)
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add this test** after the existing corpus test (`'corpus records carry the fields a worker needs'`):

```js
test('corpusIndex is unique even when names and kind-local indexes collide', function() {
    const corpus = garden.loadCorpus(path.join(__dirname, '..', 'resources'));
    const indexes = corpus.map(function(item) { return item.corpusIndex; });
    assert.strictEqual(indexes.length, new Set(indexes).size);
    corpus.forEach(function(item, i) {
        assert.strictEqual(item.corpusIndex, i);
        assert.strictEqual(typeof item.kind, 'string');
        assert.strictEqual(typeof item.fixtureIndex, 'number');
    });
    const icy = corpus.filter(function(item) { return item.name === 'icycrates'; });
    if (icy.length >= 2) {
        assert.notStrictEqual(icy[0].kind, icy[1].kind);
        assert.notStrictEqual(icy[0].corpusIndex, icy[1].corpusIndex);
    }
});
```

If the existing corpus test asserts `fixtureIndex` identity only, leave `fixtureIndex` as the kind-local index.

- [ ] **Step 2: Run tests; expect FAIL** (`corpusIndex` is undefined)

Run: `node src/tests/monster_garden/tests.js`

- [ ] **Step 3: Set `corpusIndex` in `loadCorpus`**

Use a running `corpusIndex` starting at 0. Push simulation records first, then compiler-message records. Each record gets `corpusIndex: corpus.length` (the index about to be pushed). Keep `fixtureIndex` as the loop index inside that source array. Also store `expectedOutput: payload[2]` for simulations, and `expectedErrors: payload[1]`, `expectedErrorCount: payload[2]` for compiler-message records, with the other oracle field(s) `null`. Mutants will not send oracles until plan 3; storing them on the corpus record is required now so reports and preflight can name the fixture uniquely.

```js
            corpus.push({
                name: testdata[i][0],
                corpusIndex: corpus.length,
                fixtureIndex: i,
                kind: 'simulation',
                source: payload[0],
                inputs: payload[1] || [],
                level: payload[3] !== undefined ? payload[3] : 0,
                randomSeed: payload[4] !== undefined ? payload[4] : null,
                expectedOutput: payload[2] !== undefined ? payload[2] : null,
                expectedErrors: null,
                expectedErrorCount: null
            });
```

and the analogous compiler-message push with `expectedOutput: null`.

Update `mutateFixture` to copy `corpusIndex` and `kind` (kind is already copied).

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Give garden corpus records a unique corpusIndex.

EOF
)"
```

---

### Task 3: Child protocol and UTF-8

**Files:**
- Modify: `src/tests/monster_garden/garden.js` (`runChild`, export `KNOWN_RESULT_KINDS`)
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add these tests** near the existing hung-child test:

```js
const KNOWN = [
    'ok', 'compiler-error', 'compiler-warning', 'crash',
    'invariant', 'nondeterministic', 'replay-divergence', 'semantic-mismatch'
];

test('runChild rejects parseable non-results and nonzero exits', function() {
    const empty = path.join(os.tmpdir(), 'monster-garden-empty-json.js');
    fs.writeFileSync(empty, 'process.stdout.write("{}\\n"); process.exit(0);\n');
    return garden.runChild(process.execPath, [empty], '{}', 2000).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        const liar = path.join(os.tmpdir(), 'monster-garden-ok-nonzero.js');
        fs.writeFileSync(liar, 'process.stdout.write(JSON.stringify({kind:"ok",error:null,fingerprint:"x",detail:"",errorCount:0})+"\\n"); process.exit(73);\n');
        return garden.runChild(process.execPath, [liar], '{}', 2000);
    }).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        const euro = path.join(os.tmpdir(), 'monster-garden-utf8.js');
        fs.writeFileSync(euro, 'process.stdout.write(JSON.stringify({kind:"crash",error:{name:"Error",message:"euro € here"},fingerprint:"",detail:"",errorCount:0})+"\\n");\n');
        return garden.runChild(process.execPath, [euro], '{}', 2000);
    }).then(function(result) {
        assert.strictEqual(result.kind, 'crash');
        assert.strictEqual(result.error.message, 'euro € here');
    });
});
```

Also add `assert.deepStrictEqual(garden.KNOWN_RESULT_KINDS, KNOWN);` either in this test or the arguments test.

- [ ] **Step 2: Run tests; expect FAIL** (empty `{}` is currently accepted; `€` may pass by luck on this OS but the Buffer concat is still required)

- [ ] **Step 3: Implement `KNOWN_RESULT_KINDS` and rewrite `runChild`**

```js
const KNOWN_RESULT_KINDS = [
    'ok', 'compiler-error', 'compiler-warning', 'crash',
    'invariant', 'nondeterministic', 'replay-divergence', 'semantic-mismatch'
];

function decodeBuffers(chunks) {
    return Buffer.concat(chunks).toString('utf8');
}

function runChild(command, args, stdin, timeoutMs) {
    return new Promise(function(resolve) {
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const stdoutChunks = [];
        const stderrChunks = [];
        let timedOut = false;
        let settled = false;
        const timer = setTimeout(function() {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);

        function finish(result) {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(result);
        }

        function crashResult(name, message, detail) {
            return {
                kind: 'crash',
                error: { name: name, message: String(message || '').split('\n')[0] },
                fingerprint: '',
                detail: detail || '',
                errorCount: 0
            };
        }

        function crashFromError(error) {
            if (timedOut) {
                finish({
                    kind: 'timeout',
                    error: null,
                    fingerprint: '',
                    detail: 'timeout',
                    errorCount: 0
                });
                return;
            }
            const message = error && error.message ? error.message : 'spawn failed';
            finish(crashResult((error && error.name) || 'ChildError', message, decodeBuffers(stderrChunks) || message));
        }

        child.stdout.on('data', function(chunk) { stdoutChunks.push(Buffer.from(chunk)); });
        child.stderr.on('data', function(chunk) { stderrChunks.push(Buffer.from(chunk)); });
        child.on('error', crashFromError);
        child.stdin.on('error', crashFromError);
        child.on('close', function(code, signal) {
            if (timedOut) {
                finish({
                    kind: 'timeout',
                    error: null,
                    fingerprint: '',
                    detail: 'timeout',
                    errorCount: 0
                });
                return;
            }
            const stdout = decodeBuffers(stdoutChunks);
            const stderr = decodeBuffers(stderrChunks);
            let parsed;
            try {
                const lines = stdout.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
                parsed = JSON.parse(lines.pop());
            } catch (error) {
                finish(crashResult('ChildOutputError', (stdout || stderr || error.message).split('\n')[0], stderr));
                return;
            }
            if (!parsed || typeof parsed !== 'object' || KNOWN_RESULT_KINDS.indexOf(parsed.kind) < 0) {
                finish(crashResult('ChildOutputError', 'invalid worker result', stderr));
                return;
            }
            if (code && code !== 0 && parsed.kind !== 'crash') {
                finish(crashResult('ChildExitError', 'worker exited ' + code, stderr));
                return;
            }
            if (signal && signal !== 'SIGKILL') {
                finish(crashResult('ChildExitError', 'worker signal ' + signal, stderr));
                return;
            }
            finish(parsed);
        });
        try {
            child.stdin.write(stdin);
            child.stdin.end();
        } catch (error) {
            crashFromError(error);
        }
    });
}
```

Export `KNOWN_RESULT_KINDS` on `module.exports`.

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Validate garden worker JSON, exit codes, and UTF-8 output.

EOF
)"
```

---

### Task 4: Stronger signatures and honest shrinking

**Files:**
- Modify: `src/tests/monster_garden/garden.js` (`failureSignature`)
- Modify: `src/tests/monster_garden/run.js` (`shrinkMutant`)
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Replace the existing signature test** with:

```js
test('failure signatures distinguish timeouts from parser crashes and include fingerprints', function() {
    const crash = garden.failureSignature({
        kind: 'crash',
        error: { name: 'TypeError', message: 'bad thing\nwith stack noise' },
        fingerprint: 'ignored',
        detail: ''
    });
    assert.strictEqual(crash, garden.failureSignature({
        kind: 'crash',
        error: { name: 'TypeError', message: 'bad thing\nelsewhere' },
        fingerprint: 'other'
    }));
    assert.notStrictEqual(crash, garden.failureSignature({ kind: 'timeout' }));
    const first = garden.failureSignature({
        kind: 'replay-divergence',
        fingerprint: 'alpha-board',
        detail: 'beta'
    });
    const second = garden.failureSignature({
        kind: 'replay-divergence',
        fingerprint: 'gamma-board',
        detail: 'beta'
    });
    assert.notStrictEqual(first, second);
    assert.strictEqual(garden.failureSignature({ kind: 'timeout', fingerprint: 'x' }), 'timeout');
});
```

Add this shrink helper test (pure, no worker):

```js
test('timeouts are not shrunk and a signature change after shrink is reverted', async function() {
    const original = 'keep\nlater-crash\n';
    const mutant = { source: original, inputs: [], level: 0, randomSeed: null };
    const timeoutResult = { kind: 'timeout', error: null, fingerprint: '', detail: 'timeout', errorCount: 0 };
    const shrunkTimeout = await garden.shrinkInteresting(mutant, timeoutResult, {
        shrink: true,
        shrinkBudget: 20,
        evaluate: async function() {
            return { kind: 'compiler-error', error: null, fingerprint: 'compiler-error:1', detail: '', errorCount: 1 };
        }
    });
    assert.strictEqual(shrunkTimeout.source, original);
    assert.strictEqual(shrunkTimeout.result.kind, 'timeout');

    let calls = 0;
    const crash = {
        kind: 'crash',
        error: { name: 'TypeError', message: 'keep' },
        fingerprint: '',
        detail: '',
        errorCount: 0
    };
    const shrunkCrash = await garden.shrinkInteresting(mutant, crash, {
        shrink: true,
        shrinkBudget: 20,
        evaluate: async function(source) {
            calls++;
            if (source.indexOf('keep') >= 0) {
                return crash;
            }
            return { kind: 'ok', error: null, fingerprint: 'ok', detail: '', errorCount: 0 };
        }
    });
    assert.strictEqual(shrunkCrash.source, 'keep\n');
    assert.strictEqual(shrunkCrash.result.kind, 'crash');
    assert(calls > 0);
});
```

- [ ] **Step 2: Run tests; expect FAIL** (`failureSignature` currently returns only the kind for replay-divergence; `shrinkInteresting` does not exist)

- [ ] **Step 3: Implement `failureSignature` and `shrinkInteresting`**

```js
function clip(value, n) {
    return String(value == null ? '' : value).slice(0, n || 80);
}

function failureSignature(result) {
    if (!result || !result.kind) {
        return 'unknown';
    }
    if (result.kind === 'timeout') {
        return 'timeout';
    }
    if (result.kind === 'crash' && result.error) {
        const message = String(result.error.message || '').split('\n')[0];
        return 'crash:' + result.error.name + ':' + message;
    }
    if (result.kind === 'invariant' || result.kind === 'semantic-mismatch') {
        return result.kind + ':' + clip(result.detail) + ':' + clip(result.fingerprint);
    }
    return result.kind + ':' + clip(result.fingerprint) + ':' + clip(result.detail);
}
```

```js
async function shrinkInteresting(mutant, originalResult, options) {
    const signature = failureSignature(originalResult);
    if (!options.shrink || originalResult.kind === 'timeout') {
        return { source: mutant.source, steps: 0, signature: signature, result: originalResult };
    }
    let current = mutant.source.split('\n');
    let steps = 0;
    let remaining = options.shrinkBudget;
    let changed = true;
    while (changed && remaining > 0) {
        changed = false;
        let i = 0;
        while (i < current.length && remaining > 0) {
            const candidateSource = current.slice(0, i).concat(current.slice(i + 1)).join('\n');
            remaining--;
            steps++;
            const next = await options.evaluate({
                source: candidateSource,
                inputs: mutant.inputs,
                level: mutant.level,
                randomSeed: mutant.randomSeed
            });
            if (failureSignature(next) === signature) {
                current = candidateSource.split('\n');
                changed = true;
            } else {
                i++;
            }
        }
    }
    const minimizedSource = current.join('\n');
    const verified = await options.evaluate({
        source: minimizedSource,
        inputs: mutant.inputs,
        level: mutant.level,
        randomSeed: mutant.randomSeed
    });
    steps++;
    if (failureSignature(verified) !== signature) {
        return { source: mutant.source, steps: steps, signature: signature, result: originalResult };
    }
    return { source: minimizedSource, steps: steps, signature: signature, result: verified };
}
```

Export `shrinkInteresting`. In `run.js`, replace `shrinkMutant` with a wrapper that calls `garden.shrinkInteresting` and passes `evaluate: function(partial) { return evaluateMutant(Object.assign({}, mutant, partial), options); }`.

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/run.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Stop shrinking garden timeouts and keep minimized results honest.

EOF
)"
```

---

### Task 5: Reproduction manifest and unique temp artifacts

**Files:**
- Modify: `src/tests/monster_garden/garden.js` (`formatRegression`, `writeArtifacts`)
- Modify: `src/tests/monster_garden/run.js` (report.json fields)
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Update the artifact test**

```js
test('artifact names and regression fixtures are copy-pasteable and path-safe', function() {
    const name = garden.artifactDirName('crash:TypeError:bad thing / \\ : *', 99, 3);
    assert.strictEqual(name, 'crash-TypeError-bad-thing-s99_0003');
    assert(!/[\/\\:*]/.test(name));
    const snippet = garden.formatRegression('monster garden 99 3', 'title "X"\nline\n', {
        inputs: [2, 3],
        level: 4,
        randomSeed: '1397263843369.0808'
    });
    assert.strictEqual(
        snippet,
        '[\n    "monster garden 99 3",\n    ["title \\"X\\"\\nline\\n", [2,3], "", 4, "1397263843369.0808"]\n],\n'
    );
});

test('writeArtifacts uses a unique temp directory and leaves dest intact until rename', function() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-art-'));
    const destName = 'crash-demo-s1_0001';
    const dest = path.join(root, destName);
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'report.json'), '{"old":true}\n');
    const written = garden.writeArtifacts(root, destName, {
        'report.json': '{"new":true}\n',
        'original.txt': 'src\n'
    });
    assert.strictEqual(written, dest);
    assert.strictEqual(fs.readFileSync(path.join(dest, 'report.json'), 'utf8'), '{"new":true}\n');
    const leftovers = fs.readdirSync(root).filter(function(name) {
        return name.indexOf('.tmp') >= 0 || name.indexOf(destName + '-') === 0;
    });
    leftovers.forEach(function(name) {
        assert.notStrictEqual(name, destName + '.tmp');
    });
});
```

JSON.stringify of `[2,3]` is `[2,3]` with no spaces — keep the test exact.

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

```js
function formatRegression(name, source, job) {
    job = job || {};
    const inputs = job.inputs || [];
    const level = job.level == null ? 0 : job.level;
    const seed = job.randomSeed == null ? null : job.randomSeed;
    return '[\n    ' + JSON.stringify(name) + ',\n    [' +
        JSON.stringify(source) + ', ' + JSON.stringify(inputs) + ', "", ' +
        JSON.stringify(level) + ', ' + JSON.stringify(seed) + ']\n],\n';
}

function writeArtifacts(outputDir, dirName, files) {
    fs.mkdirSync(outputDir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(outputDir, '.' + dirName + '-'));
    const dest = path.join(outputDir, dirName);
    const names = Object.keys(files);
    for (let i = 0; i < names.length; i++) {
        fs.writeFileSync(path.join(tmp, names[i]), files[names[i]]);
    }
    try {
        fs.renameSync(tmp, dest);
    } catch (error) {
        if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') {
            fs.rmSync(tmp, { recursive: true, force: true });
            throw error;
        }
        const bak = fs.mkdtempSync(path.join(outputDir, '.' + dirName + '-old-'));
        fs.renameSync(dest, bak);
        fs.renameSync(tmp, dest);
        fs.rmSync(bak, { recursive: true, force: true });
    }
    return dest;
}
```

On Darwin, `rename` of a directory onto an existing directory fails. The bak swap is the fallback. If `renameSync(tmp, dest)` succeeds because dest was absent, that is the happy path.

In `run.js`, when writing `report.json`, include at least:

```js
{
    seed: options.seed,
    campaignIndex: i,
    fixtureName: mutant.fixtureName,
    corpusIndex: mutant.corpusIndex,
    fixtureIndex: mutant.fixtureIndex,
    fixtureKind: mutant.kind,
    mutator: mutant.mutator,
    detail: mutant.detail,
    attempt: mutant.attempt,
    inputs: mutant.inputs,
    level: mutant.level,
    randomSeed: mutant.randomSeed,
    replay: options.replay,
    maxInputs: options.maxInputs,
    timeoutMs: options.timeoutMs,
    originalResult: result,
    minimizedResult: minimized.result,
    signature: minimized.signature,
    shrinkSteps: minimized.steps
}
```

and call `formatRegression(..., { inputs: mutant.inputs, level: mutant.level, randomSeed: mutant.randomSeed })`.

Add a `readGitRev` helper in `run.js`:

```js
function readGitRev() {
    try {
        return require('child_process').execSync('git rev-parse HEAD', {
            cwd: __dirname,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (error) {
        return '';
    }
}
```

Put `gitRev: readGitRev()` on the report.

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/run.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Write garden artifacts that reproduce the executed job.

EOF
)"
```

---

### Task 6: Baseline preflight and causal attribution

**Files:**
- Modify: `src/tests/monster_garden/run.js`
- Modify: `src/tests/monster_garden/garden.js` (`isInteresting` stays the same; add `isHealthyKind` if useful)
- Test: `src/tests/monster_garden/tests.js`
- Modify: `DEVELOPMENT.md`

- [ ] **Step 1: Add a parent-level test** that uses a tiny fake worker script is too heavy. Instead extract `attributeMonster(baseline, mutantResult)` in `garden.js` and test it:

```js
test('only causal mutants are attributed when the unmutated fixture already fails', function() {
    const baseline = {
        kind: 'replay-divergence',
        error: null,
        fingerprint: 'same',
        detail: 'x',
        errorCount: 0
    };
    const same = garden.attributeMonster(baseline, baseline);
    assert.strictEqual(same.save, false);
    assert.strictEqual(same.tally, 'baseline');
    const different = garden.attributeMonster(baseline, {
        kind: 'crash',
        error: { name: 'TypeError', message: 'boom' },
        fingerprint: '',
        detail: '',
        errorCount: 0
    });
    assert.strictEqual(different.save, true);
    assert.strictEqual(different.tally, 'crash');
    const healthy = garden.attributeMonster({
        kind: 'ok', error: null, fingerprint: 'f', detail: '', errorCount: 0
    }, baseline);
    assert.strictEqual(healthy.save, true);
    assert.strictEqual(healthy.tally, 'replay-divergence');
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

```js
function isHealthyKind(kind) {
    return kind === 'ok' || kind === 'compiler-error' || kind === 'compiler-warning';
}

function attributeMonster(baseline, mutantResult) {
    if (!baseline || isHealthyKind(baseline.kind)) {
        return { save: isInteresting(mutantResult), tally: mutantResult.kind, baseline: false };
    }
    if (failureSignature(baseline) === failureSignature(mutantResult)) {
        return { save: false, tally: 'baseline', baseline: true };
    }
    return { save: isInteresting(mutantResult), tally: mutantResult.kind, baseline: true };
}
```

Export `attributeMonster` and `isHealthyKind`.

In `run.js` `main`, initialize `counts.baseline = 0` and `counts['compiler-warning'] = 0` and `counts['semantic-mismatch'] = 0`. For each mutant, before `evaluateMutant(mutant)`:

```js
        const baseline = await evaluateMutant({
            source: fixture.source,
            inputs: fixture.inputs,
            level: fixture.level,
            randomSeed: fixture.randomSeed
        }, options);
        const result = await evaluateMutant(mutant, options);
        const attributed = garden.attributeMonster(baseline, result);
        counts[attributed.tally] = (counts[attributed.tally] || 0) + 1;
        process.stdout.write(
            '#' + (i + 1) + ' ' + attributed.tally + ' ' + mutant.mutator + ' ' + mutant.fixtureName + '\n'
        );
        if (!attributed.save) {
            continue;
        }
```

Pass `baselineKind: baseline.kind` and `baselineSignature: garden.failureSignature(baseline)` into `report.json`.

Update `DEVELOPMENT.md` garden section: mention baseline preflight, that `baseline` in the tally means the unmutated fixture already failed the same way, and that `report.json` contains `inputs`, `level`, `randomSeed`, `originalResult`, and `minimizedResult`.

- [ ] **Step 4: Run garden tests**

Expected: PASS. The one-mutant CLI test still writes no artifacts for healthy output.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/run.js src/tests/monster_garden/tests.js DEVELOPMENT.md
git commit -m "$(cat <<'EOF'
Preflight unmutated fixtures before blaming a garden mutation.

EOF
)"
```

---

## Self-review

- CLI empty/aliasing: Task 1
- Unique corpus identity: Task 2
- UTF-8 and protocol: Task 3
- Timeout shrinking / stale report result / stronger signatures: Task 4
- Reproduction manifest / unique tmp artifacts: Task 5
- Baseline preflight: Task 6
- Worker semantic checks, oracles, extra inputs, new mutators: **not this plan**
