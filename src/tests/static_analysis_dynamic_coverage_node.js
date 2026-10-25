#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { inventoryClaims, addRuntimeCoverage, runtimeFailureClaims } = require('./static_analysis_dynamic_coverage');
const report = {
    ps_tagged: { game: { tags: { has_random: false } }, objects: [{ tags: { static: true, future_claim: true } }],
        rule_sections: [{ groups: [{ rules: [{ tags: { may_enable_other_matches: false, self_disabling: true } }] }] }] },
    facts: { future_family: [{ status: 'proved' }], rulegroup_flow: [{ status: 'candidate', value: {
        split_candidate: true, single_pass_safe: false, group_skip_mask: { skippable: true },
    } }] },
};
const inventory = inventoryClaims(report);
const row = id => inventory.find(entry => entry.id === id);
assert.equal(row('object.future_claim').status, 'unchecked');
assert.equal(row('fact.future_family').status, 'unchecked');
assert.equal(row('object.static').certificates, 1);
assert.equal(row('rule.may_enable_other_matches').certificates, 1, 'false is the useful certificate');
assert.equal(row('group.single_pass_safe').certificates, 0);
assert.equal(row('object.static').checks, 0, 'having a checker does not mean a check ran');
addRuntimeCoverage(inventory, { objectBoundaryChecks: 3, intraTurn: { checks: {
    'rule.self_disabling': 2, 'group.split_candidate': 1,
}, skipped: { probe_budget: 4 } } });
assert.equal(row('object.static').checks, 3);
assert.equal(row('rule.self_disabling').checks, 2);
assert.equal(row('group.split_candidate').checks, 1);
assert.equal(row('rule.may_enable_other_matches').checks, 0, 'zero observations must remain visible');
assert.equal(row('object.future_claim').checks, 0);
addRuntimeCoverage(inventory, { failureClaims: runtimeFailureClaims('test: static object occupancy changed') });
assert.equal(row('object.static').failures, 1, 'legacy first-check failures are observations too');
assert.deepEqual(runtimeFailureClaims('test: quantity monotonicity claim violated\n  claim: quantity.never_increases'),
    ['fact.count_layer_invariants', 'object.quantity.never_increases']);
assert.deepEqual(runtimeFailureClaims('test: temporary object survived stable boundary'),
    ['object.temporary', 'fact.transient_boundary']);
console.log('static_analysis_dynamic_coverage_node: ok');
