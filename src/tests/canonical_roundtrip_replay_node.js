#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { canonicalizeSource } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');
const { runCanonicalRoundtripReplay } = require('./run_canonical_roundtrip_replay');

const oneMove = fs.readFileSync(path.join(__dirname, 'solver_smoke_tests', 'one_move.txt'), 'utf8');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-roundtrip-replay-'));
const originalCorpus = path.join(workDir, 'original');
const canonicalCorpus = path.join(workDir, 'canonical');
fs.mkdirSync(originalCorpus, { recursive: true });
fs.mkdirSync(canonicalCorpus, { recursive: true });
fs.writeFileSync(path.join(originalCorpus, 'one_move.txt'), oneMove, 'utf8');
fs.writeFileSync(
    path.join(canonicalCorpus, 'one_move.txt'),
    decanonicalizeSemantic(canonicalizeSource(oneMove, 'semantic', { sourcePath: 'one_move.txt' })),
    'utf8'
);

const origJson = path.join(workDir, 'orig.json');
fs.writeFileSync(origJson, JSON.stringify({
    results: [{
        game: 'one_move.txt',
        level: 0,
        status: 'solved',
        solution: ['right'],
        solution_length: 1,
    }],
}), 'utf8');

const good = runCanonicalRoundtripReplay({
    fromJsonOrig: origJson,
    canonicalCorpus,
    originalCorpus,
    direction: 'orig-to-canon',
});
assert.strictEqual(good.totals.checked, 1);
assert.strictEqual(good.totals.failures, 0);

const matchThree = path.join(__dirname, 'solver_tests', 'match three billiards.txt');
if (fs.existsSync(matchThree)) {
    const source = fs.readFileSync(matchThree, 'utf8');
    const canonDir = path.join(workDir, 'match-three');
    fs.mkdirSync(canonDir, { recursive: true });
    fs.writeFileSync(
        path.join(canonDir, 'match three billiards.txt'),
        decanonicalizeSemantic(canonicalizeSource(source, 'semantic', { sourcePath: 'match three billiards.txt' })),
        'utf8'
    );
    const solve = spawnSync('node', [
        path.join(__dirname, 'run_solver_tests_js.js'),
        path.dirname(matchThree),
        '--game', 'match three billiards.txt',
        '--level', '1',
        '--timeout-ms', '5000',
        '--strategy', 'bfs',
        '--quiet',
        '--json',
        '--no-solutions',
    ], { encoding: 'utf8' });
    assert.strictEqual(solve.status, 0, solve.stderr);
    const solved = JSON.parse(solve.stdout).results[0];
    assert.strictEqual(solved.status, 'solved');
    const badJson = path.join(workDir, 'match-three-orig.json');
    fs.writeFileSync(badJson, JSON.stringify({ results: [solved] }), 'utf8');
    const bad = runCanonicalRoundtripReplay({
        fromJsonOrig: badJson,
        canonicalCorpus: canonDir,
        originalCorpus: path.dirname(matchThree),
        direction: 'orig-to-canon',
    });
    assert.strictEqual(bad.totals.checked, 1);
    assert.strictEqual(bad.totals.failures, 0);
}

console.log('canonical_roundtrip_replay_node passed');
