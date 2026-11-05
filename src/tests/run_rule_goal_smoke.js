#!/usr/bin/env node
'use strict';
const assert = require('assert'), path = require('path');
const {spawnSync} = require('child_process');
if (process.argv.length !== 3) throw Error('Usage: run_rule_goal_smoke.js SOLVER_EXE');
const exe = path.resolve(process.argv[2]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PUZZLESCRIPT_')));
function run(corpus, extra) {
    const result = spawnSync(exe, [corpus, '--timeout-ms', '2000', '--jobs', '1', '--no-solutions',
        '--quiet', '--json', '--solver-heuristic', 'rule-goals', ...extra],
        {env, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024});
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.totals.errors, 0);
    return json;
}
for (const strategy of ['bfs', 'weighted-astar', 'portfolio']) {
    for (const storage of ['--compact-node-storage', '--full-node-storage']) {
        const result = run('src/tests/solver_smoke_tests', ['--strategy', strategy, storage]);
        assert.equal(result.totals.solved, 10);
        assert.equal(result.totals.exhausted, 2);
        assert.equal(result.totals.skipped_message, 4);
        assert.equal(result.totals.timeout, 0);
    }
}
for (const [game, level] of [['castlecloset.txt', 0], ['midas.txt', 29]]) {
    for (const strategy of ['weighted-astar', 'portfolio']) {
        const compact = run('src/tests/solver_tests', ['--game', game, '--level', String(level), '--strategy', strategy, '--compact-node-storage']);
        const full = run('src/tests/solver_tests', ['--game', game, '--level', String(level), '--strategy', strategy, '--full-node-storage']);
        assert.equal(compact.totals.solved, 1);
        assert.equal(full.totals.solved, 1);
    }
}
console.log('Rule-goal CLI smoke passed: BFS/weighted/portfolio, compact/full storage, command and producer victories; all wins replayed.');
