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

const parallelPortfolio = runSolver('portfolio', ['--jobs', '1', '--portfolio-jobs', '2']);
assert.strictEqual(parallelPortfolio.status, 'solved');
assert.strictEqual(parallelPortfolio.portfolio_jobs, 2);
assert.strictEqual(parallelPortfolio.portfolio_parallel, true);
assert.match(parallelPortfolio.strategy, /^portfolio:/);
assert.deepStrictEqual(parallelPortfolio.solution, ['right']);

const hdaSerial = runSolver('hda-weighted-astar', ['--hda-jobs', '1']);
assert.strictEqual(hdaSerial.status, 'solved');
assert.strictEqual(hdaSerial.strategy, 'hda-weighted-astar');
assert.strictEqual(hdaSerial.hda_jobs, 1);
assert.strictEqual(hdaSerial.hda_parallel, false);
assert.deepStrictEqual(hdaSerial.solution, ['right']);

const hdaParallel = runSolver('hda-weighted-astar', ['--hda-jobs', '2']);
assert.strictEqual(hdaParallel.status, 'solved');
assert.strictEqual(hdaParallel.strategy, 'hda-weighted-astar');
assert.strictEqual(hdaParallel.hda_jobs, 2);
assert.strictEqual(hdaParallel.hda_parallel, true);
assert.ok(hdaParallel.hda_inbox_drains >= 0);
assert.ok(hdaParallel.hda_remote_sends >= 0);
assert.ok(hdaParallel.hda_owner_shard_solves >= 0);
assert.deepStrictEqual(hdaParallel.solution, ['right']);

console.log('run_solver_search_modes_node passed');
