#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    appendRunRecord,
    comparePairedRuns,
    createRunRecord,
    freshnessReport,
    latestRecords,
    loadBenchmarkSlices,
    planArtifactRetention,
    readRunRecords,
    summarizeRecords,
} = require('./solver_bench_store');

const repoRoot = path.resolve(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-bench-store-'));
const storePath = path.join(tmpRoot, 'solver-bench.jsonl');

function result(game, level, status, fields = {}) {
    return Object.assign({ game, level, status, elapsed_ms: 500 }, fields);
}

function runJson(solved, extraResults = []) {
    const solvedResults = [];
    for (let level = 0; level < solved; level++) {
        solvedResults.push(result('slice-game.txt', level, 'solved', {
            elapsed_ms: 100 + level,
            generated: 10 + level,
            expanded: 5 + level,
        }));
    }
    const results = solvedResults.concat(extraResults);
    return {
        totals: {
            levels: results.length,
            solved,
            timeout: results.filter((row) => row.status === 'timeout').length,
            exhausted: results.filter((row) => row.status === 'exhausted').length,
            errors: 0,
            generated: results.reduce((sum, row) => sum + (row.generated || 0), 0),
            step_ms: results.reduce((sum, row) => sum + (row.step_ms || 0), 0),
        },
        results,
    };
}

const baselinePair1 = createRunRecord(runJson(1, [
    result('slice-game.txt', 1, 'timeout', { generated: 30 }),
    result('slice-game.txt', 2, 'timeout', { generated: 30 }),
]), {
    benchmark_slice: 'smoke-50',
    variant: 'baseline',
    pair_id: 'pair-1',
    git_rev: 'abc123',
    config: { timeout_ms: 500, strategy: 'weighted-astar' },
    machine: { hostname: 'test-host', platform: 'test-os', arch: 'test-arch' },
    artifacts: [path.join(tmpRoot, 'referenced-artifact')],
    recorded_at: '2026-07-03T00:00:00.000Z',
});
const candidatePair1 = createRunRecord(runJson(2, [
    result('slice-game.txt', 2, 'timeout', { generated: 35 }),
]), {
    benchmark_slice: 'smoke-50',
    variant: 'candidate',
    pair_id: 'pair-1',
    git_rev: 'abc123',
    config: { timeout_ms: 500, strategy: 'weighted-astar', feature: 'candidate' },
    machine: { hostname: 'test-host', platform: 'test-os', arch: 'test-arch' },
    recorded_at: '2026-07-03T00:01:00.000Z',
});
const baselinePair2 = createRunRecord(runJson(2, [
    result('slice-game.txt', 2, 'timeout', { generated: 40 }),
]), {
    benchmark_slice: 'smoke-50',
    variant: 'baseline',
    pair_id: 'pair-2',
    git_rev: 'abc123',
    config: { timeout_ms: 500, strategy: 'weighted-astar' },
    machine: { hostname: 'test-host', platform: 'test-os', arch: 'test-arch' },
    recorded_at: '2026-07-03T00:02:00.000Z',
});
const candidatePair2 = createRunRecord(runJson(3), {
    benchmark_slice: 'smoke-50',
    variant: 'candidate',
    pair_id: 'pair-2',
    git_rev: 'abc123',
    config: { timeout_ms: 500, strategy: 'weighted-astar', feature: 'candidate' },
    machine: { hostname: 'test-host', platform: 'test-os', arch: 'test-arch' },
    recorded_at: '2026-07-03T00:03:00.000Z',
});

assert.strictEqual(baselinePair1.schema_version, 1);
assert.strictEqual(baselinePair1.record_type, 'solver_bench_run');
assert.strictEqual(baselinePair1.config_hash.length, 16);
assert.strictEqual(baselinePair1.totals.solved, 1);
assert.strictEqual(baselinePair1.results.length, 3);

appendRunRecord(storePath, baselinePair1);
appendRunRecord(storePath, candidatePair1);
appendRunRecord(storePath, baselinePair2);
appendRunRecord(storePath, candidatePair2);

const records = readRunRecords(storePath);
assert.strictEqual(records.length, 4);
assert.deepStrictEqual(records.map((record) => record.pair_id), ['pair-1', 'pair-1', 'pair-2', 'pair-2']);

const summary = summarizeRecords(records, { benchmark_slice: 'smoke-50' });
assert.strictEqual(summary.run_count, 4);
assert.deepStrictEqual(summary.variants, { baseline: 2, candidate: 2 });
assert.strictEqual(summary.solved.mean, 2);
assert.strictEqual(summary.solved.min, 1);
assert.strictEqual(summary.solved.max, 3);
assert.strictEqual(summary.skipped_message.count, 4);
assert.strictEqual(summary.skipped_message.max, 0);

const noisyComparison = comparePairedRuns(records, {
    benchmark_slice: 'smoke-50',
    baseline_variant: 'baseline',
    candidate_variant: 'candidate',
    metric: 'solved',
    noise_band: 2,
});
assert.strictEqual(noisyComparison.pair_count, 2);
assert.strictEqual(noisyComparison.mean_delta, 1);
assert.strictEqual(noisyComparison.verdict, 'inconclusive_noise_band');
assert.strictEqual(noisyComparison.flips.baseline_timeout_candidate_solved, 2);

const decisiveComparison = comparePairedRuns(records, {
    benchmark_slice: 'smoke-50',
    baseline_variant: 'baseline',
    candidate_variant: 'candidate',
    metric: 'solved',
    noise_band: 0.5,
});
assert.strictEqual(decisiveComparison.verdict, 'candidate_better');

const latestCandidate = latestRecords(records, {
    benchmark_slice: 'smoke-50',
    variant: 'candidate',
    limit: 1,
});
assert.strictEqual(latestCandidate.length, 1);
assert.strictEqual(latestCandidate[0].pair_id, 'pair-2');

const freshReport = freshnessReport(records, {
    benchmark_slice: 'smoke-50',
    variant: 'candidate',
    now: new Date('2026-07-03T00:45:00.000Z'),
    max_age_hours: 1,
});
assert.strictEqual(freshReport.fresh, true);
assert.strictEqual(freshReport.latest_record.pair_id, 'pair-2');

const staleReport = freshnessReport(records, {
    benchmark_slice: 'smoke-50',
    variant: 'candidate',
    now: new Date('2026-07-03T03:15:00.000Z'),
    max_age_hours: 1,
});
assert.strictEqual(staleReport.fresh, false);
assert.ok(staleReport.age_hours > 1);

const slices = loadBenchmarkSlices(path.join(repoRoot, 'src/tests/solver_benchmark_slices.json'));
assert.deepStrictEqual(slices.slices.map((slice) => slice.name), [
    'smoke-50',
    'sokoban-skew-200',
    'hard-tail-300',
]);
assert.ok(slices.slices.every((slice) => slice.selection && slice.selection.stability));

const buildRoot = path.join(tmpRoot, 'build');
const oldUnreferenced = path.join(buildRoot, 'old-unreferenced');
const recentUnreferenced = path.join(buildRoot, 'recent-unreferenced');
const referenced = path.join(tmpRoot, 'referenced-artifact');
fs.mkdirSync(oldUnreferenced, { recursive: true });
fs.mkdirSync(recentUnreferenced, { recursive: true });
fs.mkdirSync(referenced, { recursive: true });
const oldTime = new Date('2026-05-01T00:00:00.000Z');
const recentTime = new Date('2026-07-02T00:00:00.000Z');
fs.utimesSync(oldUnreferenced, oldTime, oldTime);
fs.utimesSync(recentUnreferenced, recentTime, recentTime);
fs.utimesSync(referenced, oldTime, oldTime);

const retention = planArtifactRetention({
    build_root: buildRoot,
    records,
    now: new Date('2026-07-03T00:00:00.000Z'),
    max_age_days: 30,
});
assert.ok(retention.remove.some((entry) => entry.path === oldUnreferenced));
assert.ok(retention.keep.some((entry) => entry.path === recentUnreferenced && entry.reason === 'recent'));
assert.ok(retention.keep.some((entry) => entry.path === referenced && entry.reason === 'referenced'));

console.log('solver_bench_store_node passed');
