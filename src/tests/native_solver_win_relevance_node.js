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
        '--timeout-ms', String(run.timeoutMs === undefined ? 1000 : run.timeoutMs),
        '--jobs', '1',
        '--strategy', run.strategy || 'bfs',
        ...hintArgs,
        '--no-solutions',
        '--quiet',
        '--json',
        ...extraArgs,
    ], {
        cwd: rootDir,
        env: { ...process.env, ...run.env },
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

// Deleting an impossible rule ahead of a surviving rule changes eligible-list
// indices. A copied future cache must be rebuilt after win-relevance pruning.
// Keep the rules in one group so stale indices cannot hide in an empty group.
const futureCorpusDir = path.join(tmpDir, 'future-corpus');
const futureHintsPath = path.join(tmpDir, 'future-static-analysis-hints.json');
fs.mkdirSync(futureCorpusDir);
const futureSource = fs.readFileSync(path.join(corpusDir, gameName), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace('[ player ] -> [ goal ]\n[ deco ] -> [ no deco ]', '[ deco ] -> [ no deco ]\n+ [ player ] -> [ goal ]')
    .replace('PD.', 'P..');
assert(futureSource.includes('+ [ player ]'));
fs.writeFileSync(path.join(futureCorpusDir, gameName), futureSource);
fs.writeFileSync(futureHintsPath, JSON.stringify(buildStaticAnalysisHintsManifest(futureCorpusDir)));
const futureRun = { corpusDir: futureCorpusDir, env: { PUZZLESCRIPT_FUTURE_RULE_PRUNE: '1' } };
const futureBaseline = onlyResult(runNative([], futureHintsPath, futureRun));
const futureOptimized = onlyResult(runNative(['--solver-opt', 'win-relevance'], futureHintsPath, futureRun));
assert.strictEqual(futureBaseline.status, 'solved');
assert.strictEqual(futureOptimized.status, futureBaseline.status);
assert.deepStrictEqual(futureOptimized.solution, futureBaseline.solution);
assert(futureOptimized.removed_win_irrelevant_rules > 0);

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

const collisionGameName = 'pupush.txt';
const collisionCorpusDir = path.join(tmpDir, 'collision-corpus');
const collisionHintsPath = path.join(tmpDir, 'collision-static-analysis-hints.json');
fs.mkdirSync(collisionCorpusDir);
fs.copyFileSync(
    path.join(rootDir, 'src/tests/solver_tests', collisionGameName),
    path.join(collisionCorpusDir, collisionGameName)
);
const collisionManifest = buildStaticAnalysisHintsManifest(collisionCorpusDir);
const collisionGame = collisionManifest.games[collisionGameName];
const collisionFact = collisionGame.facts.win_relevance[0];
const collisionRootIds = new Set(collisionFact.value.movement_collision_root_rule_ids);
const collisionRootLines = collisionGame.ps_tagged.rule_sections.flatMap(section =>
    section.groups.flatMap(group => group.rules
        .filter(rule => collisionRootIds.has(rule.id))
        .map(rule => rule.source_line))
);
assert.ok(
    collisionRootLines.includes(230),
    'door removal must remain a root because doors occupy player movement layers'
);
fs.writeFileSync(collisionHintsPath, `${JSON.stringify(collisionManifest, null, 2)}\n`);
const collisionRun = {
    corpusDir: collisionCorpusDir,
    gameName: collisionGameName,
    level: 1,
    timeoutMs: 500,
};
const collisionBaseline = onlyResult(runNative([], collisionHintsPath, collisionRun));
const collisionOptimized = onlyResult(runNative(
    ['--solver-opt', 'win-relevance'],
    collisionHintsPath,
    collisionRun
));
assert.notStrictEqual(collisionBaseline.status, 'exhausted');
assert.notStrictEqual(
    collisionOptimized.status,
    'exhausted',
    'pruning must not falsely exhaust the game after removing its door-opening rules'
);
if (collisionBaseline.status === 'solved' && collisionOptimized.status === 'solved') {
    assert.deepStrictEqual(collisionOptimized.solution, collisionBaseline.solution);
}
assert.strictEqual(collisionOptimized.removed_win_irrelevant_rules, 5);

process.stdout.write('native_solver_win_relevance_node: ok\n');
