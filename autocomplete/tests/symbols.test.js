'use strict';
// Tests for autocomplete/pipeline/symbols.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');

const sym = require('../pipeline/symbols.js');

const SRC = [
    'title T', '========', 'OBJECTS', '========', 'Background', 'black', 'Player', 'red', 'CrateBox', 'blue',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', 'Solid = Player or CrateBox', 'Both = Player and CrateBox',
    '=======', 'SOUNDS', '=======', 'sfx0 1234', 'sfx3 5678', 'Player move 4321',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, CrateBox',
    '======', 'RULES', '======', '==============', 'WINCONDITIONS', '==============', '=======', 'LEVELS', '=======', 'P.', '',
].join('\n');

test('extractSymbols returns original-case objects, legend names and sfx numbers', () => {
    const s = sym.extractSymbols(SRC);
    assert.deepStrictEqual(s.objects, ['Background', 'Player', 'CrateBox']);
    assert.deepStrictEqual(s.legend, ['.', 'p', 'both', 'solid'], 'legend names are lowercase: the parser does not keep their original case');
    assert.deepStrictEqual(s.sfx, ['0', '3']);
});

test('extractSymbols survives files with more errors than the parser tolerates', () => {
    const garbage = Array.from({ length: 40 }, (_, i) => 'nonsense line ' + i).join('\n');
    const s = sym.extractSymbols(garbage + '\n' + SRC);
    assert.ok(Array.isArray(s.objects));
    assert.ok(Array.isArray(s.legend));
    const s2 = sym.extractSymbols(SRC + '\n' + garbage);
    assert.deepStrictEqual(s2.objects, ['Background', 'Player', 'CrateBox']);
});

test('symbolsFromParserState accepts a minimal editor-shaped state', () => {
    const s = sym.symbolsFromParserState({
        objects: { player: {}, wall: {} },
        legend_synonyms: [['p', 'player']],
        legend_properties: [['obstacle', 'wall']],
        sounds: [[['sfx2', 'SOUNDEVENT'], ['1', 'SOUND'], 3]],
        original_case_names: { player: 'Player', wall: 'Wall' },
    });
    assert.deepStrictEqual(s, { objects: ['Player', 'Wall'], legend: ['p', 'obstacle'], sfx: ['2'] });
});
