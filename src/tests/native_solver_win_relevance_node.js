#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildStaticAnalysisHintsManifest } = require('./run_native_solver_js_coverage');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/native_solver_win_relevance_node.js <puzzlescript_solver>');
    process.exit(1);
}

const rootDir = path.resolve(__dirname, '..', '..');
const solverPath = path.resolve(process.argv[2]);
const corpusDir = path.join(rootDir, 'src/tests/static_analysis_testdata/win_relevance');
const gameName = 'win-relevance-direct.txt';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-solver-win-relevance-'));
const hintsPath = path.join(tmpDir, 'static-analysis-hints.json');

const manifest = buildStaticAnalysisHintsManifest(corpusDir);
assert.strictEqual(manifest.games[gameName].status, 'ok');
assert.ok(
    manifest.games[gameName].facts && Array.isArray(manifest.games[gameName].facts.win_relevance),
    'native hints manifest should include win_relevance facts'
);
assert.ok(
    manifest.games[gameName].ps_tagged && Array.isArray(manifest.games[gameName].ps_tagged.rule_sections),
    'native hints manifest should include tagged rule source lines for win_relevance'
);
fs.writeFileSync(hintsPath, `${JSON.stringify(manifest, null, 2)}\n`);

function runNative(extraArgs = [], runHintsPath = hintsPath, run = {}) {
    const hintArgs = runHintsPath ? ['--static-analysis-hints', runHintsPath] : [];
    const result = spawnSync(solverPath, [
        run.corpusDir || corpusDir,
        '--game', run.gameName || gameName,
        '--level', String(run.level === undefined ? 0 : run.level),
        '--timeout-ms', '1000',
        '--jobs', '1',
        '--strategy', 'bfs',
        ...hintArgs,
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

const baselinePayload = runNative();
const baseline = onlyResult(baselinePayload);
assert.strictEqual(baseline.status, 'solved');
assert.deepStrictEqual(baseline.solution, ['right']);
assert.strictEqual(baseline.removed_win_irrelevant_rules, 0);
assert.strictEqual(baselinePayload.totals.removed_win_irrelevant_rules, 0);

const optimizedPayload = runNative(['--solver-opt', 'win-relevance']);
const optimized = onlyResult(optimizedPayload);
assert.strictEqual(optimized.status, baseline.status);
assert.deepStrictEqual(optimized.solution, baseline.solution);
assert.strictEqual(
    optimized.removed_win_irrelevant_rules,
    1,
    'native win-relevance pass should remove the irrelevant fixture rule'
);
assert.strictEqual(optimizedPayload.totals.removed_win_irrelevant_rules, 1);
assert.strictEqual(
    optimizedPayload.totals.solver_optimization.removed_win_irrelevant_rules,
    1,
    'native win-relevance removals should appear in nested solver optimization totals'
);

const optimizedAll = onlyResult(runNative(['--solver-opt', 'all']));
assert.strictEqual(optimizedAll.status, baseline.status);
assert.deepStrictEqual(optimizedAll.solution, baseline.solution);
assert.strictEqual(
    optimizedAll.removed_win_irrelevant_rules,
    1,
    'native --solver-opt all should include win-relevance pruning'
);

const noHintsOptimizedPayload = runNative(['--solver-opt', 'win-relevance'], null);
const noHintsOptimized = onlyResult(noHintsOptimizedPayload);
assert.strictEqual(noHintsOptimized.status, baseline.status);
assert.deepStrictEqual(noHintsOptimized.solution, baseline.solution);
assert.strictEqual(
    noHintsOptimized.removed_win_irrelevant_rules,
    0,
    'native win-relevance pass should be inert until JS win_relevance hints are supplied'
);
assert.strictEqual(noHintsOptimizedPayload.totals.removed_win_irrelevant_rules, 0);

const movementGameName = 'the red ring of immortality.txt';
const movementCorpusDir = path.join(tmpDir, 'movement-corpus');
const movementHintsPath = path.join(tmpDir, 'movement-static-analysis-hints.json');
fs.mkdirSync(movementCorpusDir);
fs.copyFileSync(
    path.join(rootDir, 'src/tests/solver_tests', movementGameName),
    path.join(movementCorpusDir, movementGameName)
);
const movementManifest = buildStaticAnalysisHintsManifest(movementCorpusDir);
const movementFact = movementManifest.games[movementGameName].facts.win_relevance[0];
assert.ok(
    Array.isArray(movementFact.value.movement_root_rule_ids)
        && movementFact.value.movement_root_rule_ids.some(ruleId => ruleId.startsWith('early_group_9_rule_')),
    'native hints should preserve the analyzer movement roots behind the relevance slice'
);
fs.writeFileSync(movementHintsPath, `${JSON.stringify(movementManifest, null, 2)}\n`);
const movementRun = {
    corpusDir: movementCorpusDir,
    gameName: movementGameName,
    level: 1,
};
const movementBaseline = onlyResult(runNative([], movementHintsPath, movementRun));
const movementOptimized = onlyResult(runNative(
    ['--solver-opt', 'win-relevance'],
    movementHintsPath,
    movementRun
));
assert.strictEqual(movementBaseline.status, 'solved');
assert.strictEqual(movementOptimized.status, movementBaseline.status);
assert.deepStrictEqual(movementOptimized.solution, movementBaseline.solution);

process.stdout.write('native_solver_win_relevance_node: ok\n');
