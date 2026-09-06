#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Alternate launch order to reduce drift bias. Compare complete retained boards
// and their scores/solutions, not just sample throughput or number of keepers.
if (process.argv.length < 5) throw Error('Usage: compare_generator_performance.js BEFORE AFTER REPORT [PAIRS=5]');
const binaries = process.argv.slice(2, 4).map(p => path.resolve(p));
const reportPath = path.resolve(process.argv[4]);
const pairs = Number(process.argv[5] || 5);
assert(Number.isInteger(pairs) && pairs > 0);
const root = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psgen-compare-'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const cases = [
    { mode: 'level-set', samples: 200, jobs: 1 },
    { mode: 'level-set', samples: 2000, jobs: 1 },
    { mode: 'level-set', samples: 200, jobs: 4 },
    { mode: 'legacy', samples: 20, jobs: 1 },
    { mode: 'legacy', samples: 200, jobs: 1 },
];
const report = { binaries: binaries.map(p => ({ file: path.basename(p), sha256: hash(fs.readFileSync(p)) })),
    config: { pairs, seed: 11, solver_timeout_ms: 50, time_limit_ms: 60000,
        timing: 'process launch through exit; compilation and replay included; alternating order; one warmup per binary/case' }, cases: [] };
function run(binary, spec) {
    const file = path.join(tmp, 'report.json'), gameOut = path.join(tmp, 'game.txt');
    const recipe = spec.mode === 'level-set' ? 'sokoban_levelset_tiny.gen' : 'sokoban_room_scatter.gen';
    const args = [path.join(root, 'src/demo/sokoban_basic.txt'), path.join(__dirname, 'generator_presets', recipe),
        '--samples', String(spec.samples), '--jobs', String(spec.jobs), '--seed', '11',
        '--solver-timeout-ms', '50', '--time-ms', '60000', '--json-out', file, '--quiet'];
    if (spec.mode === 'level-set') args.push('--out', gameOut);
    const start = performance.now();
    const processResult = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout: 65000 });
    const elapsed_ms = performance.now() - start;
    assert(!processResult.error, String(processResult.error));
    assert.strictEqual(processResult.status, 0, processResult.stderr);
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(result.totals.samples_attempted, spec.samples);
    if (spec.mode === 'level-set') assert.strictEqual(result.totals.interrupted_assessments, 0);
    const output = spec.mode === 'level-set' ? fs.readFileSync(gameOut, 'utf8') : JSON.stringify(result.top);
    return { elapsed_ms, output_sha256: hash(output), totals: result.totals, evaluation_cache: result.evaluation_cache };
}
try {
    for (const spec of cases) {
        for (const binary of binaries) run(binary, spec);
        const runs = [[], []];
        for (let pair = 0; pair < pairs; ++pair) {
            for (const side of pair % 2 ? [1, 0] : [0, 1]) runs[side].push(run(binaries[side], spec));
            console.log(`${spec.mode} samples=${spec.samples} jobs=${spec.jobs} pair=${pair + 1}/${pairs}`);
        }
        const before = median(runs[0].map(r => r.elapsed_ms)), after = median(runs[1].map(r => r.elapsed_ms));
        report.cases.push({ ...spec, before_median_ms: before, after_median_ms: after,
            speedup: before / after, identical_outputs: new Set(runs.flat().map(r => r.output_sha256)).size === 1, runs });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
