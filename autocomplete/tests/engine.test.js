'use strict';
// Tests for autocomplete/eval/engine.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');

const engine = require('../eval/engine.js');

const GAME = [
    'title T', '========', 'OBJECTS', '========', 'Background', 'black', 'Player', 'red', 'Crate', 'blue',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate',
    '=======', 'SOUNDS', '=======',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate',
    '======', 'RULES', '======', '[ > Player | Crate ] -> [ > Player | > Crate ]', '[ > Pl',
    '==============', 'WINCONDITIONS', '==============', '=======', 'LEVELS', '=======', 'P*.', '',
].join('\n');

test('stateAtCursor reports the section and declared objects at the cursor', () => {
    const offset = GAME.lastIndexOf('[ > Pl') + '[ > Pl'.length;
    const at = engine.stateAtCursor(GAME, offset);
    assert.strictEqual(at.state.section, 'rules');
    assert.ok(Object.keys(at.state.objects).includes('player'));
    assert.strictEqual(at.line, '[ > Pl');
    assert.strictEqual(at.cursor, 6);
    const top = engine.stateAtCursor(GAME, 3);
    assert.strictEqual(top.state.section, '');
});

test('completeAt proposes Player for a partial identifier in RULES with its replacement range', () => {
    const offset = GAME.lastIndexOf('[ > Pl') + '[ > Pl'.length;
    const c = engine.completeAt(GAME, offset);
    assert.strictEqual(c.section, 'rules');
    assert.strictEqual(GAME.slice(c.from, c.to), 'Pl');
    assert.ok(c.list.some(item => item.text.toLowerCase() === 'player'), JSON.stringify(c.list));
});

test('completeAt returns an empty list when there is no partial word', () => {
    const offset = GAME.lastIndexOf('[ > Pl') + 2;
    const c = engine.completeAt(GAME, offset);
    assert.deepStrictEqual(c.list, []);
});
