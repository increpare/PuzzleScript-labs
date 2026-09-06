#!/usr/bin/env node
'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { replaySolutionOnGameFile } = require('./run_solver_tests_js');
const binary = path.resolve(process.argv[2]);
const game = path.resolve(__dirname, '../demo/sokoban_basic.txt');
const inputs = ['up', 'left', 'down', 'right', 'action', 'tick'];
for (const level of [0, 1]) {
    const run = spawnSync(binary, [game, String(level), '5000'],
        { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert(!run.error, String(run.error));
    assert.strictEqual(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.strictEqual(result.supported, true);
    assert.strictEqual(result.status, 'solved');
    const solution = result.solution.map(input => { assert(inputs[input]); return inputs[input]; });
    const replay = replaySolutionOnGameFile(game, level, solution);
    assert.strictEqual(replay.status, 'solved', `JS rejected push solution for level ${level}`);
}
console.log('Push prototype solutions replay in the JavaScript runtime.');
