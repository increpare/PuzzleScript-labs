#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeSource } = require('./ps_static_analysis');
const { ensureRuntimeLoaded, replayFinalSerializedLevel, runSimulationWithStaticChecks } = require('./run_static_analysis_runtime_contracts_node');
const { createIntraTurnOracle } = require('./lib/static_analysis_intra_turn_oracle');
ensureRuntimeLoaded();

const fixture = fs.readFileSync(path.join(__dirname, 'static_analysis_testdata/rule_tags/match-interactions.txt'), 'utf8');
const sourceFor = (rules, board = 'aaa') => fixture
    .replace(/RULES\n[\s\S]*?\nWINCONDITIONS/, `RULES\n${rules}\n\nWINCONDITIONS`)
    .replace(/LEVELS\n[\s\S]*$/, `LEVELS\n${board}\n`);
let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('ok   ' + name); }
    catch (error) { console.error('FAIL ' + name + '\n' + error.stack); process.exitCode = 1; }
}
function run(rules, board, mutate, action, options = {}) {
    const source = sourceFor(rules, board);
    const report = analyzeSource(source);
    assert.equal(report.status, 'ok');
    if (mutate) mutate(report);
    const oracle = createIntraTurnOracle(report, options);
    const restore = oracle.install();
    unitTesting = true;
    lazyFunctionGeneration = false;
    try {
        compile(['loadLevel', 0], source, 'intra-turn');
        assert.equal(errorCount, 0);
        state.calculateRowColMasks(level);
        action(oracle, report);
        return oracle.stats();
    } finally { restore(); }
}
const firstRule = report => report.ps_tagged.rule_sections[0].groups[0].rules[0];
const firstFlow = report => report.facts.rulegroup_flow[0].value;
function rejects(rules, board, mutate, certificate, action = () => state.rules[0][0].tryApply(level)) {
    assert.throws(() => run(rules, board, mutate, action), error => error.certificate === certificate,
        `oracle must independently reject a false ${certificate} certificate`);
}

test('detects false no-invalidation and no-enabling claims at overlapping tuples', () => {
    rejects('right [ alpha | alpha ] -> [ beta | beta ]', 'aaa', report => {
        firstRule(report).tags.may_invalidate_other_matches = false;
    }, 'rule.may_invalidate_other_matches');
    rejects('right [ alpha | no alpha ] -> [ alpha | alpha ]', 'a..', report => {
        firstRule(report).tags.may_enable_other_matches = false;
    }, 'rule.may_enable_other_matches');
});
test('detects false self-disabling and isolated-invocation idempotence', () => {
    rejects('[ alpha ] -> [ right alpha ]', 'a', report => {
        firstRule(report).tags.self_disabling = true;
    }, 'rule.self_disabling');
    rejects('right [ alpha | no alpha ] -> [ alpha | alpha ]', 'a..', report => {
        firstRule(report).tags.idempotent_effect = true;
    }, 'rule.idempotent_effect');
});
test('single-pass oracle sees movement churn even when object board is unchanged', () => {
    rejects('[ alpha ] -> [ right alpha ]\n+ [ alpha ] -> [ left alpha ]', 'a', report => {
        firstFlow(report).single_pass_safe = true;
    }, 'group.single_pass_safe', () => applyRuleGroup(state.rules[0]));
});
test('split oracle compares convergence as well as final state', () => {
    rejects('[ alpha ] -> [ right alpha ]\n+ [ alpha ] -> [ left alpha ]', 'a', report => {
        const flow = firstFlow(report);
        flow.split_candidate = true;
        flow.components = flow.rule_ids.map(id => [id]);
    }, 'group.split_candidate', () => applyRuleGroup(state.rules[0]));
});
test('checks skip masks only after a group is clean, including movement outputs', () => {
    rejects('[ alpha ] -> [ right alpha ]\n+ [ marker ] -> [ flag ]', 'am', report => {
        firstFlow(report).group_skip_mask.masks.read_movements_wake.fill(0);
    }, 'group.group_skip_mask', () => {
        applyRuleGroup(state.rules[0]);
        level.movements.fill(0);
        state.calculateRowColMasks(level);
        applyRuleGroup(state.rules[0]);
    });
});
test('checks permanent guards after committed turns and resets on restoration', () => {
    const mutate = report => {
        firstRule(report).tags.persistent_guard = true;
        firstRule(report).setup_analysis.guards = [{ row: 0, cell: 0, object: 'Marker', present: true, persistent: true }];
    };
    rejects('[ alpha no marker ] -> [ alpha marker ]\n[ marker ] -> [ ]', 'a', mutate,
        'rule.persistent_guard', oracle => {
            state.rules[0][0].tryApply(level);
            oracle.boundary();
            state.rules[1][0].tryApply(level);
            oracle.boundary();
        });
    run('[ alpha no marker ] -> [ alpha marker ]\n[ marker ] -> [ ]', 'a', mutate, oracle => {
        const raw = backupLevel();
        state.rules[0][0].tryApply(level);
        oracle.boundary();
        restoreLevel(raw);
        oracle.boundary();
        assert(oracle.stats().resets > 0);
    });
});
test('retirement waits for quiescence and rejects later renewed effects', () => {
    rejects('[ alpha no marker ] -> [ alpha marker ]\n[ marker ] -> [ ]', 'a', report => {
        firstRule(report).tags.setup_only = true;
        firstRule(report).setup_analysis.setup_dependencies = [];
    }, 'rule.setup_only', oracle => {
        state.rules[0][0].tryApply(level);
        oracle.boundary();
        state.rules[1][0].tryApply(level);
        state.rules[0][0].tryApply(level);
        oracle.boundary();
    });
});
test('honest independent groups and compatible local certificates pass', () => {
    const stats = run('[ alpha ] -> [ ]\n+ [ marker ] -> [ ]', 'am', null, oracle => {
        applyRuleGroup(state.rules[0]);
        oracle.boundary();
        applyRuleGroup(state.rules[0]);
    });
    for (const key of ['group.single_pass_safe', 'group.split_candidate', 'rule.self_disabling', 'rule.idempotent_effect']) {
        assert(stats.checks[key] > 0, key);
    }
});
test('shadow probes preserve movement, commands, RNG and sound masks exactly', () => {
    run('[ alpha ] -> [ randomdir alpha ] sfx0', 'aa', null, oracle => {
        level.movements[0] = 16 << (5 * state.objects.alpha.layer);
        const before = oracle.runtimeSnapshot();
        oracle.shadow(() => {
            oracle.referenceRule(state.rules[0][0]);
            level.commandQueue.push('cancel');
        });
        assert.deepEqual(oracle.runtimeSnapshot(), before);
    });
});
test('budgets and Cartesian-product overflow are explicit skips', () => {
    const stats = run('[ alpha ] [ alpha ] -> [ alpha ] [ alpha ]', 'aaa', null, () => {
        state.rules[0][0].tryApply(level);
    }, { maxTuples: 2 });
    assert(stats.skipped.tuple_budget > 0);
    const limited = run('[ alpha ] -> [ beta ]', 'aaa', null, () => {
        state.rules[0][0].tryApply(level);
    }, { maxProbes: 0 });
    assert(limited.skipped.probe_budget > 0);
});

test('winflow records replacements through the isolated-cell engine fast path', () => {
    const source = sourceFor('[ alpha ] -> [ alpha marker ]', 'a')
        .replace('WINCONDITIONS\n', 'WINCONDITIONS\nSome Flag\nSome Marker\n');
    const expected = replayFinalSerializedLevel('single-cell winflow recorder', source, ['tick']);
    const result = runSimulationWithStaticChecks('single-cell winflow recorder', [source, ['tick'], expected]);
    assert(result.winflowCleanWinconditionChecks > 0);
});

test('replay integration observes startup rules before the initial boundary', () => {
    const source = 'run_rules_on_level_start\n' + sourceFor('[ alpha ] -> [ beta ]', 'aa');
    const expected = replayFinalSerializedLevel('startup oracle', source, []);
    const result = runSimulationWithStaticChecks('startup oracle', [source, [], expected], { intraTurn: true });
    assert(result.intraTurn.checks['rule.self_disabling'] > 0);
});

test('finishing the final level does not apply level-zero claims to its retained board', () => {
    const source = sourceFor('', 'm\n\na').replace('WINCONDITIONS\n', 'WINCONDITIONS\nSome Alpha\n');
    const expected = replayFinalSerializedLevel('final level identity', source, ['tick'], { targetLevel: 1 });
    runSimulationWithStaticChecks('final level identity', [source, ['tick'], expected, 1], { intraTurn: true });
});

test('lifetime checks observe each committed AGAIN turn', () => {
    rejects('[ alpha no flag no marker ] -> [ alpha marker ]\n'
        + '[ alpha flag no marker ] -> [ alpha marker ]\n'
        + '[ alpha flag marker ] -> [ alpha flag no marker ] again\n'
        + '[ action alpha marker ] -> [ alpha marker flag ] again', 'a', report => {
        firstRule(report).tags.persistent_guard = true;
        firstRule(report).setup_analysis.guards = [{ row: 0, cell: 0, object: 'Marker', present: true, persistent: true }];
    }, 'rule.persistent_guard', () => {
        processInput(-1);
        processInput(4);
        while (againing) { againing = false; processInput(-1); }
    });
});
test('failing probes retain their attempted-check and failure counters', () => {
    let observed;
    try {
        run('[ alpha ] -> [ right alpha ]', 'a', report => {
            firstRule(report).tags.self_disabling = true;
        }, () => state.rules[0][0].tryApply(level));
    } catch (error) { observed = error; }
    assert(observed.intraTurn.checks['rule.self_disabling'] > 0);
    assert.equal(observed.intraTurn.failures['rule.self_disabling'], 1);
});

test('negative creation and destruction claims check cell-local rule effects', () => {
    rejects('[ alpha ] -> [ alpha marker ]', 'a', report => {
        report.ps_tagged.objects.find(object => object.name === 'Marker').tags.may_be_created = false;
    }, 'object.may_be_created');
    rejects('[ alpha ] -> [ beta ]', 'a', report => {
        report.ps_tagged.objects.find(object => object.name === 'Alpha').tags.may_be_destroyed = false;
    }, 'object.may_be_destroyed');
});

test('an unmappable group does not disable the remaining phase', () => {
    const stats = run('[ alpha ] -> [ beta ]\n[ marker ] -> [ flag ]', 'am', report => {
        const rules = report.ps_tagged.rule_sections[0].groups[0].rules;
        rules.push({ ...rules[0], id: 'duplicate-semantic-variant' });
    }, () => { state.rules[1][0].tryApply(level); });
    assert(stats.skipped.unmapped_early_groups > 0);
    assert(stats.checks['rule.self_disabling'] > 0);
});

test('cell-local write checks see effects cancelled by another row of the same tuple', () => {
    rejects('[ alpha ] [ alpha ] -> [ alpha marker ] [ alpha no marker ]', 'a', report => {
        report.ps_tagged.objects.find(object => object.name === 'Marker').tags.may_be_created = false;
    }, 'object.may_be_created');
});

console.log(`static_analysis_intra_turn_node: ${passed} checks passed`);
