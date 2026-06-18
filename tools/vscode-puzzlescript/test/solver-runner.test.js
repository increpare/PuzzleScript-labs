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

    const failure = writeExecutable(tmp, 'solver-failure.js', `
console.error('compile failed');
process.exit(2);
`);
    await assert.rejects(() => new PuzzleScriptSolverRun({
        binaryPath: failure,
        sourceText: '',
        level: 0,
        timeoutMs: 10,
        strategy: 'portfolio',
    }).start(), /compile failed/);

    fs.rmSync(tmp, { recursive: true, force: true });
}

runTests().then(() => {
    console.log('solver runner tests passed');
}).catch(error => {
    console.error(error);
    process.exit(1);
});
