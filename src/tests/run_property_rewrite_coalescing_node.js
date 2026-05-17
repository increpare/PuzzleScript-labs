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

=======
LEGEND
=======
. = Background
a = Alpha
b = Beta
c = Gamma
g = Good
p = Player
x = Alpha and Beta
Thing = Alpha or Beta or Gamma or Good

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

function ruleCount(state) {
    return state.rules.reduce((sum, group) => sum + group.length, 0);
}

function cellObjectNames(index) {
    const state = global.eval('state');
    const level = global.eval('level');
    const cell = level.getCell(index);
    const names = [];
    for (const name of ['alpha', 'beta', 'gamma', 'good']) {
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

if (process.exitCode) {
    process.exit(process.exitCode);
}
