'use strict';
// Tests for autocomplete/pipeline/ingest.js. Run: node --test autocomplete/tests/

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ingest = require('../pipeline/ingest.js');

const GAME = [
    'title Test Game',
    'author Real Person',
    'homepage www.example.org/me',
    '',
    '========',
    'OBJECTS',
    '========',
    'Background',
    'black',
    'Player',
    'red',
    '=======',
    'LEGEND',
    '=======',
    '. = Background',
    'P = Player',
    '=======',
    'SOUNDS',
    '=======',
    '================',
    'COLLISIONLAYERS',
    '================',
    'Background',
    'Player',
    '======',
    'RULES',
    '======',
    '==============',
    'WINCONDITIONS',
    '==============',
    '=======',
    'LEVELS',
    '=======',
    'P..',
    '',
].join('\n');

function gistJson(gistId, owner, files, extra = {}) {
    return JSON.stringify({
        url: 'https://api.github.com/gists/' + gistId,
        status: 200,
        data: Object.assign({
            id: gistId,
            owner: { login: owner },
            created_at: '2024-01-02T03:04:05Z',
            updated_at: '2024-01-02T03:04:05Z',
            history: [{}],
            truncated: false,
            files,
        }, extra),
    });
}

function scriptFile(content, truncated = false) {
    return { 'readme.txt': { content: 'see www.puzzlescript.net' },
             'script.txt': { filename: 'script.txt', size: Buffer.byteLength(content), truncated, content } };
}

test('normaliseText strips BOM, converts CRLF and lone CR, keeps unicode', () => {
    const out = ingest.normaliseText('﻿title x\r\nfoo\rbar\n██');
    assert.strictEqual(out, 'title x\nfoo\nbar\n██');
});

test('neutraliseIdentity replaces author and homepage values only in the prelude', () => {
    const src = 'title T\nAuthor  Jane Doe\nhomepage http://x.y\n\nOBJECTS\nauthor\nred\nLEGEND\nauthor = Background\n';
    const out = ingest.neutraliseIdentity(src);
    assert.strictEqual(out, 'title T\nauthor anon\nhomepage example.com\n\nOBJECTS\nauthor\nred\nLEGEND\nauthor = Background\n');
});

test('isJunk flags non-PuzzleScript text', () => {
    assert.strictEqual(ingest.isJunk(GAME), false);
    assert.strictEqual(ingest.isJunk('function foo() {}\nOBJECTS\n'), true);
    assert.strictEqual(ingest.isJunk('title no objects section\nLEGEND\n'), true);
    assert.strictEqual(ingest.isJunk('(comment first)\n\ntitle x\nOBJECTS\n'), false);
    assert.strictEqual(ingest.isJunk('========\nOBJECTS\n========\n'), false);
});

test('runIngest writes manifest, text and stats', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-ingest-'));
    const dump = path.join(tmp, 'dump');
    const processed = path.join(tmp, 'dumpprocessed');
    const data = path.join(tmp, 'data');
    fs.mkdirSync(dump);
    fs.mkdirSync(processed);

    const crlfGame = '﻿' + GAME.replace(/\n/g, '\r\n');
    fs.writeFileSync(path.join(dump, 'alice_aaaa.json'), gistJson('aaaa', 'alice', scriptFile(crlfGame)));
    fs.writeFileSync(path.join(dump, 'bob_bbbb.json'), gistJson('bbbb', 'bob', { 'gistfile1.txt': { content: 'x' } }));
    fs.writeFileSync(path.join(dump, 'carol_cccc.json'), gistJson('cccc', 'carol', scriptFile('title tiny\n')));
    fs.writeFileSync(path.join(dump, 'dave_dddd.json'), gistJson('dddd', 'dave', scriptFile('x'.repeat(300) + '\nOBJECTS\n')));
    fs.writeFileSync(path.join(dump, 'erin_eeee.json'), gistJson('eeee', 'erin', scriptFile(GAME, true)));
    fs.writeFileSync(path.join(dump, 'frank_ffff.json'), gistJson('ffff', 'frank', scriptFile('y'.repeat(ingest.MAX_BYTES + 1))));
    fs.writeFileSync(path.join(dump, 'broken.json'), '{not json');
    // dumpprocessed has alice (kept) and bob (which we skip): lets the stats cross-check both directions
    fs.writeFileSync(path.join(processed, 'alice_aaaa.txt'), GAME);
    fs.writeFileSync(path.join(processed, 'bob_bbbb.txt'), 'x');

    const stats = ingest.runIngest({ dumpDir: dump, dataDir: data, dumpprocessedDir: processed, quiet: true });

    const manifest = fs.readFileSync(path.join(data, 'raw', 'manifest.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
    const byId = Object.fromEntries(manifest.map(r => [r.id, r]));

    assert.deepStrictEqual(Object.keys(byId).sort(), ['alice_aaaa', 'dave_dddd']);
    const a = byId.alice_aaaa;
    assert.strictEqual(a.gist_id, 'aaaa');
    assert.strictEqual(a.owner, 'alice');
    assert.strictEqual(a.created_at, '2024-01-02T03:04:05Z');
    assert.strictEqual(a.history, 1);
    assert.strictEqual(a.junk, false);
    assert.strictEqual(a.truncated, false);
    assert.strictEqual(typeof a.sha256, 'string');
    assert.strictEqual(a.sha256.length, 64);

    const text = fs.readFileSync(path.join(data, 'raw', 'text', 'alice_aaaa.txt'), 'utf8');
    assert.ok(!text.includes('\r'));
    assert.ok(!text.includes('﻿'));
    assert.ok(!text.includes('Real Person'));
    assert.ok(text.includes('\nauthor anon\n'));
    assert.ok(text.includes('\nhomepage example.com\n'));
    assert.strictEqual(a.bytes, Buffer.byteLength(text));

    assert.strictEqual(byId.dave_dddd.junk, true);

    assert.strictEqual(stats.files_seen, 7);
    assert.strictEqual(stats.unparseable, 1);
    assert.strictEqual(stats.no_script_txt, 1);
    assert.strictEqual(stats.truncated, 1);
    assert.strictEqual(stats.too_small, 1);
    assert.strictEqual(stats.too_large, 1);
    assert.strictEqual(stats.kept, 2);
    assert.strictEqual(stats.junk, 1);
    assert.strictEqual(stats.bytes.count, 2);
    assert.strictEqual(stats.dumpprocessed.files, 2);
    assert.strictEqual(stats.dumpprocessed.in_both, 1);
    assert.strictEqual(stats.dumpprocessed.only_in_dumpprocessed, 1);
    assert.strictEqual(stats.dumpprocessed.only_in_manifest, 1);

    const written = JSON.parse(fs.readFileSync(path.join(data, 'raw', 'ingest_stats.json'), 'utf8'));
    assert.strictEqual(written.kept, 2);
    fs.rmSync(tmp, { recursive: true, force: true });
});
