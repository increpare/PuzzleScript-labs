#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    ensureRuntimeLoaded,
    replayFinalSerializedLevel,
    runSimulationWithStaticChecks,
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

console.log('run_static_analysis_runtime_contracts_node_test: ok');
