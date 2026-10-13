'use strict';
// Tests for autocomplete/pipeline/compile_filter.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cf = require('../pipeline/compile_filter.js');

const GOOD = [
    'title Good', 'author anon', '', '========', 'OBJECTS', '========',
    'Background', 'black', 'Player', 'red', 'Crate', 'blue',
    '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate',
    '=======', 'SOUNDS', '=======',
    '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate',
    '======', 'RULES', '======', '[ > Player | Crate ] -> [ > Player | > Crate ]',
    '==============', 'WINCONDITIONS', '==============',
    '=======', 'LEVELS', '=======', 'P*.', '',
].join('\n');

const GOOD_MORE_LEVELS = GOOD.replace('P*.\n', 'P*.\n\n.P*\n');
const WARN = GOOD.replace('author anon\n', 'author anon\nyoutube abc\n');
const BAD = GOOD.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', '[ Player ] -> [ Player | Player ]');

test('compileOne classifies ok, warnings and errors and strips html from messages', () => {
    const ok = cf.compileOne(GOOD);
    assert.strictEqual(ok.status, 'ok');
    assert.strictEqual(ok.errorCount, 0);
    assert.strictEqual(ok.hash_no_levels.length, 64);
    assert.strictEqual(ok.hash_mechanics.length, 64);

    const warn = cf.compileOne(WARN);
    assert.strictEqual(warn.status, 'warnings');
    assert.strictEqual(warn.errorCount, 0);
    assert.ok(warn.errorStrings.length >= 1);
    assert.ok(!/<[a-z]/.test(warn.errorStrings[0]), 'html tags stripped');

    const bad = cf.compileOne(BAD);
    assert.strictEqual(bad.status, 'errors');
    assert.ok(bad.errorCount >= 1);
    assert.ok(bad.errorStrings[0].includes('equal length'));
    assert.strictEqual(bad.hash_no_levels, null);
});

test('no-levels hash ignores levels, structural difference changes it', () => {
    const a = cf.compileOne(GOOD);
    const b = cf.compileOne(GOOD_MORE_LEVELS);
    assert.strictEqual(a.hash_no_levels, b.hash_no_levels);
    assert.strictEqual(a.hash_mechanics, b.hash_mechanics);
    const c = cf.compileOne(GOOD.replace('[ > Player | Crate ] -> [ > Player | > Crate ]', '[ > Player | Crate ] -> [ Player | Crate ]'));
    assert.notStrictEqual(a.hash_no_levels, c.hash_no_levels);
});

test('normaliseErrorString folds line numbers and names', () => {
    assert.strictEqual(cf.normaliseErrorString(' line 12 : Object "foo" not defined'), 'line # : Object "foo" not defined');
});

test('runCompileFilter runs children with a watchdog, resumes, and reports', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-cf-'));
    const raw = path.join(tmp, 'raw');
    const textDir = path.join(raw, 'text');
    fs.mkdirSync(textDir, { recursive: true });
    const rows = [
        { id: 'a_good', junk: false }, { id: 'b_bad', junk: false }, { id: 'c_junk', junk: true },
        { id: 'd_hang', junk: false }, { id: 'e_good2', junk: false },
    ];
    fs.writeFileSync(path.join(raw, 'manifest.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(textDir, 'a_good.txt'), GOOD);
    fs.writeFileSync(path.join(textDir, 'b_bad.txt'), BAD);
    fs.writeFileSync(path.join(textDir, 'c_junk.txt'), 'nonsense');
    fs.writeFileSync(path.join(textDir, 'd_hang.txt'), GOOD);
    fs.writeFileSync(path.join(textDir, 'e_good2.txt'), GOOD_MORE_LEVELS);

    const report = await cf.runCompileFilter({
        dataDir: tmp, workers: 2, timeoutMs: 1500, quiet: true,
        env: { PS_AC_TEST_HANG_ID: 'd_hang' },
    });
    const lines = fs.readFileSync(path.join(tmp, 'compile.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const byId = Object.fromEntries(lines.map(r => [r.id, r]));
    assert.deepStrictEqual(Object.keys(byId).sort(), ['a_good', 'b_bad', 'c_junk', 'd_hang', 'e_good2']);
    assert.strictEqual(byId.a_good.status, 'ok');
    assert.strictEqual(byId.b_bad.status, 'errors');
    assert.strictEqual(byId.c_junk.status, 'junk');
    assert.strictEqual(byId.d_hang.status, 'timeout');
    assert.strictEqual(byId.e_good2.status, 'ok');
    assert.strictEqual(byId.e_good2.hash_no_levels, byId.a_good.hash_no_levels);
    assert.strictEqual(report.counts.ok, 2);
    assert.strictEqual(report.counts.timeout, 1);
    assert.strictEqual(report.counts.junk, 1);
    assert.ok(Array.isArray(report.top_errors));
    assert.ok(fs.existsSync(path.join(tmp, 'compile_report.json')));

    // resume: add one file, rerun, only the new one is compiled
    fs.appendFileSync(path.join(raw, 'manifest.jsonl'), JSON.stringify({ id: 'f_good3', junk: false }) + '\n');
    fs.writeFileSync(path.join(textDir, 'f_good3.txt'), GOOD);
    const report2 = await cf.runCompileFilter({ dataDir: tmp, workers: 1, timeoutMs: 1500, quiet: true, resume: true });
    assert.strictEqual(report2.compiled_this_run, 1);
    const lines2 = fs.readFileSync(path.join(tmp, 'compile.jsonl'), 'utf8').trim().split('\n');
    assert.strictEqual(lines2.length, 6);
    fs.rmSync(tmp, { recursive: true, force: true });
});
