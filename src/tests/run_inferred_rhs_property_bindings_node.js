#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();

const {
    test,
    compileSource,
    compileSourceAllowingMessages,
    makeCellInspector,
    runTick,
} = require('./lib/node_test_harness');
const { assertCell: assertNamesAt } = makeCellInspector(
    ['alpha', 'beta', 'marker', 'player']
);

function baseSource(rules, level) {
    return `title inferred rhs property bindings

========
OBJECTS
========
Background
black

Player
white

Alpha
red

Beta
blue

Marker
yellow

${'======='}
LEGEND
${'======='}
. = Background
P = Player
a = Alpha
b = Beta
m = Marker
Thing = Alpha or Beta

${'======'}
SOUNDS
${'======'}

${'================'}
COLLISIONLAYERS
${'================'}
Background
Marker
Alpha
Beta
Player

${'======'}
RULES
${'======'}
${rules}

${'=============='}
WINCONDITIONS
${'=============='}

${'======='}
LEVELS
${'======='}
${level}
`;
}

test('independent LHS property terms do not require the same concrete object', () => {
    runTick(baseSource(
        'right [ Thing | Thing ] -> [ Thing | Marker ]',
        'ab'
    ));

    assertNamesAt(1, ['marker'], 'rule should match Alpha beside Beta without equality-binding the Thing terms');
});

test('unique LHS property occurrence infers RHS property across cells', () => {
    runTick(baseSource(
        'right [ Thing | ] -> [ | Thing ]',
        'a.'
    ));
    assertNamesAt(0, [], 'source Alpha should move out of the source cell');
    assertNamesAt(1, ['alpha'], 'RHS Thing should be inferred as Alpha');

    runTick(baseSource(
        'right [ Thing | ] -> [ | Thing ]',
        'b.'
    ));
    assertNamesAt(0, [], 'source Beta should move out of the source cell');
    assertNamesAt(1, ['beta'], 'RHS Thing should be inferred as Beta');
});

test('RHS property without a LHS source remains a compiler error', () => {
    const result = compileSourceAllowingMessages(baseSource(
        'right [ Marker | ] -> [ Marker | Thing ]',
        'm.'
    ));

    assert.ok(result.errorCount > 0, 'compile should report an error');
    assert.ok(
        result.messages.some(message => message.includes('can\'t be inferred from the left-hand side')),
        result.messages.join('\n')
    );
});

test('RHS property with multiple possible LHS sources remains ambiguous', () => {
    const result = compileSourceAllowingMessages(baseSource(
        'right [ Thing | Thing | ] -> [ Thing | Thing | Thing ]',
        'ab.'
    ));

    assert.ok(result.errorCount > 0, 'compile should report an error');
    assert.ok(
        result.messages.some(message => message.includes('can\'t be inferred from the left-hand side')),
        result.messages.join('\n')
    );
});

const { ruleCount } = require('./lib/node_test_harness');

test('Phase 5c-1: single rule coalesces cross-cell property preservation', () => {
    // Before 5c: 2 rules (one per Thing alias). After 5c: 1 rule with runtime
    // alias-binding capture.
    const state = compileSource(baseSource(
        'right [ Thing | ] -> [ | Thing ]',
        'a.'
    ));
    assert.strictEqual(ruleCount(state), 1);
});
