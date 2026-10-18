'use strict';
// Tests for autocomplete/eval/tasks.js. Run: node --test autocomplete/tests/*.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tasks = require('../eval/tasks.js');

function game(n) {
    return [
        'title Game ' + n, 'author anon', '', '========', 'OBJECTS', '========',
        'Background', 'black', '', 'Player', 'red', '00000', '0...0', '0...0', '0...0', '00000', '', 'Crate' + n, 'blue',
        '=======', 'LEGEND', '=======', '. = Background', 'P = Player', '* = Crate' + n,
        '=======', 'SOUNDS', '=======', 'sfx0 1234',
        '================', 'COLLISIONLAYERS', '================', 'Background', 'Player, Crate' + n,
        '======', 'RULES', '======', '[ > Player | Crate' + n + ' ] -> [ > Player | > Crate' + n + ' ]', '', 'late [ Player | Crate' + n + ' ] -> [ Player | ]',
        '==============', 'WINCONDITIONS', '==============', 'No Crate' + n,
        '=======', 'LEVELS', '=======', 'message hi', '', 'P*.', '', '.P*', '',
    ].join('\n');
}

test('generateTasks produces well-formed, stratified, deterministic cases', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ac-tasks-'));
    const raw = path.join(tmp, 'raw');
    const textDir = path.join(raw, 'text');
    fs.mkdirSync(textDir, { recursive: true });
    const ids = ['g1', 'g2', 'g3', 'g4'];
    ids.forEach((id, i) => fs.writeFileSync(path.join(textDir, id + '.txt'), game(i)));
    fs.writeFileSync(path.join(tmp, 'compile.jsonl'), [
        { id: 'g1', status: 'ok' }, { id: 'g2', status: 'warnings' }, { id: 'g3', status: 'errors' }, { id: 'g4', status: 'ok' },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(tmp, 'splits.json'), JSON.stringify({
        train: [], val: ids.map(id => ({ lineage_id: 'L' + id, file_ids: [id] })), test: [{ lineage_id: 'Lx', file_ids: ['g4'] }],
    }));

    const sizes = { rest_of_token: 40, rest_of_line: 40, next_line: 40, next_block: 10 };
    const out = tasks.generateTasks({ dataDir: tmp, split: 'val', seed: 3, sizes, quiet: true });
    const texts = Object.fromEntries(ids.map(id => [id, fs.readFileSync(path.join(textDir, id + '.txt'), 'utf8')]));

    for (const c of out.cases) {
        assert.ok(ids.includes(c.id));
        assert.strictEqual(texts[c.id].slice(c.from, c.to), c.target, `${c.task} target matches text slice`);
        assert.ok(c.target.length > 0, 'non-empty target');
        assert.strictEqual(typeof c.compiles, 'boolean');
        assert.ok(tasks.SECTIONS.includes(c.section), c.section);
        if (c.task === 'rest_of_token') {
            assert.ok(/^[A-Za-z0-9_]+$/.test(c.target), 'rest of an identifier: ' + c.target);
            assert.ok(c.token_start < c.from, 'at least one char of prefix typed');
            assert.ok(/^[A-Za-z_]/.test(texts[c.id].slice(c.token_start, c.from)));
        }
        if (c.task === 'rest_of_line') {
            assert.ok(!c.target.includes('\n'));
            assert.ok(c.from > 0 && texts[c.id][c.from - 1] !== '\n', 'cut inside a line');
        }
        if (c.task === 'next_line') {
            assert.ok(c.from === 0 || texts[c.id][c.from - 1] === '\n', 'cursor at line start');
            assert.ok(!c.target.includes('\n'));
        }
        if (c.task === 'next_block') {
            assert.ok(['rules', 'objects'].includes(c.section));
            assert.ok(c.from === 0 || texts[c.id][c.from - 1] === '\n');
            assert.ok(!c.target.endsWith('\n') && !/\n\s*\n/.test(c.target), 'one contiguous block');
        }
    }
    assert.strictEqual(out.cases.filter(c => c.id === 'g3').every(c => c.compiles === false), true);
    assert.strictEqual(out.cases.filter(c => c.id === 'g1').every(c => c.compiles === true), true);
    const byTask = {};
    for (const c of out.cases) byTask[c.task] = (byTask[c.task] || 0) + 1;
    assert.strictEqual(byTask.next_block, 10);
    assert.ok(byTask.rest_of_line >= 30 && byTask.rest_of_line <= 40, 'close to requested after dedup: ' + byTask.rest_of_line);
    const sectionsHit = new Set(out.cases.filter(c => c.task === 'rest_of_line').map(c => c.section));
    assert.ok(sectionsHit.size >= 6, 'stratified across sections: ' + [...sectionsHit]);
    const keys = new Set(out.cases.map(c => c.task + c.id + c.from + c.to));
    assert.strictEqual(keys.size, out.cases.length, 'no duplicate cases');

    const again = tasks.generateTasks({ dataDir: tmp, split: 'val', seed: 3, sizes, quiet: true });
    assert.deepStrictEqual(again.cases, out.cases, 'seeded');
    assert.ok(fs.existsSync(path.join(tmp, 'eval', 'tasks_val.json')));
    fs.rmSync(tmp, { recursive: true, force: true });
});
