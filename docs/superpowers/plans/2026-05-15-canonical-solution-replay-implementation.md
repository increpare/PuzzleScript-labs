# Canonical Solution Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a regression harness that solves static-optimized semantic canonical focus targets and verifies each canonical solution replays to a win on the original source.

**Architecture:** Add a focused Node script that canonicalizes the existing focus corpus into a temporary canonical corpus, invokes the existing JS solver runner on that corpus, then replays solved input sequences against the original games through the real PuzzleScript runtime. Keep `src/tests/run_solver_tests_js.js` unchanged unless execution proves an internal helper must be exported.

**Tech Stack:** Node.js CommonJS scripts, existing PuzzleScript JS runtime shim, `src/canonicalize.js`, `src/decanonicalize.js`, `src/tests/run_solver_tests_js.js`, Makefile.

---

## File Structure

- Create `src/tests/run_canonical_solution_replay.js`
  - CLI entrypoint and importable helpers.
  - Owns argument parsing, focus-manifest loading, canonical corpus generation, solver invocation, original replay validation, human output, and JSON output.
- Create `src/tests/canonical_solution_replay_node.js`
  - Node assertion tests for replay helper behavior and a tiny end-to-end canonical replay run.
- Modify `Makefile`
  - Add `solver_canonical_replay` to `.PHONY`.
  - Add help text.
  - Add target that runs the harness with `$(SOLVER_FOCUS_CORPUS)`, `$(SOLVER_FOCUS_MANIFEST)`, and `$(SOLVER_FOCUS_TIMEOUT_MS)`.

No production solver behavior changes are expected.

---

### Task 1: Add Replay Helper Test

**Files:**
- Create: `src/tests/canonical_solution_replay_node.js`
- Later implementation target: `src/tests/run_canonical_solution_replay.js`

- [ ] **Step 1: Write the failing replay-helper test**

Create `src/tests/canonical_solution_replay_node.js` with this content:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    formatReplayFailure,
    loadPuzzleScriptRuntime,
    replaySolutionOnOriginal,
} = require('./run_canonical_solution_replay');

const SIMPLE_SOURCE = `
title Canonical Replay Fixture

========
OBJECTS
========

Background
black

Player
blue

Goal
green

=======
LEGEND
=======

. = Background
P = Player
G = Goal

================
COLLISIONLAYERS
================

Background
Goal
Player

=====
RULES
=====

=============
WINCONDITIONS
=============

All Player on Goal

======
LEVELS
======

PG
`;

loadPuzzleScriptRuntime();

const solved = replaySolutionOnOriginal({
    source: SIMPLE_SOURCE,
    game: 'fixture.txt',
    level: 0,
    solution: ['right'],
});
assert.strictEqual(solved.status, 'solved', 'right should solve the fixture');
assert.strictEqual(solved.steps, 1);

const notSolved = replaySolutionOnOriginal({
    source: SIMPLE_SOURCE,
    game: 'fixture.txt',
    level: 0,
    solution: ['left'],
});
assert.strictEqual(notSolved.status, 'not_solved', 'left should not solve the fixture');
assert.ok(formatReplayFailure(notSolved).includes('fixture.txt level=0'));
assert.ok(formatReplayFailure(notSolved).includes('left'));

console.log('canonical_solution_replay_node: ok');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node src/tests/canonical_solution_replay_node.js
```

Expected: FAIL with a module error similar to:

```text
Error: Cannot find module './run_canonical_solution_replay'
```

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add src/tests/canonical_solution_replay_node.js
git commit -m "Add canonical replay helper test"
```

---

### Task 2: Implement Original Replay Helper

**Files:**
- Create: `src/tests/run_canonical_solution_replay.js`
- Test: `src/tests/canonical_solution_replay_node.js`

- [ ] **Step 1: Add the minimal replay implementation**

Create `src/tests/run_canonical_solution_replay.js` with this initial content:

```js
#!/usr/bin/env node
'use strict';

const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

const INPUT_BY_TOKEN = new Map([
    ['up', 0],
    ['left', 1],
    ['down', 2],
    ['right', 3],
    ['action', 4],
]);

let runtimeLoaded = false;

function loadPuzzleScriptRuntime() {
    if (!runtimeLoaded) {
        loadPuzzleScript();
        runtimeLoaded = true;
    }
}

function stripCompilerMessages() {
    if (!Array.isArray(errorStrings)) {
        return '';
    }
    return errorStrings.map(message => {
        if (typeof stripHTMLTags === 'function') {
            return stripHTMLTags(message);
        }
        return String(message).replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
    }).join('\n');
}

function compileReplaySource(source, game) {
    loadPuzzleScriptRuntime();
    if (typeof resetParserErrorState === 'function') {
        resetParserErrorState();
    }
    unitTesting = true;
    lazyFunctionGeneration = false;
    compile(['loadLevel', 0], source, `canonical-replay:${game}:0`);
    if (errorCount > 0) {
        throw new Error(stripCompilerMessages());
    }
}

function settleAgainForReplay() {
    for (let pass = 0; pass < 500 && againing; pass++) {
        againing = false;
        processInput(-1, undefined, undefined, true);
    }
}

function stepReplayToken(token) {
    if (!INPUT_BY_TOKEN.has(token)) {
        throw new Error(`Unsupported solution token: ${token}`);
    }
    const beforeLevel = curlevel;
    const beforeTitle = titleScreen;
    const input = INPUT_BY_TOKEN.get(token);
    let changed = false;
    if (input === 4 && textMode && !titleScreen) {
        if (state.levels[curlevel] && state.levels[curlevel].message !== undefined) {
            nextLevel();
        } else {
            textMode = false;
            messagetext = '';
            messageselected = false;
        }
        changed = true;
    } else {
        changed = Boolean(processInput(input, undefined, undefined, true));
    }
    settleAgainForReplay();
    return changed && (curlevel !== beforeLevel || (!beforeTitle && titleScreen));
}

function replaySolutionOnOriginal({ source, game, level, solution }) {
    try {
        compileReplaySource(source, game);
        if (!state.levels[level]) {
            return {
                game,
                level,
                solution,
                status: 'invalid_level',
                steps: 0,
                error: `Missing level ${level}`,
            };
        }
        if (state.levels[level].message !== undefined) {
            return {
                game,
                level,
                solution,
                status: 'skipped_message',
                steps: 0,
                error: `Level ${level} is a message level`,
            };
        }
        loadLevelFromState(state, level, `canonical-replay:${game}:${level}`);
        for (let index = 0; index < solution.length; index++) {
            if (stepReplayToken(solution[index])) {
                return {
                    game,
                    level,
                    solution,
                    status: 'solved',
                    steps: index + 1,
                };
            }
        }
        return {
            game,
            level,
            solution,
            status: 'not_solved',
            steps: solution.length,
            error: `Replay ended without satisfying the win condition`,
        };
    } catch (error) {
        return {
            game,
            level,
            solution,
            status: 'replay_error',
            steps: 0,
            error: error && error.stack ? error.stack : String(error),
        };
    }
}

function formatReplayFailure(result) {
    const solution = Array.isArray(result.solution) ? result.solution.join(',') : '';
    return [
        `canonical replay failed game=${result.game} level=${result.level}`,
        `  solution=${solution}`,
        `  replay_status=${result.status}`,
        `  error=${result.error || ''}`,
    ].join('\n');
}

function main() {
    process.stderr.write('run_canonical_solution_replay.js CLI is not implemented yet\n');
    process.exit(2);
}

module.exports = {
    formatReplayFailure,
    loadPuzzleScriptRuntime,
    replaySolutionOnOriginal,
};

if (require.main === module) {
    main();
}
```

- [ ] **Step 2: Run the replay-helper test**

Run:

```bash
node src/tests/canonical_solution_replay_node.js
```

Expected: PASS and print:

```text
canonical_solution_replay_node: ok
```

- [ ] **Step 3: Commit the replay helper**

Run:

```bash
git add src/tests/run_canonical_solution_replay.js src/tests/canonical_solution_replay_node.js
git commit -m "Add original solution replay helper"
```

---

### Task 3: Add End-to-End Canonical Corpus Test

**Files:**
- Modify: `src/tests/canonical_solution_replay_node.js`
- Modify: `src/tests/run_canonical_solution_replay.js`

- [ ] **Step 1: Extend the test with a tiny canonical replay run**

Append this block before the final `console.log` in `src/tests/canonical_solution_replay_node.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    runCanonicalReplay,
} = require('./run_canonical_solution_replay');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-canonical-replay-test-'));
const corpusDir = path.join(tempRoot, 'corpus');
const manifestPath = path.join(tempRoot, 'manifest.json');
fs.mkdirSync(corpusDir, { recursive: true });
fs.writeFileSync(path.join(corpusDir, 'fixture.txt'), SIMPLE_SOURCE, 'utf8');
fs.writeFileSync(manifestPath, `${JSON.stringify({
    schema_version: 1,
    kind: 'solver_focus_group',
    target_count: 1,
    targets: [
        { game: 'fixture.txt', level: 0, first_solved_timeout_ms: 500 },
    ],
}, null, 2)}\n`, 'utf8');

const e2e = runCanonicalReplay({
    corpusPath: corpusDir,
    manifestPath,
    timeoutMs: 500,
    staticOptimizations: 'all',
    strategy: 'bfs',
    quiet: true,
    workDir: path.join(tempRoot, 'work'),
});
assert.strictEqual(e2e.failures.length, 0, e2e.failures.map(formatReplayFailure).join('\n'));
assert.strictEqual(e2e.results.length, 1);
assert.strictEqual(e2e.results[0].canonical_status, 'solved');
assert.strictEqual(e2e.results[0].original_replay_status, 'solved');
assert.deepStrictEqual(e2e.results[0].canonical_solution, ['right']);
```

Move the existing `console.log('canonical_solution_replay_node: ok');` so it remains the last statement in the file.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node src/tests/canonical_solution_replay_node.js
```

Expected: FAIL with:

```text
TypeError: runCanonicalReplay is not a function
```

- [ ] **Step 3: Commit the failing end-to-end test**

Run:

```bash
git add src/tests/canonical_solution_replay_node.js
git commit -m "Add canonical replay end-to-end test"
```

---

### Task 4: Implement Canonical Replay Runner and CLI

**Files:**
- Modify: `src/tests/run_canonical_solution_replay.js`
- Test: `src/tests/canonical_solution_replay_node.js`

- [ ] **Step 1: Replace the placeholder CLI with runner code**

Update `src/tests/run_canonical_solution_replay.js` by adding these imports near the top:

```js
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { canonicalizeSource } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');
const { parseSolverOptPassList } = require('./solver_static_opt');
```

Then add these functions above `main()`:

```js
function usage(exitCode) {
    const message = [
        'Usage: node src/tests/run_canonical_solution_replay.js <corpus>',
        '  [--solver-focus-manifest PATH] [--timeout-ms N] [--static-optimizations PASSLIST]',
        '  [--strategy bfs|weighted-astar|greedy|portfolio|phase-split] [--work-dir DIR] [--quiet] [--json]',
    ].join('\n');
    (exitCode === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const options = {
        corpusPath: null,
        manifestPath: path.resolve('src/tests/solver_focus_group.json'),
        timeoutMs: 500,
        staticOptimizations: 'all',
        strategy: 'portfolio',
        quiet: false,
        json: false,
        workDir: null,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--solver-focus-manifest' && index + 1 < args.length) {
            options.manifestPath = path.resolve(args[++index]);
        } else if (arg === '--timeout-ms' && index + 1 < args.length) {
            options.timeoutMs = Math.max(1, Number.parseInt(args[++index], 10));
        } else if (arg === '--static-optimizations' && index + 1 < args.length) {
            options.staticOptimizations = args[++index];
            parseSolverOptPassList(options.staticOptimizations);
        } else if (arg === '--strategy' && index + 1 < args.length) {
            options.strategy = args[++index];
        } else if (arg === '--work-dir' && index + 1 < args.length) {
            options.workDir = path.resolve(args[++index]);
        } else if (arg === '--quiet') {
            options.quiet = true;
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--help' || arg === '-h') {
            usage(0);
        } else if (options.corpusPath === null) {
            options.corpusPath = path.resolve(arg);
        } else {
            usage(1);
        }
    }
    if (!options.corpusPath) {
        usage(1);
    }
    return options;
}

function readManifest(manifestPath) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || !Array.isArray(manifest.targets) || manifest.targets.length === 0) {
        throw new Error(`Expected non-empty targets[] in ${manifestPath}`);
    }
    return manifest;
}

function safeTargetPath(root, game) {
    const full = path.resolve(root, game);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Target escapes corpus: ${game}`);
    }
    return full;
}

function ensureCleanDir(dirPath) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeCanonicalCorpus(options, manifest, canonicalCorpusDir) {
    ensureCleanDir(canonicalCorpusDir);
    const games = Array.from(new Set(manifest.targets.map(target => target.game))).sort();
    for (const game of games) {
        const originalPath = safeTargetPath(options.corpusPath, game);
        if (!fs.existsSync(originalPath)) {
            throw new Error(`Missing focus game: ${game}`);
        }
        const originalSource = fs.readFileSync(originalPath, 'utf8');
        const canonical = canonicalizeSource(originalSource, 'semantic', {
            staticOptimizations: options.staticOptimizations,
            sourcePath: game,
        });
        const rehydrated = decanonicalizeSemantic(canonical);
        const outputPath = safeTargetPath(canonicalCorpusDir, game);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, rehydrated, 'utf8');
    }
}

function solveCanonicalCorpus(options, canonicalCorpusDir) {
    const solverPath = path.join(__dirname, 'run_solver_tests_js.js');
    const args = [
        solverPath,
        canonicalCorpusDir,
        '--solver-focus-manifest',
        options.manifestPath,
        '--timeout-ms',
        String(options.timeoutMs),
        '--strategy',
        options.strategy,
        '--quiet',
        '--json',
        '--no-solutions',
    ];
    const child = spawnSync(process.execPath, args, {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
    });
    if (child.status !== 0) {
        throw new Error([
            `Canonical solver failed with status ${child.status}`,
            child.stdout.trim(),
            child.stderr.trim(),
        ].filter(Boolean).join('\n'));
    }
    return JSON.parse(child.stdout);
}

function originalSourceCache(corpusPath) {
    const cache = new Map();
    return function sourceForGame(game) {
        if (!cache.has(game)) {
            cache.set(game, fs.readFileSync(safeTargetPath(corpusPath, game), 'utf8'));
        }
        return cache.get(game);
    };
}

function resultKey(result) {
    return `${result.game}#${result.level}`;
}

function replayCanonicalSolutions(options, solverPayload) {
    const sourceForGame = originalSourceCache(options.corpusPath);
    const rows = [];
    const failures = [];
    for (const result of solverPayload.results || []) {
        const row = {
            game: result.game,
            level: result.level,
            canonical_status: result.status,
            canonical_solution: Array.isArray(result.solution) ? result.solution.slice() : [],
            canonical_solution_length: result.solution_length || 0,
            original_replay_status: 'not_checked',
        };
        if (result.status === 'solved') {
            const replay = replaySolutionOnOriginal({
                source: sourceForGame(result.game),
                game: result.game,
                level: result.level,
                solution: row.canonical_solution,
            });
            row.original_replay_status = replay.status;
            row.error = replay.error;
            if (replay.status !== 'solved') {
                failures.push(Object.assign({}, replay, {
                    canonical_status: result.status,
                    key: resultKey(result),
                }));
            }
        }
        rows.push(row);
    }
    return { results: rows, failures };
}

function runCanonicalReplay(options) {
    const resolved = Object.assign({}, options, {
        corpusPath: path.resolve(options.corpusPath),
        manifestPath: path.resolve(options.manifestPath),
        workDir: options.workDir
            ? path.resolve(options.workDir)
            : fs.mkdtempSync(path.join(os.tmpdir(), 'ps-canonical-replay-')),
    });
    parseSolverOptPassList(resolved.staticOptimizations);
    const manifest = readManifest(resolved.manifestPath);
    const canonicalCorpusDir = path.join(resolved.workDir, 'canonical-corpus');
    writeCanonicalCorpus(resolved, manifest, canonicalCorpusDir);
    const solverPayload = solveCanonicalCorpus(resolved, canonicalCorpusDir);
    const replay = replayCanonicalSolutions(resolved, solverPayload);
    return Object.assign({
        canonicalCorpusDir,
        totals: {
            targets: replay.results.length,
            solved: replay.results.filter(row => row.canonical_status === 'solved').length,
            replay_failures: replay.failures.length,
        },
    }, replay);
}

function printHuman(summary) {
    for (const failure of summary.failures) {
        process.stdout.write(`${formatReplayFailure(failure)}\n`);
    }
    process.stdout.write(`canonical_solution_replay targets=${summary.totals.targets} canonical_solved=${summary.totals.solved} replay_failures=${summary.totals.replay_failures}\n`);
}
```

Replace `main()` with:

```js
function main() {
    const options = parseArgs(process.argv);
    try {
        const summary = runCanonicalReplay(options);
        if (options.json) {
            process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        } else if (!options.quiet || summary.failures.length > 0) {
            printHuman(summary);
        }
        process.exit(summary.failures.length === 0 ? 0 : 1);
    } catch (error) {
        if (options.json) {
            process.stdout.write(`${JSON.stringify({ error: error && error.stack ? error.stack : String(error) }, null, 2)}\n`);
        } else {
            process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        }
        process.exit(1);
    }
}
```

Update `module.exports` to include:

```js
module.exports = {
    formatReplayFailure,
    loadPuzzleScriptRuntime,
    parseArgs,
    replaySolutionOnOriginal,
    runCanonicalReplay,
};
```

- [ ] **Step 2: Run the end-to-end test**

Run:

```bash
node src/tests/canonical_solution_replay_node.js
```

Expected: PASS and print:

```text
canonical_solution_replay_node: ok
```

- [ ] **Step 3: Run the CLI on the tiny test corpus manually**

Use the temp-corpus shape from the test if needed, or run the focus command in Task 6. The CLI should print a summary like:

```text
canonical_solution_replay targets=1 canonical_solved=1 replay_failures=0
```

- [ ] **Step 4: Commit the runner**

Run:

```bash
git add src/tests/run_canonical_solution_replay.js src/tests/canonical_solution_replay_node.js
git commit -m "Add canonical solution replay runner"
```

---

### Task 5: Add Make Target

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Verify the target is missing**

Run:

```bash
make -n solver_canonical_replay
```

Expected: FAIL with:

```text
make: *** No rule to make target `solver_canonical_replay'.  Stop.
```

The exact quoting may differ by Make version.

- [ ] **Step 2: Add the target to `.PHONY`**

In the `.PHONY:` declaration near the top of `Makefile`, add `solver_canonical_replay` next to the other solver focus targets:

```make
solver_tests_cpp solver_tests_js solver_tests solver_smoke_tests solver_determinism_tests solver_parity_smoke solver_compact_parity_smoke solver_compact_parity solver_benchmark solver_mine_pippable solver_focus_mine solver_focus_manifest_check solver_focus_benchmark solver_focus_compare solver_focus_compact_compare solver_focus_compact_codegen_compare solver_focus_perf_report solver_focus_compact_perf_report solver_focus_compact_codegen_perf_report solver_canonical_replay solver_benchmark_targets js_static_optimization_comparison_solver_smoke js_static_optimization_comparison_solver_focus static_optimizer_page generator_smoke_tests generator_benchmark \
```

- [ ] **Step 3: Add help text**

In the help block near the solver entries, add:

```make
	@echo "  make solver_canonical_replay       Solve static-optimized canonical focus targets and replay on originals"
```

- [ ] **Step 4: Add the Make target**

Add this target near `js_static_optimization_comparison_solver_focus`:

```make
solver_canonical_replay: $(SOLVER_FOCUS_MANIFEST)
	$(NODE) src/tests/run_canonical_solution_replay.js "$(SOLVER_FOCUS_CORPUS)" --solver-focus-manifest "$(SOLVER_FOCUS_MANIFEST)" --timeout-ms $(SOLVER_FOCUS_TIMEOUT_MS) --static-optimizations all --strategy $(SOLVER_FOCUS_STRATEGY)
```

- [ ] **Step 5: Verify Make expands the target**

Run:

```bash
make -n solver_canonical_replay
```

Expected: PASS and print a `node src/tests/run_canonical_solution_replay.js ...` command containing:

```text
--static-optimizations all
```

- [ ] **Step 6: Commit the Make target**

Run:

```bash
git add Makefile
git commit -m "Add canonical solution replay make target"
```

---

### Task 6: Run Focus Manifest Verification

**Files:**
- Verify: `src/tests/run_canonical_solution_replay.js`
- Verify: `src/tests/canonical_solution_replay_node.js`
- Verify: `Makefile`

- [ ] **Step 1: Run the focused unit/end-to-end test**

Run:

```bash
node src/tests/canonical_solution_replay_node.js
```

Expected:

```text
canonical_solution_replay_node: ok
```

- [ ] **Step 2: Run the real focus replay harness**

Run:

```bash
node src/tests/run_canonical_solution_replay.js src/tests/solver_tests --solver-focus-manifest src/tests/solver_focus_group.json --timeout-ms 500 --static-optimizations all --strategy portfolio
```

Expected: exit code `0` and output ending with:

```text
canonical_solution_replay targets=50 canonical_solved=<number> replay_failures=0
```

The exact `canonical_solved` number may vary with timeout and solver behavior. It must be greater than `0` for this focus manifest; if it is `0`, inspect canonical solver output before accepting the run.

- [ ] **Step 3: Run the Make target**

Run:

```bash
make solver_canonical_replay
```

Expected: exit code `0` and:

```text
replay_failures=0
```

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean or only intentional files from this plan.

- [ ] **Step 5: Commit any verification-only adjustments**

If verification required small output or timeout adjustments, commit them:

```bash
git add src/tests/run_canonical_solution_replay.js src/tests/canonical_solution_replay_node.js Makefile
git commit -m "Stabilize canonical solution replay verification"
```

Skip this commit if Task 6 made no file changes.

---

## Self-Review

Spec coverage:

- Static-optimized semantic canonical form is implemented in Task 4 via `canonicalizeSource(..., 'semantic', { staticOptimizations: options.staticOptimizations })`.
- Existing focus group is used in Task 4 and wired to Make in Task 5.
- Canonical solve happens through the existing JS solver runner in Task 4.
- Original replay uses the real PuzzleScript runtime in Task 2.
- Exact input identity is preserved by replaying `result.solution` tokens without edits in Task 4.
- Timeout is non-fatal for canonical solving because Task 4 only replays rows where `result.status === 'solved'`.
- Make integration is covered in Task 5.
- Focus verification is covered in Task 6.

Placeholder scan:

- No placeholder markers or unbounded "add tests" steps remain.
- Later-work items from the spec are intentionally outside this plan.

Type consistency:

- Exported helper names are `formatReplayFailure`, `loadPuzzleScriptRuntime`, `parseArgs`, `replaySolutionOnOriginal`, and `runCanonicalReplay`.
- Result row fields match the design: `game`, `level`, `canonical_status`, `canonical_solution`, `canonical_solution_length`, `original_replay_status`, and optional `error`.
