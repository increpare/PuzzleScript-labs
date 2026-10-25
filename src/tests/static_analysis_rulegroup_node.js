#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeSource } = require('./ps_static_analysis');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');
const fixture = fs.readFileSync(path.join(__dirname, 'static_analysis_testdata/rule_tags/match-interactions.txt'), 'utf8');
const pusher = fs.readFileSync(path.join(__dirname, 'static_analysis_testdata/rulegroup_flow/rulegroup-pusher-style.txt'), 'utf8');
const sourceFor = (rules, board = 'aaa\nm..') => fixture
    .replace(/RULES\n[\s\S]*?\nWINCONDITIONS/, `RULES\n${rules}\n\nWINCONDITIONS`)
    .replace(/LEVELS\n[\s\S]*$/, `LEVELS\n${board}\n`);
function flow(source) {
    const report = analyzeSource(source, { familyFilter: ['rulegroup_flow'] });
    assert.equal(report.status, 'ok', JSON.stringify(report.errors));
    return report.facts.rulegroup_flow[0].value;
}
let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok   ' + name); }
    catch (error) { console.error('FAIL ' + name + '\n' + error.stack); process.exitCode = 1; }
}

test('opposing push directions share a writable movement layer', () => {
    const result = flow(pusher);
    assert.equal(result.split_candidate, false);
    assert.equal(result.single_pass_safe, false);
    assert.equal(result.components.length, 1);
    assert(result.interaction_edges.some(edge => edge.reasons.includes('movement_write_conflict')));
});
test('independent components can still have self-overlapping replacements', () => {
    const result = flow(sourceFor('right [ alpha | alpha ] -> [ right alpha | left alpha ]\n+ [ marker ] -> [ flag ]'));
    assert.equal(result.split_candidate, true);
    assert.equal(result.single_pass_safe, false);
    assert(result.single_pass_blockers.includes('overlapping_replacements'));
});
test('same-layer sibling object writes cannot be independent', () => {
    const result = flow(sourceFor('[ marker ] -> [ marker alpha ]\n+ [ flag ] -> [ flag beta ]'));
    assert.equal(result.split_candidate, false);
    assert.equal(result.single_pass_safe, false);
});
test('implicit movement clearing conflicts with a direction assignment', () => {
    const result = flow(sourceFor('[ action alpha ] -> [ alpha ]\n+ [ alpha ] -> [ right alpha ]'));
    assert.equal(result.split_candidate, false);
    assert.equal(result.single_pass_safe, false);
});
test('RHS randomness and captured bindings retain conservative certificates', () => {
    for (const rewrite of ['[ alpha ] -> [ randomdir alpha ]', '[ choice ] -> [ right choice ]', '[ choice ] -> [ random choice ]']) {
        const result = flow(sourceFor(rewrite + '\n+ [ marker ] -> [ flag ]'));
        assert.equal(result.split_candidate, false, rewrite);
        assert.equal(result.single_pass_safe, false, rewrite);
        assert.equal(result.group_skip_mask.skippable, false, rewrite);
    }
});
test('observable commands are not reordered by a split certificate', () => {
    const result = flow(sourceFor('[ alpha ] -> message hello\n+ [ marker ] -> [ flag ]'));
    assert.equal(result.split_candidate, false);
    assert.equal(result.single_pass_safe, false);
});
test('genuinely disjoint deterministic rules keep useful certificates', () => {
    const result = flow(sourceFor('[ alpha ] -> [ ]\n+ [ marker ] -> [ ]'));
    assert.equal(result.split_candidate, true);
    assert.equal(result.single_pass_safe, true);
    assert.equal(result.components.length, 2);
});
test('a forward-only dependency can still converge in one pass', () => {
    const result = flow(sourceFor('[ alpha ] -> [ alpha marker ]\n+ [ marker ] -> [ marker flag ]'));
    assert.equal(result.split_candidate, false);
    assert.equal(result.single_pass_safe, true);
});
test('group skip masks include RHS-only movement resources', () => {
    const result = flow(sourceFor('[ alpha ] -> [ right alpha ]\n+ [ marker ] -> [ flag ]'));
    const report = analyzeSource(sourceFor('[ alpha ] -> [ right alpha ]\n+ [ marker ] -> [ flag ]'));
    const layer = report.ps_tagged.objects.find(object => object.name === 'Alpha').layer;
    const bit = layer * 5;
    const mask = result.group_skip_mask.masks.read_movements_wake;
    for (let offset = 0; offset < 5; offset++) {
        assert((mask[(bit + offset) >> 5] & (1 << ((bit + offset) & 31))) !== 0, 'all movement bits on the written layer wake the group');
    }
});

const messages = [];
loadPuzzleScript({ messageSink: messages });
unitTesting = false;
lazyFunctionGeneration = false;
function compileGame(source) {
    compile(['loadLevel', 0], source + '\n', 'rulegroup-conflicts');
    assert.equal(errorCount, 0, errorStrings.join('\n'));
    messages.length = 0;
}
test('the real opposing-pusher group reaches the loop guard', () => {
    const opposing = pusher.replace('RULES\n=====\n', 'RULES\n=====\nright [ action Pusher | Pushable | action Pusher ] -> [ right Pusher | Pushable | left Pusher ]\n')
        .replace(/LEVELS\n======\n[\s\S]*$/, 'LEVELS\n======\nPCP\n');
    compileGame(opposing);
    processInput(4);
    assert(messages.some(message => /looping lots/.test(message)), 'joined pushes churn before collision resolution');
});
test('a singleton with conflicting overlapping tuples must keep rescanning', () => {
    compileGame(sourceFor('right [ alpha | alpha ] -> [ right alpha | left alpha ]', 'aaa'));
    const rule = state.rules[0][0];
    assert.equal(rule.skipSingleRuleGroupRescan, false);
    state.calculateRowColMasks(level);
    const previous = inputSpecializationActive;
    inputSpecializationActive = false;
    try { applyRuleGroup(state.rules[0]); }
    finally { inputSpecializationActive = previous; }
    assert(messages.some(message => /looping lots/.test(message)));
});

console.log(`${passed} rule-group analysis checks passed`);
