#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    buildStaticAnalysisHintsManifest,
    findJsSolvedNativeMisses,
    summarizeCoverage,
} = require('./run_native_solver_js_coverage.js');

const jsRun = {
    results: [
        { game: 'ok.txt', level: 0, status: 'solved', elapsed_ms: 10, solution_length: 2 },
        { game: 'js-timeout.txt', level: 0, status: 'timeout', elapsed_ms: 1000 },
        { game: 'bad-exhausted.txt', level: 1, status: 'solved', elapsed_ms: 20, solution_length: 3 },
        { game: 'bad-timeout.txt', level: 2, status: 'solved', elapsed_ms: 30, solution_length: 4 },
        { game: 'missing.txt', level: 3, status: 'solved', elapsed_ms: 40, solution_length: 5 },
    ],
};

const nativeRun = {
    results: [
        { game: 'ok.txt', level: 0, status: 'solved', elapsed_ms: 12, solution_length: 2 },
        { game: 'bad-exhausted.txt', level: 1, status: 'exhausted', elapsed_ms: 8 },
        { game: 'bad-timeout.txt', level: 2, status: 'timeout', elapsed_ms: 1000 },
    ],
};

const misses = findJsSolvedNativeMisses(jsRun, nativeRun);
assert.deepStrictEqual(misses, [
    {
        game: 'bad-exhausted.txt',
        level: 1,
        js_ms: 20,
        js_len: 3,
        native_status: 'exhausted',
        native_ms: 8,
        native_len: undefined,
    },
    {
        game: 'bad-timeout.txt',
        level: 2,
        js_ms: 30,
        js_len: 4,
        native_status: 'timeout',
        native_ms: 1000,
        native_len: undefined,
    },
    {
        game: 'missing.txt',
        level: 3,
        js_ms: 40,
        js_len: 5,
        native_status: 'missing',
        native_ms: undefined,
        native_len: undefined,
    },
]);

assert.deepStrictEqual(summarizeCoverage(jsRun, nativeRun, misses), {
    jsSolved: 4,
    nativeSolved: 1,
    misses: 3,
    nativeErrors: 0,
});

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-coverage-static-hints-'));
fs.writeFileSync(path.join(fixtureDir, 'one.txt'), 'one');
fs.mkdirSync(path.join(fixtureDir, 'nested'));
fs.writeFileSync(path.join(fixtureDir, 'nested', 'two.txt'), 'two');
const manifest = buildStaticAnalysisHintsManifest(fixtureDir, (filePath) => ({
    status: 'ok',
    ps_tagged: {
        objects: [
            {
                name: path.basename(filePath, '.txt'),
                canonical_name: path.basename(filePath, '.txt').toLowerCase(),
                tags: { static: path.basename(filePath) === 'one.txt', cosmetic: true },
            },
        ],
    },
}));
assert.deepStrictEqual(Object.keys(manifest.games).sort(), ['nested/two.txt', 'one.txt']);
assert.deepStrictEqual(manifest.games['one.txt'], {
    status: 'ok',
    objects: [
        { name: 'one', canonical_name: 'one', tags: { static: true } },
    ],
});
assert.deepStrictEqual(manifest.games['nested/two.txt'].objects[0].tags, { static: false });

console.log('native_solver_js_coverage_node passed');
