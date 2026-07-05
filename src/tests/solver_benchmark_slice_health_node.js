#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    runSliceHealth,
} = require('./solver_benchmark_slice_health');

const repoRoot = path.resolve(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-slice-health-'));
const corpusDir = path.join(tmpRoot, 'corpus');
const outDir = path.join(tmpRoot, 'manifests');
fs.mkdirSync(corpusDir);

fs.copyFileSync(
    path.join(repoRoot, 'src/tests/solver_smoke_tests/message_skip.txt'),
    path.join(corpusDir, 'message_skip.txt'),
);

const registryPath = path.join(tmpRoot, 'slices.json');
fs.writeFileSync(registryPath, `${JSON.stringify({
    schema_version: 1,
    slices: [
        {
            name: 'message-health',
            corpus: corpusDir,
            timeout_ms: 1,
            selection: {
                type: 'seeded-game-sample',
                target_games: 1,
                seed: 'unit-message-health',
                stability: 'unit test',
            },
        },
    ],
}, null, 2)}\n`);

const report = runSliceHealth({
    registry_path: registryPath,
    out_dir: outDir,
    timeout_ms: 1,
    generated_at: '2026-07-03T00:00:00.000Z',
});

assert.strictEqual(report.healthy, true);
assert.strictEqual(report.slices.length, 1);
assert.strictEqual(report.slices[0].name, 'message-health');
assert.strictEqual(report.slices[0].target_count, 1);
assert.strictEqual(report.slices[0].result_count, 1);
assert.strictEqual(report.slices[0].totals.skipped_message, 0);
assert.strictEqual(report.slices[0].totals.errors, 0);
assert.strictEqual(fs.existsSync(report.slices[0].manifest_path), true);

console.log('solver_benchmark_slice_health_node passed');
