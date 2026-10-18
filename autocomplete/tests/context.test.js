'use strict';
// Tests for autocomplete/pipeline/context.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');

const ctx = require('../pipeline/context.js');

const DOC = [
    'title T', 'author anon', 'homepage example.com', '',
    '========', 'OBJECTS', '========',
    'Background', 'black', '', 'Player', 'red', '00000', '0...0', '0...0', '0...0', '00000', '', 'Crate', 'blue',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate',
    '=======', 'SOUNDS', '=======', 'sfx0 1234', 'Crate move sfx0',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate',
    '======', 'RULES', '======', '[ > Player | Crate ] -> [ > Player | > Crate ]',
    '==============', 'WINCONDITIONS', '==============', 'No Crate',
    '=======', 'LEVELS', '=======',
    'message one', '', 'P*.', '', '.P*', '', '*P.', '', 'message four', '', 'P..', '', '..P', '',
].join('\n');

test('lineSections labels every line with its section', () => {
    const secs = ctx.lineSections(DOC);
    const lines = DOC.split('\n');
    assert.strictEqual(secs.length, lines.length);
    assert.strictEqual(secs[0], 'prelude');
    assert.strictEqual(secs[lines.indexOf('Player')], 'objects');
    assert.strictEqual(secs[lines.indexOf('P = Player')], 'legend');
    assert.strictEqual(secs[lines.indexOf('No Crate')], 'winconditions');
    assert.strictEqual(secs[lines.indexOf('..P')], 'levels');
    assert.strictEqual(secs[lines.indexOf('RULES')], 'rules');
});

test('trimLevels keeps the first N levels, all messages, and the block around the cursor', () => {
    const cursor = DOC.indexOf('..P');
    const t = ctx.trimLevels(DOC, { keep: 3, protectFrom: cursor, protectTo: cursor });
    assert.ok(t.text.includes('P*.') && t.text.includes('.P*') && t.text.includes('*P.'));
    assert.ok(t.text.includes('message one') && t.text.includes('message four'));
    assert.ok(!t.text.includes('P..\n'), 'fourth level dropped');
    assert.ok(t.text.includes('..P'), 'cursor level protected');
    assert.strictEqual(t.text.slice(t.map(cursor), t.map(cursor) + 3), '..P', 'offset mapping');
    const noCursor = ctx.trimLevels(DOC, { keep: 3 });
    assert.ok(!noCursor.text.includes('..P'));
    assert.strictEqual(noCursor.map(DOC.indexOf('title')), 0);
});

test('buildContext removes the target before building header and suffix', () => {
    const from = DOC.indexOf('Crate\nblue');
    const to = from + 'Crate\nblue'.length;
    const symbols = text => ({ objects: text.includes('Crate\nblue') ? ['Background', 'Player', 'Crate'] : ['Background', 'Player'], legend: ['.', 'P', '*'], sfx: ['0'] });
    const c = ctx.buildContext({ text: DOC, from, to, symbols });
    assert.strictEqual(c.target, 'Crate\nblue');
    assert.ok(!c.header.includes('Crate'), 'header built without the target: ' + c.header);
    assert.ok(c.header.includes('objects Background Player'));
    assert.ok(c.header.includes('legend . P *'));
    assert.ok(c.header.includes('sfx 0'));
    assert.ok(!c.suffix.includes('blue'), 'suffix starts after the target');
    assert.ok(c.suffix.startsWith('\n=======\nLEGEND'));
    assert.ok(c.prefix.endsWith('00000\n\n'));
    assert.strictEqual(c.sectionAtCursor, 'objects');
});

test('buildContext windows prefix and suffix in source order and respects the char budget', () => {
    const cursor = DOC.indexOf('[ > Player');
    const c = ctx.buildContext({ text: DOC, from: cursor, to: cursor, symbols: () => ({ objects: [], legend: [], sfx: [] }), config: { prefixLines: 4, suffixLines: 2, maxChars: 10000 } });
    assert.strictEqual(c.prefix, '================\nBackground\nPlayer, Crate\n======\nRULES\n======\n'.split('\n').slice(-5).join('\n'));
    assert.strictEqual(c.suffix, '[ > Player | Crate ] -> [ > Player | > Crate ]\n==============\n');
    const tight = ctx.buildContext({ text: DOC, from: cursor, to: cursor, symbols: () => ({ objects: [], legend: [], sfx: [] }), config: { prefixLines: 100, suffixLines: 100, maxChars: 120 } });
    assert.ok(tight.header.length + tight.prefix.length + tight.suffix.length <= 120);
    assert.ok(tight.prefix.endsWith('======\n'), 'prefix is trimmed from the far end: ' + JSON.stringify(tight.prefix));
});

test('render produces PSM and SPM layouts with exact spans and weights', () => {
    const from = DOC.indexOf('[ > Player');
    const to = DOC.indexOf('\n', from) + 1;
    const c = ctx.buildContext({ text: DOC, from, to, symbols: () => ({ objects: ['Player'], legend: [], sfx: [] }) });
    const weight = (section, kind, line) => kind === 'target' ? 1 : 0.5;
    const psm = ctx.render(c, 'psm', weight);
    assert.ok(psm.text.startsWith('<SYM>\nobjects Player\n<PRE>'));
    assert.ok(psm.text.includes('<SUF>'));
    assert.ok(psm.text.endsWith('<MID>[ > Player | Crate ] -> [ > Player | > Crate ]\n<EOS>'));
    let covered = 0;
    for (let i = 0; i < psm.spans.length; i++) {
        const s = psm.spans[i];
        assert.strictEqual(s.start, covered, 'spans are contiguous');
        covered = s.end;
    }
    assert.strictEqual(covered, psm.text.length, 'spans cover the whole text');
    const target = psm.spans.find(s => s.kind === 'target');
    assert.strictEqual(psm.text.slice(target.start, target.end), c.target);
    assert.strictEqual(target.weight, 1);
    assert.strictEqual(target.section, 'rules');
    assert.ok(psm.spans.filter(s => s.kind === 'marker').every(s => s.weight === 0));
    assert.ok(psm.spans.filter(s => s.kind === 'header').every(s => s.weight === 0));

    const spm = ctx.render(c, 'spm', weight);
    assert.ok(spm.text.startsWith('<SYM>\nobjects Player\n<PRE><SUF>'));
    assert.ok(spm.text.includes('<MID>' + c.prefix.slice(0, 10)));
    assert.ok(spm.text.endsWith(c.target + '<EOS>'));

    const causal = ctx.buildContext({ text: DOC, from: 0, to: DOC.length, symbols: () => ({ objects: [], legend: [], sfx: [] }) });
    assert.strictEqual(causal.header, '');
    const r = ctx.render(causal, 'psm', weight);
    assert.ok(r.text.startsWith('<PRE><SUF><MID>title T'));
    const levelSpan = r.spans.find(s => s.section === 'levels' && s.kind === 'target' && s.line === 'P*.');
    assert.ok(levelSpan, 'per-line spans inside the target');
});
