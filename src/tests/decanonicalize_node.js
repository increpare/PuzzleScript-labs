#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');

const { canonicalizeSource, compileSemanticSource } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');

const source = fs.readFileSync('src/demo/notsnake.txt', 'utf8');
const canonical = canonicalizeSource(source, 'semantic');
const rehydrated = decanonicalizeSemantic(canonical);
const roundTripped = canonicalizeSource(rehydrated, 'semantic');

assert.deepStrictEqual(roundTripped, canonical, 'decanonicalized source should preserve semantic canonical form');

const optimizedBackgroundSource = `
title Optimized Background

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

const optimizedCanonical = canonicalizeSource(optimizedBackgroundSource, 'semantic', {
    staticOptimizations: 'all',
});
assert.strictEqual(optimizedCanonical.backgroundObjects.length, 0, 'static optimization should project out inert background objects');
const optimizedCanonicalBeforeRehydration = JSON.stringify(optimizedCanonical);
const optimizedRehydrated = decanonicalizeSemantic(optimizedCanonical);
const optimizedCompiled = compileSemanticSource(optimizedRehydrated);
assert.strictEqual(optimizedCompiled.errorCount, 0, 'decanonicalized optimized source should compile with a concrete background');
assert.strictEqual(JSON.stringify(optimizedCanonical), optimizedCanonicalBeforeRehydration, 'decanonicalization should not mutate optimized canonical input');

console.log('decanonicalize_node: ok');
