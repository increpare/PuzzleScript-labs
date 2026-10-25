#!/usr/bin/env node
'use strict';

// Checks MIS95's Static analysis tab projection (src/js/static_analysis_badges.js):
// badges land on the right source lines, and every badge has a description.
//   node src/tests/static_analysis_badges_node.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { analyzeSource } = require('./ps_static_analysis');
const { compileSemanticSource } = require('../canonicalize');
const { buildBadges } = require('../js/static_analysis_badges');

function badgesFor(file, anyBoard) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'demo', file), 'utf8');
    const state = compileSemanticSource(source, { includeWinConditions: true, throwOnError: false }).state;
    const report = analyzeSource(source, { arbitraryBoards: anyBoard });
    assert.strictEqual(report.status, 'ok', file);
    const model = buildBadges(report, {
        nameLines: state.original_line_numbers,
        levelLines: Array.from(state.levels, level => level.lineNumber || null),
        sourceText: source,
        anyBoard,
    });
    const lines = source.split('\n');
    const at = text => {
        const line = lines.findIndex(l => l.trim() === text) + 1;
        assert(line > 0, `no line "${text}" in ${file}`);
        const entry = model.lines.find(e => e[0] === line);
        return entry ? entry[1] : [];
    };
    return { model, at };
}

const has = (badges, text, kind) => badges.some(b => b.t === text && (!kind || b.k === kind));
let failures = 0;
function check(name, fn) {
    try { fn(); console.log('ok   ' + name); }
    catch (error) { failures++; console.log('FAIL ' + name + '\n     ' + error.message); }
}

const source = badgesFor('blockfaker.txt', false);
check('object tags on the object line', () => {
    assert(has(source.at('Background'), 'cosmetic', 'on'));
    assert(has(source.at('Background'), 'layer: 0', 'val'));
    assert(has(source.at('Wall'), 'merge ↔ WallBlock', 'candidate'));
});
check('rule tags merge one line\'s compiled directions', () => {
    const rule = source.at('[ > Moveable | Moveable ] -> [ > Moveable | > Moveable ]');
    assert(has(rule, 'direction: down×2 right×2'));
    assert(has(rule, 'movement_only', 'on'));
    assert(has(rule, 'schema: pusher'));
});
check('collision layers found by scanning their section', () => {
    assert(has(source.at('Player, Wall, WallBlock, PinkBlock, BlueBlock, PurpleBlock, OrangeBlock, GreenBlock'), 'layer: 3'));
});
check('win conditions and levels', () => {
    assert(has(source.at('some Player on Endpoint'), 'woken_by_rules: L138'));
    assert(has(source.at('........########'), 'object_universe', 'proved'));
});
check('game tags in the strip', () => {
    assert(has(source.model.game, 'can_win', 'on'));
    assert(has(source.model.game, 'program_flow', 'proved'));
});
check('punctuation legend names get their line', () => {
    const microban = badgesFor('microban.txt', false);
    for (const glyph of ['. = Background', '# = Wall', '* = Crate']) assert(has(microban.at(glyph), 'synonym'), glyph);
    assert(has(microban.at('@ = Crate and Target'), 'aggregate'));
});
check('glyphs declared on an object line ("Tree #") get that line', () => {
    const game = badgesFor('byyourside.txt', false);
    for (const [line, glyph] of [['Grass .', '.'], ['Tree #', '#'], ['house @', '@'], ['gravedirt ~', '~']]) {
        assert(has(game.at(line), `synonym: ${glyph}`), line);
    }
});
check('any board: no stand-in level tags', () => {
    const any = badgesFor('blockfaker.txt', true);
    assert.deepStrictEqual(any.at('........########'), []);
    assert(!has(any.at('Background'), 'present_in_all_levels'));
    assert(!has(any.at('Player'), 'quantity.exactly_one'));
});
check('cardinality tags on objects', () => {
    assert(has(source.at('Player'), 'quantity.exactly_one', 'on'));
    assert(has(source.at('Player'), 'quantity.at_most_one', 'on'));
});
check('every badge has a description', () => {
    for (const file of ['blockfaker.txt', 'sokoban_basic.txt', 'atlas shrank.txt', 'cakemonsters.txt']) {
        if (!fs.existsSync(path.join(__dirname, '..', 'demo', file))) continue;
        const { model } = badgesFor(file, false);
        const missing = new Set();
        for (const badge of model.game.concat(...model.lines.map(e => e[1]))) {
            if (badge.d.split('\n\n').length < 2) missing.add(badge.t.replace(/[:×].*$/, '').trim());
        }
        assert.strictEqual(missing.size, 0, `${file}: no description for ${[...missing].join(', ')}`);
    }
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('all passed');
