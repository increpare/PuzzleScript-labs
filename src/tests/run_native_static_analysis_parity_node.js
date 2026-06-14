#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildStaticAnalysisHintsManifest } = require('./run_native_solver_js_coverage');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_native_static_analysis_parity_node.js <puzzlescript_solver> [solver_tests_dir]');
    process.exit(1);
}

const solverPath = path.resolve(process.argv[2]);
const rootDir = path.resolve(__dirname, '..', '..');
const corpusDir = path.resolve(process.argv[3] || path.join(rootDir, 'src/tests/solver_tests'));

function sortedStaticObjects(entry) {
    return (entry.objects || [])
        .filter((object) => object.tags && object.tags.static === true)
        .map((object) => object.canonical_name || object.name)
        .filter(Boolean)
        .map((name) => name.toLowerCase())
        .sort();
}

const manifest = buildStaticAnalysisHintsManifest(corpusDir);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-static-analysis-parity-'));
const hintsPath = path.join(tmpDir, 'static-analysis-hints.json');
fs.writeFileSync(hintsPath, `${JSON.stringify(manifest, null, 2)}\n`);

const result = spawnSync(solverPath, [
    corpusDir,
    '--dump-static-analysis',
    '--static-analysis-hints', hintsPath,
    '--quiet',
    '--json',
], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
});

assert.strictEqual(
    result.status,
    0,
    `native static analysis dump exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
);

const native = JSON.parse(result.stdout);
const nativeByGame = new Map((native.games || []).map((entry) => [entry.game, entry]));
const failures = [];
for (const [game, entry] of Object.entries(manifest.games)) {
    const nativeEntry = nativeByGame.get(game);
    if (!nativeEntry) {
        failures.push({ game, reason: 'missing native entry' });
        continue;
    }
    if (entry.status !== 'ok') {
        continue;
    }
    if (nativeEntry.source !== 'js') {
        failures.push({
            game,
            expected_source: 'js',
            actual_source: nativeEntry.source || null,
        });
        continue;
    }
    const expected = sortedStaticObjects(entry);
    const actual = (nativeEntry.static_objects || []).map((name) => name.toLowerCase()).sort();
    try {
        assert.deepStrictEqual(actual, expected);
    } catch {
        failures.push({
            game,
            expected,
            actual,
            js_only: expected.filter((name) => !actual.includes(name)),
            native_only: actual.filter((name) => !expected.includes(name)),
        });
    }
}

assert.deepStrictEqual(failures, []);
console.log('run_native_static_analysis_parity_node passed');
