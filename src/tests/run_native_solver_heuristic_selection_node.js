#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');

if (process.argv.length < 3) {
    console.error('Usage: node src/tests/run_native_solver_heuristic_selection_node.js <puzzlescript_solver>');
    process.exit(1);
}

const solverPath = path.resolve(process.argv[2]);
const rootDir = path.resolve(__dirname, '..', '..');
const smokeDir = path.join(rootDir, 'src/tests/solver_smoke_tests');
const solverCorpus = path.join(rootDir, 'src/tests/solver_tests');

function runSolver(corpusDir, args, label) {
    const result = spawnSync(solverPath, [
        corpusDir,
        '--jobs', '1',
        '--no-solutions',
        '--quiet',
        '--json',
        ...args,
    ], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
    assert.strictEqual(
        result.status,
        0,
        `${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.results.length, 1, label);
    return parsed.results[0];
}

const explicitWinconditions = runSolver(smokeDir, [
    '--game', 'one_move.txt',
    '--level', '0',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--solver-heuristic', 'winconditions',
], 'explicit winconditions heuristic');
assert.strictEqual(explicitWinconditions.status, 'solved');
assert.strictEqual(explicitWinconditions.heuristic, 'winconditions');
assert.deepStrictEqual(explicitWinconditions.solution, ['right']);

const allOnMatching = runSolver(solverCorpus, [
    '--game', 'Pushy-V Pully-H.txt',
    '--level', '15',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'all-on-matching',
], 'all-on matching heuristic');
assert.strictEqual(allOnMatching.status, 'solved');
assert.strictEqual(allOnMatching.heuristic, 'all-on-matching');
assert(
    allOnMatching.expanded <= 5000,
    `all-on-matching expanded ${allOnMatching.expanded}, expected <= 5000`
);

const autoStaticOnDynamic = runSolver(solverCorpus, [
    '--game', 'Pushy-V Pully-H.txt',
    '--level', '15',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'auto',
], 'auto all-static-on-dynamic assignment heuristic');
assert.strictEqual(autoStaticOnDynamic.status, 'solved');
assert.strictEqual(autoStaticOnDynamic.heuristic, 'auto');
assert(
    autoStaticOnDynamic.expanded <= 5000,
    `auto all-static-on-dynamic expanded ${autoStaticOnDynamic.expanded}, expected <= 5000`
);

const autoDynamicOnStatic = runSolver(solverCorpus, [
    '--game', 'make way.txt',
    '--level', '3',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'auto',
], 'auto all-dynamic-on-static assignment heuristic');
assert.strictEqual(autoDynamicOnStatic.status, 'solved');
assert.strictEqual(autoDynamicOnStatic.heuristic, 'auto');
assert(
    autoDynamicOnStatic.expanded <= 3000,
    `auto all-dynamic-on-static expanded ${autoDynamicOnStatic.expanded}, expected <= 3000`
);

const autoNonStaticOnStatic = runSolver(solverCorpus, [
    '--game', 'mazezam.txt',
    '--level', '23',
    '--timeout-ms', '1500',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'auto',
], 'auto all-nonstatic-on-static assignment heuristic');
assert.strictEqual(autoNonStaticOnStatic.status, 'solved');
assert.strictEqual(autoNonStaticOnStatic.heuristic, 'auto');
assert(
    autoNonStaticOnStatic.expanded <= 31000,
    `auto all-nonstatic-on-static expanded ${autoNonStaticOnStatic.expanded}, expected <= 31000`
);

const staticAnalysisDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-solver-static-analysis-'));
const staticAnalysisPath = path.join(staticAnalysisDir, 'static-analysis.json');
fs.writeFileSync(staticAnalysisPath, `${JSON.stringify({
    schema: 'native-solver-static-analysis-hints-v1',
    games: {
        'mazezam.txt': {
            status: 'ok',
            objects: [
                { canonical_name: 'target', tags: { static: true } },
                { canonical_name: 'cplayer', tags: { static: false } },
                { canonical_name: 'lplayer', tags: { static: false } },
                { canonical_name: 'rplayer', tags: { static: false } },
            ],
        },
    },
}, null, 2)}\n`);
const autoJsStaticAnalysis = runSolver(solverCorpus, [
    '--game', 'mazezam.txt',
    '--level', '23',
    '--timeout-ms', '1500',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'auto',
    '--static-analysis-hints', staticAnalysisPath,
], 'auto all-nonstatic-on-static JS static-analysis hints');
assert.strictEqual(autoJsStaticAnalysis.status, 'solved');
assert.strictEqual(autoJsStaticAnalysis.heuristic, 'auto');
assert.strictEqual(autoJsStaticAnalysis.static_analysis_hints, 'js');
assert(
    autoJsStaticAnalysis.expanded <= 31000,
    `auto JS static-analysis hints expanded ${autoJsStaticAnalysis.expanded}, expected <= 31000`
);

// An external static-analysis hint must never be able to mark the player
// static: the heuristic caches a static object's initial-board distance field,
// which would be wrong for the input-controlled player on every later board.
// A hint that (unsoundly) tags the player static must still drop the player
// while keeping legitimately-static objects.
const playerStaticHintDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-solver-player-static-hint-'));
const playerStaticHintPath = path.join(playerStaticHintDir, 'static-analysis.json');
fs.writeFileSync(playerStaticHintPath, `${JSON.stringify({
    schema: 'native-solver-static-analysis-hints-v1',
    games: {
        'mazezam.txt': {
            status: 'ok',
            objects: [
                { canonical_name: 'target', tags: { static: true } },
                { canonical_name: 'cplayer', tags: { static: true } },
            ],
        },
    },
}, null, 2)}\n`);
const playerStaticDump = spawnSync(solverPath, [
    solverCorpus,
    '--dump-static-analysis',
    '--static-analysis-hints', playerStaticHintPath,
    '--game', 'mazezam.txt',
    '--quiet',
    '--json',
], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
});
assert.strictEqual(
    playerStaticDump.status,
    0,
    `dump-static-analysis exited ${playerStaticDump.status}\nstdout:\n${playerStaticDump.stdout}\nstderr:\n${playerStaticDump.stderr}`
);
const playerStaticParsed = JSON.parse(playerStaticDump.stdout);
const mazezamStaticEntry = (playerStaticParsed.games || []).find((entry) => entry.game === 'mazezam.txt');
assert(mazezamStaticEntry, 'mazezam.txt missing from --dump-static-analysis output');
assert.strictEqual(mazezamStaticEntry.source, 'js', 'expected the JS hint to be applied');
const mazezamStaticNames = (mazezamStaticEntry.static_objects || []).map((name) => name.toLowerCase());
assert(
    !mazezamStaticNames.includes('cplayer'),
    `player object 'cplayer' must be excluded from a hint-provided static set, got ${JSON.stringify(mazezamStaticNames)}`
);
assert(
    mazezamStaticNames.includes('target'),
    `legitimately-static 'target' should be retained, got ${JSON.stringify(mazezamStaticNames)}`
);

const noPlayerDistance = runSolver(solverCorpus, [
    '--game', 'butteater.txt',
    '--level', '1',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'no-player-distance',
], 'NO player-distance heuristic');
assert.strictEqual(noPlayerDistance.status, 'solved');
assert.strictEqual(noPlayerDistance.heuristic, 'no-player-distance');

const autoNoDistance = runSolver(solverCorpus, [
    '--game', 'Yellow Box.txt',
    '--level', '11',
    '--timeout-ms', '1000',
    '--strategy', 'weighted-astar',
    '--astar-weight', '2',
    '--solver-heuristic', 'auto',
], 'auto NO player-distance heuristic');
assert.strictEqual(autoNoDistance.status, 'solved');
assert.strictEqual(autoNoDistance.heuristic, 'auto');
assert(
    autoNoDistance.expanded <= 2000,
    `auto NO player-distance expanded ${autoNoDistance.expanded}, expected <= 2000`
);

const plainNoLifecycle = runSolver(solverCorpus, [
    '--game', 'color chained.txt',
    '--level', '5',
    '--timeout-ms', '1000',
    '--strategy', 'portfolio',
], 'plain NO lifecycle portfolio');
assert.strictEqual(plainNoLifecycle.status, 'solved');
assert.strictEqual(plainNoLifecycle.portfolio_profile, 'breadth-first');
assert.strictEqual(plainNoLifecycle.strategy, 'portfolio:bfs');

console.log('run_native_solver_heuristic_selection_node passed');
