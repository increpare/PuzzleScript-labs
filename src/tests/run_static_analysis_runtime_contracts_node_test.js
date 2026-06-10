#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    ensureRuntimeLoaded,
    runSimulationWithStaticChecks,
} = require('./run_static_analysis_runtime_contracts_node');

ensureRuntimeLoaded();

function loadStaticAnalysisFixtureSource(...parts) {
    return fs.readFileSync(path.join(__dirname, 'static_analysis_testdata', ...parts), 'utf8');
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
    ['tick'],
    'background player:0,background:1,\n',
]);

assert.strictEqual(
    noactionActionRule.actionUnnecessaryProved,
    true,
    'noaction metadata should prove user action input is unnecessary even when action rules exist'
);

const restartBoundarySource = [
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'Pink',
    '',
    'Marker',
    'Yellow',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    'X = Player and Marker',
    '',
    '======',
    'SOUNDS',
    '======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    'Marker',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ action Player Marker ] -> [ Player ]',
    '[ action Player no Marker ] -> restart',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    'X',
].join('\n');

const restartBoundary = runSimulationWithStaticChecks('quantity semantic restart boundary', [
    restartBoundarySource,
    [4, 4],
    'background marker player:0,\n',
]);

assert.ok(
    restartBoundary.quantityBoundaryChecks > 0,
    'semantic restart regression should exercise quantity contract checks before restart'
);

const temporaryBoundarySource = [
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'Pink',
    '',
    'Spark',
    'Yellow',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    'P = Player',
    '',
    '======',
    'SOUNDS',
    '======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    'Spark',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ action Player ] -> [ Player Spark ]',
    'late [ Spark ] -> []',
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

const temporaryBoundary = runSimulationWithStaticChecks('temporary boundary', [
    temporaryBoundarySource,
    [4],
    'background player:0,\n',
]);

assert.strictEqual(temporaryBoundary.temporaryObjectCount, 1, 'temporary fixture should have one temporary object');
assert.ok(
    temporaryBoundary.temporaryBoundaryChecks > 0,
    'temporary checks should run for temporary objects'
);

const cosmeticProjectionSource = [
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'Pink',
    '',
    'Goal',
    'Yellow',
    '',
    'Sparkle',
    'Blue',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    'P = Player',
    'G = Goal',
    'S = Sparkle',
    '',
    '======',
    'SOUNDS',
    '======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    'Goal',
    'Sparkle',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ right Player | Goal ] -> [ | Player ]',
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
    'PSG',
].join('\n');

const cosmeticProjection = runSimulationWithStaticChecks('cosmetic projection', [
    cosmeticProjectionSource,
    [3],
    'background:0,background player sparkle:1,background goal:2,\n',
]);

assert.strictEqual(cosmeticProjection.cosmeticObjectCount, 1, 'cosmetic fixture should have one cosmetic object');
assert.strictEqual(
    cosmeticProjection.cosmeticProjectionChecks,
    1,
    'cosmetic checks should compare final projected replay states'
);

const neverAppearsSource = [
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'Pink',
    '',
    'Unused',
    'Blue',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    'P = Player',
    '. = Background',
    '',
    '======',
    'SOUNDS',
    '======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    'Unused',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ > Player ] -> [ > Player ]',
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
    'P..',
].join('\n');

const neverAppears = runSimulationWithStaticChecks('never appears', [
    neverAppearsSource,
    [3],
    'background:0,background player:1,0,\n',
]);

assert.strictEqual(neverAppears.neverAppearsObjectCount, 1, 'never-appears fixture should have one never-appearing object');
assert.ok(
    neverAppears.neverAppearsBoundaryChecks > 0,
    'never-appears checks should run for absent uncreated objects'
);

const cosmeticRuleProjectionSource = [
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'Pink',
    '',
    'Goal',
    'Yellow',
    '',
    'Trail',
    'Blue',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    'P = Player',
    'G = Goal',
    '',
    '======',
    'SOUNDS',
    '======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    'Goal',
    'Trail',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ Player ] -> [ Player Trail ]',
    '[ right Player | Goal ] -> [ | Player ]',
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
    'PG',
].join('\n');

const cosmeticRuleProjection = runSimulationWithStaticChecks('cosmetic rule projection', [
    cosmeticRuleProjectionSource,
    [3],
    'background trail:0,background player:1,\n',
]);

assert.ok(
    cosmeticRuleProjection.cosmeticRuleCount > 0,
    'cosmetic rule fixture should have at least one cosmetic rule'
);
assert.strictEqual(
    cosmeticRuleProjection.cosmeticRuleProjectionChecks,
    1,
    'cosmetic rule checks should compare final projections after suppressing cosmetic rules'
);

const inertCommandRuleSource = [
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'Pink',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    'P = Player',
    '',
    '======',
    'SOUNDS',
    '======',
    '',
    'sfx0 123',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Player',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ Player ] -> [ Player ] sfx0',
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
    'P.',
].join('\n');

const inertCommandRule = runSimulationWithStaticChecks('inert command rule', [
    inertCommandRuleSource,
    [3],
    'background:0,background player:1,\n',
]);

assert.ok(
    inertCommandRule.inertCommandRuleCount > 0,
    'inert command fixture should have at least one inert command-only rule'
);
assert.strictEqual(
    inertCommandRule.inertCommandRuleSuppressionChecks,
    1,
    'inert command checks should compare final solver state after suppressing inert command-only rules'
);

const winflowCacheSource = [
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Player',
    'Yellow',
    '',
    'Crate',
    'Red',
    '',
    'Goal',
    'Green',
    '',
    'Marker',
    'Blue',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    'P = Player',
    'C = Crate',
    'G = Goal',
    'M = Marker',
    '',
    '======',
    'SOUNDS',
    '======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Goal, Marker',
    'Player',
    'Crate',
    '',
    '======',
    'RULES',
    '======',
    '',
    'right [ Crate | no Goal ] -> [ | Crate ]',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    'No Marker',
    'All Crate On Goal',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    'PC.GM',
].join('\n');

const winflowCache = runSimulationWithStaticChecks('winflow cache', [
    winflowCacheSource,
    ['tick'],
    'background player:0,background:1,background crate:2,background goal:3,background marker:4,\n',
]);

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

const mergeProjectionSource = [
    '========',
    'OBJECTS',
    '========',
    '',
    'Background',
    'Black',
    '',
    'Alpha',
    'Red',
    '',
    'Beta',
    'Blue',
    '',
    'Player',
    'Yellow',
    '',
    '=======',
    'LEGEND',
    '=======',
    '',
    '. = Background',
    'P = Player',
    'a = Alpha',
    'b = Beta',
    '',
    '======',
    'SOUNDS',
    '======',
    '',
    '================',
    'COLLISIONLAYERS',
    '================',
    '',
    'Background',
    'Alpha, Beta',
    'Player',
    '',
    '======',
    'RULES',
    '======',
    '',
    '[ no Alpha no Beta ] -> [ no Alpha no Beta ] win',
    '',
    '==============',
    'WINCONDITIONS',
    '==============',
    '',
    '=======',
    'LEVELS',
    '=======',
    '',
    'Pab',
].join('\n');

const mergeProjection = runSimulationWithStaticChecks('merge projection', [
    mergeProjectionSource,
    [3],
    'background:0,alpha background player:1,background beta:2,\n',
]);

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
