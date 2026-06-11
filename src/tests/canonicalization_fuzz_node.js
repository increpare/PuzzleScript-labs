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

console.log('canonicalization_fuzz_node: ok');
