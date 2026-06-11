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

const loopSource = `
title Loop Preservation

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

Crate
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
C = Background and Crate

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Player, Crate

=====
RULES
=====

startLoop
[ > Player | Crate ] -> [ > Player | > Crate ]
[ > Crate | Crate ] -> [ > Crate | > Crate ]
endLoop

=============
WINCONDITIONS
=============

No Crate

======
LEVELS
======

PCC.
`;

const loopCanonical = canonicalizeSource(loopSource, 'semantic');
assert.deepStrictEqual(loopCanonical.loops, [{ startGroup: 0, endGroup: 1 }], 'semantic canonicalization should preserve loop group ranges');
const loopRehydrated = decanonicalizeSemantic(loopCanonical);
assert.ok(/\bstartLoop\b/.test(loopRehydrated), 'decanonicalized loop source should include startLoop');
assert.ok(/\bendLoop\b/.test(loopRehydrated), 'decanonicalized loop source should include endLoop');
assert.deepStrictEqual(canonicalizeSource(loopRehydrated, 'semantic'), loopCanonical, 'decanonicalized loop source should preserve loop canonical form');

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

const broadWinConditionSource = `
title Broad Win Condition

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

Goal
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
P = Background and Player
M = Background and Marker
G = Background and Goal

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Player
Marker
Goal

=====
RULES
=====

[ Player ] -> [ Player Marker ]

=============
WINCONDITIONS
=============

Some Player

======
LEVELS
======

PG
`;

const broadWinCanonical = canonicalizeSource(broadWinConditionSource, 'semantic');
assert.deepStrictEqual(
    broadWinCanonical.winConditions[0].b,
    ['obj_0', 'obj_1'],
    'broad win conditions should be normalized to retained semantic objects'
);
const broadWinRehydrated = decanonicalizeSemantic(broadWinCanonical);
assert.deepStrictEqual(
    canonicalizeSource(broadWinRehydrated, 'semantic'),
    broadWinCanonical,
    'decanonicalized broad win conditions should not reintroduce pruned inert objects'
);

const unlayeredWinObjectCanonical = {
    format: 'puzzlescript-semantic-canonical-v1',
    metadata: [
        { key: 'title', value: 'Unlayered Win Object' },
    ],
    collisionLayers: [
        ['obj_0'],
        ['obj_1'],
    ],
    playerObjects: ['obj_1'],
    backgroundObjects: ['obj_0'],
    rules: [],
    winConditions: [
        { quantifier: 1, a: ['obj_1'], b: ['obj_2'] },
    ],
    levels: [
        {
            type: 'map',
            rows: [
                [['obj_0', 'obj_1']],
            ],
        },
    ],
};
const unlayeredBeforeRehydration = JSON.stringify(unlayeredWinObjectCanonical);
const unlayeredRehydrated = decanonicalizeSemantic(unlayeredWinObjectCanonical);
const unlayeredCompiled = compileSemanticSource(unlayeredRehydrated);
assert.strictEqual(unlayeredCompiled.errorCount, 0, 'decanonicalized objects referenced by wins should be assigned to a layer');
assert.strictEqual(JSON.stringify(unlayeredWinObjectCanonical), unlayeredBeforeRehydration, 'decanonicalization should not mutate canonical input when adding emission layers');

console.log('decanonicalize_node: ok');
