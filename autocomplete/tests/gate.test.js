'use strict';
// Tests for src/js/autocomplete_gate.js through the eval bridge (engine.gate).
// Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');

const engine = require('../eval/engine.js');

const GAME = [
    'title T', '========', 'OBJECTS', '========', 'Background', 'black', 'Player', 'red', 'Crate', 'blue', 'Wall', 'gray',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate', '# = Wall',
    '=======', 'SOUNDS', '=======',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate, Wall',
    '======', 'RULES', '======', '[ > Player | Crate ] -> [ > Player | > Crate ]', '',
    '==============', 'WINCONDITIONS', '==============', '=======', 'LEVELS', '=======', 'P*.', '',
].join('\n');
const RULES_INSERT = GAME.indexOf('\n', GAME.indexOf('-> [')) + 1;

test('gate accepts a well-formed rule that references declared names', () => {
    const r = engine.gate(GAME, RULES_INSERT, RULES_INSERT, '[ > Player | Wall ] -> [ Player | Wall ]');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.section, 'rules');
});

test('gate rejects unbalanced brackets, cell count mismatches and unknown names', () => {
    assert.strictEqual(engine.gate(GAME, RULES_INSERT, RULES_INSERT, '[ Player -> [ Player ]').reason, 'brackets');
    assert.strictEqual(engine.gate(GAME, RULES_INSERT, RULES_INSERT, '[ > Player | Crate ] -> [ > Player ]').reason, 'cell count');
    const unknown = engine.gate(GAME, RULES_INSERT, RULES_INSERT, '[ Player ] -> [ Foo ]');
    assert.strictEqual(unknown.ok, false);
});

test('gate rejects a rule pasted into the prelude and an empty candidate', () => {
    const prelude = GAME.indexOf('\n') + 1;
    assert.strictEqual(engine.gate(GAME, prelude, prelude, '[ Player ] -> [ Crate ]').ok, false);
    assert.strictEqual(engine.gate(GAME, RULES_INSERT, RULES_INSERT, '   ').reason, 'empty');
});

test('gate allows OBJECTS to declare a new name and keeps the engine error state clean', () => {
    const objectsEnd = GAME.indexOf('\n=======\nLEGEND');
    const r = engine.gate(GAME, objectsEnd, objectsEnd, '\nTarget\nyellow');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    // A second, unrelated validate must still see a clean game.
    assert.strictEqual(engine.validateCompileSource(GAME).ok, true);
});
