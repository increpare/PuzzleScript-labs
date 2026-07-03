#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');

const {
    __solverSearchInternals,
} = require('./run_solver_tests_js');

const {
    computePushSpaceReachability,
    createPushSpaceBlockingWords,
} = __solverSearchInternals;

const width = 4;
const height = 3;
const playerLayerWords = new Int32Array([0b10]);
const objects = new Int32Array(width * height);

function tile(x, y) {
    return x * height + y;
}

objects[tile(0, 1)] = 0b10; // player
objects[tile(1, 0)] = 0b10; // wall on the player's collision layer
objects[tile(1, 1)] = 0b10; // wall on the player's collision layer
objects[tile(1, 2)] = 0b10; // wall on the player's collision layer
objects[tile(3, 2)] = 0b100; // object on another layer; should not block walking

const reachable = computePushSpaceReachability({
    objects,
    width,
    height,
    stride: 1,
    startTiles: [tile(0, 1)],
    blockingLayerWords: playerLayerWords,
});

assert.strictEqual(reachable.reachable[tile(0, 0)], 1);
assert.strictEqual(reachable.reachable[tile(0, 1)], 1);
assert.strictEqual(reachable.reachable[tile(0, 2)], 1);
assert.strictEqual(reachable.reachable[tile(2, 1)], 0, 'wall column should block the right side');
assert.strictEqual(reachable.reachable[tile(3, 2)], 0, 'other-layer object is still unreachable behind the wall');
assert.deepStrictEqual(reachable.pathTo(tile(0, 0)), ['up']);
assert.deepStrictEqual(reachable.pathTo(tile(0, 2)), ['down']);
assert.strictEqual(reachable.pathTo(tile(2, 1)), null);

const openObjects = new Int32Array(width * height);
openObjects[tile(0, 1)] = 0b10;
openObjects[tile(3, 2)] = 0b100;
const open = computePushSpaceReachability({
    objects: openObjects,
    width,
    height,
    stride: 1,
    startTiles: [tile(0, 1)],
    blockingLayerWords: playerLayerWords,
});

assert.strictEqual(open.reachable[tile(3, 2)], 1, 'other-layer objects do not block player walking');
assert.deepStrictEqual(open.pathTo(tile(3, 2)), ['right', 'right', 'right', 'down']);

function mask(word) {
    return { data: new Int32Array([word]) };
}

const blockerWords = createPushSpaceBlockingWords({
    objectMasks: { "\nall\n": mask(0b1111) },
    layerMasks: [
        mask(0b0001), // background
        mask(0b1000), // target/floor marker
        mask(0b0010), // player
        mask(0b0100), // crate
    ],
    backgroundlayer: 0,
    playerMask: [null, mask(0b0010)],
    winconditions: [
        [1, mask(0b1000), mask(0b0100), 0, false, false], // all target on crate
        [1, mask(0b0100), mask(0b1000), 0, false, false], // all crate on target
    ],
    rules: [
        [{ writeMovements: { data: new Int32Array([0x1f << (5 * 3)]) } }],
    ],
}, 1);

assert.strictEqual(blockerWords[0], 0b0100, 'moving crate layer should remain blocking while static target floor is walkable');

const solverPath = path.join(__dirname, 'run_solver_tests_js.js');
const corpusPath = path.join(__dirname, 'solver_smoke_tests');
const pushSpace = spawnSync(process.execPath, [
    solverPath,
    corpusPath,
    '--game',
    'push_goal.txt',
    '--level',
    '0',
    '--strategy',
    'push-space',
    '--timeout-ms',
    '1000',
    '--quiet',
    '--json',
    '--no-solutions',
], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf8',
});

assert.strictEqual(pushSpace.status, 0, pushSpace.stderr || pushSpace.stdout);
const parsed = JSON.parse(pushSpace.stdout);
assert.strictEqual(parsed.results.length, 1);
assert.strictEqual(parsed.results[0].status, 'solved');
assert.deepStrictEqual(parsed.results[0].solution, ['right', 'right']);
assert.strictEqual(parsed.results[0].strategy, 'push-space');
assert.strictEqual(parsed.results[0].push_depth, 1);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-push-space-'));
const reversedWinconditionGame = path.join(tmpDir, 'target_on_crate.txt');
fs.writeFileSync(reversedWinconditionGame, `title Push Space Target On Crate

========
OBJECTS
========

Background
black

Player
blue

Crate
orange

Target
green

=======
LEGEND
=======

. = Background
P = Player and Background
C = Crate and Background
T = Target and Background

========
SOUNDS
========

================
COLLISIONLAYERS
================

Background
Target
Player
Crate

======
RULES
======

[ > Player | Crate ] -> [ > Player | > Crate ]

=============
WINCONDITIONS
=============

all Target on Crate

======
LEVELS
======

P.CT
`);

const reversedPushSpace = spawnSync(process.execPath, [
    solverPath,
    tmpDir,
    '--game',
    'target_on_crate.txt',
    '--level',
    '0',
    '--strategy',
    'push-space',
    '--timeout-ms',
    '1000',
    '--quiet',
    '--json',
    '--no-solutions',
], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf8',
});

assert.strictEqual(reversedPushSpace.status, 0, reversedPushSpace.stderr || reversedPushSpace.stdout);
const reversedParsed = JSON.parse(reversedPushSpace.stdout);
assert.strictEqual(reversedParsed.results.length, 1);
assert.strictEqual(reversedParsed.results[0].status, 'solved');
assert.deepStrictEqual(reversedParsed.results[0].solution, ['right', 'right']);
assert.strictEqual(reversedParsed.results[0].strategy, 'push-space');

console.log('solver_push_space_node passed');
