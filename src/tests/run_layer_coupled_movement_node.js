#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();

const {
    test,
    compileSource,
    compileSourceAllowingMessages,
    ruleCount,
    lateRuleCount,
    makeCellInspector,
    runTick,
    runRight,
} = require('./lib/node_test_harness');
const { cellObjectNames, assertCell } = makeCellInspector(
    ['player1', 'player2', 'crate1', 'crate2', 'gem1', 'gem2']
);

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

Gem1
pink

Gem2
white

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
G = Gem1
H = Gem2
# = Wall
Crate = Crate1 or Crate2
Player = Player1 or Player2
Gem = Gem1 or Gem2

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
Gem1
Gem2

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

test('coalesces a multi-layer movement-only property rule to one runtime rule', () => {
    const state = compileSource(baseSource(
        'right [ > Player | Crate ] -> [ > Player | > Crate ]',
        'P.C'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('coalesces command-bearing multi-layer property movement rules', () => {
    const state = compileSource(baseSource(
        'right [ > Player | Crate ] -> [ > Player | > Crate ] again',
        'P.C'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('coalesces movement rules with terminating and sound commands', () => {
    for (const command of ['cancel', 'restart', 'win', 'checkpoint', 'sfx0']) {
        const state = compileSource(baseSource(
            `right [ > Player | Crate ] -> [ > Player | > Crate ] ${command}`,
            'P.C'
        ));
        assert.strictEqual(ruleCount(state), 1, command);
    }
});

test('coalesces random multi-layer property movement rules', () => {
    const source = baseSource(
        'random right [ > Player | Crate ] -> [ > Player | > Crate ]',
        'PC.'
    );
    const state = compileSource(source, 'random-layer-coupled-movement');
    assert.strictEqual(ruleCount(state), 1);

    processInput(3);
    assertCell(0, [], 'source cell should be empty after the random push');
    assertCell(1, ['player1'], 'player should move into the crate cell');
    assertCell(2, ['crate1'], 'crate should move right');
});

test('keeps random plus-group size at authored coalesced rule count', () => {
    const state = compileSource(baseSource(`
random right [ > Player | Crate ] -> [ > Player | > Crate ]
+ right [ > Player | Gem ] -> [ > Player | > Gem ]
`, 'P.C'));
    assert.strictEqual(ruleCount(state), 2);
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

test('coalesces multiple same-cell property movement terms with disjoint layers', () => {
    const state = compileSource(baseSource(
        'right [ > Player > Gem ] -> [ > Player > Gem ]',
        'PG'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('keeps overlapping same-cell property movement terms on the expansion path', () => {
    const state = compileSource(baseSource(
        'right [ > Player > Crate ] -> [ > Player > Crate ]',
        'PX'
    ));
    assert.ok(ruleCount(state) > 1);
});

test('coalesces mixed movement and property rewrite rules', () => {
    const state = compileSource(baseSource(
        'right [ > Player | Crate ] -> [ > Player | Crate1 ]',
        'P.C'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('keeps multi-cell preserved layer-coupled properties on the expansion path', () => {
    const state = compileSource(baseSource(
        'right [ Crate | Player ] -> [ Crate | Player ] again',
        'CP'
    ));
    assert.ok(ruleCount(state) > 1);
});

test('coalesces safe single-row multi-cell preserved properties', () => {
    const state = compileSource(baseSource(
        'right [ Crate Target | Player no Target ] -> [ Crate Target | Player Target ]',
        'CP'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('coalesces late single-row multi-cell preserved properties', () => {
    const state = compileSource(baseSource(
        'late right [ Crate Target | Player no Target ] -> [ Crate Target | Player Target ]',
        'CP'
    ));
    assert.strictEqual(lateRuleCount(state), 1);
    assert.strictEqual(ruleCount(state), 0);
});

test('keeps multi-row preserved properties on the expansion path', () => {
    const state = compileSource(baseSource(
        '[ Player1 no Target ] [ Gem ] -> [ Player1 Target ] [ Gem Wall ]',
        'PG'
    ));
    assert.ok(ruleCount(state) > 1);
});

test('does not split preserved layer-coupled properties beside object changes', () => {
    const state = compileSource(baseSource(
        'late [ Crate no Target ] -> [ Crate Target ]',
        'C'
    ));
    assert.strictEqual(ruleCount(state) + lateRuleCount(state), 1);
});

test('keeps duplicate same-cell properties on the expansion path', () => {
    const result = compileSourceAllowingMessages(baseSource(
        'right [ Crate Crate ] -> [ Crate Crate ]',
        'C'
    ));
    assert.ok(result.messages.some(message => message.indexOf('can never overlap') >= 0));
});

test('keeps properties with overlapping no-constraints on the expansion path', () => {
    const result = compileSourceAllowingMessages(baseSource(
        'right [ Crate no Crate1 ] -> [ Crate no Crate1 ]',
        'C'
    ));
    assert.ok(result.messages.some(message => message.indexOf('can never match') >= 0));
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

test('coalesces command-only rules with a coupled-property movement term', () => {
    const state = compileSource(baseSource(
        'right [ > Crate | Player ] -> cancel',
        'CP'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('coalesces command-only rules with multiple coupled-property terms', () => {
    const state = compileSource(baseSource(
        'right [ > Player > Gem ] -> cancel',
        'PG'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('coalesces command-only rules for various terminating commands', () => {
    for (const command of ['cancel', 'restart', 'win']) {
        const state = compileSource(baseSource(
            `right [ > Crate | Player ] -> ${command}`,
            'CP'
        ));
        assert.strictEqual(ruleCount(state), 1, command);
    }
});

test('keeps command-only rules with overlapping coupled-term layers on the expansion path', () => {
    const state = compileSource(baseSource(
        'right [ > Player > Crate ] -> cancel',
        'PX'
    ));
    assert.ok(ruleCount(state) > 1);
});

test('keeps command-only rules with no-term overlapping a coupled property on the expansion path', () => {
    const result = compileSourceAllowingMessages(baseSource(
        'right [ Crate no Crate1 ] -> cancel',
        'C'
    ));
    assert.ok(result.messages.some(message => message.indexOf('can never match') >= 0));
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
