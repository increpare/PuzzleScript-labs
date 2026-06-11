#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    buildComparisonHashes,
    canonicalizeSource,
    compileSemanticSource,
    hashCanonical,
} = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');
const psStaticAnalysis = require('./ps_static_analysis');

const fixtureDir = path.join(__dirname, 'canonicalizer_testdata');

function loadCanonicalizerFixture(filename) {
    return fs.readFileSync(path.join(fixtureDir, filename), 'utf8');
}

const baseGame = `
title Base
author Test

========
OBJECTS
========

Background
black
00000
00000
00000
00000
00000

Hero
blue
00000
00000
00000
00000
00000

Goal
yellow
00000
00000
00000
00000
00000

=======
LEGEND
=======

. = Background
P = Hero
G = Goal
Player = Hero

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Hero, Goal

=====
RULES
=====

[ > Hero ] -> [ > Hero ]

=============
WINCONDITIONS
=============

All Hero on Goal

======
LEVELS
======

P.G
...
...
`;

const compiledBase = compileSemanticSource(baseGame);
assert.strictEqual(compiledBase.errorCount, 0, 'compileSemanticSource should compile valid source');
assert.ok(compiledBase.state, 'compileSemanticSource should return compiled state');
assert.ok(compiledBase.state.objects.hero, 'compiled state should expose normalized compiler object names');
assert.strictEqual(compiledBase.state.original_case_names.hero, 'Hero', 'compiled state should retain original object casing');
assert.ok(Array.isArray(compiledBase.state.rules), 'compiled state should expose processed rules');
assert.ok(compiledBase.state.rules.some(rule => rule.lineNumber), 'compiled rules should retain source line numbers');
assert.ok(Array.isArray(compiledBase.state.winconditions), 'compiled state should expose processed win conditions');

const renamedAndReskinned = `
(comment)
title Something Else
author Someone Else

========
OBJECTS
========

Bg
white
00000
00000
00000
00000
00000

Avatar
red
00000
00000
00000
00000
00000

Exit
green
00000
00000
00000
00000
00000

=======
LEGEND
=======

. = Bg
P = Avatar
G = Exit
Player = Avatar

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Bg
Avatar, Exit

=====
RULES
=====

[ > Avatar ] -> [ > Avatar ]

=============
WINCONDITIONS
=============

All Avatar on Exit

======
LEVELS
======

P.G
...
...
`;

const differentLevels = `
title Base

========
OBJECTS
========

Background
black
00000
00000
00000
00000
00000

Hero
blue
00000
00000
00000
00000
00000

Goal
yellow
00000
00000
00000
00000
00000

=======
LEGEND
=======

. = Background
P = Hero
G = Goal
Player = Hero

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Hero, Goal

=====
RULES
=====

[ > Hero ] -> [ > Hero ]

=============
WINCONDITIONS
=============

All Hero on Goal

======
LEVELS
======

PG.
...
...
`;

const reorderedObjects = `
title Base

========
OBJECTS
========

Goal
yellow
00000
00000
00000
00000
00000

Background
black
00000
00000
00000
00000
00000

Hero
blue
00000
00000
00000
00000
00000

=======
LEGEND
=======

. = Background
P = Hero
G = Goal
Player = Hero

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Hero, Goal

=====
RULES
=====

[ > Hero ] -> [ > Hero ]

=============
WINCONDITIONS
=============

All Hero on Goal

======
LEVELS
======

P.G
...
...
`;

const structuralBase = canonicalizeSource(baseGame, 'structural');
const structuralVariant = canonicalizeSource(renamedAndReskinned, 'structural');
assert.deepStrictEqual(structuralVariant, structuralBase, 'structural mode should ignore object naming and visuals');

const structuralBaseHash = hashCanonical(structuralBase);
const structuralDifferentLevelsHash = hashCanonical(canonicalizeSource(differentLevels, 'structural'));
assert.notStrictEqual(structuralBaseHash, structuralDifferentLevelsHash, 'structural mode should keep level differences');

const noLevelsBaseHash = hashCanonical(canonicalizeSource(baseGame, 'no-levels'));
const noLevelsDifferentHash = hashCanonical(canonicalizeSource(differentLevels, 'no-levels'));
assert.strictEqual(noLevelsBaseHash, noLevelsDifferentHash, 'no-levels mode should ignore level changes');

const hashes = buildComparisonHashes(baseGame);
assert.ok(hashes.full && hashes.structural && hashes['no-levels'] && hashes.mechanics && hashes.ruleset && hashes.semantic && hashes.family, 'comparison hashes should expose all modes');

const rulesetBaseHash = hashCanonical(canonicalizeSource(baseGame, 'ruleset'));
const rulesetDifferentHash = hashCanonical(canonicalizeSource(differentLevels, 'ruleset'));
assert.strictEqual(rulesetBaseHash, rulesetDifferentHash, 'ruleset mode should ignore map differences');

const semanticBaseHash = hashCanonical(canonicalizeSource(baseGame, 'semantic'));
const semanticDifferentHash = hashCanonical(canonicalizeSource(differentLevels, 'semantic'));
assert.notStrictEqual(semanticBaseHash, semanticDifferentHash, 'semantic mode should include per-cell map contents');

const semanticBase = canonicalizeSource(baseGame, 'semantic');
assert.deepStrictEqual(semanticBase.playerObjects, ['obj_0'], 'semantic mode should preserve canonical player objects after pruning inert layers');
assert.deepStrictEqual(semanticBase.backgroundObjects, [], 'semantic mode should drop inert background-only layers');
assert.deepStrictEqual(semanticBase.collisionLayers, [['obj_0', 'obj_1']], 'semantic mode should merge/prune inert objects at the collision-layer level by default');
assert.ok(
    semanticBase.rules.every(rule => rule.commands.every(command => !/^sfx(?:10|[0-9])$/.test(command[0]))),
    'semantic mode should discard sfxN commands'
);

const semanticReordered = canonicalizeSource(reorderedObjects, 'semantic');
assert.deepStrictEqual(semanticReordered, semanticBase, 'semantic mode should ignore object declaration order');

const perpendicularSource = loadCanonicalizerFixture('perpendicular-round-trip.puzzlescript');

const perpendicularCanonical = canonicalizeSource(perpendicularSource, 'semantic');
const perpendicularRehydrated = decanonicalizeSemantic(perpendicularCanonical);
assert.ok(!/\b(?:horizontal|vertical)_(?:par|perp)\b/.test(perpendicularRehydrated), 'decanonicalized rules should not emit internal relative direction markers');
const perpendicularRecompiled = compileSemanticSource(perpendicularRehydrated, { throwOnError: false });
assert.strictEqual(perpendicularRecompiled.errorCount, 0, 'decanonicalized perpendicular rules should compile as source');

const familySource = loadCanonicalizerFixture('family-distinct-rule-objects.puzzlescript');

const familyCanonical = canonicalizeSource(familySource, 'family');
assert.strictEqual(familyCanonical.format, 'puzzlescript-family-canonical-v1', 'family mode should expose the family format');
assert.deepStrictEqual(familyCanonical.collisionLayers, [['fam_0', 'fam_1', 'fam_2']], 'family mode should keep rule-mentioned objects distinct while dropping inert background-only layers');
assert.strictEqual(familyCanonical.rules.length, 8, 'family mode should preserve distinct compiled rules for distinct rule-mentioned objects');
assert.deepStrictEqual(familyCanonical.playerObjects, ['fam_0'], 'family mode should preserve player role after family relabeling');

const inertLayerSource = loadCanonicalizerFixture('family-prune-inert-layer.puzzlescript');

const inertLayerCanonical = canonicalizeSource(inertLayerSource, 'family');
assert.deepStrictEqual(inertLayerCanonical.collisionLayers, [['fam_0', 'fam_1']], 'family mode should remove layers with no player or rule-mentioned objects');
assert.deepStrictEqual(
    Array.from(new Set(inertLayerCanonical.rules.flatMap(rule =>
        rule.lhs.flatMap(row => row.flatMap(cell => cell.flatMap(entry => entry.obj ? [entry.obj] : (entry.objs || []))))
    ))).sort(),
    ['fam_0', 'fam_1'],
    'family mode should keep surviving rule-mentioned objects intact when pruning inert layers'
);

const inertMergeSource = loadCanonicalizerFixture('family-merge-inert-objects.puzzlescript');

const inertMergeCanonical = canonicalizeSource(inertMergeSource, 'family');
assert.deepStrictEqual(inertMergeCanonical.collisionLayers, [['fam_0', 'fam_1', 'fam_2']], 'family mode should merge multiple rule-inert non-player objects within a retained layer');

const semanticInertMerge = canonicalizeSource(inertMergeSource, 'semantic');
assert.deepStrictEqual(semanticInertMerge.collisionLayers, [['obj_0', 'obj_1', 'obj_2', 'obj_3']], 'semantic mode should keep win-condition objects distinct while bucketing other rule-inert non-player objects');
assert.strictEqual(JSON.stringify(semanticInertMerge.winConditions), JSON.stringify([{ quantifier: 0, a: ['obj_2'], b: ['obj_0', 'obj_1', 'obj_2', 'obj_3'] }]), 'semantic mode should preserve some-object win conditions through inert bucketing');

const semanticWinOnlyLayerSource = loadCanonicalizerFixture('semantic-retain-win-only-layer.puzzlescript');

const semanticWinOnlyLayer = canonicalizeSource(semanticWinOnlyLayerSource, 'semantic');
assert.deepStrictEqual(
    semanticWinOnlyLayer.collisionLayers,
    [['obj_0'], ['obj_1', 'obj_2']],
    'semantic mode should retain win-condition-only layers during object collapse'
);
assert.strictEqual(
    JSON.stringify(semanticWinOnlyLayer.winConditions),
    JSON.stringify([{ quantifier: 1, a: ['obj_1'], b: ['obj_0'] }]),
    'semantic mode should not alias win-condition targets with retained rule/player objects'
);
assert.deepStrictEqual(
    semanticWinOnlyLayer.levels[0].rows[0],
    [['obj_1'], ['obj_2'], ['obj_0']],
    'semantic mode should preserve win-condition target cells in levels'
);

const inertCommandOptimizationSource = loadCanonicalizerFixture('static-inert-command-rule.puzzlescript');

const inertCommandBaseline = canonicalizeSource(inertCommandOptimizationSource, 'semantic');
const inertCommandOptimized = canonicalizeSource(inertCommandOptimizationSource, 'semantic', {
    staticOptimizations: 'inert',
});
assert.strictEqual(inertCommandBaseline.rules.length, 1, 'baseline semantic canonicalization should retain inert command-only rules after command payload stripping');
assert.strictEqual(inertCommandOptimized.rules.length, 0, 'static optimization should prune inert command-only rules before canonical serialization');

const cosmeticOptimizationSource = loadCanonicalizerFixture('static-cosmetic-cleanup-rule.puzzlescript');

const cosmeticBaseline = canonicalizeSource(cosmeticOptimizationSource, 'semantic');
const cosmeticOptimized = canonicalizeSource(cosmeticOptimizationSource, 'semantic', {
    staticOptimizations: 'cosmetic-rules,cosmetic',
});
assert.strictEqual(cosmeticBaseline.rules.length, 1, 'baseline semantic canonicalization should retain cosmetic cleanup rules');
assert.strictEqual(cosmeticOptimized.rules.length, 0, 'static optimization should prune cosmetic cleanup rules');
assert.deepStrictEqual(cosmeticBaseline.collisionLayers, [['obj_0'], ['obj_1'], ['obj_2']], 'baseline should retain win-condition and rule-mentioned cosmetic layers');
assert.deepStrictEqual(cosmeticOptimized.collisionLayers, [['obj_0'], ['obj_1']], 'static optimization should drop the now-unreferenced cosmetic layer');
assert.deepStrictEqual(cosmeticBaseline.levels[0].rows[0][2], ['obj_2'], 'baseline should still project the cosmetic object into the canonical level');
assert.deepStrictEqual(cosmeticOptimized.levels[0].rows[0][2], [], 'static optimization should remove cosmetic objects from canonical levels');

const mergeOptimizationSource = loadCanonicalizerFixture('static-merge-equivalent-objects.puzzlescript');

const mergeBaseline = canonicalizeSource(mergeOptimizationSource, 'semantic');
const mergeOptimized = canonicalizeSource(mergeOptimizationSource, 'semantic', {
    staticOptimizations: 'merge',
});
assert.deepStrictEqual(mergeBaseline.collisionLayers, [['obj_0', 'obj_1'], ['obj_2']], 'baseline should keep merge candidates distinct when rules mention them directly');
assert.deepStrictEqual(mergeOptimized.collisionLayers, [['obj_0'], ['obj_1']], 'static optimization should fold equivalent object aliases before serialization');
assert.deepStrictEqual(mergeBaseline.levels[0].rows[0], [['obj_2'], ['obj_0'], ['obj_1']], 'baseline should serialize distinct merge-candidate cells');
assert.deepStrictEqual(mergeOptimized.levels[0].rows[0], [['obj_1'], ['obj_0'], ['obj_0']], 'static optimization should rewrite merged object aliases in levels');

function captureStaticAnalysisOptions(fn) {
    const originalAnalyzeSource = psStaticAnalysis.analyzeSource;
    let captured = null;
    psStaticAnalysis.analyzeSource = function patchedAnalyzeSource(source, options) {
        captured = options;
        return originalAnalyzeSource.call(this, source, options);
    };
    try {
        fn();
    } finally {
        psStaticAnalysis.analyzeSource = originalAnalyzeSource;
    }
    return captured;
}

const inertStaticAnalysisOptions = captureStaticAnalysisOptions(() => {
    canonicalizeSource(inertCommandOptimizationSource, 'semantic', {
        staticOptimizations: 'inert',
    });
});
assert.deepStrictEqual(inertStaticAnalysisOptions.familyFilter, [], 'inert static optimization should skip unused static fact families');

const mergeStaticAnalysisOptions = captureStaticAnalysisOptions(() => {
    canonicalizeSource(mergeOptimizationSource, 'semantic', {
        staticOptimizations: 'merge',
    });
});
assert.deepStrictEqual(mergeStaticAnalysisOptions.familyFilter, ['mergeability'], 'merge static optimization should request only mergeability facts');

const actionUnnecessaryOptimizationSource = loadCanonicalizerFixture('static-action-unnecessary.puzzlescript');

const actionBaseline = canonicalizeSource(actionUnnecessaryOptimizationSource, 'semantic');
const actionOptimized = canonicalizeSource(actionUnnecessaryOptimizationSource, 'semantic', {
    staticOptimizations: 'action',
});
assert.strictEqual(actionBaseline.metadata.some(item => item.key === 'noaction'), false, 'baseline canonicalization should not synthesize noaction');
assert.strictEqual(actionOptimized.metadata.some(item => item.key === 'noaction'), true, 'static action optimization should synthesize noaction metadata');

const actionCoveredByDirectionSource = actionUnnecessaryOptimizationSource.replace(
    '=====\nRULES\n=====\n\n',
    '=====\nRULES\n=====\n\n[ action Player ] -> [ right Player ]\n',
);
const actionCoveredByDirectionOptimized = canonicalizeSource(actionCoveredByDirectionSource, 'semantic', {
    staticOptimizations: 'action',
});
assert.strictEqual(
    actionCoveredByDirectionOptimized.metadata.some(item => item.key === 'noaction'),
    false,
    'game-facing static action optimization should not synthesize noaction when action has a direction-covered in-game effect',
);

const actionStaticAnalysisOptions = captureStaticAnalysisOptions(() => {
    canonicalizeSource(actionUnnecessaryOptimizationSource, 'semantic', {
        staticOptimizations: 'action',
    });
});
assert.deepStrictEqual(actionStaticAnalysisOptions.familyFilter, ['movement_action'], 'action static optimization should request only movement_action facts');

function countNumericLocaleCompareCalls(fn) {
    const originalLocaleCompare = String.prototype.localeCompare;
    let count = 0;
    String.prototype.localeCompare = function patchedLocaleCompare(other, locales, options) {
        if (options && options.numeric === true) {
            count++;
        }
        return originalLocaleCompare.call(this, other, locales, options);
    };
    try {
        fn();
    } finally {
        String.prototype.localeCompare = originalLocaleCompare;
    }
    return count;
}

const numericLocaleCompareCalls = countNumericLocaleCompareCalls(() => {
    canonicalizeSource(baseGame, 'semantic');
});
assert.strictEqual(numericLocaleCompareCalls, 0, 'compiled canonicalization should not call per-comparison numeric localeCompare');

console.log('canonicalizer_node: ok');
