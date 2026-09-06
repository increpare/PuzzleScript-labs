#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const binary = path.resolve(process.argv[2]);
const out = process.argv[3] || 'build/native-future-generator.json';
const pairs = Number(process.argv[4] || 3);
const root = path.resolve('build/native-future-generator');
fs.mkdirSync(root, { recursive: true });
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const report = { scope: 'Same native generator binary, future-rule filter off/on. Generic remix of bundled games, 100 candidates, seed 11, 10ms solver budget, serial alternating pairs after warmup. Process wall includes compilation and output. Retained outputs can differ at time limits; four-worker runs additionally depend on scheduling.',
    binary_sha256: hash(fs.readFileSync(binary)), cases: [] };
const median = xs => xs.slice().sort((a,b) => a-b)[Math.floor(xs.length / 2)];
for (const spec of [{ game: 'cakemonsters', jobs: 1 }, { game: 'chaos wizard', jobs: 1 },
    { game: 'dropswap', jobs: 1 }, { game: 'midas', jobs: 1 }, { game: 'cakemonsters', jobs: 4 }]) {
    function run(enabled) {
        const summary = path.join(root, 'summary.json'), output = path.join(root, 'generated.txt');
        const args = [`src/tests/solver_tests/${spec.game}.txt`, '--remix', '--samples', '100', '--jobs', String(spec.jobs),
            '--seed', '11', '--solver-timeout-ms', '10', '--time-ms', '60000', '--out', output, '--json-out', summary, '--quiet'];
        const start = performance.now();
        const result = spawnSync(binary, args, { env: { ...process.env, PUZZLESCRIPT_FUTURE_RULE_PRUNE: enabled ? '1' : '0' },
            encoding: 'utf8', windowsHide: true, timeout: 65000 });
        if (result.error) throw result.error;
        assert.strictEqual(result.status, 0, result.stderr);
        const wall = performance.now() - start;
        const data = JSON.parse(fs.readFileSync(summary, 'utf8'));
        assert.strictEqual(data.totals.samples_attempted, 100);
        assert.strictEqual(data.totals.interrupted_assessments, 0);
        if (enabled) assert(data.future_rule_filter && data.future_rule_filter.queries > 0, 'exercise native ruleset cache');
        return { wall_ms: wall, output_sha256: hash(fs.readFileSync(output)), ...data };
    }
    run(false); run(true);
    const row = { ...spec, pairs: [] };
    for (let pair = 0; pair < pairs; ++pair) {
        const p = {};
        for (const enabled of pair % 2 ? [true, false] : [false, true]) p[enabled ? 'future' : 'baseline'] = run(enabled);
        row.pairs.push(p);
    }
    row.baseline_median_ms = median(row.pairs.map(p => p.baseline.wall_ms));
    row.future_median_ms = median(row.pairs.map(p => p.future.wall_ms));
    row.identical_outputs = new Set(row.pairs.flatMap(p => [p.baseline.output_sha256, p.future.output_sha256])).size === 1;
    report.cases.push(row);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(`${spec.game} jobs=${spec.jobs}: ${row.baseline_median_ms.toFixed(1)} -> ${row.future_median_ms.toFixed(1)} ms; identical outputs=${row.identical_outputs}`);
}
