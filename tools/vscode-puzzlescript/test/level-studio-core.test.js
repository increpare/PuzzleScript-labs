#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    boardFromLevel,
    generatedLevelsLogPath,
    glyphPaletteForSource,
    isPuzzleScriptCandidateDocument,
    replaceGlyphAt,
    replaceLevelRowsInSource,
    statusLabel,
} = require('../src/puzzlescriptLevelStudioCore');
const { findPlayableLevels } = require('../src/puzzlescriptGeneratorCore');

const source = [
    'title Studio Test',
    '',
    'objects',
    'Background',
    'black',
    'Wall',
    'gray',
    'Player',
    'blue',
    'Crate',
    'orange',
    'Target',
    'green',
    '',
    'legend',
    '. = Background',
    '# = Wall',
    'P = Player',
    '* = Crate',
    'O = Target',
    '@ = Crate and Target',
    '',
    'collisionlayers',
    'Background',
    'Player, Wall, Crate',
    'Target',
    '',
    'rules',
    '[ > Player | Crate ] -> [ > Player | > Crate ]',
    '',
    'winconditions',
    'all Crate on Target',
    '',
    'levels',
    '#####',
    '#P*.#',
    '#..O#',
    '#####',
].join('\n');

assert.strictEqual(isPuzzleScriptCandidateDocument(source, 'game.txt'), true);
assert.strictEqual(isPuzzleScriptCandidateDocument('just notes', 'notes.txt'), false);
assert.strictEqual(isPuzzleScriptCandidateDocument('anything', 'game.ps'), true);
assert.strictEqual(generatedLevelsLogPath('/tmp/game.txt'), '/tmp/game.generatedlevels.txt');
assert.strictEqual(generatedLevelsLogPath('/tmp/game.ps'), '/tmp/game.generatedlevels.txt');

const palette = glyphPaletteForSource(source);
assert.deepStrictEqual(palette.map(entry => entry.glyph), ['.', '#', 'P', '*', 'O', '@']);
assert.deepStrictEqual(palette.find(entry => entry.glyph === '@').objects, ['crate', 'target']);

const level = findPlayableLevels(source)[0];
assert.deepStrictEqual(boardFromLevel(level), [
    ['#', '#', '#', '#', '#'],
    ['#', 'P', '*', '.', '#'],
    ['#', '.', '.', 'O', '#'],
    ['#', '#', '#', '#', '#'],
]);

assert.deepStrictEqual(replaceGlyphAt(boardFromLevel(level), 1, 1, '.'), [
    ['#', '#', '#', '#', '#'],
    ['#', '.', '*', '.', '#'],
    ['#', '.', '.', 'O', '#'],
    ['#', '#', '#', '#', '#'],
]);

const replaced = replaceLevelRowsInSource(source, level, [
    '#####',
    '#..*#',
    '#P.O#',
    '#####',
]);
assert(replaced.includes('#..*#'));
assert(!replaced.includes('#P*.#'));

assert.strictEqual(statusLabel({ status: 'solved', solution_length: 12 }), 'solved, 12 moves');
assert.strictEqual(statusLabel({ status: 'timeout', solver_budget_ms: 1000 }), 'timeout @ 1s');
assert.strictEqual(statusLabel({ status: 'exhausted' }), 'exhausted');

console.log('level studio core tests passed');
