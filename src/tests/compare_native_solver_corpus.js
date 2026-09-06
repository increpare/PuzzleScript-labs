#!/usr/bin/env node
'use strict';
// Actual deadline-limited native solves, measured serially in alternating order.
// Fixed-expansion parity is a separate check: deadlines can change search paths.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');

if (process.argv.length < 6) throw Error('Usage: compare_native_solver_corpus.js BEFORE_EXE AFTER_EXE CORPUS_DIR OUTPUT_DIR [PAIRS=3] [TIMEOUT_MS=250]');
const binaries = process.argv.slice(2, 4).map(p => path.resolve(p));
const corpus = path.resolve(process.argv[4]), output = path.resolve(process.argv[5]);
const pairs = Number(process.argv[6] || 3), timeout = Number(process.argv[7] || 250);
assert(Number.isSafeInteger(pairs) && pairs > 0 && Number.isSafeInteger(timeout) && timeout > 0);
fs.mkdirSync(output, { recursive: true });
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('PUZZLESCRIPT_')) delete env[key];
const report = {
    scope: 'Native portfolio, interpreter, one worker, normal timing defaults. Serial alternating pairs after smoke warmups. Source compilation excluded from per-level times but included in process wall. Strict cutoff: solved and elapsed_ms < timeout_ms. No PUZZLESCRIPT environment overrides.',
    timeout_ms: timeout, binaries, binary_hashes: binaries.map(hash),
    sources: fs.readdirSync(corpus).filter(n => n.endsWith('.txt')).sort().map(name => ({ name, sha256: hash(path.join(corpus, name)) })),
    warmups: [], runs: [],
};
let expectedKeys;
function run(side, pair, warmup = false) {
    const label = `${side ? 'after' : 'before'}-${warmup ? 'warmup' : pair + 1}`;
    const target = warmup ? path.resolve(__dirname, 'solver_smoke_tests') : corpus;
    const args = [target, '--timeout-ms', String(timeout), '--strategy', 'portfolio', '--jobs', '1', '--no-solutions', '--json', '--progress-per-game'];
    fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ label, args, started: new Date().toISOString() }));
    console.log(`Starting ${label}`);
    const start = performance.now();
    const child = spawnSync(binaries[side], args, { env, encoding: 'utf8', windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    const wall_ms = performance.now() - start;
    fs.writeFileSync(path.join(output, label + '.json'), child.stdout || '');
    fs.writeFileSync(path.join(output, label + '.stderr.txt'), child.stderr || '');
    if (child.error) throw child.error;
    assert.strictEqual(child.status, 0, `${label} failed; see stderr`);
    const data = JSON.parse(child.stdout);
    const playable = data.results.filter(r => r.status !== 'skipped_message');
    const keys = playable.map(r => JSON.stringify([r.game, r.level])).sort();
    assert.strictEqual(new Set(keys).size, keys.length, 'Duplicate level keys');
    if (!warmup) {
        if (expectedKeys) assert.deepStrictEqual(keys, expectedKeys, 'Playable corpus changed');
        else expectedKeys = keys;
    }
    assert(playable.every(r => !r.compiled_rules_attached && !r.specialized_full_turn_attached && !r.specialized_compact_turn_attached), 'Unexpected generated kernel');
    const errors = playable.filter(r => /error/.test(r.status));
    assert.strictEqual(errors.length, 0, JSON.stringify(errors));
    const record = { label, wall_ms, playable: playable.length,
        solved_strict: playable.filter(r => r.status === 'solved' && r.elapsed_ms < timeout).length,
        solved_nominal: playable.filter(r => r.status === 'solved').length,
        replay_rejected: playable.reduce((sum, r) => sum + (r.replay_rejected || 0), 0),
        output_sha256: hash(path.join(output, label + '.json')) };
    (warmup ? report.warmups : report.runs).push(record);
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${label}: ${record.solved_strict}/${record.playable} strictly <${timeout}ms; ${record.solved_nominal} nominal; ${(wall_ms / 1000).toFixed(1)}s wall`);
}
for (const side of [0, 1]) run(side, 0, true);
for (let pair = 0; pair < pairs; ++pair)
    for (const side of pair % 2 ? [1, 0] : [0, 1]) run(side, pair);
fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ complete: true, runs: report.runs.length }));
