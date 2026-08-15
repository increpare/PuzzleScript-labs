# Garden Forever Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--forever` so the garden can run until Ctrl+C, with a live `tally.json` and TTY stderr status, without changing batch `--count` campaigns except for writing that tally file.

**Architecture:** Same `run.js` parent and `worker.js` child. `garden.js` gains `parseArguments` `--forever`, atomic `writeTally` / `tallyPayload` / `formatForeverStatus`, and an optional `onSpawn` on `runChild`. `run.js` owns the stop flag, signal handlers, and when to publish the tally. First SIGINT/SIGTERM finishes the current trial; a second SIGKILL’s the live worker.

**Tech Stack:** Node.js built-ins only (`fs`, `child_process`). No new dependencies.

**Worktree:** `.worktrees/compiler-monster-garden`

**Spec:** `docs/superpowers/specs/2026-08-14-garden-forever-mode-design.md`

---

## File map

- Modify: `src/tests/monster_garden/garden.js` (`parseArguments`, `runChild`, tally helpers, exports)
- Modify: `src/tests/monster_garden/run.js` (loop, signals, publish tally, pass `onSpawn`)
- Modify: `src/tests/monster_garden/tests.js`
- Modify: `DEVELOPMENT.md`

Do not modify `src/js/compiler.js` or fixture files. Do not dedup artifacts by signature.

---

### Task 1: `--forever` CLI flag

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add tests** next to `'arguments have reproducible defaults...'`. Also assert the default in that existing test: `defaults.forever === false`.

```js
test('--forever cannot be combined with --count', function() {
    assert.strictEqual(garden.parseArguments([]).forever, false);
    assert.strictEqual(garden.parseArguments(['--forever']).forever, true);
    assert.strictEqual(garden.parseArguments(['--forever']).count, 100);
    assert.throws(function() {
        garden.parseArguments(['--forever', '--count', '3']);
    }, /forever/);
    assert.throws(function() {
        garden.parseArguments(['--count', '3', '--forever']);
    }, /forever/);
});
```

- [ ] **Step 2: Run tests; expect FAIL**

```
cd /Users/stephenlavelle/Documents/GitHub/PuzzleScript/.worktrees/compiler-monster-garden
node src/tests/monster_garden/tests.js
```

Expected: FAIL (`forever` undefined / `--forever` unknown option).

- [ ] **Step 3: Implement**

In `parseArguments` default `forever: false`. Track whether `--count` and `--forever` appeared (count always has a default of 100, so do not treat `count === 100` as “user passed `--count`”).

After the `for` loop, if both were seen, `throw new Error('--forever cannot be combined with --count');`.

```js
    let sawCount = false;
    let sawForever = false;
    // ... inside switch:
            case '--count':
                sawCount = true;
                result.count = needPositiveInt(argv, i, 'count');
                i++;
                break;
            case '--forever':
                sawForever = true;
                result.forever = true;
                break;
    // ... after the for loop, before return:
    if (sawCount && sawForever) {
        throw new Error('--forever cannot be combined with --count');
    }
    return result;
```

Add `forever: false` to the `result` object next to `count: 100`.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Add --forever and reject combining it with --count.

EOF
)"
```

---

### Task 2: Atomic tally file and status line

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

- [ ] **Step 1: Add tests**

```js
test('writeTally replaces tally.json atomically and payload fields are stable', function() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-tally-'));
    const counts = {
        ok: 1, 'compiler-error': 0, 'compiler-warning': 0, crash: 2,
        timeout: 0, invariant: 0, nondeterministic: 0, 'replay-divergence': 0,
        'semantic-mismatch': 0, baseline: 0, skipped: 0
    };
    const payload = garden.tallyPayload({
        seed: 9,
        forever: true,
        trials: 4,
        saved: 2,
        counts: counts,
        lastTrial: { index: 4, tally: 'crash', mutator: 'legend-cycle', fixtureName: 'sokoban' },
        lastSaved: { dir: 'crash-demo-s9_0002', signature: 'crash:TypeError:x', kind: 'crash' }
    }, function() { return '2026-08-14T12:00:00.000Z'; });
    garden.writeTally(dir, payload);
    garden.writeTally(dir, payload);
    const names = fs.readdirSync(dir);
    assert.deepStrictEqual(names.filter(function(name) {
        return name !== 'tally.json';
    }), []);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'tally.json'), 'utf8'));
    assert.strictEqual(parsed.seed, 9);
    assert.strictEqual(parsed.forever, true);
    assert.strictEqual(parsed.trials, 4);
    assert.strictEqual(parsed.saved, 2);
    assert.strictEqual(parsed.updatedAt, '2026-08-14T12:00:00.000Z');
    assert.deepStrictEqual(parsed.counts, counts);
    assert.strictEqual(parsed.lastTrial.mutator, 'legend-cycle');
    assert.strictEqual(parsed.lastSaved.kind, 'crash');
    assert.strictEqual(
        garden.formatForeverStatus(counts, 4, 2),
        'trials=4 saved=2 crash=2 timeout=0 invariant=0 nondeterministic=0 replay-divergence=0 semantic-mismatch=0'
    );
});
```

- [ ] **Step 2: Run tests; expect FAIL**

Expected: FAIL (`tallyPayload` / `writeTally` not exported).

- [ ] **Step 3: Implement** in `garden.js` (near `writeArtifacts`). Export all three.

```js
function tallyPayload(fields, now) {
    const stamp = now === undefined ? function() { return new Date().toISOString(); } : now;
    return {
        seed: fields.seed,
        forever: !!fields.forever,
        trials: fields.trials,
        saved: fields.saved,
        counts: fields.counts,
        lastTrial: fields.lastTrial,
        lastSaved: fields.lastSaved == null ? null : fields.lastSaved,
        updatedAt: typeof stamp === 'function' ? stamp() : stamp
    };
}

function writeTally(outputDir, payload) {
    fs.mkdirSync(outputDir, { recursive: true });
    const dest = path.join(outputDir, 'tally.json');
    const tmp = path.join(outputDir, '.tally.json.' + process.pid + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
    fs.renameSync(tmp, dest);
}

function formatForeverStatus(counts, trials, saved) {
    return 'trials=' + trials +
        ' saved=' + saved +
        ' crash=' + (counts.crash || 0) +
        ' timeout=' + (counts.timeout || 0) +
        ' invariant=' + (counts.invariant || 0) +
        ' nondeterministic=' + (counts.nondeterministic || 0) +
        ' replay-divergence=' + (counts['replay-divergence'] || 0) +
        ' semantic-mismatch=' + (counts['semantic-mismatch'] || 0);
}
```

`writeTally` must not leave the `.tmp` file after a successful rename. If `renameSync` throws, unlink `tmp` in a `finally` only when `dest` already has the new file; if rename failed, still unlink tmp so a crash does not litter (unlink tmp in `catch` after rethrow is enough):

```js
    try {
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
        fs.renameSync(tmp, dest);
    } catch (error) {
        if (fs.existsSync(tmp)) {
            fs.unlinkSync(tmp);
        }
        throw error;
    }
```

- [ ] **Step 4: Run tests**

Expected: PASS. `readdir` must not include the pid tmp name.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Write garden tally.json through a temp file rename.

EOF
)"
```

---

### Task 3: `runChild` `onSpawn` handle

**Files:**
- Modify: `src/tests/monster_garden/garden.js`
- Test: `src/tests/monster_garden/tests.js`

Existing `runChild(command, args, stdin, timeoutMs)` callers must keep working. Add a 5th optional `onSpawn(child)` invoked immediately after `spawn`, before stdin write.

- [ ] **Step 1: Add test** (near other `runChild` tests)

```js
test('runChild onSpawn receives the live child process', function() {
    const payload = JSON.stringify({
        kind: 'ok', error: null, fingerprint: 'x', detail: '', errorCount: 0
    });
    let seen = null;
    return garden.runChild('/bin/echo', [payload], '{}', 2000, function(child) {
        seen = child;
        assert.strictEqual(typeof child.pid, 'number');
        assert.strictEqual(typeof child.kill, 'function');
    }).then(function(result) {
        assert(seen);
        assert.strictEqual(result.kind, 'ok');
    });
});
```

- [ ] **Step 2: Run tests; expect FAIL** (`onSpawn` ignored / not called).

- [ ] **Step 3: Implement**

In `runChild`, after `const child = spawn(...)`:

```js
        if (typeof onSpawn === 'function') {
            onSpawn(child);
        }
```

Function signature:

```js
function runChild(command, args, stdin, timeoutMs, onSpawn) {
```

Do not change timeout/SIGKILL behavior.

- [ ] **Step 4: Run tests**

Expected: PASS, including the existing `/bin/echo` runChild tests.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/garden.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Expose the live garden worker to the parent via onSpawn.

EOF
)"
```

---

### Task 4: Publish `tally.json` after every batch trial

**Files:**
- Modify: `src/tests/monster_garden/run.js`
- Test: `src/tests/monster_garden/tests.js`

**Trap:** `'a one-mutant CLI run is deterministic and writes no artifacts for healthy output'` asserts `fs.readdirSync(output).length === 0`. After this task the dir contains `tally.json`. Update that test in the same commit or it will FAIL.

- [ ] **Step 1: Change the one-mutant test** to expect `tally.json` and no other names. Add a dedicated tally assertion (this is the failing-before-impl check if you add the tally asserts **before** wiring `run.js`):

In `'a one-mutant CLI run...'` replace `assert.strictEqual(fs.readdirSync(output).length, 0);` with:

```js
    const names = fs.readdirSync(output).sort();
    assert.deepStrictEqual(names, ['tally.json']);
    const tally = JSON.parse(fs.readFileSync(path.join(output, 'tally.json'), 'utf8'));
    assert.strictEqual(tally.seed, 12345);
    assert.strictEqual(tally.forever, false);
    assert.strictEqual(tally.trials, 1);
    assert.strictEqual(typeof tally.counts.ok, 'number');
    assert(tally.lastTrial);
    assert.strictEqual(tally.lastTrial.index, 1);
```

Also add `--forever --count 3` to `'run.js rejects malformed options...'`:

```js
    const both = spawnSync(process.execPath, [
        path.join(__dirname, 'run.js'), '--forever', '--count', '3'
    ], { encoding: 'utf8' });
    assert.notStrictEqual(both.status, 0);
    assert(/forever/.test(both.stderr));
```

- [ ] **Step 2: Run tests; expect FAIL** (one-mutant: empty dir, no `tally.json`).

- [ ] **Step 3: Wire `run.js`**

Add helpers (same file, above `main`):

```js
function publishTally(options, counts, trialIndex, saved, lastTrial, lastSaved) {
    const payload = garden.tallyPayload({
        seed: options.seed,
        forever: options.forever,
        trials: trialIndex + 1,
        saved: saved,
        counts: counts,
        lastTrial: lastTrial,
        lastSaved: lastSaved
    });
    garden.writeTally(options.output, payload);
    if (process.stderr.isTTY) {
        process.stderr.write('\r' + garden.formatForeverStatus(counts, trialIndex + 1, saved));
    }
}
```

Pass `onSpawn` from `evaluateMutant` so Task 5 can store the child. For this task it is enough to accept a slot:

```js
let currentChild = null;

async function evaluateMutant(mutant, options, oracle) {
    const job = {
        source: mutant.source,
        inputs: mutant.inputs,
        level: mutant.level,
        randomSeed: mutant.randomSeed,
        replay: options.replay,
        maxInputs: garden.trialMaxInputs(options, mutant.inputs)
    };
    if (oracle) {
        Object.assign(job, oracle);
    }
    try {
        return await garden.runChild(
            process.execPath,
            [workerPath],
            JSON.stringify(job),
            options.timeoutMs,
            function(child) { currentChild = child; }
        );
    } finally {
        currentChild = null;
    }
}
```

In the trial loop, **before every `continue` and after a completed trial** (including skip), call `publishTally`. Skip path:

```js
            counts.skipped++;
            publishTally(options, counts, i, artifactIndex, {
                index: i + 1,
                tally: 'skipped',
                mutator: null,
                fixtureName: fixture.name
            }, lastSaved);
            continue;
```

After the `#N` stdout line, if `!attributed.save`, publish with that trial’s mutator/fixture and `continue`. After a save, publish with `lastSaved` set to `{ dir: dirName, signature: minimized.signature, kind: result.kind }` (`saved` is `artifactIndex` after increment).

Keep a `let lastSaved = null;` next to `artifactIndex`.

Keep the existing `for (let i = 0; i < options.count; i++)` in this task (forever loop is Task 5). Still print JSON counts at the end. If stderr is a TTY, write `'\n'` after the loop so the prompt is not stuck on the status line.

- [ ] **Step 4: Run tests**

Expected: PASS. One-mutant stdout still identical across two runs (tally.json `updatedAt` is not on stdout).

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/run.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Publish garden tally.json after every campaign trial.

EOF
)"
```

---

### Task 5: `--forever` loop and cooperative SIGINT

**Files:**
- Modify: `src/tests/monster_garden/run.js`
- Test: `src/tests/monster_garden/tests.js`

`tests.js` currently imports `{ spawnSync }`. Add `spawn`:

```js
const { spawnSync, spawn } = require('child_process');
```

- [ ] **Step 1: Add the SIGINT test** after the one-mutant CLI test.

```js
test('run.js --forever stops on SIGINT and writes tally.json', function() {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'monster-garden-forever-'));
    const child = spawn(process.execPath, [
        path.join(__dirname, 'run.js'),
        '--forever',
        '--seed', '1',
        '--no-shrink',
        '--no-replay',
        '--timeout-ms', '20000',
        '--output', output
    ]);
    let stdout = '';
    let signalled = false;
    child.stdout.on('data', function(chunk) {
        stdout += chunk.toString();
        if (!signalled && stdout.indexOf('#') >= 0) {
            signalled = true;
            child.kill('SIGINT');
        }
    });
    return new Promise(function(resolve, reject) {
        const timer = setTimeout(function() {
            child.kill('SIGKILL');
            reject(new Error('forever process did not exit after SIGINT; stdout=' + stdout.slice(0, 200)));
        }, 30000);
        child.on('error', function(error) {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', function(code) {
            clearTimeout(timer);
            try {
                assert.strictEqual(code, 0, stdout);
                assert(signalled);
                const tallyPath = path.join(output, 'tally.json');
                assert(fs.existsSync(tallyPath), 'missing tally.json');
                const tally = JSON.parse(fs.readFileSync(tallyPath, 'utf8'));
                assert.strictEqual(tally.forever, true);
                assert.strictEqual(tally.seed, 1);
                assert(tally.trials >= 1);
                const lines = stdout.trim().split('\n').filter(Boolean);
                const summary = JSON.parse(lines[lines.length - 1]);
                assert.strictEqual(typeof summary.ok, 'number');
                assert.strictEqual(typeof summary.crash, 'number');
                assert.strictEqual(typeof summary.skipped, 'number');
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
});
```

- [ ] **Step 2: Run tests; expect FAIL** (unknown option already fixed; process never exits / no SIGINT handler).

- [ ] **Step 3: Implement the loop and signals in `run.js`**

Replace `for (let i = 0; i < options.count; i++)` with:

```js
    let stopRequested = false;
    let finishing = false;

    function finishCampaign() {
        if (finishing) {
            return;
        }
        finishing = true;
        if (process.stderr.isTTY) {
            process.stderr.write('\n');
        }
        process.stdout.write(JSON.stringify(counts) + '\n');
    }

    function onSignal() {
        if (stopRequested) {
            if (currentChild) {
                try {
                    currentChild.kill('SIGKILL');
                } catch (error) {}
            }
            finishCampaign();
            process.exit(0);
            return;
        }
        stopRequested = true;
    }

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    for (let i = 0; options.forever ? !stopRequested : i < options.count; i++) {
        // existing trial body
    }
    finishCampaign();
```

Do not register signals on the `--list-mutators` path.

First SIGINT sets `stopRequested` and does **not** kill the worker. The current trial (including shrink if already saving) finishes, the `for` condition fails, `finishCampaign` prints JSON and exits 0 via `main` returning.

Second SIGINT SIGKILLs `currentChild` (set in Task 4 `onSpawn`), calls `finishCampaign`, `process.exit(0)` so a hung 20s timeout does not block shutdown. `finishCampaign` must be idempotent so the loop does not print JSON twice if it also reaches the end (the `finishing` flag). If the second signal exits via `process.exit`, skip a second JSON write — `finishing` handles that.

Remove the old trailing `process.stdout.write(JSON.stringify(counts) + '\n');` so only `finishCampaign` prints it.

- [ ] **Step 4: Run tests**

```
node src/tests/monster_garden/tests.js
```

Expected: all PASS, including the new SIGINT test within 30s.

- [ ] **Step 5: Commit**

```bash
git add src/tests/monster_garden/run.js src/tests/monster_garden/tests.js
git commit -m "$(cat <<'EOF'
Stop --forever garden campaigns on SIGINT after the current trial.

EOF
)"
```

---

### Task 6: Docs

**Files:**
- Modify: `DEVELOPMENT.md`

- [ ] **Step 1: Update the garden section** to mention:

- `node src/tests/monster_garden/run.js --forever --seed 12345`
- Ctrl+C finishes the current trial and exits 0; a second Ctrl+C kills the worker
- `<output>/tally.json` is rewritten after every trial (batch and forever); `cat` it while the process runs
- TTY stderr shows a `\r` status line with trials/saved/interesting counts
- `--forever` cannot be combined with `--count`
- `--timeout-ms` still bounds each worker
- Do not claim the garden is part of the normal test suite

- [ ] **Step 2: Run**

```
node src/tests/monster_garden/tests.js
node src/tests/monster_garden/run.js --list-mutators
```

Expected: tests PASS; 13 mutator names. Do not start a `--forever` campaign in this step (the SIGINT test already did).

- [ ] **Step 3: Commit**

```bash
git add DEVELOPMENT.md
git commit -m "$(cat <<'EOF'
Document garden --forever, tally.json, and Ctrl+C.

EOF
)"
```

---

## Self-review

| Spec requirement | Task |
| --- | --- |
| `--forever`; cannot combine with `--count` | 1 |
| `--list-mutators` still exits before the loop | unchanged `run.js` early return |
| `--timeout-ms` unchanged | 3, 5 |
| One seed for the whole run; stored on tally | 2, 4 |
| No signature dedup | no task adds it |
| Loop until `stopRequested`; same trial body | 5 |
| First SIGINT finishes current trial including shrink | 5 |
| Second SIGINT SIGKILLs worker, tally, exit 0 | 3 + 4 `currentChild` + 5 |
| `runChild` `onSpawn` | 3 |
| `tally.json` after every trial including skip; atomic rename | 2, 4 |
| Payload fields (seed, forever, trials, saved, counts, lastTrial, lastSaved, updatedAt) | 2 |
| Skip `lastTrial.mutator === null` | 4 |
| TTY `\r` status; no line when not TTY; newline on exit | 2, 4, 5 |
| Stdout `#N` lines + JSON on cooperative stop | 5 |
| Parent throw still nonzero; last tally remains | no extra path |
| Tests listed in spec | 1, 4, 5 |
| DEVELOPMENT.md | 6 |
| Do not edit compiler.js / fixtures | file map |

`trials` is `i + 1` (1-based), matching `lastTrial.index` and stdout `#N`.
