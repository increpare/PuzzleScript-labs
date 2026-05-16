#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');
const { analyzeSource } = require('./ps_static_analysis');
const {
    parseSolverOptPassList,
    resolveSolverPasses,
    createSolverOptimizationHook,
    collectWinconditionLegendRefs,
    collectObjectNamesFromCompiledLevels,
    expandLegendRefsToConcreteObjectNames,
    effectiveSolverPassesForHook,
    buildSolverOptimizationJsonTotals,
    formatSolverOptimizationHumanSuffixFromTotals,
    isInertCommandOnlyCompiledRule,
    cosmeticRuleSourceLines,
    isCosmeticRuleOptimizationEligible,
    applyNameSubstitutionToWinconditions,
    buildMergeAliasMap,
} = require('./solver_static_opt');

function assertThrows(fn, msg) {
    let threw = false;
    try {
        fn();
    } catch (e) {
        threw = true;
        if (msg && !String(e.message || e).includes(msg)) {
            throw e;
        }
    }
    assert.ok(threw, 'expected throw');
}

function run() {
    const mockState = {
        objects: { rock: {}, crate: {}, gem: {} },
        aggregatesDict: { pile: ['rock', 'crate'] },
        propertiesDict: { shiny: ['gem', 'crate'] },
        winconditions: [['some', 'pile', 'on', 'shiny', 99]],
    };
    const winRefs = collectWinconditionLegendRefs(mockState);
    assert.ok(winRefs.has('pile'));
    assert.ok(winRefs.has('shiny'));

    const mergeWinState = {
        objects: { a: {}, b: {} },
        aggregatesDict: {},
        propertiesDict: {},
        winconditions: [['all', 'oldname', 'on', 'b', 777]],
    };
    applyNameSubstitutionToWinconditions(mergeWinState, nm => (nm === 'oldname' ? 'a' : undefined));
    assert.deepStrictEqual(mergeWinState.winconditions[0], ['all', 'a', 'on', 'b', 777]);

    const lineOnly = { objects: { y: {} }, aggregatesDict: {}, propertiesDict: {}, winconditions: [['no', 'x', 99]] };
    applyNameSubstitutionToWinconditions(lineOnly, nm => (nm === 'x' ? 'y' : undefined));
    assert.deepStrictEqual(lineOnly.winconditions[0], ['no', 'y', 99], 'last wincondition token is line number, not rewritten');
    const expanded = expandLegendRefsToConcreteObjectNames(mockState, new Set(['pile', 'shiny']));
    assert.deepStrictEqual(new Set([...expanded].sort()), new Set(['crate', 'gem', 'rock']));

    const levelScanState = {
        objectCount: 3,
        STRIDE_OBJ: 1,
        idDict: ['bg', 'player', 'star'],
        levels: [{ n_tiles: 1, objects: new Int32Array([1 << 2]) }],
    };
    const onMap = collectObjectNamesFromCompiledLevels(levelScanState);
    assert.ok(onMap.has('star'));
    assert.ok(!onMap.has('player'));

    assert.deepStrictEqual(
        effectiveSolverPassesForHook(null, { inert: true, cosmetic: true, cosmeticRules: true, merge: true }),
        { inert: true, cosmetic: false, cosmeticRules: false, merge: false, action: false },
    );
    assert.deepStrictEqual(
        effectiveSolverPassesForHook({ status: 'compile_error' }, { inert: true, cosmetic: true, cosmeticRules: true, merge: true }),
        { inert: true, cosmetic: false, cosmeticRules: false, merge: false, action: false },
    );
    assert.deepStrictEqual(
        effectiveSolverPassesForHook({ status: 'ok' }, { inert: false, cosmetic: true, cosmeticRules: true, merge: true }),
        { inert: false, cosmetic: true, cosmeticRules: true, merge: true, action: false },
    );
    const nest = buildSolverOptimizationJsonTotals({
        static_optimization_removed_rules: 1,
        removed_cosmetic_objects: 0,
        removed_collision_layers: 0,
        removed_cosmetic_rules: 0,
        merged_object_aliases: 0,
        merged_object_groups: 0,
        solver_opt_ms_inert: 0.01,
        solver_opt_ms_cosmetic: 0,
        solver_opt_ms_cosmetic_rules: 0,
        solver_opt_ms_merge: 0,
    });
    assert.strictEqual(nest.removed_inert_rules, 1);
    assert.ok(nest.ms_hook > 0);

    const nestGated = buildSolverOptimizationJsonTotals({
        static_optimization_removed_rules: 0,
        removed_cosmetic_objects: 0,
        removed_collision_layers: 0,
        removed_cosmetic_rules: 0,
        merged_object_aliases: 0,
        merged_object_groups: 0,
        solver_opt_ms_inert: 0,
        solver_opt_ms_cosmetic: 0,
        solver_opt_ms_cosmetic_rules: 0,
        solver_opt_ms_merge: 0,
        solver_optimization_gated: true,
    });
    assert.strictEqual(nestGated.gated, true);
    assert.ok(formatSolverOptimizationHumanSuffixFromTotals({ solver_optimization_gated: true }).includes('opt_gated=1'));

    assert.deepStrictEqual(parseSolverOptPassList('all'), { inert: true, cosmetic: true, cosmeticRules: true, merge: true, action: true });
    assert.deepStrictEqual(parseSolverOptPassList('inert,cosmetic'), { inert: true, cosmetic: true, cosmeticRules: false, merge: false, action: false });
    assert.deepStrictEqual(parseSolverOptPassList('cosmetic-rules'), { inert: false, cosmetic: false, cosmeticRules: true, merge: false, action: false });
    assertThrows(() => parseSolverOptPassList('nope'), 'Unknown');

    const actionReport = {
        status: 'ok',
        facts: {
            movement_action: [{ id: 'action_noop', status: 'proved' }],
        },
    };
    const actionState = { invalid: 0, metadata: [] };
    createSolverOptimizationHook(actionReport, { action: true })(actionState);
    assert.ok(actionState.metadata.includes('noaction'), 'action pass should insert noaction metadata when action_noop is proved');
    assert.strictEqual(actionState.solverOptimizationTelemetry.inserted_noaction_metadata, 1);

    const rejectedActionState = { invalid: 0, metadata: [] };
    createSolverOptimizationHook({
        status: 'ok',
        facts: { movement_action: [{ id: 'action_noop', status: 'rejected' }] },
    }, { action: true })(rejectedActionState);
    assert.ok(!rejectedActionState.metadata.includes('noaction'), 'action pass should not insert noaction when action_noop is rejected');

    const inertLine = new Set([42]);
    assert.strictEqual(
        isInertCommandOnlyCompiledRule(
            { lineNumber: 42, randomRule: true, hasReplacements: false, commands: [['message', 'x']] },
            inertLine,
        ),
        false,
        'never drop random rules tagged inert-command-only (can affect nondeterminism)',
    );
    assert.strictEqual(
        isInertCommandOnlyCompiledRule(
            { lineNumber: 42, hasReplacements: false, commands: [['message', 'x']] },
            inertLine,
        ),
        true,
    );
    const cosmeticNames = new Set(['Dust']);
    assert.strictEqual(
        isCosmeticRuleOptimizationEligible({
            random_rule: false,
            rigid: false,
            tags: {
                cosmetic: true,
                object_mutating: true,
                objects_required: ['Dust'],
                objects_matched: ['Dust'],
                object_absences_matched: [],
                objects_written: [],
                objects_erased: ['Dust'],
                movements_written: [],
                movements_removed: [],
            },
            summary: { semantic_commands: [], rhs_random_objects: [] },
        }, cosmeticNames),
        true,
        'pure cosmetic cleanup rules are optimizer-eligible',
    );
    assert.strictEqual(
        isCosmeticRuleOptimizationEligible({
            random_rule: false,
            rigid: false,
            tags: {
                cosmetic: true,
                object_mutating: true,
                objects_required: ['Player'],
                objects_matched: ['Player'],
                object_absences_matched: [],
                objects_written: ['Dust'],
                objects_erased: [],
                movements_written: [],
                movements_removed: [],
            },
            summary: { semantic_commands: [], rhs_random_objects: [] },
        }, cosmeticNames),
        true,
        'contextual rules that only write cosmetic objects are optimizer-eligible',
    );
    assert.strictEqual(
        isCosmeticRuleOptimizationEligible({
            random_rule: false,
            rigid: false,
            tags: {
                cosmetic: false,
                object_mutating: true,
                objects_required: ['Player'],
                objects_matched: ['Player'],
                object_absences_matched: [],
                objects_written: ['Dust'],
                objects_erased: [],
                movements_written: ['Player:stationary', 'Dust:stationary'],
                movements_removed: ['Player:stationary'],
            },
            summary: { semantic_commands: [], rhs_random_objects: [] },
        }, cosmeticNames),
        true,
        'visible movement write/remove pairs cancel when projecting cosmetic effects',
    );
    assert.strictEqual(
        isCosmeticRuleOptimizationEligible({
            random_rule: false,
            rigid: false,
            tags: {
                cosmetic: false,
                object_mutating: true,
                objects_required: ['Player'],
                objects_matched: ['Player'],
                object_absences_matched: [],
                objects_written: ['Dust'],
                objects_erased: [],
                movements_written: ['Player:right', 'Dust:stationary'],
                movements_removed: ['Player:stationary'],
            },
            summary: { semantic_commands: [], rhs_random_objects: [] },
        }, cosmeticNames),
        false,
        'visible net movement changes keep a rule out of cosmetic projection',
    );
    const dependentCosmeticReport = {
        ps_tagged: {
            objects: [{ name: 'Dust', tags: { cosmetic: true } }],
            rule_sections: [{
                groups: [
                    { rules: [{
                        source_line: 1,
                        random_rule: false,
                        rigid: false,
                        tags: {
                            cosmetic: true,
                            object_mutating: true,
                            objects_required: ['Dust'],
                            objects_matched: ['Dust'],
                            object_absences_matched: [],
                            objects_written: [],
                            objects_erased: ['Dust'],
                            movements_written: [],
                            movements_removed: [],
                        },
                        summary: { semantic_commands: [], rhs_random_objects: [] },
                    }] },
                    { rules: [{
                        source_line: 2,
                        random_rule: false,
                        rigid: false,
                        tags: {
                            cosmetic: false,
                            object_mutating: false,
                            objects_required: ['Dust'],
                            objects_matched: ['Dust'],
                            object_absences_matched: [],
                        },
                        summary: { semantic_commands: [], rhs_random_objects: [] },
                    }] },
                ],
            }],
        },
    };
    assert.deepStrictEqual(
        Array.from(cosmeticRuleSourceLines(dependentCosmeticReport)),
        [],
        'do not remove cosmetic cleanup rules whose markers are read by kept rules',
    );
    const writerDependentCosmeticReport = {
        ps_tagged: {
            objects: [{ name: 'Dust', tags: { cosmetic: true } }],
            rule_sections: [{
                groups: [
                    { rules: [{
                        source_line: 1,
                        random_rule: false,
                        rigid: false,
                        tags: {
                            cosmetic: true,
                            object_mutating: true,
                            objects_required: ['Dust'],
                            objects_matched: ['Dust'],
                            object_absences_matched: [],
                            objects_written: [],
                            objects_erased: ['Dust'],
                            movements_written: [],
                            movements_removed: [],
                        },
                        summary: { semantic_commands: [], rhs_random_objects: [] },
                    }] },
                    { rules: [{
                        source_line: 2,
                        random_rule: false,
                        rigid: false,
                        tags: {
                            cosmetic: false,
                            object_mutating: true,
                            objects_required: ['Player'],
                            objects_matched: ['Player'],
                            object_absences_matched: [],
                            objects_written: ['Dust'],
                            objects_erased: [],
                            movements_written: [],
                            movements_removed: [],
                        },
                        summary: { semantic_commands: [], rhs_random_objects: [] },
                    }] },
                ],
            }],
        },
    };
    assert.deepStrictEqual(
        Array.from(cosmeticRuleSourceLines(writerDependentCosmeticReport)),
        [1, 2],
        'remove cosmetic cleanup rules together with projectable cosmetic writers',
    );

    const mergeAliasState = {
        objects: { alpha: {}, beta: {} },
        original_case_names: { alpha: 'Alpha', beta: 'Beta' },
    };
    const mergeAlias = buildMergeAliasMap([['Alpha', 'Beta']], new Set(), mergeAliasState);
    assert.strictEqual(mergeAlias.groups, 1, 'mixed-case static names should resolve to runtime object names');
    assert.strictEqual(mergeAlias.alias.get('beta'), 'alpha');
    const cosmeticMergeAlias = buildMergeAliasMap([['Alpha', 'Beta']], new Set(['Beta']), mergeAliasState);
    assert.strictEqual(cosmeticMergeAlias.alias.size, 0, 'cosmetic merge candidates should remain excluded after name resolution');
    const structuralMergeAlias = buildMergeAliasMap([['Player', 'Beta']], new Set(), {
        objects: { player: {}, beta: {} },
        original_case_names: { player: 'Player', beta: 'Beta' },
    });
    assert.strictEqual(structuralMergeAlias.alias.size, 0, 'player objects should remain excluded from merge aliases');
    const mutatedMergeAlias = buildMergeAliasMap([['Alpha', 'Beta']], new Set(), mergeAliasState, {
        excludedNames: new Set(['Alpha']),
    });
    assert.strictEqual(mutatedMergeAlias.alias.size, 0, 'mutated objects should remain excluded from merge aliases');

    const opt = { solverOptimizeStatic: true, solverOptPasses: { cosmetic: true, merge: false } };
    const merged = resolveSolverPasses(opt);
    assert.strictEqual(merged.inert, true);
    assert.strictEqual(merged.cosmetic, true);
    assert.strictEqual(merged.cosmeticRules, false);

    const baseline = resolveSolverPasses(Object.assign({}, opt, { solverOptParityBaseline: true }));
    assert.deepStrictEqual(baseline, { inert: false, cosmetic: false, cosmeticRules: false, merge: false, action: false });

    loadPuzzleScript();
    const smokePath = path.join(__dirname, 'solver_smoke_tests', 'one_move.txt');
    const source = fs.readFileSync(smokePath, 'utf8');
    const report = analyzeSource(source, { sourcePath: smokePath });
    assert.strictEqual(report.status, 'ok');

    const hook = createSolverOptimizationHook(report, { inert: true, cosmetic: true, merge: true });
    setPluginOptimizationHook(hook);
    try {
        compile(['loadLevel', 0], source, 'solver_static_opt_node');
    } finally {
        setPluginOptimizationHook(null);
    }
    assert.strictEqual(errorCount, 0, 'compile should succeed with full optimization hook');
    assert.ok(state && state.solverOptimizationTelemetry, 'telemetry attached');
    const tel = state.solverOptimizationTelemetry;
    assert.ok(typeof tel.removed_inert_rules === 'number');
    assert.ok(typeof tel.removed_cosmetic_rules === 'number');
    assert.ok(typeof tel.ms_inert === 'number' && tel.ms_inert >= 0);
    assert.ok(typeof tel.ms_cosmetic === 'number' && tel.ms_cosmetic >= 0);
    assert.ok(typeof tel.ms_cosmetic_rules === 'number' && tel.ms_cosmetic_rules >= 0);
    assert.ok(typeof tel.ms_merge === 'number' && tel.ms_merge >= 0);

    const cosmeticRuleSource = `
title Solver Static Cosmetic Rule

========
OBJECTS
========

background
black

Player
blue

Target
green

Dust
red

========
LEGEND
========

. = background
P = Player
T = Target
d = Dust

========
SOUNDS
========

================
COLLISIONLAYERS
================

background
Target
Player
Dust

======
RULES
======

[ Dust ] -> [ ]

=============
WINCONDITIONS
=============

all Player on Target

======
LEVELS
======

PTd
`;
    const cosmeticRuleReport = analyzeSource(cosmeticRuleSource, { sourcePath: 'solver_static_cosmetic_rule.txt' });
    assert.strictEqual(cosmeticRuleReport.status, 'ok');
    assert.ok(
        cosmeticRuleReport.ps_tagged.rule_sections
            .flatMap(section => section.groups)
            .flatMap(group => group.rules)
            .some(rule => rule.tags && rule.tags.cosmetic === true),
        'fixture should exercise a cosmetic-tagged rule',
    );
    const cosmeticRuleHook = createSolverOptimizationHook(cosmeticRuleReport, {
        inert: false,
        cosmetic: false,
        cosmeticRules: true,
        merge: false,
    });
    setPluginOptimizationHook(cosmeticRuleHook);
    try {
        compile(['loadLevel', 0], cosmeticRuleSource, 'solver_static_cosmetic_rule');
    } finally {
        setPluginOptimizationHook(null);
    }
    assert.strictEqual(errorCount, 0, 'cosmetic rule optimization compile should succeed');
    assert.strictEqual(
        state.solverOptimizationTelemetry.removed_cosmetic_rules,
        1,
        'cosmetic rule pass should suppress the cosmetic cleanup rule',
    );

    const backgroundOnlySource = `
title Solver Static Cosmetic Background

========
OBJECTS
========

background
black

Player
blue

Target
green

========
LEGEND
========

. = background
P = Player and background
T = Target and background

========
SOUNDS
========

================
COLLISIONLAYERS
================

background
Target
Player

======
RULES
======

=============
WINCONDITIONS
=============

all Player on Target

======
LEVELS
======

PT
`;
    const backgroundReport = analyzeSource(backgroundOnlySource, { sourcePath: 'solver_static_cosmetic_background.txt' });
    assert.strictEqual(backgroundReport.status, 'ok');
    assert.strictEqual(
        backgroundReport.ps_tagged.objects.find(object => object.name === 'background').tags.cosmetic,
        true,
        'fixture should exercise a cosmetic-tagged background object',
    );
    const backgroundHook = createSolverOptimizationHook(backgroundReport, { inert: false, cosmetic: true, merge: false });
    setPluginOptimizationHook(backgroundHook);
    try {
        compile(['loadLevel', 0], backgroundOnlySource, 'solver_static_cosmetic_background');
    } finally {
        setPluginOptimizationHook(null);
    }
    assert.strictEqual(errorCount, 0, 'cosmetic pruning must preserve the compiler background object');
    assert.ok(state && state.objects && state.objects.background, 'background object should remain after cosmetic pruning');

    const corpusDir = path.join(__dirname, 'solver_smoke_tests');
    const runner = path.join(__dirname, 'run_solver_tests_js.js');
    const actionBaseline = JSON.parse(execFileSync(
        process.execPath,
        [
            runner,
            corpusDir,
            '--game',
            'push_goal.txt',
            '--quiet',
            '--no-solutions',
            '--json',
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ));
    const actionOptimized = JSON.parse(execFileSync(
        process.execPath,
        [
            runner,
            corpusDir,
            '--game',
            'push_goal.txt',
            '--quiet',
            '--no-solutions',
            '--solver-opt',
            'action',
            '--json',
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ));
    assert.strictEqual(actionOptimized.results[0].status, 'solved');
    assert.strictEqual(actionBaseline.results[0].solution_length, actionOptimized.results[0].solution_length);
    assert.ok(actionOptimized.results[0].generated < actionBaseline.results[0].generated, 'action-noop static pass should prune solver action branches');
    assert.strictEqual(actionOptimized.results[0].inserted_noaction_metadata, 1);

    const profiledAction = JSON.parse(execFileSync(
        process.execPath,
        [
            runner,
            corpusDir,
            '--game',
            'push_goal.txt',
            '--quiet',
            '--no-solutions',
            '--json',
        ],
        {
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            env: Object.assign({}, process.env, { PUZZLESCRIPT_SOLVER_STEP_PROFILE: '1' }),
        },
    ));
    assert.ok(profiledAction.results[0].step_profile_early_rules_ms > 0, 'step profiler should time early rules');
    assert.ok(profiledAction.results[0].step_profile_movement_ms > 0, 'step profiler should time movement resolution');
    assert.ok(profiledAction.results[0].step_profile_command_ms > 0, 'step profiler should time command queue processing');

    const mlJson = execFileSync(
        process.execPath,
        [
            runner,
            corpusDir,
            '--game',
            'multi_level.txt',
            '--quiet',
            '--no-solutions',
            '--solver-optimize-static',
            '--json',
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    const mlPayload = JSON.parse(mlJson);
    const mlLevels = mlPayload.results.filter(r => r.game === 'multi_level.txt' && r.level >= 0);
    assert.ok(mlLevels.length >= 2, 'multi_level fixture should yield 2+ level rows');
    const rowsWithCompileMs = mlLevels.filter(r => (r.compile_ms || 0) > 0);
    assert.strictEqual(
        rowsWithCompileMs.length,
        1,
        'per-game compile_ms should appear on first level row only (totals aggregation)',
    );
    const tMl = mlPayload.totals;
    assert.strictEqual(tMl.compile_ms, rowsWithCompileMs[0].compile_ms);
    assert.strictEqual(
        tMl.solver_opt_ms_inert + tMl.solver_opt_ms_cosmetic + tMl.solver_opt_ms_merge,
        (rowsWithCompileMs[0].solver_opt_ms_inert || 0)
            + (rowsWithCompileMs[0].solver_opt_ms_cosmetic || 0)
            + (rowsWithCompileMs[0].solver_opt_ms_merge || 0),
    );
    const parityReplayJson = execFileSync(
        process.execPath,
        [
            runner,
            path.join(__dirname, 'solver_tests'),
            '--game',
            'kreiseln.txt',
            '--level',
            '5',
            '--timeout-ms',
            '5000',
            '--strategy',
            'portfolio',
            '--quiet',
            '--no-solutions',
            '--solver-opt',
            'all',
            '--solver-opt-parity',
            '--json',
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    const parityReplayPayload = JSON.parse(parityReplayJson);
    assert.strictEqual(
        parityReplayPayload.results[0].status,
        'solved',
        'solver opt parity should accept replay-valid optimized solutions with different search order',
    );

    process.stdout.write('solver_static_opt_node: ok\n');
}

run();
