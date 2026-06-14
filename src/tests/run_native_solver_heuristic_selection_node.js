#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_native_solver_heuristic_selection_node.js <puzzlescript_solver>');
    process.exit(1);
}

const solverPath = path.resolve(process.argv[2]);
const rootDir = path.resolve(__dirname, '..', '..');
const smokeDir = path.join(rootDir, 'src/tests/solver_smoke_tests');
const solverCorpus = path.join(rootDir, 'src/tests/solver_tests');

function runSolver(corpusDir, args, label) {
    const result = spawnSync(solverPath, [
        corpusDir,
        '--jobs', '1',
        '--no-solutions',
        '--quiet',
        '--json',
        ...args,
    ], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
    assert.strictEqual(
        result.status,
        0,
        `${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.results.length, 1, label);
    return parsed.results[0];
}

const explicitWinconditions = runSolver(smokeDir, [
    '--game', 'one_move.txt',
    '--level', '0',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--solver-heuristic', 'winconditions',
], 'explicit winconditions heuristic');
assert.strictEqual(explicitWinconditions.status, 'solved');
assert.strictEqual(explicitWinconditions.heuristic, 'winconditions');
assert.deepStrictEqual(explicitWinconditions.solution, ['right']);

const allOnMatching = runSolver(solverCorpus, [
    '--game', 'Pushy-V Pully-H.txt',
    '--level', '15',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'all-on-matching',
], 'all-on matching heuristic');
assert.strictEqual(allOnMatching.status, 'solved');
assert.strictEqual(allOnMatching.heuristic, 'all-on-matching');
assert(
    allOnMatching.expanded <= 5000,
    `all-on-matching expanded ${allOnMatching.expanded}, expected <= 5000`
);

const noPlayerDistance = runSolver(solverCorpus, [
    '--game', 'butteater.txt',
    '--level', '1',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'no-player-distance',
], 'NO player-distance heuristic');
assert.strictEqual(noPlayerDistance.status, 'solved');
assert.strictEqual(noPlayerDistance.heuristic, 'no-player-distance');

const autoNoDistance = runSolver(solverCorpus, [
    '--game', 'Yellow Box.txt',
    '--level', '11',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'auto',
], 'auto NO player-distance heuristic');
assert.strictEqual(autoNoDistance.status, 'solved');
assert.strictEqual(autoNoDistance.heuristic, 'auto');
assert(
    autoNoDistance.expanded <= 2000,
    `auto NO player-distance expanded ${autoNoDistance.expanded}, expected <= 2000`
);

const plainNoLifecycle = runSolver(solverCorpus, [
    '--game', 'color chained.txt',
    '--level', '5',
    '--timeout-ms', '1000',
    '--strategy', 'portfolio',
], 'plain NO lifecycle portfolio');
assert.strictEqual(plainNoLifecycle.status, 'solved');
assert.strictEqual(plainNoLifecycle.portfolio_profile, 'breadth-first');
assert.strictEqual(plainNoLifecycle.strategy, 'portfolio:bfs');

console.log('run_native_solver_heuristic_selection_node passed');
