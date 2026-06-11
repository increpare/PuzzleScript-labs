#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');

const {
    runCanonicalizationFuzzCase,
} = require('./fuzz_canonicalization');
const { canonicalizeSource } = require('../canonicalize');

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

const disabledMetaSource = `
title Disabled Meta Inputs
noundo
norestart

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

Marker
red
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
M = Background and Marker

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Player
Marker

=====
RULES
=====

[ action Player ] -> [ Player Marker ]

=============
WINCONDITIONS
=============

Some Player

======
LEVELS
======

P.
`;

assert.deepStrictEqual(
    canonicalizeSource(disabledMetaSource, 'semantic').metadata,
    [
        { key: 'noundo', value: 'true' },
        { key: 'norestart', value: 'true' },
    ],
    'semantic canonicalization should preserve undo/restart-disabling metadata'
);

for (const inputs of [[4, 'undo'], [4, 'restart']]) {
    const disabledMetaResult = runCanonicalizationFuzzCase({
        label: `canonicalization_fuzz_node:disabled-meta:${inputs.join(',')}`,
        source: disabledMetaSource,
        targetLevel: 0,
        randomSeed: 321,
        inputs,
    });
    assert.strictEqual(disabledMetaResult.status, 'ok');
}

const castleClosetSource = fs.readFileSync('src/tests/solver_tests/castlecloset.txt', 'utf8');
const castleClosetMetaResult = runCanonicalizationFuzzCase({
    label: 'canonicalization_fuzz_node:castlecloset-meta',
    source: castleClosetSource,
    targetLevel: 0,
    randomSeed: 36419,
    inputs: ['undo', 4, 0, 'undo', 0],
});
assert.strictEqual(castleClosetMetaResult.status, 'ok');

console.log('canonicalization_fuzz_node: ok');
