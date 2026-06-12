#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    ensureRuntimeLoaded,
    replayFinalSerializedLevel,
    runSimulationWithStaticChecks,
    staticContractForSource,
} = require('./run_static_analysis_runtime_contracts_node');

ensureRuntimeLoaded();

function loadStaticAnalysisFixtureSource(...parts) {
    return fs.readFileSync(path.join(__dirname, 'static_analysis_testdata', ...parts), 'utf8');
}

function loadStaticAnalysisFixtureJson(...parts) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'static_analysis_testdata', ...parts), 'utf8'));
}

function runRuntimeContractFixture(testName, stem) {
    const source = loadStaticAnalysisFixtureSource('runtime_contracts', `${stem}.txt`);
    const payload = loadStaticAnalysisFixtureJson('runtime_contracts', `${stem}.json`);
    return runSimulationWithStaticChecks(testName, [
        source,
        payload.inputs,
        payload.expectedFinalLevel,
        payload.targetLevel === undefined ? 0 : payload.targetLevel,
        payload.randomSeed === undefined ? null : payload.randomSeed,
        payload.expectedSounds === undefined ? null : payload.expectedSounds,
    ]);
}

const sokoban = global.testdata.find(entry => entry[0] === 'sokoban with win condition');
assert.ok(sokoban, 'sokoban fixture should be available');
const autowin = global.testdata.find(entry => entry[0] === 'Autowin');
assert.ok(autowin, 'Autowin fixture should be available');

const result = runSimulationWithStaticChecks(sokoban[0], sokoban[1]);

assert.strictEqual(result.staticObjectCount, 3, 'sokoban should have three static objects');
assert.strictEqual(result.staticLayerCount, 2, 'sokoban should have two static layers');
assert.strictEqual(result.inertLayerCount, 1, 'sokoban should have one inert collision layer');
assert.strictEqual(result.constantQuantityObjectCount, 5, 'sokoban should have five constant-quantity objects');
assert.strictEqual(result.actionUnnecessaryProved, true, 'sokoban should prove action-unnecessary');
assert.strictEqual(result.tickNoopProved, true, 'sokoban should have no autonomous tick rules');
assert.strictEqual(result.noAgainProved, true, 'sokoban should have no AGAIN rules');
assert.strictEqual(result.noRandomProved, true, 'sokoban should have no random rules or random RHS objects');
assert.ok(
    result.quantityBoundaryChecks > result.objectBoundaryChecks,
    'quantity checks should include movable constant-quantity objects'
);
assert.ok(
    result.staticLayerBoundaryChecks > 0,
    'static layer checks should include stable replay boundaries'
);
assert.ok(
    result.inertLayerBoundaryChecks > 0,
    'inert layer checks should include stable replay boundaries'
);
assert.ok(
    result.actionUnnecessaryBoundaryChecks > 0,
    'action-unnecessary checks should probe action at stable replay boundaries'
);
assert.ok(
    result.tickNoopBoundaryChecks > 0,
    'tick-noop checks should probe no-input ticks at stable replay boundaries'
);
assert.ok(
    result.noAgainBoundaryChecks > 0,
    'no-again checks should include replay boundaries'
);
assert.ok(
    result.noRandomReplayChecks > 0,
    'no-random checks should compare replay boundaries under an alternate seed'
);

const initialProbeSource = [
    'title Initial Probe Coverage',
    '',
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'White',
    '',
    'Goal',
    'Yellow',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    'P = Player',
    'G = Goal',
    '',
    '=======',
    'SOUNDS',
    '=======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Goal',
    'Player',
    '',
    '======',
    'RULES',
    '======',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    'Some Player On Goal',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    'P',
].join('\n');
const initialProbeExpected = replayFinalSerializedLevel('initial probe coverage', initialProbeSource, []);
const initialProbe = runSimulationWithStaticChecks('initial probe coverage', [
    initialProbeSource,
    [],
    initialProbeExpected,
]);

assert.strictEqual(initialProbe.actionUnnecessaryProved, true, 'empty fixture should prove action unnecessary');
assert.strictEqual(initialProbe.tickNoopProved, true, 'empty fixture should prove tick noop');
assert.strictEqual(
    initialProbe.actionUnnecessaryBoundaryChecks,
    1,
    'action-unnecessary probes should include the freshly loaded initial boundary'
);
assert.strictEqual(
    initialProbe.tickNoopBoundaryChecks,
    1,
    'tick-noop probes should include the freshly loaded initial boundary'
);

const cosmeticDependencyLines = [
    'title Cosmetic Rule Dependency',
    '',
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'White',
    '',
    'Hole',
    'Gray',
    '',
    'HoleTop',
    'Blue',
    '',
    'HoleTopGrass1',
    'Green',
    '',
    'HoleTopGrass2',
    'LightGreen',
    '',
    'DustSpawn',
    'Red',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    'P = Player',
    'H = Hole',
    'd = DustSpawn',
    'HoleTopGrass = HoleTopGrass1 or HoleTopGrass2',
    '',
    '=======',
    'SOUNDS',
    '=======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    'Hole',
    'HoleTop, HoleTopGrass',
    'DustSpawn',
    '',
    '======',
    'RULES',
    '======',
    '',
    'late up [ Hole | no Hole ] -> [ Hole HoleTop | ]',
    'late up [ HoleTop | DustSpawn ] -> [ random HoleTopGrass | DustSpawn ]',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    'Some Player',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    'PHd',
];
const cosmeticDependencySource = cosmeticDependencyLines.join('\n');
const cosmeticDependencyContract = staticContractForSource(cosmeticDependencySource, 'cosmetic dependency');
const cosmeticWriterLine = cosmeticDependencyLines.indexOf('late up [ Hole | no Hole ] -> [ Hole HoleTop | ]') + 1;
assert.ok(
    !cosmeticDependencyContract.cosmeticRuleSourceLines.includes(cosmeticWriterLine),
    'cosmetic rules whose writes are read by kept rules should not be independently suppressed'
);

const cosmeticWallProjectionSource = [
    'title Cosmetic Wall Projection',
    '',
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'LightGreen',
    '',
    'Wall',
    'Brown',
    '',
    'Sally',
    'Red',
    '',
    'Jad',
    'White',
    '',
    'Player',
    'Yellow',
    '',
    'Love',
    'Pink',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    '# = Wall',
    'S = Sally',
    'J = Jad',
    'P = Player',
    '',
    '=======',
    'SOUNDS',
    '=======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Sally, Wall, Jad',
    'Player',
    'Love',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ Sally | ... | Player ] -> [ > Sally | ... | Player ]',
    '[ Sally | | Jad ] -> [ Sally | Love | Jad ]',
    'right [ > Sally ] [ Jad ] -> [ > Sally ] [ < Jad ]',
    'right [ > Sally | Jad ] -> [ > Sally | > Jad ]',
    'vertical [ > Sally ] [ Jad ] -> [ > Sally ] [ > Jad ]',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    '########',
    '#......#',
    '#..P...#',
    '#.S..J.#',
    '#......#',
    '#......#',
    '########',
].join('\n');
const cosmeticWallProjectionInputs = [
    3, 0, 0, 2, 3, 3, 'restart', 2, 3, 1,
    4, 4, 2, 3, 2, 1, 2, 1, 1, 3,
    2, 0, 2, 4, 1, 2, 4, 0, 2, 4,
];
const cosmeticWallProjectionExpected = replayFinalSerializedLevel(
    'cosmetic wall projection',
    cosmeticWallProjectionSource,
    cosmeticWallProjectionInputs
);
assert.doesNotThrow(() => runSimulationWithStaticChecks('cosmetic wall projection', [
    cosmeticWallProjectionSource,
    cosmeticWallProjectionInputs,
    cosmeticWallProjectionExpected,
]));

const textModeGuardSource = [
    'title Text Mode ProcessInput Guard',
    '',
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'White',
    '',
    'Wall',
    'Gray',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    'P = Player',
    '# = Wall',
    '',
    '=======',
    'SOUNDS',
    '=======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player, Wall',
    '',
    '======',
    'RULES',
    '======',
    '',
    'rigid [ > Player | Wall ] -> [ > Player | > Wall ]',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    'Some Player',
    'No Alias',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    'message hello',
    '',
    'P#.',
].join('\n');

levelString = textModeGuardSource;
compile(['loadLevel', 0], textModeGuardSource, 'text-mode-guard');
assert.strictEqual(textMode, true, 'message level should leave the engine in text mode');
assert.strictEqual(titleScreen, false, 'message level should not be the title screen');
assert.doesNotThrow(() => {
    assert.strictEqual(processInput(3), false, 'processInput should ignore message-level input');
});
assert.strictEqual(textMode, true, 'message-level input should leave text mode untouched');

levelString = textModeGuardSource;
compile(['restart'], textModeGuardSource, 'title-screen-guard');
assert.strictEqual(titleScreen, true, 'restart should leave the title screen showing');
assert.strictEqual(textMode, true, 'title screen is text mode');
assert.doesNotThrow(() => {
    assert.strictEqual(processInput(4), false, 'processInput should ignore title-screen input');
});
assert.strictEqual(titleScreen, true, 'title-screen input should leave the title screen untouched');

const autowinResult = runSimulationWithStaticChecks(autowin[0], autowin[1]);
assert.strictEqual(autowinResult.actionUnnecessaryProved, true, 'Autowin should prove action-unnecessary');
assert.ok(
    autowinResult.actionUnnecessaryBoundaryChecks > 0,
    'action-unnecessary checks should ignore pre-existing message text while probing solver state'
);

const noactionActionRuleSource = loadStaticAnalysisFixtureSource(
    'movement_action',
    'action-noop-noaction-metadata.txt'
);

const noactionActionRule = runSimulationWithStaticChecks('noaction action rule', [
    noactionActionRuleSource,
    ['TICK'],
    'background player:0,background:1,\n',
]);

assert.strictEqual(
    noactionActionRule.actionUnnecessaryProved,
    true,
    'noaction metadata should prove user action input is unnecessary even when action rules exist'
);

const restartBoundary = runRuntimeContractFixture(
    'quantity semantic restart boundary',
    'quantity-semantic-restart-boundary'
);

assert.ok(
    restartBoundary.quantityBoundaryChecks > 0,
    'semantic restart regression should exercise quantity contract checks before restart'
);

const temporaryBoundary = runRuntimeContractFixture('temporary boundary', 'temporary-boundary');

assert.strictEqual(temporaryBoundary.temporaryObjectCount, 1, 'temporary fixture should have one temporary object');
assert.ok(
    temporaryBoundary.temporaryBoundaryChecks > 0,
    'temporary checks should run for temporary objects'
);

const cosmeticProjection = runRuntimeContractFixture('cosmetic projection', 'cosmetic-projection');

assert.strictEqual(cosmeticProjection.cosmeticObjectCount, 1, 'cosmetic fixture should have one cosmetic object');
assert.strictEqual(
    cosmeticProjection.cosmeticProjectionChecks,
    1,
    'cosmetic checks should compare final projected replay states'
);

const neverAppears = runRuntimeContractFixture('never appears', 'never-appears');

assert.strictEqual(neverAppears.neverAppearsObjectCount, 1, 'never-appears fixture should have one never-appearing object');
assert.ok(
    neverAppears.neverAppearsBoundaryChecks > 0,
    'never-appears checks should run for absent uncreated objects'
);

const cosmeticRuleProjection = runRuntimeContractFixture(
    'cosmetic rule projection',
    'cosmetic-rule-projection'
);

assert.ok(
    cosmeticRuleProjection.cosmeticRuleCount > 0,
    'cosmetic rule fixture should have at least one cosmetic rule'
);
assert.strictEqual(
    cosmeticRuleProjection.cosmeticRuleProjectionChecks,
    1,
    'cosmetic rule checks should compare final projections after suppressing cosmetic rules'
);

const inertCommandRule = runRuntimeContractFixture('inert command rule', 'inert-command-rule');

assert.ok(
    inertCommandRule.inertCommandRuleCount > 0,
    'inert command fixture should have at least one inert command-only rule'
);
assert.strictEqual(
    inertCommandRule.inertCommandRuleSuppressionChecks,
    1,
    'inert command checks should compare final solver state after suppressing inert command-only rules'
);

const winflowCache = runRuntimeContractFixture('winflow cache', 'winflow-cache');

assert.strictEqual(
    winflowCache.winflowWinconditionCount,
    2,
    'winflow fixture should expose both winconditions to the runtime contract'
);
assert.strictEqual(
    winflowCache.winflowCleanWinconditionChecks,
    1,
    'winflow checks should keep unrelated winconditions cached across a rule application'
);

const mergeProjection = runRuntimeContractFixture('merge projection', 'merge-projection');

assert.ok(
    mergeProjection.mergeAliasCount > 0,
    'merge fixture should have at least one object alias folded by the optimizer'
);
assert.strictEqual(
    mergeProjection.mergeProjectionChecks,
    1,
    'merge checks should compare final canonical snapshots after optimizer alias folding'
);

const randomFinalParitySkipSource = [
    'title Random Final Parity Skip',
    '',
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'White',
    '',
    'Alpha',
    'Red',
    '',
    'Beta',
    'Blue',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    'P = Player',
    '',
    '=======',
    'SOUNDS',
    '=======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    'Alpha, Beta',
    '',
    '======',
    'RULES',
    '======',
    '',
    'random [ Player ] -> [ Player Alpha ]',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    'Some Player',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    'P',
].join('\n');
const randomFinalParitySkip = runSimulationWithStaticChecks('random final parity skip', [
    randomFinalParitySkipSource,
    [4],
    'intentionally stale expected final level\n',
    0,
    123,
    null,
]);
assert.strictEqual(
    randomFinalParitySkip.noRandomProved,
    false,
    'random fixture should disable final replay parity checks'
);

const randomSolverProjectionSkipSource = [
    'title Random Solver Projection Skip',
    '',
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'White',
    '',
    'AliasA',
    'Red',
    '',
    'AliasB',
    'Blue',
    '',
    'Noise1',
    'Green',
    '',
    'Noise2',
    'Yellow',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    'P = Player',
    'n = Noise1',
    'Alias = AliasA or AliasB',
    '',
    '=======',
    'SOUNDS',
    '=======',
    '',
    'sfx0 123456',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    'AliasA, AliasB',
    'Noise1, Noise2',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ Player ] -> sfx0',
    'random [ Noise1 ] -> [ Noise2 ]',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    'Some Player',
    'No Alias',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    'Pn',
].join('\n');
const randomSolverProjectionSkip = runSimulationWithStaticChecks('random solver projection skip', [
    randomSolverProjectionSkipSource,
    [4],
    'intentionally stale expected final level\n',
    0,
    123,
    null,
]);
assert.strictEqual(
    randomSolverProjectionSkip.noRandomProved,
    false,
    'random solver-projection fixture should not prove no-random'
);
assert.ok(
    randomSolverProjectionSkip.inertCommandRuleCount > 0,
    'random solver-projection fixture should still report inert command-only rules'
);
assert.ok(
    randomSolverProjectionSkip.mergeAliasCount > 0,
    'random solver-projection fixture should still report merge aliases'
);
assert.strictEqual(
    randomSolverProjectionSkip.inertCommandRuleSuppressionChecks,
    0,
    'random games should skip inert-command replay projection checks'
);
assert.strictEqual(
    randomSolverProjectionSkip.mergeProjectionChecks,
    0,
    'random games should skip merge replay projection checks'
);

console.log('run_static_analysis_runtime_contracts_node_test: ok');
