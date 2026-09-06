#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const games = ['chaos wizard', 'coincounter', 'gobble_rush', 'midas', 'led challenge'];
const root = path.resolve('build/future-prune-focus');
fs.mkdirSync(root, { recursive: true });
for (const game of games) fs.copyFileSync(`src/tests/solver_tests/${game}.txt`, path.join(root, `${game}.txt`));
const result = { scope: 'Five games selected because bounded exploration observed certified dead branches; not an unbiased corpus benchmark. Separate processes, serial alternating order; startup/static analysis included in wall time.', games, pairs: [] };
const out = process.argv[2] || 'build/future-prune-comparison.json';
const pairs = Number(process.argv[3] || 2);
for (let pair = 0; pair < pairs; pair++) {
    const row = {};
    for (const enabled of pair % 2 ? [true, false] : [false, true]) {
        const args = ['src/tests/run_solver_tests_js.js', root, '--strategy', 'weighted-astar',
            '--timeout-ms', '250', '--no-solutions', '--quiet', '--json'];
        if (enabled) args.push('--solver-future-prune');
        const start = performance.now();
        const run = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (run.status !== 0) throw new Error(run.stderr || `Exit ${run.status}`);
        const payload = JSON.parse(run.stdout);
        row[enabled ? 'future' : 'baseline'] = { wall_ms: performance.now() - start, ...payload };
        console.log(`pair ${pair + 1} ${enabled ? 'future' : 'baseline'}: ${payload.totals.solved} solved, ${payload.totals.future_pruned || 0} pruned`);
    }
    result.pairs.push(row);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2)+'\n');
}
