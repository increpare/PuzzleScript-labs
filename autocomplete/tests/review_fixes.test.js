'use strict';
// Regression tests for the findings of the Phase 0 code review. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ingest = require('../pipeline/ingest.js');
const cf = require('../pipeline/compile_filter.js');
const dedup = require('../pipeline/dedup.js');
const ctx = require('../pipeline/context.js');
const canonicalize = require('../../src/canonicalize.js');

const GAME = [
    'title Review Game', 'author anon', '', '========', 'OBJECTS', '========',
    'Background', 'black', 'Player', 'red', 'Crate', 'blue',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate',
    '=======', 'SOUNDS', '=======',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate',
    '======', 'RULES', '======', '[ > Player | Crate ] -> [ > Player | > Crate ]',
    '==============', 'WINCONDITIONS', '==============',
    '=======', 'LEVELS', '=======', 'P*.', '',
].join('\n');

// --- ingest: junk heuristic and identity replacement ------------------------------

test('isJunk is not fooled by a leading multi-line comment', () => {
    const commented = '(\n  A long header comment\n  spanning lines (and nesting)\n)\n\n' + GAME;
    assert.strictEqual(ingest.isJunk(commented), false);
    assert.strictEqual(ingest.isJunk('(\n comment\n)\nfunction foo() {}\nOBJECTS\n'), true);
});

test('neutraliseIdentity stops at a commented section header and leaves objects alone', () => {
    const src = 'title T\nauthor Jane\nOBJECTS (my objects)\nAuthor\nred\nhomepage\nblue\n';
    const out = ingest.neutraliseIdentity(src);
    assert.strictEqual(out, 'title T\nauthor anon\nOBJECTS (my objects)\nAuthor\nred\nhomepage\nblue\n');
});

// --- canonicalize: aborted parse is an error ---------------------------------------

test('parseSourceState reports an aborted parse as an error, and canonicalizeSource refuses it', () => {
    const warningsOnly = GAME.replace('P*.\n', 'P*.\n' + Array.from({ length: 120 }, (_, i) => `\nmessagehi${i}`).join('') + '\n');
    const r = canonicalize.parseSourceState(warningsOnly);
    assert.strictEqual(r.aborted, true);
    assert.ok(r.errorCount > 0, 'aborted parse counts as an error');
    assert.ok(r.state && r.state.objects, 'partial state is still returned');
    assert.throws(() => canonicalize.canonicalizeSource(warningsOnly, 'structural'), /Unable to canonicalize/);
    const ok = canonicalize.parseSourceState(GAME);
    assert.strictEqual(ok.aborted, false);
});

// --- context: section labels ---------------------------------------------------------

test('prefix section labels are right when the cursor is at a line start', () => {
    const text = 'title T\n\n=======\nLEGEND\n=======\nP = Player\n';
    const cursor = text.indexOf('LEGEND');
    const c = ctx.buildContext({ text, from: cursor, to: cursor, symbols: () => null });
    const labels = c.prefixLines.map(l => l.section);
    assert.deepStrictEqual(labels, ['prelude', 'prelude', 'prelude'], JSON.stringify(c.prefixLines));
    const mid = ctx.buildContext({ text, from: cursor + 3, to: cursor + 3, symbols: () => null });
    assert.strictEqual(mid.prefixLines[mid.prefixLines.length - 1].section, 'legend');
});

test('a target that starts with a section header is labelled with that section', () => {
    const from = GAME.indexOf('LEGEND');
    const to = GAME.indexOf('=======\nSOUNDS');
    const c = ctx.buildContext({ text: GAME, from, to, symbols: () => null });
    assert.strictEqual(c.sectionAtCursor, 'legend');
    assert.strictEqual(c.targetLines[0].section, 'legend');
});

// --- dedup: owner-keyed union ----------------------------------------------------------

test('same owner with the same mechanics hash or title is one lineage even when the text differs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-dedup2-'));
    const raw = path.join(tmp, 'raw');
    const textDir = path.join(raw, 'text');
    fs.mkdirSync(textDir, { recursive: true });
    const A = GAME;
    const B = GAME.replace(/Player/g, 'Hero').replace(/Crate/g, 'Box').replace('red', 'green').replace('blue', 'yellow'); // rename + recolour
    // Same title, same owner, but the code moved on a lot: new objects, six new rules, new levels.
    const C = GAME
        .replace('Crate\nblue', 'Crate\nblue\nWall\ngrey\nGoal\nwhite\nKey\norange')
        .replace('* = Crate', '* = Crate\n# = Wall\nO = Goal\nK = Key')
        .replace('Player, Crate', 'Player, Crate, Key\nWall\nGoal')
        .replace('[ > Player | Crate ] -> [ > Player | > Crate ]',
            ['[ > Player | Wall ] -> [ Player | Wall ]', '[ > Player | Key ] -> [ > Player | ]', '[ Crate | Goal ] -> [ | Goal ]',
             'late [ Player | Goal ] -> [ Player | ]', '[ action Player ] -> [ Player Key ]', 'down [ Key | Wall ] -> [ | Wall ]'].join('\n'))
        .replace('P*.\n', '#####\n#P*O#\n#K..#\n#####\n');
    assert.ok(dedup.jaccard(dedup.shingleSet(dedup.codeTokens(A)), dedup.shingleSet(dedup.codeTokens(C))) < 0.8, 'C is not a near duplicate of A');
    const D = GAME.replace(/Player/g, 'Dude').replace(/Crate/g, 'Rock').replace('red', 'pink').replace('blue', 'white');
    const files = { a: A, b: B, c: C, d: D };
    const owners = { a: 'ann', b: 'ann', c: 'ann', d: 'bob' };
    const manifest = [], compile = [];
    for (const [id, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(textDir, id + '.txt'), text);
        manifest.push({ id, owner: owners[id], created_at: '2024-01-0' + (Object.keys(files).indexOf(id) + 1) + 'T00:00:00Z', junk: false, bytes: text.length });
        compile.push({ id, status: 'ok', hash_no_levels: 'NL' + id, hash_mechanics: id === 'c' ? 'MC' : 'MSAME' });
    }
    fs.writeFileSync(path.join(raw, 'manifest.jsonl'), manifest.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(tmp, 'compile.jsonl'), compile.map(r => JSON.stringify(r)).join('\n') + '\n');
    const report = dedup.runDedup({ dataDir: tmp, demoDir: null, quiet: true });
    const lineages = fs.readFileSync(path.join(tmp, 'lineages.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const byMember = {};
    for (const l of lineages) for (const id of l.file_ids) byMember[id] = l;
    assert.strictEqual(byMember.a, byMember.b, 'owner+mechanics unions a rename/recolour');
    assert.strictEqual(byMember.a, byMember.c, 'owner+title unions a rule change under the same title');
    assert.notStrictEqual(byMember.a, byMember.d, 'another owner with the same mechanics stays apart');
    assert.ok(report.owner_mechanics_merges >= 1);
    assert.ok(report.owner_title_merges >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
});

// --- compile filter: startup crash and junk redo on resume --------------------------------

test('a worker that dies before its first file does not relaunch forever', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-cf2-'));
    const raw = path.join(tmp, 'raw');
    const textDir = path.join(raw, 'text');
    fs.mkdirSync(textDir, { recursive: true });
    fs.writeFileSync(path.join(raw, 'manifest.jsonl'), ['x1', 'x2'].map(id => JSON.stringify({ id, junk: false })).join('\n') + '\n');
    fs.writeFileSync(path.join(textDir, 'x1.txt'), GAME);
    fs.writeFileSync(path.join(textDir, 'x2.txt'), GAME);
    const report = await cf.runCompileFilter({ dataDir: tmp, workers: 1, timeoutMs: 5000, quiet: true, env: { PS_AC_TEST_CRASH_START: '1' } });
    const rows = fs.readFileSync(path.join(tmp, 'compile.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every(r => r.status === 'errors' && /failed to start/.test(r.errorStrings[0])));
    assert.strictEqual(report.counts.errors, 2);
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('resume recompiles files that were junk before the heuristic changed', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-cf3-'));
    const raw = path.join(tmp, 'raw');
    const textDir = path.join(raw, 'text');
    fs.mkdirSync(textDir, { recursive: true });
    fs.writeFileSync(path.join(textDir, 'y1.txt'), GAME);
    fs.writeFileSync(path.join(textDir, 'y2.txt'), GAME);
    fs.writeFileSync(path.join(raw, 'manifest.jsonl'), [{ id: 'y1', junk: false }, { id: 'y2', junk: false }].map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(tmp, 'compile.jsonl'), [
        { id: 'y1', status: 'ok', errorCount: 0, errorStrings: [], ms: 1, hash_no_levels: 'H', hash_mechanics: 'M' },
        { id: 'y2', status: 'junk', errorCount: 0, errorStrings: [], ms: 0, hash_no_levels: null, hash_mechanics: null },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    const report = await cf.runCompileFilter({ dataDir: tmp, workers: 1, timeoutMs: 5000, quiet: true, resume: true });
    assert.strictEqual(report.compiled_this_run, 1);
    const rows = fs.readFileSync(path.join(tmp, 'compile.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows.find(r => r.id === 'y2').status, 'ok');
    assert.strictEqual(rows.find(r => r.id === 'y1').hash_no_levels, 'H', 'existing row kept');
    fs.rmSync(tmp, { recursive: true, force: true });
});
