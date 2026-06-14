#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-curve-denominator-'));
process.on('exit', () => {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
        // best-effort cleanup
    }
});
const csvPath = path.join(tempDir, 'mismatched.csv');
const outCsv = path.join(tempDir, 'out.csv');
const outSvg = path.join(tempDir, 'out.svg');

fs.writeFileSync(csvPath, [
    'series,timeout_ms,solved,pct',
    'js,100,5,50.00',
    'c++,100,6,40.00',
    '',
].join('\n'));

const result = spawnSync(process.execPath, [
    path.join(__dirname, 'solver_timeout_curve.js'),
    '--series', `js:${csvPath}`,
    '--series', `c++:${csvPath}`,
    '--out-csv', outCsv,
    '--out-svg', outSvg,
], {
    encoding: 'utf8',
});

assert.notStrictEqual(result.status, 0, 'mismatched playable denominators should fail');
assert.match(
    `${result.stdout}\n${result.stderr}`,
    /playable denominator mismatch/,
    'failure should explain the denominator mismatch'
);

console.log('solver_timeout_curve_denominator_node passed');
