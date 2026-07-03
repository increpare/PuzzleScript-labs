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
const scriptPath = path.join(repoRoot, 'src/tests/run_js_solver_bench_pair.js');
const corpusDir = path.join(repoRoot, 'src/tests/solver_smoke_tests');

const result = spawnSync(process.execPath, [
    scriptPath,
    corpusDir,
    '--store', storePath,
    '--slice', 'smoke-50',
    '--runs', '1',
    '--out-dir', outDir,
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
assert.deepStrictEqual(records.map((record) => record.pair_id), ['pair-1', 'pair-1']);
assert.deepStrictEqual(records.map((record) => record.variant), ['baseline', 'candidate']);
assert.ok(records.every((record) => record.benchmark_slice === 'smoke-50'));
assert.ok(records.every((record) => record.totals.solved === 1));
assert.ok(fs.existsSync(path.join(outDir, 'pair-1-baseline.json')));
assert.ok(fs.existsSync(path.join(outDir, 'pair-1-candidate.json')));

console.log('run_js_solver_bench_pair_node passed');
