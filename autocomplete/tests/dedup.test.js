'use strict';
// Tests for autocomplete/pipeline/dedup.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dedup = require('../pipeline/dedup.js');

function game(title, rules, levels, extra = '') {
    return [
        'title ' + title, 'author anon', extra, '========', 'OBJECTS', '========',
        'Background', 'black', 'Player', 'red', '00000', '0...0', '0...0', '0...0', '00000', 'Crate', 'blue', 'Wall', 'grey',
        '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate', '# = Wall',
        '=======', 'SOUNDS', '=======',
        '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate, Wall',
        '======', 'RULES', '======', ...rules,
        '==============', 'WINCONDITIONS', '==============', 'No Crate',
        '=======', 'LEVELS', '=======', ...levels, '',
    ].join('\n');
}

const DIRS = ['>', '<', '^', 'v', 'up', 'down', 'left', 'right', 'horizontal', 'vertical', 'moving', 'stationary', 'perpendicular', 'parallel', 'orthogonal'];
const RULES = [];
for (const d of DIRS) for (const o of ['Crate', 'Wall']) RULES.push(`[ ${d} Player | ${o} ] -> [ ${d} Player | ${d} ${o} ]`);

test('codeTokens drops level rows, sprite rows and comments', () => {
    const toks = dedup.codeTokens(game('T', ['[ > Player | Crate ] -> [ > Player | > Crate ] (hidden)'], ['P*.', '###', 'message hello']));
    assert.ok(!toks.includes('p*.'));
    assert.ok(!toks.includes('###'));
    assert.ok(!toks.includes('00000'));
    assert.ok(!toks.includes('(hidden)') && !toks.includes('hidden'));
    assert.ok(toks.includes('message'));
    assert.ok(toks.includes('crate'));
});

test('exactKey ignores comments and whitespace', () => {
    const a = dedup.exactKey('title x\n\n[ a ] -> [ b ] (c)\n');
    const b = dedup.exactKey('title   x\n[ a ]  ->   [ b ]\n');
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, dedup.exactKey('title y\n[ a ] -> [ b ]\n'));
});

test('jaccard and minhash agree on near duplicates', () => {
    const base = game('T', RULES, ['P*.']);
    const near = game('T', RULES.slice(0, 29).concat(['[ Player | Wall ] -> [ Player | ]']), ['P*.']);
    const far = game('T', RULES.slice(0, 5), ['P*.']);
    const sa = dedup.shingleSet(dedup.codeTokens(base));
    const sb = dedup.shingleSet(dedup.codeTokens(near));
    const sc = dedup.shingleSet(dedup.codeTokens(far));
    assert.ok(dedup.jaccard(sa, sb) > 0.8, 'near is above threshold: ' + dedup.jaccard(sa, sb));
    assert.ok(dedup.jaccard(sa, sc) < 0.8, 'far is below threshold: ' + dedup.jaccard(sa, sc));
    const ma = dedup.minhash(sa), mb = dedup.minhash(sb);
    let same = 0;
    for (let i = 0; i < ma.length; i++) if (ma[i] === mb[i]) same++;
    assert.ok(same / ma.length > 0.6);
});

test('buildLineages unions exact and no-levels keys, merges near latest, keeps distinct games apart, flags demos', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-dedup-'));
    const raw = path.join(tmp, 'raw');
    const textDir = path.join(raw, 'text');
    const demoDir = path.join(tmp, 'demo');
    fs.mkdirSync(textDir, { recursive: true });
    fs.mkdirSync(demoDir);

    const A1 = game('Alpha', RULES, ['P*.']);
    const A2 = game('Alpha', RULES, ['P*.', '', '.P*']);            // same code, extra level -> same no-levels hash
    const A3 = A1.replace('[ ^ Player | Crate ]', '[ ^ Player | Crate ] (a comment)'); // comment change -> same exact key
    const B = game('Beta', RULES.slice(0, 28).concat(['[ Player | Wall ] -> [ Player | ]', '[ Crate | Crate ] -> [ | Crate ]']), ['P#.']); // near A, same owner
    const C = game('Gamma', RULES.slice(0, 5), ['P*.']);               // far from A
    const RULES_D = [];
    for (const d of DIRS) for (const o of ['Crate', 'Wall']) RULES_D.push(`[ ${d} Player | ${o} ] -> [ Player | ${o} ]`);
    const D1 = game('Delta', RULES_D, ['P.*']);
    const D2 = game('Delta', RULES_D.slice(0, 28).concat(['[ Crate | Wall ] -> [ | Wall ]', '[ Wall | Wall ] -> [ | Wall ]']), ['P.*']); // other owner
    const simAB = dedup.jaccard(dedup.shingleSet(dedup.codeTokens(A1)), dedup.shingleSet(dedup.codeTokens(B)));
    const simD = dedup.jaccard(dedup.shingleSet(dedup.codeTokens(D1)), dedup.shingleSet(dedup.codeTokens(D2)));
    assert.ok(simAB >= 0.8 && simAB < 0.9, 'A/B fixture sits between the thresholds: ' + simAB);
    assert.ok(simD >= 0.8 && simD < 0.9, 'D fixture sits between the thresholds: ' + simD);
    const DEMO = game('Demo Game', RULES.slice(0, 12), ['PPP']);
    const E = game('Demo Game', RULES.slice(0, 12), ['PPP', '', 'P.P']); // demo with different levels

    const files = { a1: A1, a2: A2, a3: A3, b: B, c: C, d1: D1, d2: D2, e: E };
    const owners = { a1: 'ann', a2: 'ann', a3: 'ann', b: 'ann', c: 'cid', d1: 'dee', d2: 'eve', e: 'fay' };
    const created = { a1: '2024-01-01T00:00:00Z', a2: '2024-01-03T00:00:00Z', a3: '2024-01-02T00:00:00Z', b: '2024-01-04T00:00:00Z',
        c: '2024-01-01T00:00:00Z', d1: '2024-02-01T00:00:00Z', d2: '2024-02-02T00:00:00Z', e: '2024-03-01T00:00:00Z' };
    const realE = require('../pipeline/compile_filter.js').compileOne(E);
    assert.strictEqual(realE.status, 'ok', 'fixture game compiles: ' + JSON.stringify(realE.errorStrings));
    const manifest = [];
    const compile = [];
    for (const [id, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(textDir, id + '.txt'), text);
        manifest.push({ id, owner: owners[id], created_at: created[id], junk: false, bytes: text.length });
        // fabricated hashes: A1/A2/A3 share no-levels; others distinct
        // E must carry its real no-levels hash so it can match the demo's real hash.
        const nl = id === 'e' ? realE.hash_no_levels : id.startsWith('a') ? 'HA' : 'H' + id;
        compile.push({ id, status: 'ok', hash_no_levels: nl, hash_mechanics: id.startsWith('a') ? 'MA' : 'M' + id });
    }
    manifest.push({ id: 'junk1', owner: 'x', created_at: '2024-01-01T00:00:00Z', junk: true, bytes: 10 });
    compile.push({ id: 'junk1', status: 'junk', hash_no_levels: null, hash_mechanics: null });
    fs.writeFileSync(path.join(raw, 'manifest.jsonl'), manifest.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(tmp, 'compile.jsonl'), compile.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(demoDir, 'demo game.txt'), DEMO.replace('author anon', 'author increpare'));

    const report = dedup.runDedup({ dataDir: tmp, demoDir, quiet: true });
    const lineages = fs.readFileSync(path.join(tmp, 'lineages.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const byMember = {};
    for (const l of lineages) for (const id of l.file_ids) byMember[id] = l;

    assert.strictEqual(byMember.junk1, undefined, 'junk excluded');
    assert.strictEqual(byMember.a1, byMember.a2, 'no-levels key unions');
    assert.strictEqual(byMember.a1, byMember.a3, 'exact key unions');
    assert.strictEqual(byMember.a1, byMember.b, 'near latest, same owner, merges');
    assert.strictEqual(byMember.a1.representative_id, 'b', 'representative is the latest');
    assert.notStrictEqual(byMember.a1, byMember.c, 'far game stays apart');
    assert.notStrictEqual(byMember.d1, byMember.d2, 'cross-owner near dup below the stricter threshold stays apart');
    assert.strictEqual(byMember.e.demo, 'demo game', 'demo flagged via no-levels or exact match');
    assert.strictEqual(byMember.a1.demo, null);
    assert.deepStrictEqual(byMember.a1.owners, ['ann']);
    assert.strictEqual(byMember.a1.title, 'Beta');

    assert.strictEqual(report.files, 8);
    assert.strictEqual(report.lineages, lineages.length);
    assert.strictEqual(report.largest.size, 4);
    assert.ok(report.mechanics_agreement.lineages_spanning_multiple_mechanics >= 1);
    assert.strictEqual(report.demo_lineages, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
});
