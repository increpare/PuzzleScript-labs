#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const {
    createSiblingMarkovPriorStore,
} = require('./lib/solver_sibling_markov_prior');
const {
    parseArgs,
    runCorpus,
} = require('./run_solver_tests_js');

const actions = ['right', 'up', 'down', 'left', 'action']
    .map((token, input) => ({ token, input }));

const store = createSiblingMarkovPriorStore({
    results: [
        { game: 'alpha.txt', level: 0, status: 'solved', solution: ['right', 'right'] },
        { game: 'alpha.txt', level: 1, status: 'solved', solution: ['action', 'left', 'action', 'left'] },
        { game: 'alpha.txt', level: 2, status: 'timeout', solution: [] },
        { game: 'beta.txt', level: 0, status: 'solved', solution: ['up', 'up'] },
        { game: 'alpha.txt', level: 3, status: 'solved', solution: ['tick'] },
    ],
});

assert.strictEqual(store.ignoredRecords, 2, 'timeout and unsupported solutions are ignored');

const targetZero = store.forTarget('alpha.txt', 0, actions);
assert.strictEqual(targetZero.trainingLevels, 1, 'the target solution is excluded');
assert.deepStrictEqual(
    targetZero.actionsFor(null).map((action) => action.token),
    ['action', 'right', 'up', 'down', 'left'],
    'action can be learned as the first input'
);
assert.deepStrictEqual(
    targetZero.actionsFor('action').map((action) => action.token),
    ['left', 'right', 'up', 'down', 'action'],
    'action is also a first-class previous-input context'
);
assert.strictEqual(targetZero.actionsFor('up'), null, 'missing contexts preserve baseline order');

const targetTwo = store.forTarget('alpha.txt', 2, actions);
assert.strictEqual(targetTwo.trainingLevels, 2, 'all solved siblings train an unsolved target');
assert.deepStrictEqual(
    targetTwo.actionsFor(null).map((action) => action.token),
    ['right', 'action', 'up', 'down', 'left'],
    'equal counts preserve baseline order'
);

assert.strictEqual(store.forTarget('missing.txt', 0, actions), null);
assert.throws(
    () => createSiblingMarkovPriorStore({ results: [
        { game: 'dup.txt', level: 0, status: 'solved', solution: ['right'] },
        { game: 'dup.txt', level: 0, status: 'solved', solution: ['left'] },
    ] }),
    /duplicate solved training record dup\.txt#0/
);
assert.throws(() => createSiblingMarkovPriorStore({}), /expected top-level results array/);

const smokeCorpus = path.join(__dirname, 'solver_smoke_tests');
const trainingPath = path.join(__dirname, 'training.json');
const parsed = parseArgs([
    'node',
    'run_solver_tests_js.js',
    smokeCorpus,
    '--solver-sibling-priors',
    trainingPath,
]);
assert.strictEqual(parsed.solverSiblingPriorsPath, trainingPath);

const coldResults = runCorpus(parseArgs([
    'node',
    'run_solver_tests_js.js',
    smokeCorpus,
    '--game',
    'one_move.txt',
    '--level',
    '0',
    '--strategy',
    'bfs',
    '--timeout-ms',
    '1000',
    '--no-solutions',
    '--quiet',
]));
assert.strictEqual(coldResults.length, 1);
const cold = coldResults[0];
assert.strictEqual(cold.sibling_prior_enabled, false);
assert.strictEqual(cold.sibling_prior_training_records_ignored, 0);
assert.strictEqual(cold.sibling_prior_training_levels, 0);
assert.strictEqual(cold.sibling_prior_contexts, 0);
assert.strictEqual(cold.sibling_prior_ordered_expansions, 0);
assert.strictEqual(cold.sibling_prior_fallback_expansions, 0);

console.log('solver_sibling_markov_prior_node passed');
