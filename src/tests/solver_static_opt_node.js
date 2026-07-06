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
    winRelevanceIrrelevantRuleSourceLines,
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
        { inert: true, cosmetic: false, cosmeticRules: false, merge: false, action: false, winRelevance: false },
    );
    assert.deepStrictEqual(
        effectiveSolverPassesForHook({ status: 'compile_error' }, { inert: true, cosmetic: true, cosmeticRules: true, merge: true }),
        { inert: true, cosmetic: false, cosmeticRules: false, merge: false, action: false, winRelevance: false },
    );
    assert.deepStrictEqual(
        effectiveSolverPassesForHook({ status: 'ok' }, { inert: false, cosmetic: true, cosmeticRules: true, merge: true }),
        { inert: false, cosmetic: true, cosmeticRules: true, merge: true, action: false, winRelevance: false },
    );
    assert.deepStrictEqual(
        effectiveSolverPassesForHook({ status: 'ok' }, { winRelevance: true }),
        { inert: false, cosmetic: false, cosmeticRules: false, merge: false, action: false, winRelevance: true },
    );
    const nest = buildSolverOptimizationJsonTotals({
        static_optimization_removed_rules: 1,
        removed_cosmetic_objects: 0,
        removed_collision_layers: 0,
        removed_cosmetic_rules: 0,
        removed_win_irrelevant_rules: 2,
        merged_object_aliases: 0,
        merged_object_groups: 0,
        solver_opt_ms_inert: 0.01,
        solver_opt_ms_cosmetic: 0,
        solver_opt_ms_cosmetic_rules: 0,
        solver_opt_ms_merge: 0,
        solver_opt_ms_win_relevance: 0.02,
    });
    assert.strictEqual(nest.removed_inert_rules, 1);
    assert.strictEqual(nest.removed_win_irrelevant_rules, 2);
    assert.ok(nest.ms_hook > 0);

    const nestGated = buildSolverOptimizationJsonTotals({
        static_optimization_removed_rules: 0,
        removed_cosmetic_objects: 0,
        removed_collision_layers: 0,
        removed_cosmetic_rules: 0,
        removed_win_irrelevant_rules: 0,
        merged_object_aliases: 0,
        merged_object_groups: 0,
        solver_opt_ms_inert: 0,
        solver_opt_ms_cosmetic: 0,
        solver_opt_ms_cosmetic_rules: 0,
        solver_opt_ms_merge: 0,
        solver_opt_ms_win_relevance: 0,
        solver_optimization_gated: true,
    });
    assert.strictEqual(nestGated.gated, true);
    assert.ok(formatSolverOptimizationHumanSuffixFromTotals({ solver_optimization_gated: true }).includes('opt_gated=1'));

    assert.deepStrictEqual(parseSolverOptPassList('all'), { inert: true, cosmetic: true, cosmeticRules: true, merge: true, action: true, winRelevance: true });
    assert.deepStrictEqual(parseSolverOptPassList('inert,cosmetic'), { inert: true, cosmetic: true, cosmeticRules: false, merge: false, action: false, winRelevance: false });
    assert.deepStrictEqual(parseSolverOptPassList('cosmetic-rules'), { inert: false, cosmetic: false, cosmeticRules: true, merge: false, action: false, winRelevance: false });
    assert.deepStrictEqual(parseSolverOptPassList('win-relevance'), {
        inert: false,
        cosmetic: false,
        cosmeticRules: false,
        merge: false,
        action: false,
        winRelevance: true,
    });
    assertThrows(() => parseSolverOptPassList('nope'), 'Unknown');

    const winRelevanceReport = {
        status: 'ok',
        facts: {
            win_relevance: [{
                id: 'win_relevance',
                status: 'proved',
                value: {
                    irrelevant_rule_ids: ['early_group_0_rule_1', 'late_group_0_rule_0'],
                },
            }],
        },
        ps_tagged: {
            rule_sections: [
                {
                    groups: [
                        { rules: [{ id: 'early_group_0_rule_0', source_line: 10 }] },
                        { rules: [{ id: 'early_group_0_rule_1', source_line: 11 }] },
                    ],
                },
                {
                    groups: [
                        { rules: [{ id: 'late_group_0_rule_0', source_line: 21 }] },
                    ],
                },
            ],
        },
    };
    assert.deepStrictEqual(
        Array.from(winRelevanceIrrelevantRuleSourceLines(winRelevanceReport)).sort((left, right) => left - right),
        [11, 21],
        'win-relevance pass should resolve irrelevant rule ids to source lines',
    );
    assert.deepStrictEqual(
        Array.from(winRelevanceIrrelevantRuleSourceLines({
            status: 'ok',
            facts: { win_relevance: [{ id: 'win_relevance', status: 'candidate', value: { irrelevant_rule_ids: ['x'] } }] },
            ps_tagged: { rule_sections: [{ groups: [{ rules: [{ id: 'x', source_line: 9 }] }] }] },
        })),
        [],
        'win-relevance pass should only consume proved facts',
    );

    const winRelevanceState = {
        invalid: 0,
        rules: [
            { lineNumber: 10 },
            { lineNumber: 11 },
            { lineNumber: 12, randomRule: true },
        ],
        lateRules: [
            { lineNumber: 21 },
            { lineNumber: 22 },
        ],
    };
    createSolverOptimizationHook(winRelevanceReport, { winRelevance: true })(winRelevanceState);
    assert.deepStrictEqual(
        winRelevanceState.rules.map(rule => rule.lineNumber),
        [10, 12],
        'win-relevance pass should drop irrelevant early rules by source line',
    );
    assert.deepStrictEqual(
        winRelevanceState.lateRules.map(rule => rule.lineNumber),
        [22],
        'win-relevance pass should drop irrelevant late rules by source line',
    );
    assert.strictEqual(
        winRelevanceState.solverOptimizationTelemetry.removed_win_irrelevant_rules,
        2,
    );

    const actionReport = {
        status: 'ok',
        facts: {
            movement_action: [{ id: 'action_unnecessary', status: 'proved' }],
        },
    };
    const actionState = { invalid: 0, metadata: [] };
    createSolverOptimizationHook(actionReport, { action: true })(actionState);
    assert.ok(actionState.metadata.includes('noaction'), 'action pass should insert noaction metadata when action_unnecessary is proved');
    assert.strictEqual(actionState.solverOptimizationTelemetry.inserted_noaction_metadata, 1);

    const actionUnnecessaryReport = {
        status: 'ok',
        facts: {
            movement_action: [{
                id: 'action_unnecessary',
                status: 'proved',
                proof: ['action_effects_covered_by_directional_inputs'],
            }],
        },
    };
    const solverActionState = { invalid: 0, metadata: [] };
    createSolverOptimizationHook(actionUnnecessaryReport, { action: true })(solverActionState);
    assert.ok(
        solverActionState.metadata.includes('noaction'),
        'solver action pass should insert noaction when action is unnecessary even if it has a direction-covered effect',
    );

    const gameActionState = { invalid: 0, metadata: [] };
    createSolverOptimizationHook(actionUnnecessaryReport, { action: true }, { actionNoactionMode: 'game' })(gameActionState);
    assert.ok(
        !gameActionState.metadata.includes('noaction'),
        'game action pass should not insert noaction when action has a direction-covered effect',
    );

    const rejectedActionState = { invalid: 0, metadata: [] };
    createSolverOptimizationHook({
        status: 'ok',
        facts: { movement_action: [{ id: 'action_unnecessary', status: 'rejected' }] },
    }, { action: true })(rejectedActionState);
    assert.ok(!rejectedActionState.metadata.includes('noaction'), 'action pass should not insert noaction when action_unnecessary is rejected');

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
                objects_erased: [],
                movements_written: ['Dust:randomdir'],
                movements_removed: ['Dust:stationary'],
            },
            summary: {
                semantic_commands: [],
                rhs_random_objects: [],
                rhs_movement: [{ movement: 'randomdir', expanded_objects: ['Dust'] }],
            },
        }, cosmeticNames),
        false,
        'randomdir movement consumes randomness and is not cosmetic-rule safe',
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
    const againCosmeticReport = {
        ps_tagged: {
            game: { tags: { has_again: true } },
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
                            has_again: false,
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
                ],
            }],
        },
    };
    assert.deepStrictEqual(
        Array.from(cosmeticRuleSourceLines(againCosmeticReport)),
        [],
        'do not remove cosmetic rules in games with again-driven fixpoint timing',
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
    assert.deepStrictEqual(baseline, { inert: false, cosmetic: false, cosmeticRules: false, merge: false, action: false, winRelevance: false });

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

    const mergeSynonymPropertySource = `
title Solver Static Merge Synonym Property

========
OBJECTS
========

background
black

Player
blue

KK
red

IK
green

OK
yellow

SK
white

========
LEGEND
========

. = background
P = Player
K = KK
I = IK
O = OK
S = SK
Kioski = K or O or I or S

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

background
KK, IK, OK, SK
Player

======
RULES
======

[ Player Kioski ] -> win

==============
WINCONDITIONS
==============

=======
LEVELS
=======

PI
`;
    const mergeSynonymReport = analyzeSource(mergeSynonymPropertySource, { sourcePath: 'solver_static_merge_synonym_property.txt' });
    assert.strictEqual(mergeSynonymReport.status, 'ok');
    const mergeSynonymHook = createSolverOptimizationHook(mergeSynonymReport, {
        inert: false,
        cosmetic: false,
        cosmeticRules: false,
        merge: true,
    });
    setPluginOptimizationHook(mergeSynonymHook);
    try {
        compile(['loadLevel', 0], mergeSynonymPropertySource, 'solver_static_merge_synonym_property');
    } finally {
        setPluginOptimizationHook(null);
    }
    assert.strictEqual(errorCount, 0, 'merge pass should preserve synonym-backed OR properties used by rules');
    assert.ok(
        state.solverOptimizationTelemetry.merged_object_aliases > 0,
        'fixture should exercise a merge alias',
    );
    assert.ok(
        state.propertiesDict && Object.prototype.hasOwnProperty.call(state.propertiesDict, 'kioski'),
        'merged synonym-backed property should remain resolvable',
    );

    const mergeRepeatedAggregateMovementSource = `
title Solver Static Merge Repeated Aggregate Movement

========
OBJECTS
========

background
black

Player
blue

Avatar
white

MarkerA
red

MarkerB
green

========
LEGEND
========

. = background
P = Player and Avatar
a = MarkerA
b = MarkerB
Marker = MarkerA or MarkerB

========
SOUNDS
========

================
COLLISIONLAYERS
================

background
Player
MarkerA, MarkerB
Avatar

======
RULES
======

[ Marker ] -> [ Marker ]
[ moving Player Avatar ] -> [ moving Player moving Avatar ]

=============
WINCONDITIONS
=============

some Marker on background

=======
LEVELS
=======

.P.
.ab
`;
    const mergeRepeatedAggregateReport = analyzeSource(mergeRepeatedAggregateMovementSource, {
        sourcePath: 'solver_static_merge_repeated_aggregate_movement.txt',
    });
    assert.strictEqual(mergeRepeatedAggregateReport.status, 'ok');
    const mergeRepeatedAggregateHook = createSolverOptimizationHook(mergeRepeatedAggregateReport, {
        inert: false,
        cosmetic: false,
        cosmeticRules: false,
        merge: true,
    });
    setPluginOptimizationHook(mergeRepeatedAggregateHook);
    try {
        compile(['loadLevel', 0], mergeRepeatedAggregateMovementSource, 'solver_static_merge_repeated_aggregate_movement');
    } finally {
        setPluginOptimizationHook(null);
    }
    assert.strictEqual(errorCount, 0, 'merge pass should preserve repeated aggregate movement rules');
    assert.ok(
        state.solverOptimizationTelemetry.merged_object_aliases > 0,
        'fixture should exercise the merge rebuild path',
    );
    processInput(1);
    const playerObject = state.objects.player;
    const avatarObject = state.objects.avatar;
    const movedCell = level.getCell(0);
    assert.ok(movedCell.get(playerObject.id), 'optimized player should move left');
    assert.ok(movedCell.get(avatarObject.id), 'optimized avatar should inherit the player movement');

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
    assert.ok(actionOptimized.results[0].generated < actionBaseline.results[0].generated, 'action-unnecessary static pass should prune solver action branches');
    assert.strictEqual(actionOptimized.results[0].inserted_noaction_metadata, 1);

    const actionForcedNoaction = JSON.parse(execFileSync(
        process.execPath,
        [
            runner,
            corpusDir,
            '--game',
            'push_goal.txt',
            '--quiet',
            '--no-solutions',
            '--force-noaction',
            '--json',
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ));
    assert.strictEqual(actionForcedNoaction.results[0].status, 'solved');
    assert.strictEqual(actionBaseline.results[0].solution_length, actionForcedNoaction.results[0].solution_length);

    const winRelevancePayload = JSON.parse(execFileSync(
        process.execPath,
        [
            runner,
            path.join(__dirname, 'static_analysis_testdata', 'win_relevance'),
            '--game',
            'win-relevance-direct.txt',
            '--timeout-ms',
            '1000',
            '--quiet',
            '--no-solutions',
            '--solver-opt',
            'win-relevance',
            '--solver-opt-parity',
            '--json',
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ));
    assert.strictEqual(
        winRelevancePayload.results[0].removed_win_irrelevant_rules,
        1,
        'win-relevance solver opt should remove the irrelevant fixture rule',
    );
    assert.strictEqual(
        winRelevancePayload.totals.solver_optimization.removed_win_irrelevant_rules,
        1,
        'win-relevance removals should appear in nested solver optimization totals',
    );

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
    assert.ok(profiledAction.results[0].step_profile_rule_match_ms > 0, 'step profiler should time rule matching');
    assert.ok(profiledAction.totals.heuristic_score_ms > 0, 'heuristic score timing should be recorded');
    assert.ok(Number.isFinite(profiledAction.totals.expanded_per_solved), 'expanded_per_solved should be present');

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
