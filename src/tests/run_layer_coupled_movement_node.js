#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();

function baseSource(rules, level) {
    return `title layer coupled movement

========
OBJECTS
========
Background
black

Target
yellow

Player1
red

Player2
blue

Crate1
green

Crate2
orange

Wall
grey

=======
LEGEND
=======
. = Background
P = Player1
Q = Player2
C = Crate1
D = Crate2
X = Player1 and Crate2
Z = Crate1 and Crate2
# = Wall
Crate = Crate1 or Crate2
Player = Player1 or Player2

======
SOUNDS
======

================
COLLISIONLAYERS
================
Background
Target
Player1, Crate1, Wall
Player2, Crate2

======
RULES
======
${rules}

==============
WINCONDITIONS
==============

=======
LEVELS
=======
${level}
`;
}

function compileSource(source) {
    compile(['loadLevel', 0], source);
    assert.strictEqual(errorCount, 0, errorStrings.map(stripHTMLTags).join('\n'));
    return global.eval('state');
}

function compileSourceWithCoalescingProbe(source) {
    const originalShouldCoalesce = global.eval('shouldCoalesceLayerCoupledMovementRule');
    global.__layerCoupledMovementProbeCalls = 0;
    global.__originalShouldCoalesceLayerCoupledMovementRule = originalShouldCoalesce;
    global.eval(`shouldCoalesceLayerCoupledMovementRule = function() {
        globalThis.__layerCoupledMovementProbeCalls++;
        return globalThis.__originalShouldCoalesceLayerCoupledMovementRule.apply(this, arguments);
    }`);
    try {
        const state = compileSource(source);
        return {
            state,
            calls: global.__layerCoupledMovementProbeCalls
        };
    } finally {
        global.eval('shouldCoalesceLayerCoupledMovementRule = globalThis.__originalShouldCoalesceLayerCoupledMovementRule');
        delete global.__layerCoupledMovementProbeCalls;
        delete global.__originalShouldCoalesceLayerCoupledMovementRule;
    }
}

function ruleCount(state) {
    return state.rules.reduce((sum, group) => sum + group.length, 0);
}

function cellObjectNames(index) {
    const state = global.eval('state');
    const level = global.eval('level');
    const cell = level.getCell(index);
    const names = [];
    for (const name of ['player1', 'player2', 'crate1', 'crate2']) {
        if (cell.get(state.objects[name].id)) {
            names.push(name);
        }
    }
    return names;
}

function assertCell(index, expectedNames, message) {
    assert.deepStrictEqual(cellObjectNames(index).sort(), expectedNames.slice().sort(), message);
}

function runRight(source) {
    compileSource(source);
    processInput(3);
}

function runTick(source) {
    compileSource(source);
    processInput(-1);
}

function test(name, body) {
    try {
        body();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error && error.stack ? error.stack : String(error));
        process.exitCode = 1;
    }
}

test('coalesces a multi-layer movement-only property rule to one runtime rule', () => {
    const state = compileSource(baseSource(
        'right [ > Player | Crate ] -> [ > Player | > Crate ]',
        'P.C'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('keeps command-bearing multi-layer property movement rules on the old expansion path', () => {
    const result = compileSourceWithCoalescingProbe(baseSource(
        'right [ > Player | Crate ] -> [ > Player | > Crate ] again',
        'P.C'
    ));
    assert.strictEqual(result.calls, 0);
    assert.strictEqual(ruleCount(result.state), 4);
});

test('does not satisfy a moving property term with movement from a different layer', () => {
    runTick(baseSource(`
[ Crate2 ] -> [ right Crate2 ]
[ > Player ] -> [ left Player ]
`, '.X.'));

    assertCell(0, [], 'player should not move left due to crate-layer movement');
    assertCell(1, ['player1'], 'player should remain on its original cell');
    assertCell(2, ['crate2'], 'crate should move right');
});

test('applies RHS property movement to every matching target layer', () => {
    runRight(baseSource(
        'right [ > Player | Crate ] -> [ > Player | > Crate ]',
        'PZ.'
    ));

    assertCell(0, [], 'source cell should be empty after push');
    assertCell(1, ['player1'], 'player should move into the pushed cell');
    assertCell(2, ['crate1', 'crate2'], 'both crate layers should move');
});

test('coalesces one same-cell property movement term beside fixed layer terms', () => {
    const state = compileSource(baseSource(
        'right [ > Player1 Crate ] -> [ > Player1 > Crate ]',
        '.X.'
    ));
    assert.strictEqual(ruleCount(state), 1);

    processInput(3);
    assertCell(0, [], 'left cell should remain empty');
    assertCell(1, [], 'source cell should be empty after both objects move');
    assertCell(2, ['player1', 'crate2'], 'only the compatible crate layer should move with player1');
});

test('does not satisfy a stationary property term from a different stationary layer', () => {
    runRight(baseSource(
        'right [ stationary Player ] -> [ left Player ]',
        '.X.'
    ));

    assertCell(0, [], 'player should not move left due to another stationary layer');
    assertCell(1, ['crate2'], 'crate should remain on the original cell');
    assertCell(2, ['player1'], 'player should keep the input movement');
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
