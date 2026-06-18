#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const { replaySolutionOnGameFile } = require('./run_solver_tests_js');

function solveAndReplay(game, level, timeoutMs) {
    const gamePath = path.join(__dirname, 'solver_tests', game);
    const run = spawnSync(process.execPath, [
        path.join(__dirname, 'run_solver_tests_js.js'),
        path.join(__dirname, 'solver_tests'),
        '--game', game,
        '--level', String(level),
        '--timeout-ms', String(timeoutMs),
        '--strategy', 'portfolio',
        '--quiet',
        '--json',
    ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    assert.strictEqual(run.status, 0, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout);
    const result = payload.results.find((entry) => entry.level === level);
    assert(result, `missing level ${level} in solver output`);
    assert.strictEqual(result.status, 'solved', `${game}#${level} status=${result.status}`);
    assert(result.hash_mode.includes('with_rng'), `${game}#${level} hash_mode=${result.hash_mode}`);
    const replay = replaySolutionOnGameFile(gamePath, level, result.solution);
    assert.strictEqual(replay.status, 'solved', `${game}#${level} replay=${replay.status}`);
}

solveAndReplay('kishoutenketsu.txt', 8, 5000);
solveAndReplay('dropswap.txt', 3, 3000);

console.log('solver_random_replay_node passed');
