#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');

const jsonPath = process.argv[2];
if (!jsonPath) {
    throw new Error('Usage: node src/tests/compact_turn_native_parity_node.js COVERAGE_JSON');
}

const coverage = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const compact = coverage.aggregate && coverage.aggregate.compact_turn;
assert.ok(compact, `${jsonPath}: missing aggregate.compact_turn`);

const sources = compact.sources;
assert.strictEqual(sources, 182, `expected solver corpus source count to stay 182, got ${sources}`);
assert.strictEqual(compact.whole_turn_supported, sources, 'every source must have a callable compact-turn backend');
assert.strictEqual(compact.native_kernel_supported, sources, 'every source must use a native compact-turn kernel');
assert.strictEqual(compact.interpreter_bridge_supported, 0, 'compiler-mode compact-turn bridges are not accepted');

const reasons = compact.native_kernel_status_reason_counts || {};
const forbidden = [
    'interpreter_bridge',
    'native_compact_generator_rebuild',
    'no_rules',
    'rule_loops',
    'again_command',
    'cancel_command',
    'run_rules_on_level_start_late_rules',
    'run_rules_on_level_start_native_perf_guard',
    'aggregate_bindings',
    'transparent_object_compact_unsupported',
    'verbose_logging',
];

for (const reason of forbidden) {
    assert.strictEqual(reasons[reason] || 0, 0, `unexpected native blocker remains: ${reason}=${reasons[reason] || 0}`);
}
assert.strictEqual(reasons.native_kernel, sources, `expected native_kernel=${sources}, got ${reasons.native_kernel || 0}`);

console.log(`compact_turn_native_parity_node passed native=${compact.native_kernel_supported}/${sources}`);
