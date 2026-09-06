#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const baseline = path.resolve(process.argv[2] || '');
if (!process.argv[2] || baseline === process.cwd()) throw new Error('Supply a separate baseline checkout');
const out = process.argv[3] || 'build/future-ruleset-solver.json';
const pairs = Number(process.argv[4] || 3);
const games = ['chaos wizard', 'coincounter', 'gobble_rush', 'midas', 'led challenge'];
const root = path.resolve('build/future-ruleset-solver-focus');
fs.mkdirSync(root, { recursive: true });
for (const game of games) fs.copyFileSync(`src/tests/solver_tests/${game}.txt`, path.join(root, `${game}.txt`));
const result = { scope: 'Previous PR revision versus shared-ruleset implementation, both with future pruning enabled. Same five-game focused sample and 250ms per-level budget, independent serial processes in alternating order. Includes process startup, full compilation and static analysis. Not generation throughput or an unbiased corpus benchmark.',
    baseline, candidate: process.cwd(), node: process.version, cpu: os.cpus()[0].model, games, pairs: [] };
for (let pair = 0; pair < pairs; pair++) {
    const row = {};
    for (const shared of pair % 2 ? [true, false] : [false, true]) {
        const cwd = shared ? process.cwd() : baseline;
        const args = ['src/tests/run_solver_tests_js.js', root, '--strategy', 'weighted-astar',
            '--timeout-ms', '250', '--no-solutions', '--quiet', '--json', '--solver-future-prune'];
        const start = performance.now();
        const run = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (run.status !== 0) throw new Error(run.stderr || `Exit ${run.status}`);
        const wall = performance.now() - start;
        const payload = JSON.parse(run.stdout);
        row[shared ? 'shared' : 'previous'] = { wall_ms: wall, totals: payload.totals,
            results: payload.results.map(r => ({ game: r.game, level: r.level, status: r.status,
                solution_length: r.solution_length, expanded: r.expanded, replay_rejected: r.replay_rejected,
                static_analysis_ms: r.static_analysis_ms, future_prune_ms: r.future_prune_ms,
                future_ruleset_setups: r.future_ruleset_setups })) };
        console.log(`pair ${pair + 1} ${shared ? 'shared' : 'previous'}: ${payload.totals.solved} solved, ${wall.toFixed(1)} ms`);
    }
    result.pairs.push(row);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
}
