#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    materializeSlice,
    writeSliceManifest,
} = require('./generate_solver_benchmark_slice_manifest');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-slice-manifest-'));
const corpusDir = path.join(tmpRoot, 'corpus');
const messageCorpusDir = path.join(tmpRoot, 'message-corpus');
fs.mkdirSync(corpusDir);
fs.mkdirSync(messageCorpusDir);

function writeGame(name, source) {
    fs.writeFileSync(path.join(corpusDir, name), source);
}

writeGame('crate-a.txt', 'title crate a\nobjects\nplayer\nrules\n[ > player | crate ] -> [ > player | > crate ]\nlevels\np.\n');
writeGame('plain-b.txt', 'title plain b\nobjects\nplayer\nrules\n[ > player ] -> [ > player ]\nlevels\np.\n');
writeGame('sokoban-c.txt', 'title sokoban c\nobjects\nbox\nrules\n[ > player | box ] -> [ > player | > box ]\nlevels\np.\n');
writeGame('wall-d.txt', 'title wall d\nobjects\nwall\nrules\n[ > player | wall ] -> cancel\nlevels\np.\n');
fs.writeFileSync(path.join(messageCorpusDir, 'message-first.txt'), 'title message first\nobjects\nplayer\nrules\n[ > player ] -> [ > player ]\nlevels\nmessage intro\np.\n');

const rankingManifestPath = path.join(tmpRoot, 'ranked.json');
fs.writeFileSync(rankingManifestPath, `${JSON.stringify({
    schema_version: 1,
    kind: 'solver_focus_group',
    corpus: corpusDir,
    target_count: 2,
    targets: [
        { game: 'sokoban-c.txt', level: 3, first_solved_timeout_ms: 700 },
        { game: 'missing.txt', level: 1, first_solved_timeout_ms: 900 },
        { game: 'crate-a.txt', level: 2, first_solved_timeout_ms: 500 },
    ],
}, null, 2)}\n`);

const registryPath = path.join(tmpRoot, 'slices.json');
fs.writeFileSync(registryPath, `${JSON.stringify({
    schema_version: 1,
    slices: [
        {
            name: 'smoke-test',
            corpus: corpusDir,
            timeout_ms: 500,
            selection: {
                type: 'seeded-game-sample',
                target_games: 3,
                seed: 'unit-smoke',
                stability: 'unit test',
            },
        },
        {
            name: 'hint-test',
            corpus: corpusDir,
            timeout_ms: 600,
            selection: {
                type: 'seeded-mechanic-biased-level-sample',
                target_levels: 3,
                seed: 'unit-hint',
                mechanic_hints: ['crate', 'sokoban'],
                stability: 'unit test',
            },
        },
        {
            name: 'ranked-test',
            corpus: corpusDir,
            timeout_ms: 700,
            selection: {
                type: 'seeded-hard-tail-level-sample',
                target_levels: 2,
                seed: 'unit-ranked',
                source_rankings: [rankingManifestPath],
                stability: 'unit test',
            },
        },
        {
            name: 'message-test',
            corpus: messageCorpusDir,
            timeout_ms: 500,
            selection: {
                type: 'seeded-game-sample',
                target_games: 1,
                seed: 'unit-message',
                stability: 'unit test',
            },
        },
    ],
}, null, 2)}\n`);

const smoke = materializeSlice('smoke-test', { registry_path: registryPath, generated_at: '2026-07-03T00:00:00.000Z' });
assert.strictEqual(smoke.kind, 'solver_benchmark_slice');
assert.strictEqual(smoke.name, 'smoke-test');
assert.strictEqual(smoke.target_count, 3);
assert.strictEqual(smoke.targets.length, 3);
assert.ok(smoke.targets.every((target) => target.level === 0));
assert.deepStrictEqual(
    smoke.targets.map((target) => target.game),
    materializeSlice('smoke-test', { registry_path: registryPath, generated_at: '2026-07-03T00:00:00.000Z' }).targets.map((target) => target.game),
);

const hinted = materializeSlice('hint-test', { registry_path: registryPath, generated_at: '2026-07-03T00:00:00.000Z' });
assert.strictEqual(hinted.target_count, 3);
assert.ok(hinted.targets[0].selection_reason.includes('mechanic_hint'));
assert.ok(hinted.targets.some((target) => target.game === 'crate-a.txt'));
assert.ok(hinted.targets.some((target) => target.game === 'sokoban-c.txt'));

const ranked = materializeSlice('ranked-test', { registry_path: registryPath, generated_at: '2026-07-03T00:00:00.000Z' });
assert.deepStrictEqual(ranked.targets.map((target) => `${target.game}#${target.level}`), [
    'sokoban-c.txt#3',
    'crate-a.txt#2',
]);
assert.strictEqual(ranked.targets[0].first_solved_timeout_ms, 700);

const message = materializeSlice('message-test', { registry_path: registryPath, generated_at: '2026-07-03T00:00:00.000Z' });
assert.deepStrictEqual(message.targets.map((target) => `${target.game}#${target.level}`), [
    'message-first.txt#1',
]);

const outPath = path.join(tmpRoot, 'out', 'smoke.json');
writeSliceManifest(smoke, outPath);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')).targets, smoke.targets);

console.log('generate_solver_benchmark_slice_manifest_node passed');
