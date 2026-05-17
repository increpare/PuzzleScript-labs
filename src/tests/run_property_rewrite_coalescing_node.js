#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();

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

function compileSource(source) {
    compile(['loadLevel', 0], source);
    assert.strictEqual(errorCount, 0, errorStrings.map(stripHTMLTags).join('\n'));
    return global.eval('state');
}

function compileSourceAllowingMessages(source) {
    compile(['loadLevel', 0], source);
    return {
        state: global.eval('state'),
        messages: errorStrings.map(stripHTMLTags)
    };
}

function ruleCount(state) {
    return state.rules.reduce((sum, group) => sum + group.length, 0);
}

function cellObjectNames(index) {
    const state = global.eval('state');
    const level = global.eval('level');
    const cell = level.getCell(index);
    const names = [];
    for (const name of ['alpha', 'beta', 'gamma', 'good', 'player', 'target']) {
        if (cell.get(state.objects[name].id)) {
            names.push(name);
        }
    }
    return names;
}

function assertCell(index, expectedNames, message) {
    assert.deepStrictEqual(cellObjectNames(index).sort(), expectedNames.slice().sort(), message);
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

if (process.exitCode) {
    process.exit(process.exitCode);
}
