#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    formatReplayFailure,
    loadPuzzleScriptRuntime,
    replaySolutionOnOriginal,
} = require('./run_canonical_solution_replay');

const SIMPLE_SOURCE = `
title Canonical Replay Fixture

========
OBJECTS
========

Background
black

Player
blue

Goal
green

=======
LEGEND
=======

. = Background
P = Player
G = Goal

======
SOUNDS
======

================
COLLISIONLAYERS
================

Background
Goal
Player

=====
RULES
=====

=============
WINCONDITIONS
=============

All Player on Goal

======
LEVELS
======

PG
`;

loadPuzzleScriptRuntime();

const solved = replaySolutionOnOriginal({
    source: SIMPLE_SOURCE,
    game: 'fixture.txt',
    level: 0,
    solution: ['right'],
});
assert.strictEqual(solved.status, 'solved', 'right should solve the fixture');
assert.strictEqual(solved.steps, 1);

const notSolved = replaySolutionOnOriginal({
    source: SIMPLE_SOURCE,
    game: 'fixture.txt',
    level: 0,
    solution: ['left'],
});
assert.strictEqual(notSolved.status, 'not_solved', 'left should not solve the fixture');
assert.ok(formatReplayFailure(notSolved).includes('fixture.txt level=0'));
assert.ok(formatReplayFailure(notSolved).includes('left'));

console.log('canonical_solution_replay_node: ok');
