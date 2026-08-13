#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const {
    compileGameFile,
    drainStartupAgainForSolver,
} = require('./run_solver_tests_js');

const gamePath = path.join(__dirname, 'solver_tests', 'expand also avoid the flames.txt');
const seed = 'solver:expand also avoid the flames.txt:1';

compileGameFile(gamePath);
loadLevelFromState(state, 1, seed);
assert.strictEqual(againing, true, 'fixture should leave startup again pending after load');

const passes = drainStartupAgainForSolver();
assert.ok(passes > 0, `expected startup again passes, got ${passes}`);
assert.strictEqual(againing, false, 'solver start snapshot must be after startup again is drained');

// Player/oracle drain (processInput(-1) with again probe), not skipAgainProbe settleAgain.
const board = convertLevelToString();
assert.ok(board.includes('background fire t3:'), `unexpected fire timer after player-style drain:\n${board}`);
assert.ok(
    board.includes('background spawntile u:3,background d spawntile:4'),
    `board should match oracle/player drained start, got:\n${board}`
);

console.log('solver_startup_again_drain_node passed');
