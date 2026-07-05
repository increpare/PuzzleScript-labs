#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const {
    parseArgs,
    __solverSearchInternals,
} = require('./run_solver_tests_js');

const parsed = parseArgs([
    'node',
    'run_solver_tests_js.js',
    path.join(__dirname, 'solver_smoke_tests'),
    '--solver-novelty',
    'tiebreak',
]);
assert.strictEqual(parsed.solverNovelty, 'tiebreak');

assert.throws(
    () => parseArgs([
        'node',
        'run_solver_tests_js.js',
        path.join(__dirname, 'solver_smoke_tests'),
        '--solver-novelty',
        'prune',
    ]),
    /Unsupported solver novelty mode: prune/
);

const {
    compareSolverQueueItems,
    createObjectNoveltyTracker,
} = __solverSearchInternals;

assert(compareSolverQueueItems(
    { priority: 1, novelty: 1, tie: 0 },
    { priority: 2, novelty: 0, tie: 0 }
) < 0, 'primary priority must outrank novelty');

assert(compareSolverQueueItems(
    { priority: 2, novelty: 0, tie: 7 },
    { priority: 2, novelty: 1, tie: 0 }
) < 0, 'novel states should win equal-priority ties');

assert(compareSolverQueueItems(
    { priority: 2, novelty: 1, tie: 3 },
    { priority: 2, novelty: 1, tie: 4 }
) < 0, 'FIFO tie should remain the final ordering key');

const tracker = createObjectNoveltyTracker(new Uint32Array([0b001, 0b010]));
assert.strictEqual(
    tracker.testAndRecord(new Uint32Array([0b001, 0b010])),
    false,
    'the initial atoms are not novel'
);
assert.strictEqual(
    tracker.testAndRecord(new Uint32Array([0b101, 0b010])),
    true,
    'a new object bit in an existing cell is novel'
);
assert.strictEqual(
    tracker.testAndRecord(new Uint32Array([0b101, 0b010])),
    false,
    'an atom is no longer novel after being recorded'
);
assert.strictEqual(
    tracker.testAndRecord(new Uint32Array([0b101, 0b110])),
    true,
    'a new object bit in another cell is novel'
);

console.log('solver_novelty_node passed');
