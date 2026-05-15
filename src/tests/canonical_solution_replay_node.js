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

const ACTION_WIN_SOURCE = `
title Canonical Action Win Fixture

========
OBJECTS
========

Background
black

Player
blue

=======
LEGEND
=======

. = Background
P = Player

======
SOUNDS
======

================
COLLISIONLAYERS
================

Background
Player

=====
RULES
=====

[ action Player ] -> [ Player ] win

=============
WINCONDITIONS
=============

======
LEVELS
======

P

P
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

const actionSolved = replaySolutionOnOriginal({
    source: ACTION_WIN_SOURCE,
    game: 'action-win-fixture.txt',
    level: 0,
    solution: ['action'],
});
assert.strictEqual(actionSolved.status, 'solved', 'action win command should solve without changing the board');
assert.strictEqual(actionSolved.steps, 1);

console.log('canonical_solution_replay_node: ok');
