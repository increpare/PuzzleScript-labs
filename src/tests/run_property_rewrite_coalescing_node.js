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
    totalRuleCount,
    makeCellInspector,
} = require('./lib/node_test_harness');
const { cellObjectNames, assertCell } = makeCellInspector(
    ['alpha', 'beta', 'gamma', 'good', 'player', 'target']
);

function baseSource(rules, level) {
    return `title property rewrite coalescing

========
OBJECTS
========
Background
black

Alpha
red

Beta
blue

Gamma
green

Good
yellow

Player
purple

Target
white

=======
LEGEND
=======
. = Background
a = Alpha
b = Beta
c = Gamma
g = Good
p = Player
t = Target
x = Alpha and Beta
y = Alpha and Target
Thing = Alpha or Beta or Gamma or Good
Actor = Target or Player

=======
SOUNDS
=======
sfx0 17355302

================
COLLISIONLAYERS
================
Background
Alpha
Beta
Gamma
Good
Player
Target

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

test('coalesces repeated property-to-object rewrite instead of Cartesian expansion', () => {
    const state = compileSource(baseSource(
        '[ Thing | Thing | Thing ] -> [ Good | Good | Good ] again sfx0',
        'abc'
    ));
    assert.strictEqual(ruleCount(state), 2);
});

test('rewrites each matched property cell to the concrete object', () => {
    compileSource(baseSource(
        '[ Thing | Thing | Thing ] -> [ Good | Good | Good ] again sfx0',
        'abc'
    ));

    processInput(-1);

    assertCell(0, ['good'], 'first cell should become Good');
    assertCell(1, ['good'], 'second cell should become Good');
    assertCell(2, ['good'], 'third cell should become Good');
});

test('clears every matching source property alternative in a cell', () => {
    compileSource(baseSource(
        '[ Thing | Thing | Thing ] -> [ Good | Good | Good ] again sfx0',
        'xgg'
    ));

    processInput(-1);

    assertCell(0, ['good'], 'cell with A and B should become only Good');
    assertCell(1, ['good'], 'existing Good should remain Good');
    assertCell(2, ['good'], 'existing Good should remain Good');
});

test('coalesces multiple same-cell property rewrites with disjoint layers', () => {
    const state = compileSource(baseSource(
        '[ Thing Actor ] -> [ Good Player ]',
        'y'
    ));
    assert.strictEqual(ruleCount(state), 1);
});

test('applies multiple same-cell property rewrites to their own layers', () => {
    compileSource(baseSource(
        '[ Thing Actor ] -> [ Good Player ]',
        'y'
    ));

    processInput(-1);

    assertCell(0, ['good', 'player'], 'Alpha/Gamma should become Good/Player');
});

test('keeps overlapping same-cell property rewrites on the expansion path', () => {
    const result = compileSourceAllowingMessages(baseSource(
        '[ Thing Thing ] -> [ Good Target ]',
        'x'
    ));
    assert.ok(result.messages.some(message => message.indexOf('can never overlap') >= 0));
});

test('coalesces late property-to-object rewrite rules', () => {
    const state = compileSource(baseSource(
        'late [ Thing | Thing ] -> [ Good | Good ]',
        'ab'
    ));
    assert.strictEqual(totalRuleCount(state), 2);
});

test('coalesces random property-to-object rewrite rules', () => {
    const source = baseSource(
        'random [ Thing | Thing ] -> [ Good | Good ]',
        'ab'
    );
    const state = compileSource(source, 'random-property-rewrite');
    assert.strictEqual(ruleCount(state), 2);

    processInput(-1);
    assertCell(0, ['good'], 'first cell should become Good');
    assertCell(1, ['good'], 'second cell should become Good');
});

test('no-property terms match via the property union mask', () => {
    compileSource(baseSource(
        '[ no Thing ] -> [ Good ]',
        '.'
    ));
    processInput(-1);
    assertCell(0, ['good'], 'empty cell should match no Thing and create Good');

    compileSource(baseSource(
        '[ no Thing ] -> [ Good ]',
        'a'
    ));
    processInput(-1);
    assertCell(0, ['alpha'], 'cell containing a Thing should not match no Thing');
});


// Reduced from Selene's Labyrinth, gist 34da610e12cac29309b174af89c3a3ad,
// lines 3648/3652: an excluded property member does not exclude the others.
test('property negation silently filters only the excluded alternatives', () => {
    for (const [glyph, name] of [['a', 'alpha'], ['b', 'beta'], ['c', 'gamma'], ['g', 'good']]) {
        for (const constraint of ['no Alpha', 'no Flow', 'no FlowAlias']) {
            const source = baseSource(
                `late right [ ${constraint} Thing | Player ] -> [ Thing | Target ]`,
                glyph + 'p'
            ).replace('Actor = Target or Player',
                'Actor = Target or Player\nFlow = Alpha or Beta\nFlowAlias = Flow');
            const result = compileSourceAllowingMessages(source);
            assert.strictEqual(result.errorCount, 0);
            assert.deepStrictEqual(result.messages, [], constraint);
            processInput(-1);
            assertCell(0, [name], 'preserve the matched alternative');
            const excluded = name === 'alpha' || (constraint !== 'no Alpha' && name === 'beta');
            assertCell(1, [excluded ? 'player' : 'target'], constraint + ' on ' + name);
        }
    }
});

test('property negation still warns when every alternative is excluded', () => {
    const result = compileSourceAllowingMessages(baseSource(
        'late right [ Thing no Flow | Player ] -> [ Thing | Target ]',
        'ap'
    ).replace('Actor = Target or Player',
        'Actor = Target or Player\nFlow = Alpha or Beta or Gamma or Good'));
    assert.strictEqual(result.errorCount, 0);
    assert.ok(result.messages.some(message => message.includes('can never match')));
    assert.strictEqual(totalRuleCount(result.state), 0);
    processInput(-1);
    assertCell(1, ['player']);
});

if (process.exitCode) {
    process.exit(process.exitCode);
}
