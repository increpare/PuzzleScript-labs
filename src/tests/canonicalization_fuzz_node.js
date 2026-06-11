#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    runCanonicalizationFuzzCase,
} = require('./fuzz_canonicalization');

const simpleCanonicalizationSource = `
title Canonicalization Fuzz Fixture

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

Marker
green
00000
00000
00000
00000
00000

=======
LEGEND
=======

. = Background
P = Background and Hero
G = Background and Goal
M = Background and Marker
Player = Hero

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Hero, Goal
Marker

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
.M.
...
`;

const result = runCanonicalizationFuzzCase({
    label: 'canonicalization_fuzz_node:simple',
    source: simpleCanonicalizationSource,
    targetLevel: 0,
    randomSeed: 123,
    inputs: [3, 'tick', 'undo', 3],
});

assert.strictEqual(result.status, 'ok');
assert.strictEqual(result.mismatches.length, 0);
assert.ok(result.snapshotsChecked >= 2, 'should compare the initial and replayed canonical level states');

const duplicateLayerSource = `
title Duplicate Layer Fixture

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

Player
blue
00000
00000
00000
00000
00000

Wall
gray
00000
00000
00000
00000
00000

=======
LEGEND
=======

. = Background
P = Background and Player
W = Background and Wall

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Player, Wall
Wall

=====
RULES
=====

[ > Player | Wall ] -> [ > Player | Wall ]

=============
WINCONDITIONS
=============

No Player

======
LEVELS
======

PW
`;

const duplicateLayerResult = runCanonicalizationFuzzCase({
    label: 'canonicalization_fuzz_node:duplicate-layer',
    source: duplicateLayerSource,
    targetLevel: 0,
    randomSeed: 123,
    inputs: [3],
});

assert.strictEqual(duplicateLayerResult.status, 'skipped');
assert.strictEqual(duplicateLayerResult.reason, 'unrepresentable_duplicate_collision_layers');

console.log('canonicalization_fuzz_node: ok');
