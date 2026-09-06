#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const cli = path.resolve(process.argv[2]);
const out = process.argv[3] || 'build/native-future-rules-performance.json';
const pairs = Number(process.argv[4] || 3);
const temp = path.resolve('build/native-future-rules-profile.json');
fs.mkdirSync(path.dirname(temp), { recursive: true });
const report = { scope: 'Opt-in native future-rule eligibility versus existing input/wake/mask skipping, same binary. Full 470-case simulation corpus, two repetitions, one worker, serial alternating processes after warmups. Includes compilation and runtime counters; built-in pass/fail totals must agree. This measures replay throughput, not level-generation throughput.',
    binary_sha256: crypto.createHash('sha256').update(fs.readFileSync(cli)).digest('hex'), pairs: [] };
function run(enabled) {
    const env = { ...process.env, PUZZLESCRIPT_FUTURE_RULE_PRUNE: enabled ? '1' : '0' };
    fs.rmSync(temp, { force: true });
    const start = performance.now();
    const child = spawnSync(cli, ['test', 'simulation-corpus', 'src/tests/resources/testdata.js',
        '--profile-timers', '--json-summary-out', temp, '--repeat', '2', '--jobs', '1', '--quiet'],
        { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000, windowsHide: true });
    if (child.error) throw child.error;
    assert([0, 1].includes(child.status), child.stderr);
    const result = JSON.parse(fs.readFileSync(temp, 'utf8'));
    return { wall_ms: performance.now() - start, exit_code: child.status, ...result };
}
run(false); run(true);
for (let pair = 0; pair < pairs; ++pair) {
    const row = {};
    for (const enabled of pair % 2 ? [true, false] : [false, true]) {
        const result = run(enabled);
        row[enabled ? 'future' : 'baseline'] = result;
        console.log(`pair ${pair + 1} ${enabled ? 'future' : 'baseline'} wall=${result.wall_ms.toFixed(1)}ms rules=${result.runtime_counters.rules_visited}`);
    }
    assert.strictEqual(row.baseline.status_summary.passed, row.future.status_summary.passed);
    assert.strictEqual(row.baseline.status_summary.failed, row.future.status_summary.failed);
    assert.strictEqual(row.baseline.runtime_counters.replacements_applied, row.future.runtime_counters.replacements_applied);
    report.pairs.push(row);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}
