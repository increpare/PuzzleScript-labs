'use strict';
// Tests for autocomplete/eval/score.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const score = require('../eval/score.js');
const engine = require('../eval/engine.js');

const GAME = [
    'title T', '========', 'OBJECTS', '========', 'Background', 'black', 'Player', 'red', 'Crate', 'blue',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate',
    '=======', 'SOUNDS', '=======',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate',
    '======', 'RULES', '======', '[ > Player | Crate ] -> [ > Player | > Crate ]',
    '==============', 'WINCONDITIONS', '==============', 'No Crate',
    '=======', 'LEVELS', '=======', 'P*.', '',
].join('\n');

test('editSimilarity and normalise', () => {
    assert.strictEqual(score.editSimilarity('[ a ]', '[  a ]'), 1);
    assert.strictEqual(score.editSimilarity('abc', 'abc'), 1);
    assert.ok(score.editSimilarity('abcd', 'abce') === 0.75);
    assert.strictEqual(score.editSimilarity('', ''), 1);
});

test('symbolValid is section-aware', () => {
    const symbols = new Set(['background', 'player', 'crate', 'p', '.', '*']);
    const kw = engine.keywords();
    assert.strictEqual(score.symbolValid('rules', '[ > Player | Crate ] -> [ > Player | > Crate ]', symbols, kw), true);
    assert.strictEqual(score.symbolValid('rules', '[ > Player | Wall ] -> [ > Player | > Wall ]', symbols, kw), false);
    assert.strictEqual(score.symbolValid('rules', 'late [ Player ] -> [ Player ] message you win Bob', symbols, kw), true);
    assert.strictEqual(score.symbolValid('rules', '[ Player ] -> [ Player ] sfx3', symbols, kw), true);
    assert.strictEqual(score.symbolValid('winconditions', 'No Crate', symbols, kw), true);
    assert.strictEqual(score.symbolValid('winconditions', 'All Gem on Target', symbols, kw), false);
    assert.strictEqual(score.symbolValid('legend', 'W = Wall', symbols, kw), false);
    assert.strictEqual(score.symbolValid('legend', 'Solid = Player or Crate', symbols, kw), true);
    assert.strictEqual(score.symbolValid('objects', 'Wall\ngrey', symbols, kw), null);
    assert.strictEqual(score.symbolValid('levels', 'P*.', symbols, kw), null);
});

test('scorePredictions aggregates coverage, exact, edit_sim, compile and symbol validity', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-score-'));
    const textDir = path.join(tmp, 'raw', 'text');
    const evalDir = path.join(tmp, 'eval');
    fs.mkdirSync(textDir, { recursive: true });
    fs.mkdirSync(evalDir);
    fs.writeFileSync(path.join(textDir, 'g.txt'), GAME);
    const ruleFrom = GAME.indexOf('[ > Player | Crate ]');
    const ruleTo = ruleFrom + '[ > Player | Crate ] -> [ > Player | > Crate ]'.length;
    const winFrom = GAME.indexOf('No Crate');
    const cases = [
        { task: 'next_line', id: 'g', section: 'rules', from: ruleFrom, to: ruleTo, target: GAME.slice(ruleFrom, ruleTo), compiles: true },
        { task: 'next_line', id: 'g', section: 'rules', from: ruleFrom, to: ruleTo, target: GAME.slice(ruleFrom, ruleTo), compiles: true },
        { task: 'next_line', id: 'g', section: 'winconditions', from: winFrom, to: winFrom + 8, target: 'No Crate', compiles: true },
        { task: 'next_line', id: 'g', section: 'winconditions', from: winFrom, to: winFrom + 8, target: 'No Crate', compiles: true },
        { task: 'rest_of_token', id: 'g', section: 'rules', from: ruleFrom + 6, to: ruleFrom + 10, target: 'ayer', token_start: ruleFrom + 4, compiles: true },
    ];
    const tasksPath = path.join(evalDir, 'tasks_val.json');
    fs.writeFileSync(tasksPath, JSON.stringify({ split: 'val', counts: { next_line: {}, rest_of_token: {} }, cases }));
    const preds = [
        { i: 0, prediction: '[ > Player | Crate ] -> [ > Player | > Crate ]', latency_ms: 2 },          // exact, compiles
        { i: 1, prediction: '[ > Player | Crate ] -> [ > Player ]', latency_ms: 4 },                    // cell count mismatch: compile invalid, symbols ok
        { i: 2, prediction: null },                                                                    // no suggestion
        { i: 3, prediction: 'No Wall', latency_ms: 1 },                                                // symbol invalid and compile invalid
        { i: 4, prediction: 'ayer', candidates: ['ayer', 'xyz'], latency_ms: 1 },
    ];
    const predsPath = path.join(evalDir, 'sys.jsonl');
    fs.writeFileSync(predsPath, preds.map(p => JSON.stringify(p)).join('\n') + '\n');

    const out = await score.scorePredictions({ tasksPath, predictionsPath: predsPath, name: 'sys', dataDir: tmp, workers: 1, quiet: true });
    const nl = out.tables.next_line;
    assert.strictEqual(nl.rules.n, 2);
    assert.strictEqual(nl.rules.coverage, 1);
    assert.strictEqual(nl.rules.exact, 0.5);
    assert.strictEqual(nl.rules.compile_valid, 0.5);
    assert.strictEqual(nl.rules.symbol_valid, 1);
    assert.strictEqual(nl.rules.latency_ms, 3);
    assert.strictEqual(nl.winconditions.coverage, 0.5);
    assert.strictEqual(nl.winconditions.exact, 0);
    assert.strictEqual(nl.winconditions.symbol_valid, 0);
    assert.strictEqual(nl.winconditions.compile_valid, 0);
    assert.strictEqual(nl.overall.n, 4);
    assert.strictEqual(nl.overall.coverage, 0.75);
    assert.strictEqual(nl.overall.exact_all, 0.25);
    const rt = out.tables.rest_of_token;
    assert.strictEqual(rt.rules.exact, 1);
    assert.strictEqual(rt.rules.any_exact, 1);
    assert.strictEqual(rt.rules.compile_valid, 1);
    assert.ok(fs.existsSync(path.join(evalDir, 'scores', 'sys.md')));
    const md = fs.readFileSync(path.join(evalDir, 'scores', 'sys.md'), 'utf8');
    assert.ok(md.includes('| rules |'));
    fs.rmSync(tmp, { recursive: true, force: true });
});
