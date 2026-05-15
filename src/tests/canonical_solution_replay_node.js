#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    formatReplayFailure,
    loadPuzzleScriptRuntime,
    parseArgs,
    replaySolutionOnOriginal,
    replayCanonicalSolutions,
    runCanonicalReplay,
} = require('./run_canonical_solution_replay');

const SIMPLE_SOURCE = `
title Canonical Replay Fixture

========
OBJECTS
========

Background
black

Player
blue

Goal
green

=======
LEGEND
=======

. = Background
P = Player and Background
G = Goal and Background

======
SOUNDS
======

================
COLLISIONLAYERS
================

Background
Goal
Player

=====
RULES
=====

[ Player Background | Goal ] -> [ Player Background | Goal ]

=============
WINCONDITIONS
=============

All Player on Goal

======
LEVELS
======

PG
`;

const ACTION_WIN_SOURCE = `
title Canonical Action Win Fixture

========
OBJECTS
========

Background
black

Player
blue

=======
LEGEND
=======

. = Background
P = Player

======
SOUNDS
======

================
COLLISIONLAYERS
================

Background
Player

=====
RULES
=====

[ action Player ] -> [ Player ] win

=============
WINCONDITIONS
=============

======
LEVELS
======

P

P
`;

loadPuzzleScriptRuntime();

function assertThrowsMessage(fn, pattern) {
    assert.throws(fn, error => pattern.test(error && error.message ? error.message : String(error)));
}

assertThrowsMessage(
    () => parseArgs(['node', 'script', 'corpus', '--timeout-ms', 'nope']),
    /--timeout-ms must be a positive integer: nope/
);
assertThrowsMessage(
    () => runCanonicalReplay({ corpusPath: '.', timeoutMs: NaN }),
    /timeoutMs must be a positive integer: NaN/
);
for (const badTimeout of [Infinity, 0, -1]) {
    assertThrowsMessage(
        () => runCanonicalReplay({ corpusPath: '.', timeoutMs: badTimeout }),
        new RegExp(`timeoutMs must be a positive integer: ${badTimeout}`)
    );
}

const solved = replaySolutionOnOriginal({
    source: SIMPLE_SOURCE,
    game: 'fixture.txt',
    level: 0,
    solution: ['right'],
});
assert.strictEqual(solved.status, 'solved', 'right should solve the fixture');
assert.strictEqual(solved.steps, 1);

const notSolved = replaySolutionOnOriginal({
    source: SIMPLE_SOURCE,
    game: 'fixture.txt',
    level: 0,
    solution: ['left'],
});
assert.strictEqual(notSolved.status, 'not_solved', 'left should not solve the fixture');
assert.ok(formatReplayFailure(notSolved).includes('fixture.txt level=0'));
assert.ok(formatReplayFailure(notSolved).includes('left'));

const actionSolved = replaySolutionOnOriginal({
    source: ACTION_WIN_SOURCE,
    game: 'action-win-fixture.txt',
    level: 0,
    solution: ['action'],
});
assert.strictEqual(actionSolved.status, 'solved', 'action win command should solve without changing the board');
assert.strictEqual(actionSolved.steps, 1);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-canonical-replay-test-'));
try {
    const corpusDir = path.join(tempRoot, 'corpus');
    const manifestPath = path.join(tempRoot, 'manifest.json');
    fs.mkdirSync(corpusDir, { recursive: true });
    fs.writeFileSync(path.join(corpusDir, 'fixture.txt'), SIMPLE_SOURCE, 'utf8');
    fs.writeFileSync(manifestPath, `${JSON.stringify({
        schema_version: 1,
        kind: 'solver_focus_group',
        target_count: 1,
        targets: [
            { game: 'fixture.txt', level: 0, first_solved_timeout_ms: 500 },
        ],
    }, null, 2)}\n`, 'utf8');

    const e2e = runCanonicalReplay({
        corpusPath: corpusDir,
        manifestPath,
        timeoutMs: 500,
        staticOptimizations: 'all',
        strategy: 'bfs',
        quiet: true,
        workDir: path.join(tempRoot, 'work'),
    });
    assert.strictEqual(e2e.failures.length, 0, e2e.failures.map(formatReplayFailure).join('\n'));
    assert.strictEqual(e2e.results.length, 1);
    assert.strictEqual(e2e.results[0].canonical_status, 'solved');
    assert.strictEqual(e2e.results[0].original_replay_status, 'solved');
    assert.deepStrictEqual(e2e.results[0].canonical_solution, ['right']);

    const canonicalCompileFailure = replayCanonicalSolutions({
        corpusPath: corpusDir,
    }, {
        results: [
            {
                game: 'fixture.txt',
                level: -1,
                status: 'compile_error',
                error: 'canonical fixture failed to compile',
            },
        ],
    });
    assert.strictEqual(canonicalCompileFailure.failures.length, 1, 'canonical compile errors should fail the replay harness');
    assert.strictEqual(canonicalCompileFailure.failures[0].status, 'canonical_compile_error');
    assert.strictEqual(canonicalCompileFailure.failures[0].canonical_status, 'compile_error');
    assert.strictEqual(canonicalCompileFailure.results[0].canonical_status, 'compile_error');
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('canonical_solution_replay_node: ok');
