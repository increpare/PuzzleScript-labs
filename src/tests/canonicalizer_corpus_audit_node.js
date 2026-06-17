#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    auditCanonicalRoundTrip,
    compileClean,
} = require('./run_canonicalizer_corpus_audit');

const cleanGame = `
title Clean
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

const brokenGame = cleanGame.replace('Player = Hero', '');

assert.strictEqual(compileClean(cleanGame, 'clean').ok, true, 'fixture should compile cleanly');
assert.strictEqual(compileClean(brokenGame, 'broken').ok, false, 'fixture without player should not compile cleanly');

const passResult = auditCanonicalRoundTrip(cleanGame, 'clean');
assert.strictEqual(passResult.outcome, 'passed', 'clean game should pass canonical round-trip audit');

const skipResult = auditCanonicalRoundTrip(brokenGame, 'broken');
assert.strictEqual(skipResult.outcome, 'skipped_original_compile', 'broken game should be skipped');

console.log('canonicalizer_corpus_audit_node: ok');
