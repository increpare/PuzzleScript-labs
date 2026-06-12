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

const exactRoundTripSource = fs.readFileSync('src/tests/solver_tests/a clear view of the sky.txt', 'utf8');
const exactCanonical = canonicalizeSource(exactRoundTripSource, 'semantic');
const exactRehydrated = decanonicalizeSemantic(exactCanonical);
assert.deepStrictEqual(
    canonicalizeSource(exactRehydrated, 'semantic'),
    exactCanonical,
    'decanonicalized semantic source should preserve exact object labels for asymmetric layers'
);

const numericLayerSource = fs.readFileSync('src/demo/blockfaker.txt', 'utf8');
const numericLayerCanonical = canonicalizeSource(numericLayerSource, 'semantic');
const numericLayerRehydrated = decanonicalizeSemantic(numericLayerCanonical);
assert.deepStrictEqual(
    canonicalizeSource(numericLayerRehydrated, 'semantic'),
    numericLayerCanonical,
    'decanonicalized semantic source should preserve exact object labels when layers contain obj_10'
);

const cyclicRelabelSource = fs.readFileSync('src/demo/atlas shrank.txt', 'utf8');
const cyclicRelabelCanonical = canonicalizeSource(cyclicRelabelSource, 'semantic');
const cyclicRelabelRehydrated = decanonicalizeSemantic(cyclicRelabelCanonical);
assert.deepStrictEqual(
    canonicalizeSource(cyclicRelabelRehydrated, 'semantic'),
    cyclicRelabelCanonical,
    'decanonicalized semantic source should preserve exact object labels for cyclic object families'
);

const winLinkedRelabelSource = fs.readFileSync('src/demo/byyourside.txt', 'utf8');
const winLinkedRelabelCanonical = canonicalizeSource(winLinkedRelabelSource, 'semantic');
const winLinkedRelabelRehydrated = decanonicalizeSemantic(winLinkedRelabelCanonical);
assert.deepStrictEqual(
    canonicalizeSource(winLinkedRelabelRehydrated, 'semantic'),
    winLinkedRelabelCanonical,
    'decanonicalized semantic source should preserve exact object labels for win-linked object families'
);

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
assert.ok(
    !/\bon\b/i.test(broadWinRehydrated.split('WINCONDITIONS')[1].split('LEVELS')[0]),
    'broad plain win conditions should not use explicit "on" form',
);
assert.deepStrictEqual(
    canonicalizeSource(broadWinRehydrated, 'semantic'),
    broadWinCanonical,
    'decanonicalized broad win conditions should not reintroduce pruned inert objects'
);

const plainWinMinusBackgroundCanonical = {
    format: 'puzzlescript-semantic-canonical-v1',
    metadata: [
        { key: 'title', value: 'Plain Win Minus Background' },
    ],
    collisionLayers: [
        ['obj_0'],
        ['obj_1'],
        ['obj_2'],
    ],
    playerObjects: ['obj_1'],
    backgroundObjects: ['obj_0'],
    rules: [],
    winConditions: [
        { quantifier: 0, a: ['obj_2'], b: ['obj_1', 'obj_2'] },
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
const plainWinMinusBackgroundRehydrated = decanonicalizeSemantic(plainWinMinusBackgroundCanonical);
const plainWinSection = plainWinMinusBackgroundRehydrated.split('WINCONDITIONS')[1].split('LEVELS')[0];
assert.ok(
    !/\bon\b/i.test(plainWinSection),
    'plain win targets that omit only background should not use explicit "on" form',
);
assert.ok(
    /some obj_2/.test(plainWinSection),
    'plain win targets that omit only background should emit subject-only win text',
);

const singletonPlayerPlainWinCanonical = {
    format: 'puzzlescript-semantic-canonical-v1',
    metadata: [],
    collisionLayers: [
        ['obj_0'],
    ],
    playerObjects: ['obj_0'],
    backgroundObjects: [],
    rules: [],
    winConditions: [
        { quantifier: -1, a: ['obj_0'], b: ['obj_0'] },
    ],
    levels: [
        {
            type: 'map',
            rows: [
                [['obj_0'], []],
            ],
        },
    ],
};
const singletonPlayerPlainWinRehydrated = decanonicalizeSemantic(singletonPlayerPlainWinCanonical);
assert.ok(
    /\bplayer\s*=\s*obj_0\b/i.test(singletonPlayerPlainWinRehydrated),
    'singleton player aliases should be emitted even when the player is also a plain win target'
);
assert.strictEqual(
    compileSemanticSource(singletonPlayerPlainWinRehydrated).errorCount,
    0,
    'decanonicalized singleton player plain-win source should compile'
);

const redundantNoCanonical = {
    format: 'puzzlescript-semantic-canonical-v1',
    metadata: [],
    collisionLayers: [
        ['obj_3'],
        ['obj_0'],
        ['obj_1', 'obj_2'],
    ],
    playerObjects: ['obj_0'],
    backgroundObjects: ['obj_3'],
    rules: Array.from({ length: 110 }, (_, index) => ({
        direction: 'down',
        late: false,
        rigid: false,
        randomRule: false,
        groupNumber: index,
        lhs: [[[
            { dir: '', obj: 'obj_1' },
            { dir: 'no', obj: 'obj_2' },
        ]]],
        rhs: [[[
            { dir: '', obj: 'obj_1' },
        ]]],
        commands: [],
    })),
    winConditions: [],
    levels: [
        {
            type: 'map',
            rows: [
                [['obj_3', 'obj_0']],
            ],
        },
    ],
};
const redundantNoRehydrated = decanonicalizeSemantic(redundantNoCanonical);
assert.ok(
    !/\bno obj_2\b/i.test(redundantNoRehydrated),
    'decanonicalization should omit negated objects made redundant by positive same-layer objects'
);
assert.strictEqual(
    compileSemanticSource(redundantNoRehydrated).errorCount,
    0,
    'decanonicalized redundant negation source should compile without warning overflow'
);

const impossibleRuleCanonical = {
    format: 'puzzlescript-semantic-canonical-v1',
    metadata: [],
    collisionLayers: [
        ['obj_3'],
        ['obj_2'],
        ['obj_0', 'obj_1'],
        ['obj_4'],
    ],
    playerObjects: ['obj_2'],
    backgroundObjects: ['obj_3'],
    rules: [
        {
            direction: 'down',
            late: true,
            rigid: false,
            randomRule: false,
            groupNumber: 0,
            lhs: [[[
                { dir: '', obj: 'obj_0' },
                { dir: '', obj: 'obj_1' },
            ]]],
            rhs: [[[
                { dir: '', obj: 'obj_4' },
            ]]],
            commands: [],
        },
        {
            direction: 'down',
            late: true,
            rigid: false,
            randomRule: false,
            groupNumber: 1,
            lhs: [[[
                { dir: '', obj: 'obj_0' },
                { dir: '', obj: 'obj_2' },
            ]]],
            rhs: [[[
                { dir: '', obj: 'obj_4' },
            ]]],
            commands: [],
        },
        {
            direction: 'down',
            late: true,
            rigid: false,
            randomRule: false,
            groupNumber: 2,
            lhs: [[[
                { dir: '', obj: 'obj_0' },
                { dir: '', objs: ['obj_0', 'obj_1'] },
            ]]],
            rhs: [[[
                { dir: '', obj: 'obj_4' },
            ]]],
            commands: [],
        },
    ],
    winConditions: [],
    levels: [
        {
            type: 'map',
            rows: [
                [['obj_3', 'obj_2']],
            ],
        },
    ],
};
const impossibleRuleRehydrated = decanonicalizeSemantic(impossibleRuleCanonical);
const impossibleRuleRules = impossibleRuleRehydrated.split('RULES')[1].split('WINCONDITIONS')[0];
assert.ok(
    !/\bobj_0 obj_1\b/.test(impossibleRuleRules),
    'decanonicalization should omit rules with impossible same-layer positive requirements'
);
assert.ok(
    /\bobj_0 obj_2\b/.test(impossibleRuleRules),
    'decanonicalization should keep possible rules while omitting impossible neighbors'
);
assert.ok(
    !/\b(?:obj_0 set_\d+|set_\d+ obj_0)\b/.test(impossibleRuleRules),
    'decanonicalization should omit positive same-layer set aliases made redundant by concrete objects'
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
