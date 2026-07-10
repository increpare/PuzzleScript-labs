#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const solver = process.argv[2] || path.join(__dirname, '..', '..', 'build', 'native', 'puzzlescript_solver');
const corpus = path.join(__dirname, 'solver_smoke_tests');
const wideCorpus = path.join(__dirname, 'solver_tests');
const requiredKeys = [
    'rules_visited',
    'rule_group_invocations',
    'rule_group_passes',
    'rule_group_confirmation_passes',
    'rule_group_confirmation_rule_visits',
    'candidate_cells_tested',
    'pattern_tests',
    'mask_rebuild_calls',
    'mask_rebuild_dirty_calls',
    'mask_rebuild_rows',
    'mask_rebuild_columns',
    'mask_rebuild_object_rows',
    'mask_rebuild_object_columns',
    'mask_rebuild_movement_rows',
    'mask_rebuild_movement_columns',
    'mask_rebuild_object_row_cells_scanned',
    'mask_rebuild_object_column_cells_scanned',
    'mask_rebuild_movement_row_cells_scanned',
    'mask_rebuild_movement_column_cells_scanned',
    'mask_rebuild_object_count_full_rebuilds',
    'mask_rebuild_object_count_full_rebuild_cells_scanned',
    'mask_rebuild_object_count_index_rebuilds',
    'mask_rebuild_object_count_index_bits_visited',
    'mask_dirty_object_cells_changed',
    'mask_dirty_object_bits_changed',
    'mask_dirty_object_bits_cleared',
    'mask_dirty_object_marks',
    'mask_dirty_object_add_only_marks',
    'mask_dirty_object_clear_marks',
    'mask_dirty_object_refcount_bit_updates',
    'mask_dirty_object_refcount_fallbacks',
    'mask_dirty_movement_cells_changed',
    'mask_dirty_movement_bits_changed',
    'mask_dirty_movement_bits_cleared',
    'mask_dirty_movement_marks',
    'mask_dirty_movement_clear_marks',
    'mask_dirty_movement_line_all_marks',
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

function runCounterProbe(extraEnv = {}, probe = {}) {
    const env = Object.assign({}, process.env);
    delete env.PUZZLESCRIPT_N4C_OBJECT_REFCOUNT_MASKS;
    Object.assign(env, extraEnv);
    return spawnSync(solver, [
        probe.corpus || corpus,
        '--timeout-ms', '1000',
        '--jobs', '1',
        '--strategy', 'bfs',
        '--game', probe.game || 'push_goal.txt',
        '--level', String(probe.level === undefined ? 0 : probe.level),
        '--json',
        '--quiet',
        '--no-solutions',
        '--profile-runtime-counters',
    ], {
        encoding: 'utf8',
        env,
    });
}

const result = runCounterProbe();

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

assert.ok(counters.rule_group_invocations > 0, 'expected interpreted rule-group invocations');
assert.ok(counters.rule_group_passes >= counters.rule_group_invocations, 'expected at least one pass per group invocation');
assert.ok(counters.rule_group_confirmation_passes > 0, 'expected terminal no-change confirmation passes');
assert.ok(
    counters.rule_group_confirmation_rule_visits >= counters.rule_group_confirmation_passes,
    'expected each confirmation pass to visit at least one rule'
);
assert.ok(
    counters.rule_group_confirmation_rule_visits <= counters.rules_visited,
    'expected confirmation visits to be a subset of all rule visits'
);
assert.strictEqual(counters.movement_anchor_overlap_cells_scanned, 0, 'expected movement anchor overlap count to use the moving-cell index');
assert.ok(counters.movement_anchor_collection_cells_scanned > 0, 'expected movement anchor collection scan attribution');
assert.ok(counters.movement_anchor_collections_used > 0, 'expected movement anchor collection count');
assert.strictEqual(counters.movement_anchor_runtime_mask_builds, 0, 'expected movement anchor masks to be precomputed');
assert.ok(counters.mask_rebuild_dirty_calls < 13, 'expected add-only movement writes to avoid dirty mask rebuild calls');
assert.ok(counters.mask_rebuild_rows < 21, 'expected add-only movement writes to avoid dirty row rebuilds');
assert.ok(counters.mask_rebuild_columns < 75, 'expected add-only movement writes to avoid dirty column rebuilds');
assert.strictEqual(
    counters.mask_rebuild_rows,
    counters.mask_rebuild_object_rows + counters.mask_rebuild_movement_rows,
    'expected typed row rebuild counters to add up to the existing aggregate'
);
assert.strictEqual(
    counters.mask_rebuild_columns,
    counters.mask_rebuild_object_columns + counters.mask_rebuild_movement_columns,
    'expected typed column rebuild counters to add up to the existing aggregate'
);
assert.ok(counters.mask_dirty_object_marks > 0, 'expected object changes to produce dirty-mask preflight marks');
assert.strictEqual(counters.mask_rebuild_object_count_full_rebuilds, 0, 'expected N4c full rebuild counter to stay off by default');
assert.strictEqual(counters.mask_rebuild_object_count_index_rebuilds, 0, 'expected N4c index rebuild counter to stay off by default');
assert.strictEqual(counters.mask_dirty_object_refcount_bit_updates, 0, 'expected N4c refcount update counter to stay off by default');
assert.strictEqual(counters.mask_dirty_object_refcount_fallbacks, 0, 'expected N4c fallback counter to stay off by default');
assert.strictEqual(
    counters.mask_dirty_object_marks,
    counters.mask_dirty_object_add_only_marks + counters.mask_dirty_object_clear_marks,
    'expected object dirty marks to split into add-only and clear-caused marks'
);
assert.strictEqual(
    counters.mask_dirty_movement_marks,
    counters.mask_dirty_movement_clear_marks + counters.mask_dirty_movement_line_all_marks,
    'expected movement dirty marks to split into clear-caused and line-all marks'
);

const n4cResult = runCounterProbe({ PUZZLESCRIPT_N4C_OBJECT_REFCOUNT_MASKS: '1' });
assert.strictEqual(
    n4cResult.status,
    0,
    `N4c solver exited ${n4cResult.status}\nstdout:\n${n4cResult.stdout}\nstderr:\n${n4cResult.stderr}`
);
const n4cCounters = parseCounters(`${n4cResult.stdout}\n${n4cResult.stderr}`);
assert.ok(
    n4cCounters.mask_rebuild_object_rows < counters.mask_rebuild_object_rows,
    'expected N4c object refcount masks to reduce object row rebuilds'
);
assert.ok(
    n4cCounters.mask_rebuild_object_columns < counters.mask_rebuild_object_columns,
    'expected N4c object refcount masks to reduce object column rebuilds'
);
assert.strictEqual(
    n4cCounters.mask_rebuild_object_count_full_rebuilds,
    0,
    'expected N4c to avoid a second full-board count-cache rebuild'
);
assert.strictEqual(
    n4cCounters.mask_rebuild_object_count_full_rebuild_cells_scanned,
    0,
    'expected N4c to avoid secondary full-board seed scans'
);
assert.ok(
    n4cCounters.mask_rebuild_object_count_index_rebuilds > 0,
    'expected N4c to seed object refcounts from the existing object-cell index'
);
assert.ok(
    n4cCounters.mask_rebuild_object_count_index_bits_visited > 0,
    'expected N4c index seeding to report visited object-cell bits'
);
assert.ok(
    n4cCounters.mask_dirty_object_refcount_bit_updates > 0,
    'expected N4c to update object refcounts incrementally after the seed rebuild'
);
assert.strictEqual(
    n4cCounters.mask_dirty_object_refcount_fallbacks,
    0,
    'expected N4c canary to stay on the exact refcount path'
);

const wideProbe = {
    corpus: wideCorpus,
    game: 'North Wind Simple Sailboat Buoy Collection.txt',
    level: 2,
};
const wideResult = runCounterProbe({}, wideProbe);
assert.strictEqual(
    wideResult.status,
    0,
    `wide N4c solver exited ${wideResult.status}\nstdout:\n${wideResult.stdout}\nstderr:\n${wideResult.stderr}`
);
const wideCounters = parseCounters(`${wideResult.stdout}\n${wideResult.stderr}`);
assert.ok(
    wideCounters.mask_rebuild_object_count_index_rebuilds > 0,
    'expected three-word games to enable indexed N4c masks automatically'
);
assert.strictEqual(
    wideCounters.mask_dirty_object_refcount_fallbacks,
    0,
    'expected automatic wide-game N4c to stay exact'
);

const wideDisabledResult = runCounterProbe(
    { PUZZLESCRIPT_N4C_OBJECT_REFCOUNT_MASKS: '0' },
    wideProbe
);
assert.strictEqual(wideDisabledResult.status, 0, 'expected the N4c benchmark escape hatch to run');
const wideDisabledCounters = parseCounters(`${wideDisabledResult.stdout}\n${wideDisabledResult.stderr}`);
assert.strictEqual(
    wideDisabledCounters.mask_rebuild_object_count_index_rebuilds,
    0,
    'expected PUZZLESCRIPT_N4C_OBJECT_REFCOUNT_MASKS=0 to disable automatic N4c'
);

process.stdout.write('native_runtime_counters_node: ok\n');
