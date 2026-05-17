#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();

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

function compileSource(source, randomseed) {
    compile(['loadLevel', 0], source, randomseed);
    assert.strictEqual(errorCount, 0, errorStrings.map(stripHTMLTags).join('\n'));
    return global.eval('state');
}

function compileSourceAllowingMessages(source) {
    compile(['loadLevel', 0], source);
    return {
        state: global.eval('state'),
        errorCount,
        messages: errorStrings.map(stripHTMLTags)
    };
}

function namesAt(index) {
    const state = global.eval('state');
    const level = global.eval('level');
    const cell = level.getCell(index);
    const names = [];
    for (const name of ['alpha', 'beta', 'marker', 'player']) {
        if (cell.get(state.objects[name].id)) {
            names.push(name);
        }
    }
    return names.sort();
}

function assertNamesAt(index, expected, message) {
    assert.deepStrictEqual(namesAt(index), expected.slice().sort(), message);
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
