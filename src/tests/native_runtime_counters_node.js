#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const solver = process.argv[2] || path.join(__dirname, '..', '..', 'build', 'native', 'puzzlescript_solver');
const corpus = path.join(__dirname, 'solver_smoke_tests');
const requiredKeys = [
    'rules_visited',
    'candidate_cells_tested',
    'pattern_tests',
    'mask_rebuild_calls',
    'mask_rebuild_dirty_calls',
    'mask_rebuild_rows',
    'mask_rebuild_columns',
    'movement_anchor_overlap_cells_scanned',
    'movement_anchor_collection_cells_scanned',
    'movement_anchor_collections_used',
    'movement_anchor_runtime_mask_builds',
];

function parseCounters(output) {
    const line = output.split(/\r?\n/).find(candidate => candidate.startsWith('solver_runtime_counters '));
    assert.ok(line, `expected solver_runtime_counters line in output:\n${output}`);
    const counters = {};
    for (const part of line.slice('solver_runtime_counters '.length).trim().split(/\s+/)) {
        const [key, value] = part.split('=');
        counters[key] = Number(value);
    }
    return counters;
}

const result = spawnSync(solver, [
    corpus,
    '--timeout-ms', '1000',
    '--jobs', '1',
    '--strategy', 'bfs',
    '--game', 'push_goal.txt',
    '--level', '0',
    '--json',
    '--quiet',
    '--no-solutions',
    '--profile-runtime-counters',
], { encoding: 'utf8' });

assert.strictEqual(
    result.status,
    0,
    `solver exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
);

const counters = parseCounters(`${result.stdout}\n${result.stderr}`);
const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(counters, key));
assert.deepStrictEqual(missing, []);
for (const key of requiredKeys) {
    assert.ok(Number.isFinite(counters[key]), `expected finite counter ${key}`);
}

assert.strictEqual(counters.movement_anchor_overlap_cells_scanned, 0, 'expected movement anchor overlap count to use the moving-cell index');
assert.ok(counters.movement_anchor_collection_cells_scanned > 0, 'expected movement anchor collection scan attribution');
assert.ok(counters.movement_anchor_collections_used > 0, 'expected movement anchor collection count');
assert.strictEqual(counters.movement_anchor_runtime_mask_builds, 0, 'expected movement anchor masks to be precomputed');
assert.ok(counters.mask_rebuild_dirty_calls < 13, 'expected add-only movement writes to avoid dirty mask rebuild calls');
assert.ok(counters.mask_rebuild_rows < 21, 'expected add-only movement writes to avoid dirty row rebuilds');
assert.ok(counters.mask_rebuild_columns < 75, 'expected add-only movement writes to avoid dirty column rebuilds');

process.stdout.write('native_runtime_counters_node: ok\n');
