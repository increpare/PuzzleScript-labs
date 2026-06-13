#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_solver_search_modes_node.js <puzzlescript_solver>');
    process.exit(1);
}

const solverPath = path.resolve(process.argv[2]);
const rootDir = path.resolve(__dirname, '..', '..');
const smokeDir = path.join(rootDir, 'src/tests/solver_smoke_tests');

function runSolver(strategy, extraArgs = []) {
    const result = spawnSync(solverPath, [
        smokeDir,
        '--game',
        'one_move.txt',
        '--level',
        '0',
        '--timeout-ms',
        '1000',
        '--strategy',
        strategy,
        '--no-solutions',
        '--quiet',
        '--json',
        ...extraArgs,
    ], {
        cwd: rootDir,
        encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.results.length, 1);
    return parsed.results[0];
}

const deep = runSolver('weighted-astar-deep', ['--astar-weight', '2']);
assert.strictEqual(deep.status, 'solved');
assert.strictEqual(deep.strategy, 'weighted-astar-deep');
assert.strictEqual(deep.heuristic, 'auto:deep-tie');
assert.deepStrictEqual(deep.solution, ['right']);

console.log('run_solver_search_modes_node passed');
