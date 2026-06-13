#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
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

console.log('native_solver_js_coverage_node passed');
