#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compareSolverJson, solvedAt } = require('./compare_solver_timeout_curve_json');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-timeout-curve-compare-'));
const origPath = path.join(tempDir, 'js.json');
const canonPath = path.join(tempDir, 'js-canonical.json');

fs.writeFileSync(origPath, JSON.stringify({
    meta: { max_ms: 1000 },
    results: [
        { game: 'same-solved.txt', level: 0, status: 'solved', elapsed_ms: 500, strategy: 'portfolio' },
        { game: 'same-timeout.txt', level: 0, status: 'timeout', elapsed_ms: 1000, strategy: 'portfolio' },
        { game: 'canon-gains.txt', level: 0, status: 'timeout', elapsed_ms: 1000, strategy: 'portfolio' },
        { game: 'canon-loses.txt', level: 0, status: 'solved', elapsed_ms: 750, strategy: 'portfolio' },
        { game: 'ignored-negative-level.txt', level: -1, status: 'solved', elapsed_ms: 10, strategy: 'portfolio' },
    ],
}), 'utf8');

fs.writeFileSync(canonPath, JSON.stringify({
    results: [
        { game: 'same-solved.txt', level: 0, status: 'solved', elapsed_ms: 600, strategy: 'canonical' },
        { game: 'same-timeout.txt', level: 0, status: 'timeout', elapsed_ms: 1000, strategy: 'canonical' },
        { game: 'canon-gains.txt', level: 0, status: 'solved', elapsed_ms: 900, strategy: 'canonical' },
        { game: 'canon-loses.txt', level: 0, status: 'timeout', elapsed_ms: 1000, strategy: 'canonical' },
        { game: 'ignored-negative-level.txt', level: -1, status: 'timeout', elapsed_ms: 1000, strategy: 'canonical' },
    ],
}), 'utf8');

const summary = compareSolverJson(origPath, canonPath);
assert.strictEqual(summary.max_ms, 1000);
assert.strictEqual(summary.orig_solved, 2);
assert.strictEqual(summary.canon_solved, 2);
assert.strictEqual(summary.net, 0);
assert.strictEqual(summary.flip_count, 2);
assert.strictEqual(summary.gained_count, 1);
assert.strictEqual(summary.lost_count, 1);
assert.strictEqual(summary.flip_count, summary.gained_count + summary.lost_count);
assert.deepStrictEqual(
    summary.gained.map(entry => `${entry.game}#${entry.level}`),
    ['canon-gains.txt#0']
);
assert.deepStrictEqual(
    summary.lost.map(entry => `${entry.game}#${entry.level}`),
    ['canon-loses.txt#0']
);

assert.strictEqual(solvedAt({ status: 'solved', elapsed_ms: 500 }, 1000), true);
assert.strictEqual(solvedAt({ status: 'solved', elapsed_ms: 1500 }, 1000), false);
assert.strictEqual(solvedAt({ status: 'timeout', elapsed_ms: 100 }, 1000), false);

console.log('compare_solver_timeout_curve_json_node passed');
