#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PuzzleScriptSolverRun, parseSolverJson, resolveSolverPath } = require('../src/puzzlescriptSolverRunner');

function writeExecutable(dir, name, body) {
    const script = path.join(dir, name);
    fs.writeFileSync(script, `#!/usr/bin/env node\n${body}`, 'utf8');
    fs.chmodSync(script, 0o755);
    return script;
}

function solverTempDirs() {
    return fs.readdirSync(os.tmpdir())
        .filter(name => name.startsWith('puzzlescript-solver-'))
        .map(name => path.join(os.tmpdir(), name));
}

function newSolverTempDirs(before) {
    const known = new Set(before);
    return solverTempDirs().filter(dir => !known.has(dir));
}

function removeDirs(dirs) {
    for (const dir of dirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

async function runTests() {
    assert.deepStrictEqual(parseSolverJson('noise\n{"results":[{"status":"solved"}]}\n'), {
        results: [{ status: 'solved' }],
    });
    assert.throws(() => parseSolverJson('not json'), /did not contain JSON/);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-solver-runner-'));
    const fakeSolver = path.join(tmp, process.platform === 'win32' ? 'puzzlescript_solver.exe' : 'puzzlescript_solver');
    fs.writeFileSync(fakeSolver, '');
    assert.deepStrictEqual(resolveSolverPath(fakeSolver, '/missing'), {
        path: fakeSolver,
        exists: true,
        source: 'setting',
    });
    assert.strictEqual(resolveSolverPath('', tmp).exists, false);

    const success = writeExecutable(tmp, 'solver-success.js', `
const fs = require('fs');
const sourcePath = process.argv[2];
if (!fs.readFileSync(sourcePath, 'utf8').includes('levels')) process.exit(3);
function requireFlag(flag, expected) {
    const index = process.argv.indexOf(flag);
    if (index < 0) throw new Error('missing ' + flag);
    if (expected !== undefined && process.argv[index + 1] !== expected) {
        throw new Error(flag + ' expected ' + expected + ' but got ' + process.argv[index + 1]);
    }
}
requireFlag('--json');
requireFlag('--quiet');
requireFlag('--no-solutions');
requireFlag('--level', '0');
requireFlag('--timeout-ms', '1000');
requireFlag('--strategy', 'portfolio');
console.log(JSON.stringify({ results: [{ game: 'game', level: 0, status: 'solved', solution: ['right'], solution_length: 1, unique_states: 2 }] }));
`);
    const run = new PuzzleScriptSolverRun({
        binaryPath: success,
        sourceText: 'title T\nlevels\nP',
        level: 0,
        timeoutMs: 1000,
        strategy: 'portfolio',
    });
    const output = await run.start();
    assert.strictEqual(output.cancelled, false);
    assert.strictEqual(output.result.results[0].status, 'solved');
    assert.strictEqual(fs.existsSync(output.tempDir), false);

    const beforeSyncError = solverTempDirs();
    let leakedSyncError = [];
    try {
        const syncErrorPromise = new PuzzleScriptSolverRun({
            binaryPath: success,
            sourceText: {
                toString() {
                    throw new Error('source stringify failed');
                },
            },
            level: 0,
            timeoutMs: 1000,
            strategy: 'portfolio',
        }).start();
        assert.strictEqual(typeof syncErrorPromise.then, 'function');
        await assert.rejects(syncErrorPromise, /source stringify failed/);
    } finally {
        leakedSyncError = newSolverTempDirs(beforeSyncError);
        removeDirs(leakedSyncError);
    }
    assert.deepStrictEqual(leakedSyncError, [], 'synchronous setup errors should not leak solver temp dirs');

    const failure = writeExecutable(tmp, 'solver-failure.js', `
console.error('compile failed');
process.exit(2);
`);
    const beforeFailure = solverTempDirs();
    let leakedFailure = [];
    try {
        await assert.rejects(() => new PuzzleScriptSolverRun({
            binaryPath: failure,
            sourceText: '',
            level: 0,
            timeoutMs: 10,
            strategy: 'portfolio',
        }).start(), /compile failed/);
    } finally {
        leakedFailure = newSolverTempDirs(beforeFailure);
        removeDirs(leakedFailure);
    }
    assert.deepStrictEqual(leakedFailure, [], 'failed solver runs should not leak solver temp dirs');

    const slow = writeExecutable(tmp, 'solver-slow.js', `
setTimeout(() => {}, 10000);
`);
    const slowRun = new PuzzleScriptSolverRun({
        binaryPath: slow,
        sourceText: 'title T\\nlevels\\nP',
        level: 0,
        timeoutMs: 10000,
        strategy: 'portfolio',
    });
    const beforeCancel = solverTempDirs();
    let leakedCancel = [];
    try {
        const pending = slowRun.start();
        setTimeout(() => slowRun.cancel(), 50);
        const cancelled = await pending;
        assert.strictEqual(cancelled.cancelled, true);
        assert.strictEqual(fs.existsSync(cancelled.tempDir), false);
    } finally {
        leakedCancel = newSolverTempDirs(beforeCancel);
        removeDirs(leakedCancel);
    }
    assert.deepStrictEqual(leakedCancel, [], 'cancelled solver runs should not leak solver temp dirs');

    fs.rmSync(tmp, { recursive: true, force: true });
}

runTests().then(() => {
    console.log('solver runner tests passed');
}).catch(error => {
    console.error(error);
    process.exit(1);
});
