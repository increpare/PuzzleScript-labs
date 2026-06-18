#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    CandidateBatchState,
    effortScore,
    gridDifference,
} = require('../src/puzzlescriptCandidateScheduler');

assert.strictEqual(gridDifference(['P..', '.O.'], ['P..', '.O.']), 0);
assert.strictEqual(gridDifference(['P..', '.O.'], ['.P.', '.O.']), 2);
assert.strictEqual(gridDifference([['player', '', ''], ['', 'target', '']], [['', 'player', ''], ['', 'target', '']]), 2);
assert.strictEqual(gridDifference([['']], [[]]), 1, 'missing cells should differ from present empty cells');

assert.strictEqual(effortScore({ unique_states: 10 }), 10);
assert.strictEqual(effortScore({ uniqueStates: 11 }), 11);
assert.strictEqual(effortScore({ expanded: 4, generated: 9 }), 9);

const batch = new CandidateBatchState({
    topCount: 3,
    promotionBudgetsMs: [1000, 5000, 30000],
    promotionQueueLimit: 2,
    batchId: 'batch-1',
});

assert.strictEqual(batch.recordEvaluation({
    level_hash: 1,
    status: 'solved',
    unique_states: 20,
    solution: ['right'],
    cells: [['player target']],
}).becameTopSolved, true);

assert.strictEqual(batch.recordEvaluation({
    level_hash: 2,
    status: 'solved',
    unique_states: 10,
    solution: ['left'],
    cells: [['player']],
}).becameTopSolved, true);

assert.strictEqual(batch.recordEvaluation({
    level_hash: 3,
    status: 'solved',
    unique_states: 30,
    solution: ['up'],
    cells: [['target']],
}).becameTopSolved, true);

assert.strictEqual(batch.recordEvaluation({
    level_hash: 4,
    status: 'solved',
    unique_states: 5,
    solution: ['down'],
    cells: [['background']],
}).becameTopSolved, false, 'low effort solved candidate should not enter top 3');

assert.deepStrictEqual(batch.solvedTop().map(candidate => candidate.level_hash), [3, 1, 2]);
assert.strictEqual(batch.shouldLogSolvedTop(3), true);
assert.strictEqual(batch.shouldLogSolvedTop(3), false, 'same top solved candidate logs once');

batch.recordEvaluation({
    level_hash: 5,
    status: 'timeout',
    unique_states: 100,
    solver_budget_ms: 1000,
    cells: [['player', 'crate']],
});
batch.recordEvaluation({
    level_hash: 6,
    status: 'timeout',
    unique_states: 80,
    solver_budget_ms: 1000,
    cells: [['wall', 'crate']],
});
batch.recordEvaluation({
    level_hash: 7,
    status: 'timeout',
    unique_states: 1,
    solver_budget_ms: 1000,
    cells: [['wall', 'crate']],
});

const next = batch.nextPromotion();
assert.strictEqual(next.level_hash, 5, 'highest effort timeout should promote first');
assert.strictEqual(next.next_budget_ms, 5000);
assert(batch.timeoutQueue().length <= 1, 'queue limit should evict low-priority timeout candidates');

const maxBudgetBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
    promotionQueueLimit: 4,
});
maxBudgetBatch.recordEvaluation({
    level_hash: 8,
    status: 'timeout',
    unique_states: 100,
    solver_budget_ms: 5000,
    cells: [['player']],
});
maxBudgetBatch.recordEvaluation({
    level_hash: 9,
    status: 'timeout',
    unique_states: 10,
    solver_budget_ms: 1000,
    cells: [['target']],
});
const promotable = maxBudgetBatch.nextPromotion();
assert.strictEqual(promotable.level_hash, 9, 'max-budget timeout should be skipped for the next promotable candidate');
assert.strictEqual(promotable.next_budget_ms, 5000);
assert.strictEqual(maxBudgetBatch.nextPromotion(), null, 'only non-advancing max-budget timeout should remain skipped');

console.log('candidate scheduler tests passed');
