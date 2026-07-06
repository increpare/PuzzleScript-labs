#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');
const {
    formatReplayFailure,
    replaySolutionOnOriginal,
} = require('./run_canonical_solution_replay');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_solver_hda_smoke_node.js <puzzlescript_solver>');
    process.exit(1);
}

const solverPath = path.resolve(process.argv[2]);
const rootDir = path.resolve(__dirname, '..', '..');
const smokeDir = path.join(rootDir, 'src/tests/solver_smoke_tests');

function runSolver(args, label) {
    const result = spawnSync(solverPath, args, {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
    assert.strictEqual(result.status, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return JSON.parse(result.stdout);
}

function keyOf(result) {
    return `${result.game}#${result.level}`;
}

const commonArgs = [
    smokeDir,
    '--timeout-ms', '1000',
    '--jobs', '1',
    '--quiet',
    '--json',
];

const serial = runSolver([
    ...commonArgs,
    '--no-solutions',
    '--strategy', 'weighted-astar',
], 'serial weighted-astar');

function runHdaSmoke(runIndex) {
    return runSolver([
        ...commonArgs,
        '--strategy', 'hda-weighted-astar',
        '--hda-jobs', '4',
    ], `hda weighted-astar run ${runIndex}`);
}

assert.strictEqual(serial.totals.levels, 16);
assert.strictEqual(serial.totals.solved, 10);
assert.strictEqual(serial.totals.exhausted, 2);
assert.strictEqual(serial.totals.skipped_message, 4);
assert.strictEqual(serial.totals.timeout, 0);
assert.strictEqual(serial.totals.errors, 0);

const serialByKey = new Map(serial.results.map((result) => [keyOf(result), result]));
const hdaRuns = [1, 2, 3].map(runHdaSmoke);
for (const hda of hdaRuns) {
    assert.strictEqual(hda.totals.levels, serial.totals.levels);
    assert.strictEqual(hda.totals.errors, 0);
    assert.strictEqual(hda.totals.timeout, 0);
    assert.strictEqual(hda.totals.exhausted, serial.totals.exhausted);
    assert.strictEqual(hda.totals.skipped_message, serial.totals.skipped_message);
    assert.ok(hda.totals.solved >= serial.totals.solved);
    assert.ok(hda.totals.hda_remote_sends > 0, 'HDA smoke should exercise remote shard sends');
    assert.ok(hda.totals.hda_inbox_drains > 0, 'HDA smoke should exercise remote shard drains');
    assert.ok(hda.totals.hda_owner_shard_solves > 0);

    let replayed = 0;
    for (const result of hda.results) {
        const key = keyOf(result);
        const expected = serialByKey.get(key);
        assert.ok(expected, `unexpected HDA result ${key}`);
        assert.strictEqual(result.hda_jobs, 4, key);
        assert.strictEqual(result.hda_parallel, true, key);
        if (expected.status === 'skipped_message' || expected.status === 'exhausted') {
            assert.strictEqual(result.status, expected.status, key);
        }
        if (result.status === 'solved') {
            assert.ok(Array.isArray(result.solution), key);
            assert.ok(result.solution.length > 0, key);
            const source = fs.readFileSync(path.join(smokeDir, result.game), 'utf8');
            const replay = replaySolutionOnOriginal({
                source,
                game: result.game,
                level: result.level,
                solution: result.solution,
            });
            assert.strictEqual(replay.status, 'solved', formatReplayFailure(replay));
            replayed++;
        }
    }
    assert.ok(replayed > 0, 'HDA smoke should replay at least one solved level');
}

const compileErrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-hda-compile-error-'));
fs.writeFileSync(path.join(compileErrorDir, 'bad.txt'), `
title bad

objects
Background
black

Player
white

Crate
red

legend
. = Background
P = Player
C = Crate
Thing = Player and Crate

collisionlayers
Background
Player, Crate

rules
[ no Thing ] -> [ ]

levels
P
`, 'utf8');
const compileError = runSolver([
    compileErrorDir,
    '--timeout-ms', '1000',
    '--jobs', '1',
    '--strategy', 'hda-weighted-astar',
    '--hda-jobs', '4',
    '--quiet',
    '--json',
], 'hda compile error');
assert.strictEqual(compileError.totals.errors, 1);
assert.strictEqual(compileError.results[0].status, 'compile_error');
assert.strictEqual(compileError.results[0].strategy, 'hda-weighted-astar');
assert.strictEqual(compileError.results[0].hda_jobs, 4);
assert.strictEqual(compileError.results[0].hda_parallel, true);

console.log('run_solver_hda_smoke_node passed');
