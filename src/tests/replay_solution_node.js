#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const { replaySolutionOnGameFile } = require('./run_solver_tests_js');

const oneMove = path.join(__dirname, 'solver_smoke_tests', 'one_move.txt');
const impossible = path.join(__dirname, 'solver_smoke_tests', 'impossible.txt');

const solved = replaySolutionOnGameFile(oneMove, 0, ['right']);
assert.strictEqual(solved.status, 'solved');
assert.strictEqual(solved.steps, 1);

const notSolved = replaySolutionOnGameFile(oneMove, 0, ['left']);
assert.strictEqual(notSolved.status, 'not_solved');

const exhausted = replaySolutionOnGameFile(impossible, 0, []);
assert.strictEqual(exhausted.status, 'not_solved');

const cliSolved = spawnSync(process.execPath, [
    path.join(__dirname, 'replay_solution.js'),
    oneMove,
    '0',
    'right',
], { encoding: 'utf8' });
assert.strictEqual(cliSolved.status, 1, cliSolved.stderr);

const cliFailed = spawnSync(process.execPath, [
    path.join(__dirname, 'replay_solution.js'),
    oneMove,
    '0',
    'left',
], { encoding: 'utf8' });
assert.strictEqual(cliFailed.status, 0, cliFailed.stderr);

const cliJson = spawnSync(process.execPath, [
    path.join(__dirname, 'replay_solution.js'),
    oneMove,
    '0',
    '--solution-json',
    '["right"]',
    '--json',
], { encoding: 'utf8' });
assert.strictEqual(cliJson.status, 1, cliJson.stderr);
const parsed = JSON.parse(cliJson.stdout);
assert.strictEqual(parsed.solved, true);
assert.strictEqual(parsed.status, 'solved');

console.log('replay_solution_node passed');
