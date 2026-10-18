'use strict';
// Tests for autocomplete/eval/ngram.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');

const ngram = require('../eval/ngram.js');

const GAME = [
    'title T', '========', 'OBJECTS', '========', 'Background', 'black', 'Player', 'red', 'Crate', 'blue',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate',
    '=======', 'SOUNDS', '=======',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate',
    '======', 'RULES', '======', '[ > Player | Crate ] -> [ > Player | > Crate ]', 'late [ Crate | Player ] -> [ | Player ]',
    '==============', 'WINCONDITIONS', '==============', 'No Crate',
    '=======', 'LEVELS', '=======', 'P*.', '',
].join('\n');

test('tokenize keeps newlines as tokens and labels sections', () => {
    const { tokens, sections } = ngram.tokenize('title T\nOBJECTS\nPlayer\nred\n');
    assert.deepStrictEqual(tokens, ['title', 'T', '\n', 'OBJECTS', '\n', 'Player', '\n', 'red', '\n']);
    assert.strictEqual(sections[1], 'prelude');
    assert.strictEqual(sections[5], 'objects');
    assert.strictEqual(tokens.length, sections.length);
});

test('a trained model assigns a proper distribution and prefers seen continuations', () => {
    const model = new ngram.KneserNey(5);
    model.train(GAME);
    model.train(GAME.replace(/Crate/g, 'Box'));
    model.finalize();
    const history = ['[', '>', 'Player', '|'];
    let total = 0;
    for (const w of model.vocab('rules')) total += model.prob('rules', history, w);
    assert.ok(Math.abs(total - 1) < 1e-6, 'probabilities sum to 1: ' + total);
    const best = model.predictNext('rules', history);
    assert.strictEqual(best.token, '>', 'seen twice (once per document) vs Crate/Box once each: ' + JSON.stringify(best));
    assert.strictEqual(model.predictNext('rules', history, 'C').token, 'Crate');
    const withPrefix = model.predictNext('rules', history, 'B');
    assert.strictEqual(withPrefix.token, 'Box');
    assert.strictEqual(model.predictNext('rules', history, 'zzz'), null);
});

test('generate reproduces a memorised line and stops at the newline', () => {
    const model = new ngram.KneserNey(5);
    for (let i = 0; i < 3; i++) model.train(GAME);
    model.finalize();
    const history = ngram.tokenize(GAME.slice(0, GAME.indexOf('late ['))).tokens;
    const out = model.generate('rules', history, { stop: 'line', maxTokens: 40 });
    assert.strictEqual(out.text, 'late [ Crate | Player ] -> [ | Player ]');
    const block = model.generate('objects', ngram.tokenize(GAME.slice(0, GAME.indexOf('Player\nred'))).tokens, { stop: 'block', maxTokens: 40 });
    assert.ok(block.text.startsWith('Player\nred'), block.text);
});

test('sequenceLogProb scores a candidate continuation', () => {
    const model = new ngram.KneserNey(5);
    model.train(GAME);
    model.finalize();
    const history = ['[', '>', 'Player', '|'];
    const seen = model.sequenceLogProb('rules', history, ['Crate', ']']);
    const unseen = model.sequenceLogProb('rules', history, ['Wall', ']']);
    assert.ok(seen > unseen);
});
