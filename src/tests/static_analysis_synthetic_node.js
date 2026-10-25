#!/usr/bin/env node
'use strict';

// All ordered pairs of a small rule vocabulary, on authored initial boards.
// Unlike arbitrary object injection, authored levels remain inside the scope
// of game-wide reachability/setup certificates. Oracle budgets stay explicit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeSource } = require('./ps_static_analysis');
const { ensureRuntimeLoaded } = require('./run_static_analysis_runtime_contracts_node');
const { createIntraTurnOracle } = require('./lib/static_analysis_intra_turn_oracle');
ensureRuntimeLoaded();
unitTesting = true;
lazyFunctionGeneration = false;
const base = fs.readFileSync(path.join(__dirname, 'static_analysis_testdata/rule_tags/match-interactions.txt'), 'utf8');
const rules = [
    '[ alpha ] -> [ beta ]', '[ alpha ] -> [ ]', '[ no marker ] -> [ marker ]',
    '[ alpha ] -> [ alpha marker ]', '[ alpha marker ] -> [ alpha ]',
    '[ marker ] -> [ flag ]', '[ flag ] -> [ marker ]',
    '[ alpha ] -> [ right alpha ]', '[ alpha ] -> [ left alpha ]',
    '[ alpha ] -> [ stationary alpha ]', '[ stationary alpha ] -> [ right alpha ]',
    '[ right alpha ] -> [ up alpha ]', '[ marker ] -> [ action marker ]',
    'right [ alpha | alpha ] -> [ beta | beta ]',
    'right [ alpha | no alpha ] -> [ alpha | alpha ]',
    'right [ no marker | no marker ] -> [ no marker | marker ]',
    'right [ alpha | alpha ] -> [ right alpha | left alpha ]',
    '[ alpha ] [ marker ] -> [ beta ] [ flag ]',
    '[ alpha ] [ alpha ] -> [ alpha marker ] [ alpha no marker ]',
    '[ alpha ] -> [ randomdir alpha ]', '[ choice ] -> [ right choice ]',
    '[ alpha ] -> [ random choice ]', '[ alpha ] -> [ alpha flag ] sfx0',
    'right [ alpha | marker ] -> [ alpha | marker stationary flag ]',
    'right [ alpha | flag ] -> [ alpha stationary flag | flag ]',
];
const boards = ['aaa', 'a..', 'amam', 'aaf', 'bbb', 'mmm', 'fff', 'xay', 'qaq', 'aaa\nama', 'am\nfa'];
let cases = 0;
const checks = {}, skipped = {};
for (const left of rules) for (const right of rules) {
    const source = base
        .replace('Choice = Alpha or Beta', 'Choice = Alpha or Beta\nx = Alpha and Marker\ny = Alpha and Flag\nq = Beta and Marker and Flag')
        .replace(/RULES\n[\s\S]*?\nWINCONDITIONS/, `RULES\n${left}\n+ ${right}\n\nWINCONDITIONS`)
        .replace(/LEVELS\n[\s\S]*$/, `LEVELS\n${boards.join('\n\n')}\n`);
    const report = analyzeSource(source);
    assert.equal(report.status, 'ok', JSON.stringify({ left, right, errors: report.errors }));
    compile(['loadLevel', 0], source, 19);
    inputSpecializationActive = false;
    for (let index = 0; index < boards.length; index++) {
        curlevel = index;
        loadLevelFromState(state, index, 19);
        state.calculateRowColMasks(level);
        const oracle = createIntraTurnOracle(report, { maxProbes: 32, maxTuples: 64 });
        oracle.attach(state);
        const restore = oracle.install();
        try {
            applyRuleGroup(state.rules[0]);
            oracle.boundary();
            cases++;
        } catch (error) {
            error.message += `\nRules: ${left}\n+ ${right}\nBoard: ${JSON.stringify(boards[index])}\nSeed: 19`;
            throw error;
        } finally {
            const stats = oracle.stats();
            for (const [target, values] of [[checks, stats.checks], [skipped, stats.skipped]]) {
                for (const [key, value] of Object.entries(values)) target[key] = (target[key] || 0) + value;
            }
            restore();
        }
    }
}
assert.equal(cases, rules.length ** 2 * boards.length);
console.log(`static_analysis_synthetic_node: ok (${rules.length ** 2} programs, ${cases} authored boards)`);
console.log(JSON.stringify({ checks, skipped }));
