#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildStaticAnalysisHintsManifest } = require('./run_native_solver_js_coverage');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/native_solver_hash_projection_node.js <puzzlescript_solver>');
    process.exit(1);
}

const rootDir = path.resolve(__dirname, '..', '..');
const solverPath = path.resolve(process.argv[2]);
const corpusDir = path.join(rootDir, 'src/tests/solver_smoke_tests');
const blockerCorpusDir = path.join(rootDir, 'src/tests/static_analysis_testdata/solver_hash_projection');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-solver-hash-projection-'));
const hintsPath = path.join(tmpDir, 'static-analysis-hints.json');
const blockerHintsPath = path.join(tmpDir, 'static-analysis-blocker-hints.json');
fs.writeFileSync(hintsPath, `${JSON.stringify(buildStaticAnalysisHintsManifest(corpusDir), null, 2)}\n`);
fs.writeFileSync(blockerHintsPath, `${JSON.stringify(buildStaticAnalysisHintsManifest(blockerCorpusDir), null, 2)}\n`);

function runNative(game, extraArgs = [], runCorpusDir = corpusDir, runHintsPath = hintsPath) {
    const result = spawnSync(solverPath, [
        runCorpusDir,
        '--game', game,
        '--level', '0',
        '--timeout-ms', '1000',
        '--jobs', '1',
        '--strategy', 'bfs',
        '--static-analysis-hints', runHintsPath,
        '--no-solutions',
        '--quiet',
        '--json',
        ...extraArgs,
    ], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
    assert.strictEqual(
        result.status,
        0,
        `native solver exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    return JSON.parse(result.stdout);
}

function onlyResult(payload) {
    assert.strictEqual(payload.results.length, 1);
    return payload.results[0];
}

const cosmeticBaseline = onlyResult(runNative('hash_projection_cosmetic.txt'));
const cosmeticProjected = onlyResult(runNative('hash_projection_cosmetic.txt', ['--solver-hash-projection']));
assert.strictEqual(cosmeticBaseline.status, 'solved');
assert.strictEqual(cosmeticProjected.status, cosmeticBaseline.status);
assert.deepStrictEqual(cosmeticProjected.solution, cosmeticBaseline.solution);
assert.ok(
    cosmeticProjected.solver_hash_projection_projected_objects >= 1,
    'native projection run should consume at least one projected object'
);
assert.strictEqual(cosmeticProjected.solver_hash_projection_blocked, false);
assert.ok(
    cosmeticProjected.hash_mode.includes('hash_projection'),
    `expected hash_mode to mention hash_projection, got ${cosmeticProjected.hash_mode}`
);

const toggleBaseline = onlyResult(runNative('hash_projection_toggle.txt'));
const toggleProjectedPayload = runNative('hash_projection_toggle.txt', ['--solver-hash-projection']);
const toggleProjected = onlyResult(toggleProjectedPayload);
assert.strictEqual(toggleBaseline.status, 'exhausted');
assert.strictEqual(toggleProjected.status, toggleBaseline.status);
assert.ok(
    toggleProjected.solver_hash_projection_projected_objects >= 1,
    'toggle projection run should consume at least one projected object'
);
assert.strictEqual(toggleProjected.solver_hash_projection_blocked, false);
assert.ok(
    toggleProjected.unique_states < toggleBaseline.unique_states,
    `expected projection to reduce unique states (${toggleBaseline.unique_states} -> ${toggleProjected.unique_states})`
);
assert.ok(
    toggleProjectedPayload.totals.solver_hash_projection_projected_objects >= 1,
    'totals should include consumed projected objects'
);

const hdaProjected = onlyResult(runNative('hash_projection_toggle.txt', [
    '--solver-hash-projection',
    '--strategy', 'hda-weighted-astar',
    '--hda-jobs', '2',
    '--compact-node-storage',
]));
assert.strictEqual(hdaProjected.status, 'exhausted');
assert.strictEqual(hdaProjected.hda_parallel, true);
assert.ok(hdaProjected.solver_hash_projection_projected_objects >= 1);
assert.ok(
    hdaProjected.hash_mode.includes('hash_projection'),
    `expected HDA hash_mode to mention hash_projection, got ${hdaProjected.hash_mode}`
);

const hashKeyProjected = onlyResult(runNative('hash_projection_toggle.txt', [
    '--solver-hash-projection',
    '--hash-state-keys',
]));
assert.strictEqual(hashKeyProjected.exact_state_keys, false);
assert.ok(
    hashKeyProjected.hash_mode.startsWith('hash_state_keys_hash_projection'),
    `expected hash-state-key mode to include projection, got ${hashKeyProjected.hash_mode}`
);

const blockedProjection = onlyResult(runNative(
    'random-blocker.txt',
    ['--solver-hash-projection'],
    blockerCorpusDir,
    blockerHintsPath
));
assert.strictEqual(blockedProjection.solver_hash_projection_projected_objects, 0);
assert.strictEqual(blockedProjection.solver_hash_projection_blocked, true);
assert.deepStrictEqual(blockedProjection.solver_hash_projection_blockers, ['random_mechanics']);
assert.ok(
    !blockedProjection.hash_mode.includes('hash_projection'),
    `blocked projection should not alter hash_mode, got ${blockedProjection.hash_mode}`
);

process.stdout.write('native_solver_hash_projection_node: ok\n');
