#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    buildMixedGameManifest,
} = require('./build_solver_sibling_prior_focus_manifest');

const input = {
    results: [
        { game: 'mixed.txt', level: 1, status: 'timeout' },
        { game: 'mixed.txt', level: 0, status: 'solved', solution: ['action'] },
        { game: 'solved.txt', level: 0, status: 'solved', solution: ['right'] },
        { game: 'timeout.txt', level: 0, status: 'timeout' },
        { game: 'mixed.txt', level: 2, status: 'skipped_message' },
        { game: 'mixed.txt', level: 3, status: 'level_error' },
    ],
};

const manifest = buildMixedGameManifest(input, 500);
assert.strictEqual(manifest.schema_version, 1);
assert.strictEqual(manifest.timeout_ms, 500);
assert.deepStrictEqual(manifest.targets, [
    { game: 'mixed.txt', level: 0 },
    { game: 'mixed.txt', level: 1 },
]);
assert.deepStrictEqual(manifest.summary, {
    mixed_games: 1,
    targets: 2,
});
assert.throws(() => buildMixedGameManifest({}, 500), /expected top-level results array/);
assert.throws(() => buildMixedGameManifest(input, 0), /timeout must be a positive number/);

console.log('build_solver_sibling_prior_focus_manifest_node passed');
