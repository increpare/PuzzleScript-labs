#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'js-solver-bench-pair-'));
const storePath = path.join(tmpRoot, 'bench-store.jsonl');
const outDir = path.join(tmpRoot, 'artifacts');
const manifestPath = path.join(tmpRoot, 'slice-manifest.json');
const scriptPath = path.join(repoRoot, 'src/tests/run_js_solver_bench_pair.js');
const corpusDir = path.join(repoRoot, 'src/tests/solver_smoke_tests');

fs.writeFileSync(manifestPath, `${JSON.stringify({
    schema_version: 1,
    kind: 'solver_benchmark_slice',
    name: 'unit-slice',
    corpus: 'src/tests/solver_smoke_tests',
    timeout_ms: 500,
    targets: [
        { game: 'push_goal.txt', level: 0, first_solved_timeout_ms: 500 },
    ],
}, null, 2)}\n`);

const result = spawnSync(process.execPath, [
    scriptPath,
    corpusDir,
    '--store', storePath,
    '--slice', 'smoke-50',
    '--runs', '1',
    '--out-dir', outDir,
    '--batch-id', 'unit-batch',
    '--noise-band', '1',
    '--candidate-arg', '--adaptive-step-cost',
    '--',
    '--game', 'push_goal.txt',
    '--quiet',
    '--json',
    '--no-solutions',
], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
const comparison = JSON.parse(result.stdout);
assert.strictEqual(comparison.pair_count, 1);
assert.strictEqual(comparison.benchmark_slice, 'smoke-50');
assert.strictEqual(comparison.baseline_variant, 'baseline');
assert.strictEqual(comparison.candidate_variant, 'candidate');
assert.ok(['inconclusive_noise_band', 'candidate_better', 'candidate_worse'].includes(comparison.verdict));

const records = fs.readFileSync(storePath, 'utf8').trim().split(/\n/).map((line) => JSON.parse(line));
assert.strictEqual(records.length, 2);
assert.deepStrictEqual(records.map((record) => record.pair_id), ['unit-batch:pair-1', 'unit-batch:pair-1']);
assert.deepStrictEqual(records.map((record) => record.variant), ['baseline', 'candidate']);
assert.ok(records.every((record) => record.benchmark_slice === 'smoke-50'));
assert.ok(records.every((record) => record.totals.solved === 1));
assert.ok(fs.existsSync(path.join(outDir, 'unit-batch', 'pair-1-baseline.json')));
assert.ok(fs.existsSync(path.join(outDir, 'unit-batch', 'pair-1-candidate.json')));

const sliceStorePath = path.join(tmpRoot, 'slice-bench-store.jsonl');
const sliceOutDir = path.join(tmpRoot, 'slice-artifacts');
const sliceResult = spawnSync(process.execPath, [
    scriptPath,
    corpusDir,
    '--store', sliceStorePath,
    '--slice', 'unit-slice',
    '--runs', '1',
    '--out-dir', sliceOutDir,
    '--batch-id', 'slice-batch',
    '--slice-manifest', manifestPath,
    '--noise-band', '1',
    '--candidate-arg', '--adaptive-step-cost',
    '--',
    '--quiet',
    '--json',
    '--no-solutions',
], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
});

assert.strictEqual(sliceResult.status, 0, sliceResult.stderr || sliceResult.stdout);
const sliceRecords = fs.readFileSync(sliceStorePath, 'utf8').trim().split(/\n/).map((line) => JSON.parse(line));
assert.strictEqual(sliceRecords.length, 2);
assert.ok(sliceRecords.every((record) => record.config.solver_focus_manifest === manifestPath));
assert.ok(sliceRecords.every((record) => record.config.timeout_ms === 500));
assert.ok(sliceRecords.every((record) => record.totals.levels === 1));

const repeatStorePath = path.join(tmpRoot, 'repeat-bench-store.jsonl');
const repeatOutDir = path.join(tmpRoot, 'repeat-artifacts');
for (const batchId of ['repeat-a', 'repeat-b']) {
    const repeatResult = spawnSync(process.execPath, [
        scriptPath,
        corpusDir,
        '--store', repeatStorePath,
        '--slice', 'repeat-slice',
        '--runs', '1',
        '--out-dir', repeatOutDir,
        '--batch-id', batchId,
        '--noise-band', '1',
        '--candidate-arg', '--adaptive-step-cost',
        '--',
        '--game', 'push_goal.txt',
        '--quiet',
        '--json',
        '--no-solutions',
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    assert.strictEqual(repeatResult.status, 0, repeatResult.stderr || repeatResult.stdout);
}

const repeatRecords = fs.readFileSync(repeatStorePath, 'utf8').trim().split(/\n/).map((line) => JSON.parse(line));
assert.deepStrictEqual(repeatRecords.map((record) => record.pair_id), [
    'repeat-a:pair-1',
    'repeat-a:pair-1',
    'repeat-b:pair-1',
    'repeat-b:pair-1',
]);
assert.strictEqual(new Set(repeatRecords.map((record) => record.source_path)).size, 4);
assert.ok(fs.existsSync(path.join(repeatOutDir, 'repeat-a', 'pair-1-baseline.json')));
assert.ok(fs.existsSync(path.join(repeatOutDir, 'repeat-b', 'pair-1-baseline.json')));

console.log('run_js_solver_bench_pair_node passed');
