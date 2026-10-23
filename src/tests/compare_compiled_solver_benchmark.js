#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
assert.ok(args.length >= 3, 'Usage: node src/tests/compare_compiled_solver_benchmark.js BEFORE AFTER CORPUS [--runs 2] [--timeout-ms 250] [--out-dir DIR]');
const executables = { before: path.resolve(args[0]), after: path.resolve(args[1]) };
const corpus = path.resolve(args[2]);
let runs = 2;
let timeoutMs = 250;
let output = path.resolve('build/native/compiled-solver-comparison');
for (let index = 3; index < args.length; ++index) {
    const option = args[index];
    assert.ok(index + 1 < args.length, `Missing value for ${option}`);
    const value = args[++index];
    if (option === '--runs') runs = Number(value);
    else if (option === '--timeout-ms') timeoutMs = Number(value);
    else if (option === '--out-dir') output = path.resolve(value);
    else throw new Error(`Unknown option ${option}`);
}
assert.ok(Number.isInteger(runs) && runs > 0, '--runs must be positive');
assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0, '--timeout-ms must be positive');
fs.mkdirSync(output, { recursive: true });
const order = Array.from({ length: runs }, (_, index) => index % 2 ? ['after', 'before'] : ['before', 'after']).flat();
const samples = [];
const results = [];
const average = values => values.reduce((a, b) => a + b, 0) / values.length;

async function run(variant, index) {
    const stem = `${index + 1}-${variant}`;
    const stdout = fs.openSync(path.join(output, `${stem}.json`), 'w');
    const stderr = fs.openSync(path.join(output, `${stem}.log`), 'w');
    const start = process.hrtime.bigint();
    const progress = setInterval(() => console.error(`${stem}: running (${Math.round(Number(process.hrtime.bigint() - start) / 1e9)}s)`), 30000);
    let code;
    try {
        const child = spawn(executables[variant], [corpus, '--timeout-ms', String(timeoutMs), '--jobs', '1', '--strategy', 'weighted-astar', '--no-solutions', '--quiet', '--json'], {
            stdio: ['ignore', stdout, stderr], windowsHide: true,
        });
        code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    } finally {
        clearInterval(progress);
        fs.closeSync(stdout);
        fs.closeSync(stderr);
    }
    assert.strictEqual(code, 0, `${stem}: solver failed; inspect ${stem}.log`);
    const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
    const data = JSON.parse(fs.readFileSync(path.join(output, `${stem}.json`), 'utf8'));
    assert.strictEqual(data.totals.errors, 0, `${stem}: solver errors`);
    const totals = data.totals;
    assert.strictEqual(totals.levels, totals.solved + totals.timeout + totals.exhausted + totals.skipped_message + totals.errors, `${stem}: unaccounted levels`);
    samples.push({ variant, wallMs, file: `${stem}.json`, totals });
    results.push(data.results);
    fs.writeFileSync(path.join(output, 'samples.json'), JSON.stringify({ timeoutMs, runs, order, samples }, null, 2));
    console.error(`${stem}: solved=${totals.solved} wall_ms=${wallMs.toFixed(1)}`);
}

function summarize() {
    const variants = {};
    for (const variant of ['before', 'after']) {
        const chosen = samples.filter(sample => sample.variant === variant);
        const generated = average(chosen.map(sample => sample.totals.generated));
        variants[variant] = {
            solved: chosen.map(sample => sample.totals.solved),
            wallMs: average(chosen.map(sample => sample.wallMs)),
            generatedPerStepMs: generated / average(chosen.map(sample => sample.totals.step_ms)),
            generatedPerSearchMs: generated / average(samples.flatMap((sample, index) => sample.variant === variant
                ? [results[index].reduce((sum, row) => sum + row.elapsed_ms, 0)] : [])),
        };
    }
    const key = row => `${row.game}|${row.level}`;
    const maps = results.map(rows => new Map(rows.map(row => [key(row), row])));
    const differences = [];
    const common = [];
    for (const first of results[0]) {
        const rows = maps.map(map => map.get(key(first)));
        assert.ok(rows.every(Boolean), `Missing level ${key(first)}`);
        const solved = rows.filter(row => row.status === 'solved');
        const changed = ['solution', 'expanded', 'generated', 'unique_states', 'duplicates'].filter(field => solved.some(row => JSON.stringify(row[field]) !== JSON.stringify(solved[0][field])));
        const statuses = new Set(rows.map(row => row.status).filter(status => status !== 'timeout'));
        if (changed.length || statuses.size > 1) differences.push({ game: first.game, level: first.level, fields: changed, statuses: rows.map(row => row.status) });
        if (rows.every(row => row.status === 'solved') && !changed.length) {
            const meanStep = variant => average(rows.filter((_, index) => samples[index].variant === variant).map(row => row.step_ms));
            common.push({ game: first.game, level: first.level, beforeStepMs: meanStep('before'), afterStepMs: meanStep('after') });
        }
    }
    for (const map of maps) assert.strictEqual(map.size, maps[0].size, 'Level coverage differs');
    const beforeStepMs = common.reduce((sum, row) => sum + row.beforeStepMs, 0);
    const afterStepMs = common.reduce((sum, row) => sum + row.afterStepMs, 0);
    const summary = { timeoutMs, jobs: 1, strategy: 'weighted-astar', order, variants,
        commonIdenticalSolved: { levels: common.length, beforeStepMs, afterStepMs }, differences,
        validation: 'Solver-reported solves include its own replay. Use an interpreter-only validator for independent replay.' };
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    assert.strictEqual(differences.length, 0, 'Semantic differences across runs');
}

(async () => { for (let index = 0; index < order.length; ++index) await run(order[index], index); summarize(); })()
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
