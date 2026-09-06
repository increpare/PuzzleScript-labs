#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { replaySolutionOnGameFile } = require('./run_solver_tests_js');
if (process.argv.length < 5) throw Error('Usage: compare_push_performance.js PORTFOLIO_BINARY PUSH_BINARY REPORT [PAIRS=5]');
const binaries = process.argv.slice(2, 4).map(p => path.resolve(p));
const pairs = Number(process.argv[5] || 5);
assert(Number.isInteger(pairs) && pairs > 0);
const file = path.resolve(__dirname, '../demo/microban.txt');
const levels = [5, 7, 9, 11, 13, 15, 17, 19]; // Playable levels 3–10; exclude initial two prototype fixtures.
const inputs = ['up', 'left', 'down', 'right', 'action', 'tick'];
const report = { config: { game: 'src/demo/microban.txt', levels, pairs, timeout_ms: 500,
    timing: 'process launch through exit, including compilation and native replay; alternating order',
    limitation: 'eight additional levels from one standard Sokoban set; different search objectives; no general PuzzleScript claim' }, runs: [] };
const seen = new Set();
for (let pair = 0; pair < pairs; ++pair) {
    const totals = [{ elapsed_ms: 0, solved: 0 }, { elapsed_ms: 0, solved: 0 }];
    for (const level of levels) for (const side of pair % 2 ? [1, 0] : [0, 1]) {
        const args = side ? [file, String(level), '500'] : [file, '--level', String(level), '--timeout-ms', '500',
            '--jobs', '1', '--strategy', 'portfolio', '--json', '--quiet'];
        const start = performance.now();
        const run = spawnSync(binaries[side], args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
        const elapsed_ms = performance.now() - start;
        assert(!run.error, String(run.error)); assert.strictEqual(run.status, 0, run.stderr);
        const payload = JSON.parse(run.stdout), result = side ? payload : payload.results[0];
        const solution = side ? result.solution.map(n => inputs[n]) : result.solution;
        if (side) assert.strictEqual(result.supported, true);
        if (result.status === 'solved') {
            // Replay outside the measured interval; validate every distinct
            // solution from either solver rather than granting one a free pass.
            const key = JSON.stringify([level, solution]);
            if (!seen.has(key)) {
                assert.strictEqual(replaySolutionOnGameFile(file, level, solution).status, 'solved');
                seen.add(key);
            }
            ++totals[side].solved;
        }
        totals[side].elapsed_ms += elapsed_ms;
        report.runs.push({ pair, level, solver: side ? 'push' : 'portfolio', status: result.status,
            elapsed_ms, expanded: result.expanded, pushes: result.pushes, solution_length: solution.length,
            solution_sha256: crypto.createHash('sha256').update(JSON.stringify(solution)).digest('hex') });
    }
    console.log(JSON.stringify({ pair, portfolio: totals[0], push: totals[1] }));
}
report.js_replayed_distinct_solutions = seen.size;
fs.writeFileSync(path.resolve(process.argv[4]), JSON.stringify(report, null, 2) + '\n');
