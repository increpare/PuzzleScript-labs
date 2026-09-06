#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
if (process.argv.length < 5) throw new Error('Usage: compare_native_runtime.js BASELINE_DIR CANDIDATE_DIR OUTPUT_JSON [PAIRS=5] [replay|generator|all] [--allow-rule-count-change] [--games-json JSON_ARRAY]');
const dirs = process.argv.slice(2, 4).map(p => path.resolve(p));
const pairs = Number(process.argv[5] || 5);
assert(Number.isSafeInteger(pairs) && pairs > 0);
const out = process.argv[4];
const suite = process.argv[6] || 'all';
// Rule-filter experiments intentionally change visits; replacements and replay
// success must still agree. Keep strict same-work checks as the default.
const allowRuleCountChange = process.argv.slice(7).includes('--allow-rule-count-change');
const gamesArg = process.argv.indexOf('--games-json', 7);
const games = gamesArg < 0 ? ['cakemonsters', 'chaos wizard', 'dropswap', 'midas'] : JSON.parse(process.argv[gamesArg + 1]);
assert(Array.isArray(games) && games.length && games.every(name => typeof name === 'string' && name.length));
assert(['all', 'replay', 'generator'].includes(suite));
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const median = xs => xs.slice().sort((a,b) => a-b)[Math.floor(xs.length / 2)];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
fs.mkdirSync('build', { recursive: true });
const temporary = fs.mkdtempSync(path.resolve('build/native-runtime-performance-'));
const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const report = { scope: 'Serial alternating processes after one warmup per binary. Replay repeats all 470 cases twice; generic remix uses 200 candidates, seed 11, one worker and 10ms per-search limits. Includes compilation, startup and output. Generator output identity is reported because time limits can change keepers.', cases: [] };
report.allow_rule_count_change = allowRuleCountChange;
report.games = games;
const specs = suite === 'generator' ? [] : [{ name: 'replay', exe: 'puzzlescript_cpp' + executableSuffix }];
if (suite !== 'replay') for (const game of games) specs.push({ name: game, exe: 'puzzlescript_generator' + executableSuffix });
for (const spec of specs) {
    const json = path.join(temporary, 'summary.json');
    const output = path.join(temporary, 'generated.txt');
    const args = spec.name === 'replay'
        ? ['test', 'simulation-corpus', 'src/tests/resources/testdata.js', '--profile-timers', '--json-summary-out', json, '--repeat', '2', '--jobs', '1', '--quiet']
        : [`src/tests/solver_tests/${spec.name}.txt`, '--remix', '--samples', '200', '--jobs', '1', '--seed', '11', '--solver-timeout-ms', '10', '--time-ms', '60000', '--out', output, '--json-out', json, '--quiet'];
    function run(which) {
        fs.rmSync(json, { force: true });
        const start = performance.now();
        const child = spawnSync(path.join(dirs[which], spec.exe), args, { env: { ...process.env, PUZZLESCRIPT_INPUT_SPECIALIZATION: '1' }, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 32000000 });
        if (child.error) throw child.error;
        assert.strictEqual(child.status, 0, child.stderr);
        const wall_ms = performance.now() - start;
        const data = JSON.parse(fs.readFileSync(json));
        if (spec.name !== 'replay') { assert.strictEqual(data.totals.samples_attempted, 200); assert.strictEqual(data.totals.interrupted_assessments, 0); }
        return { wall_ms, ...data, ...(spec.name === 'replay' ? {} : { output_hash: hash(fs.readFileSync(output)) }) };
    }
    const row = { name: spec.name, binary_hashes: dirs.map(d => hash(fs.readFileSync(path.join(d, spec.exe)))), pairs: [] };
    row.source_hash = hash(fs.readFileSync(spec.name === 'replay' ? 'src/tests/resources/testdata.js' : `src/tests/solver_tests/${spec.name}.txt`));
    run(0); run(1);
    for (let p = 0; p < pairs; ++p) {
        const pair = {};
        for (const which of p % 2 ? [1,0] : [0,1]) pair[which ? 'candidate' : 'baseline'] = run(which);
        if (spec.name === 'replay') {
            assert.deepStrictEqual(pair.baseline.status_summary.passed, pair.candidate.status_summary.passed);
            for (const counter of allowRuleCountChange ? ['replacements_applied'] : ['rules_visited', 'replacements_applied']) assert.strictEqual(pair.baseline.runtime_counters[counter], pair.candidate.runtime_counters[counter], counter);
        }
        row.pairs.push(pair);
        console.log(`${spec.name} pair ${p+1}: ${pair.baseline.wall_ms.toFixed(1)} -> ${pair.candidate.wall_ms.toFixed(1)} ms`);
    }
    row.baseline_median_ms = median(row.pairs.map(p=>p.baseline.wall_ms));
    row.candidate_median_ms = median(row.pairs.map(p=>p.candidate.wall_ms));
    if (spec.name !== 'replay') row.identical_outputs = new Set(row.pairs.flatMap(p => [p.baseline.output_hash, p.candidate.output_hash])).size === 1;
    report.cases.push(row);
    fs.writeFileSync(out, JSON.stringify(report, null, 2)+'\n');
    console.log(`${spec.name} medians: ${row.baseline_median_ms.toFixed(1)} -> ${row.candidate_median_ms.toFixed(1)} ms`);
}
