'use strict';
// Tests for autocomplete/pipeline/split.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const split = require('../pipeline/split.js');

test('lineDistance is 0 for identical, grows with changed lines', () => {
    const a = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n';
    assert.strictEqual(split.lineDistance(a, a), 0);
    const b = a.replace('l1\n', 'x1\n');
    assert.ok(split.lineDistance(a, b) > 0.05 && split.lineDistance(a, b) < 0.2);
    const c = a.replace(/l([1-5])/g, 'x$1');
    assert.ok(split.lineDistance(a, c) >= 0.4);
});

test('pickTrainingRevisions keeps latest plus at most two spaced earlier ones', () => {
    const base = Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n');
    const texts = {
        r1: base,                                              // oldest
        r2: base.replace('line 0', 'changed 0'),               // too close to r1 and r3
        r3: base.replace(/line (\d)\b/g, 'alt $1'),            // far from r1
        r4: base.replace(/line (1\d)/g, 'other $1'),           // far from r1 and r3, close to latest? no, different lines
        r5: base.replace(/line 1(\d)/g, 'latest 1$1'),         // latest
    };
    const ordered = ['r1', 'r2', 'r3', 'r4', 'r5']; // oldest -> latest
    const picked = split.pickTrainingRevisions(ordered, id => texts[id], 0.2, 2);
    assert.strictEqual(picked[0], 'r5', 'latest first');
    assert.ok(picked.length <= 3);
    assert.ok(picked.length === 3, 'two earlier revisions found: ' + picked.join(','));
    for (let i = 0; i < picked.length; i++) {
        for (let j = i + 1; j < picked.length; j++) {
            assert.ok(split.lineDistance(texts[picked[i]], texts[picked[j]]) >= 0.2, picked[i] + ' vs ' + picked[j]);
        }
    }
});

test('runSplit splits by lineage, drops demo lineages, keeps latest only in val/test, is seeded', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-split-'));
    const raw = path.join(tmp, 'raw');
    const textDir = path.join(raw, 'text');
    fs.mkdirSync(textDir, { recursive: true });
    const manifest = [];
    const lineages = [];
    let n = 0;
    const mk = (lid, count, demo = null) => {
        const ids = [];
        for (let k = 0; k < count; k++) {
            const id = `${lid}_f${k}`;
            const text = Array.from({ length: 30 }, (_, i) => `${lid} line ${i} rev ${k % 2 === 0 ? k : 0}`).join('\n');
            fs.writeFileSync(path.join(textDir, id + '.txt'), text);
            manifest.push({ id, owner: 'o', created_at: `2024-01-${String(k + 1).padStart(2, '0')}T00:00:00Z`, bytes: text.length, junk: false });
            ids.push(id);
            n++;
        }
        lineages.push({ lineage_id: lid, file_ids: ids, representative_id: ids[ids.length - 1], size: ids.length, owners: ['o'], title: lid, demo, demo_mechanics: null });
    };
    for (let i = 0; i < 40; i++) mk('L' + i, 1 + (i % 4));
    mk('DEMO', 5, 'push');
    fs.writeFileSync(path.join(raw, 'manifest.jsonl'), manifest.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(tmp, 'lineages.jsonl'), lineages.map(r => JSON.stringify(r)).join('\n') + '\n');

    const out = split.runSplit({ dataDir: tmp, seed: 7, quiet: true });
    const j = JSON.parse(fs.readFileSync(path.join(tmp, 'splits.json'), 'utf8'));
    assert.strictEqual(j.seed, 7);
    const all = [...j.train, ...j.val, ...j.test];
    assert.strictEqual(all.length, 40, 'demo lineage dropped, all others assigned');
    assert.ok(!all.some(l => l.lineage_id === 'DEMO'));
    assert.strictEqual(j.val.length, 2);
    assert.strictEqual(j.test.length, 2);
    assert.strictEqual(j.train.length, 36);
    for (const l of [...j.val, ...j.test]) assert.strictEqual(l.file_ids.length, 1, 'latest only');
    for (const l of j.val) assert.ok(l.file_ids[0].endsWith('_f' + (parseInt(l.lineage_id.slice(1), 10) % 4)));
    for (const l of j.train) assert.ok(l.file_ids.length <= 3);
    const ids = new Set(all.flatMap(l => l.file_ids));
    assert.strictEqual(ids.size, all.reduce((a, l) => a + l.file_ids.length, 0), 'no file in two splits');
    assert.strictEqual(out.counts.dropped_demo_lineages, 1);
    assert.ok(out.counts.train.files >= 36 && out.counts.train.bytes > 0);
    assert.deepStrictEqual(out.counts.leakage.test, { same_mechanics_any_owner: 0, same_owner_mechanics: 0, same_owner_title: 0 });

    const again = split.runSplit({ dataDir: tmp, seed: 7, quiet: true });
    assert.deepStrictEqual(again.counts, out.counts);
    const j2 = JSON.parse(fs.readFileSync(path.join(tmp, 'splits.json'), 'utf8'));
    assert.deepStrictEqual(j2.test.map(l => l.lineage_id), j.test.map(l => l.lineage_id), 'seeded');
    fs.rmSync(tmp, { recursive: true, force: true });
});
