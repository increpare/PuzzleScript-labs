'use strict';
// Tests for autocomplete/pipeline/build_samples.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bs = require('../pipeline/build_samples.js');

const GAME = [
    'title Sample', 'author anon', 'homepage example.com', '',
    '========', 'OBJECTS', '========', 'Background', 'black', '', 'Player', 'red', '', 'Crate', 'blue',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate',
    '=======', 'SOUNDS', '=======', 'sfx0 1234',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate',
    '======', 'RULES', '======', '[ > Player | Crate ] -> [ > Player | > Crate ]', '[ > Player | Crate ] -> [ > Player | > Crate ] sfx0',
    '==============', 'WINCONDITIONS', '==============', 'No Crate',
    '=======', 'LEVELS', '=======', 'message hi', '', 'P*.', '', '.P*', '', '*P.', '', 'P..', '',
].join('\n');

test('weightFor applies the section rules and the broken-file multiplier', () => {
    assert.strictEqual(bs.weightFor(false)('levels', 'target', 'P*.\n'), 0.2);
    assert.strictEqual(bs.weightFor(false)('levels', 'target', 'message hi\n'), 1);
    assert.strictEqual(bs.weightFor(false)('prelude', 'prefix', 'author anon\n'), 0);
    assert.strictEqual(bs.weightFor(false)('prelude', 'prefix', 'homepage example.com\n'), 0);
    assert.strictEqual(bs.weightFor(false)('prelude', 'prefix', 'title x\n'), 1);
    assert.strictEqual(bs.weightFor(false)('rules', 'target', '[ a ] -> [ b ]\n'), 1);
    assert.strictEqual(bs.weightFor(true)('rules', 'target', '[ a ] -> [ b ]\n'), 0.3);
    assert.strictEqual(bs.weightFor(true)('levels', 'target', 'P*.\n'), 0.06);
});

test('chooseFimSpan picks a target inside the text and respects the line/char mix', () => {
    const rand = bs.seededRandom(3);
    let lineStarts = 0, total = 0;
    for (let i = 0; i < 200; i++) {
        const { from, to } = bs.chooseFimSpan(GAME, rand);
        assert.ok(from >= 0 && from < to && to <= GAME.length, `${from}..${to}`);
        total++;
        if (from === 0 || GAME[from - 1] === '\n') lineStarts++;
    }
    assert.ok(lineStarts / total > 0.3 && lineStarts / total < 0.7, 'about half at line boundaries: ' + lineStarts / total);
});

test('runBuildSamples writes causal and FIM samples with contiguous spans and stats', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-samples-'));
    const raw = path.join(tmp, 'raw');
    const textDir = path.join(raw, 'text');
    fs.mkdirSync(textDir, { recursive: true });
    const BROKEN = GAME.replace('[ > Player | Crate ] -> [ > Player | > Crate ]\n', '[ > Player | Crate ] -> [ > Player ]\n');
    fs.writeFileSync(path.join(textDir, 'g1.txt'), GAME);
    fs.writeFileSync(path.join(textDir, 'g2.txt'), BROKEN);
    fs.writeFileSync(path.join(textDir, 'g3.txt'), GAME.replace('title Sample', 'title Other'));
    fs.writeFileSync(path.join(raw, 'manifest.jsonl'), ['g1', 'g2', 'g3'].map(id => JSON.stringify({ id, bytes: 10 })).join('\n') + '\n');
    fs.writeFileSync(path.join(tmp, 'compile.jsonl'), [
        { id: 'g1', status: 'ok' }, { id: 'g2', status: 'errors' }, { id: 'g3', status: 'warnings' },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(tmp, 'splits.json'), JSON.stringify({
        train: [{ lineage_id: 'L1', file_ids: ['g1', 'g2'] }], val: [{ lineage_id: 'L2', file_ids: ['g3'] }], test: [],
    }));

    const stats = bs.runBuildSamples({ dataDir: tmp, seed: 1, fimRate: 1, quiet: true });
    const train = fs.readFileSync(path.join(tmp, 'samples', 'train.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const val = fs.readFileSync(path.join(tmp, 'samples', 'val.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(train.filter(s => s.kind === 'causal').length, 2);
    assert.strictEqual(train.filter(s => s.kind.startsWith('fim')).length, 2, 'fimRate 1 gives one FIM sample per file');
    assert.strictEqual(val.length, 2);

    for (const s of [...train, ...val]) {
        let covered = 0;
        for (const sp of s.spans) { assert.strictEqual(sp.start, covered); covered = sp.end; }
        assert.strictEqual(covered, s.text.length, 'spans cover ' + s.kind);
        assert.ok(s.text.endsWith('<EOS>'));
        assert.ok(['prelude', 'objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'].includes(s.section));
    }
    const causal1 = train.find(s => s.id === 'g1' && s.kind === 'causal');
    assert.ok(causal1.text.startsWith('<PRE><SUF><MID>title Sample'), 'causal has no header and no prefix');
    assert.ok(!causal1.text.includes('P..'), 'causal levels trimmed to three');
    assert.ok(causal1.text.includes('message hi'));
    const authorSpan = causal1.spans.find(sp => sp.start === causal1.text.indexOf('author anon'));
    assert.strictEqual(authorSpan.weight, 0);
    const levelSpan = causal1.spans.find(sp => sp.start === causal1.text.indexOf('P*.'));
    assert.strictEqual(levelSpan.weight, 0.2);
    const causal2 = train.find(s => s.id === 'g2' && s.kind === 'causal');
    const ruleSpan = causal2.spans.find(sp => sp.start === causal2.text.indexOf('[ > Player | Crate ] -> [ > Player ]'));
    assert.strictEqual(ruleSpan.weight, 0.3, 'broken file multiplier');

    const fim = train.find(s => s.id === 'g1' && s.kind.startsWith('fim'));
    const target = fim.spans.filter(sp => sp.kind === 'target');
    assert.ok(target.length >= 1 && fim.text.slice(target[0].start, target[target.length - 1].end).length > 0);
    assert.ok(fim.text.includes('<MID>'));
    assert.ok(fim.spans.some(sp => sp.kind === 'prefix') || fim.spans.some(sp => sp.kind === 'suffix'));

    assert.strictEqual(stats.train.files, 2);
    assert.strictEqual(stats.train.causal, 2);
    assert.strictEqual(stats.train.fim, 2);
    assert.ok(stats.train.chars > 0);
    assert.ok(fs.existsSync(path.join(tmp, 'samples', 'samples_stats.json')));
    fs.rmSync(tmp, { recursive: true, force: true });
});
