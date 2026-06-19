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

const identityBatch = new CandidateBatchState();
assert.strictEqual(identityBatch.recordEvaluation({
    level_hash: 1,
    level_hash_hex: 'ABCDEF1234567890',
    status: 'solved',
    unique_states: 1,
    cells: [['player']],
}).becameTopSolved, true);
assert.strictEqual(
    identityBatch.shouldLogSolvedTop({ levelHashHex: 'abcdef1234567890', levelHash: 999 }),
    true,
    'exact hash should be canonicalized and preferred over numeric hash'
);
assert.strictEqual(identityBatch.shouldLogSolvedTop({ level_hash_hex: 'abcdef1234567890' }), false);

const exactStringBatch = new CandidateBatchState();
exactStringBatch.recordEvaluation({
    level_hash: 100,
    level_hash_hex: 'abcdef1234567890',
    status: 'solved',
    unique_states: 1,
    cells: [['player']],
});
assert.strictEqual(exactStringBatch.shouldLogSolvedTop('abcdef1234567890'), true);
assert.strictEqual(exactStringBatch.shouldLogSolvedTop('abcdef1234567890'), false, 'exact hash string logs once');

const exactStringLegacyBatch = new CandidateBatchState();
exactStringLegacyBatch.recordEvaluation({
    level_hash: 123,
    status: 'solved',
    unique_states: 1,
    cells: [['player']],
});
assert.strictEqual(exactStringLegacyBatch.shouldLogSolvedTop('000000000000007b'), true);
assert.strictEqual(exactStringLegacyBatch.shouldLogSolvedTop('000000000000007b'), false, 'safe exact hash string should alias legacy hash once');

assert.strictEqual(identityBatch.recordEvaluation({
    level_hash: 2,
    level_hash_hex: 'not-a-hex-hash',
    status: 'solved',
    unique_states: 100,
    cells: [['target']],
}).becameTopSolved, false, 'invalid exact hash should reject instead of falling back to numeric hash');
assert.strictEqual(identityBatch.solvedTop().length, 1);
assert.strictEqual(identityBatch.solvedTop()[0].level_hash, undefined);
assert.strictEqual(identityBatch.solvedTop()[0].level_hash_hex, 'abcdef1234567890');
assert.strictEqual(identityBatch.shouldLogSolvedTop({ levelHashHex: 'not-a-hex-hash', levelHash: 2 }), false);
assert.strictEqual(identityBatch.shouldLogSolvedTop(undefined), false);

const legacyIdentityBatch = new CandidateBatchState();
legacyIdentityBatch.recordEvaluation({
    levelHash: '00042',
    status: 'solved',
    uniqueStates: 1,
    cells: [['player']],
});
assert.strictEqual(legacyIdentityBatch.shouldLogSolvedTop(42), true, 'safe decimal string legacy hashes should normalize');

const invalidIdentityBatch = new CandidateBatchState();
assert.strictEqual(invalidIdentityBatch.recordEvaluation(null).becameTopSolved, false);
assert.strictEqual(invalidIdentityBatch.recordEvaluation({
    status: 'solved',
    unique_states: 1,
    cells: [['player']],
}).becameTopSolved, false);
invalidIdentityBatch.recordEvaluation({
    levelHash: Number.MAX_SAFE_INTEGER + 1,
    status: 'timeout',
    unique_states: 100,
    solver_budget_ms: 1000,
    cells: [['target']],
});
assert.strictEqual(invalidIdentityBatch.solvedTop().length, 0);
assert.strictEqual(invalidIdentityBatch.timeoutQueue().length, 0);

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

const duplicateTopBatch = new CandidateBatchState({ topCount: 3 });
duplicateTopBatch.recordEvaluation({
    level_hash: 30,
    status: 'solved',
    unique_states: 10,
    cells: [['player']],
});
duplicateTopBatch.recordEvaluation({
    level_hash: 31,
    status: 'solved',
    unique_states: 20,
    cells: [['target']],
});
assert.strictEqual(duplicateTopBatch.recordEvaluation({
    level_hash: 30,
    status: 'solved',
    unique_states: 25,
    cells: [['player']],
}).becameTopSolved, false, 'already-top duplicate should not count as newly entering top solved set');

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

const timeoutDuplicateAtMaxBudgetBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
    promotionQueueLimit: 4,
});
timeoutDuplicateAtMaxBudgetBatch.recordEvaluation({
    level_hash: 24,
    status: 'timeout',
    unique_states: 50,
    solver_budget_ms: 1000,
    cells: [['legacy']],
});
assert.strictEqual(timeoutDuplicateAtMaxBudgetBatch.timeoutQueue().length, 1);
timeoutDuplicateAtMaxBudgetBatch.recordEvaluation({
    level_hash_hex: '0000000000000018',
    status: 'timeout',
    unique_states: 60,
    solver_budget_ms: 5000,
    cells: [['exact']],
});
assert.strictEqual(timeoutDuplicateAtMaxBudgetBatch.timeoutQueue().length, 0, 'unpromotable duplicate timeout should clear older promotable entries');
assert.strictEqual(timeoutDuplicateAtMaxBudgetBatch.nextPromotion(), null);

const timeoutThenSolvedBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
    promotionQueueLimit: 4,
});
timeoutThenSolvedBatch.recordEvaluation({
    level_hash: 10,
    status: 'timeout',
    unique_states: 100,
    solver_budget_ms: 1000,
    cells: [['player']],
});
assert.strictEqual(timeoutThenSolvedBatch.timeoutQueue().length, 1);
assert.strictEqual(timeoutThenSolvedBatch.recordEvaluation({
    level_hash: 10,
    status: 'solved',
    unique_states: 101,
    cells: [['player']],
}).becameTopSolved, true);
assert.strictEqual(timeoutThenSolvedBatch.timeoutQueue().length, 0, 'solved candidate should be removed from timeout queue');
assert.strictEqual(timeoutThenSolvedBatch.nextPromotion(), null);

const legacyTimeoutExactSolvedBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
    promotionQueueLimit: 4,
});
legacyTimeoutExactSolvedBatch.recordEvaluation({
    level_hash: 123,
    status: 'timeout',
    unique_states: 100,
    solver_budget_ms: 1000,
    cells: [['legacy']],
});
assert.strictEqual(legacyTimeoutExactSolvedBatch.timeoutQueue().length, 1);
assert.strictEqual(legacyTimeoutExactSolvedBatch.recordEvaluation({
    level_hash: 123,
    level_hash_hex: '000000000000007b',
    status: 'solved',
    unique_states: 101,
    cells: [['exact']],
}).becameTopSolved, true);
assert.strictEqual(legacyTimeoutExactSolvedBatch.timeoutQueue().length, 0, 'exact solved identity should clear equivalent legacy timeout');
assert.strictEqual(legacyTimeoutExactSolvedBatch.nextPromotion(), null);

const legacyTimeoutExactOnlySolvedBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
    promotionQueueLimit: 4,
});
legacyTimeoutExactOnlySolvedBatch.recordEvaluation({
    level_hash: 123,
    status: 'timeout',
    unique_states: 100,
    solver_budget_ms: 1000,
    cells: [['legacy']],
});
assert.strictEqual(legacyTimeoutExactOnlySolvedBatch.recordEvaluation({
    level_hash_hex: '000000000000007b',
    status: 'solved',
    unique_states: 101,
    cells: [['exact']],
}).becameTopSolved, true);
assert.strictEqual(legacyTimeoutExactOnlySolvedBatch.timeoutQueue().length, 0, 'safe exact-only solved identity should clear equivalent legacy timeout');
assert.strictEqual(legacyTimeoutExactOnlySolvedBatch.nextPromotion(), null);

const legacyTimeoutConflictingExactSolvedBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
    promotionQueueLimit: 4,
});
legacyTimeoutConflictingExactSolvedBatch.recordEvaluation({
    level_hash: 123,
    status: 'timeout',
    unique_states: 100,
    solver_budget_ms: 1000,
    cells: [['legacy']],
});
assert.strictEqual(legacyTimeoutConflictingExactSolvedBatch.recordEvaluation({
    level_hash: 999999,
    level_hash_hex: '000000000000007B',
    status: 'solved',
    unique_states: 101,
    cells: [['exact']],
}).becameTopSolved, true);
assert.strictEqual(legacyTimeoutConflictingExactSolvedBatch.timeoutQueue().length, 0, 'exact-derived safe alias should ignore conflicting legacy field');
assert.strictEqual(legacyTimeoutConflictingExactSolvedBatch.nextPromotion(), null);
assert.strictEqual(legacyTimeoutConflictingExactSolvedBatch.solvedTop()[0].level_hash, 123, 'exposed candidate should use exact-derived canonical legacy hash');
assert.strictEqual(legacyTimeoutConflictingExactSolvedBatch.solvedTop()[0].level_hash_hex, '000000000000007b');

const solvedThenTimeoutBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
    promotionQueueLimit: 4,
});
solvedThenTimeoutBatch.recordEvaluation({
    level_hash: 11,
    status: 'solved',
    unique_states: 100,
    cells: [['target']],
});
solvedThenTimeoutBatch.recordEvaluation({
    level_hash: 11,
    status: 'timeout',
    unique_states: 200,
    solver_budget_ms: 1000,
    cells: [['target']],
});
assert.strictEqual(solvedThenTimeoutBatch.timeoutQueue().length, 0, 'already solved candidate should not become promotable timeout');
assert.deepStrictEqual(solvedThenTimeoutBatch.solvedTop().map(candidate => candidate.level_hash), [11]);
assert.strictEqual(solvedThenTimeoutBatch.nextPromotion(), null);

const trimBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
    promotionQueueLimit: 1,
});
trimBatch.recordEvaluation({
    level_hash: 12,
    status: 'timeout',
    unique_states: 1000,
    solver_budget_ms: 5000,
    cells: [['max']],
});
trimBatch.recordEvaluation({
    level_hash: 13,
    status: 'timeout',
    unique_states: 1,
    solver_budget_ms: 1000,
    cells: [['low']],
});
assert.deepStrictEqual(trimBatch.timeoutQueue().map(candidate => candidate.level_hash), [13]);
assert.strictEqual(trimBatch.nextPromotion().level_hash, 13);

const defensiveBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
});
defensiveBatch.recordEvaluation({
    level_hash: 14,
    status: 'solved',
    unique_states: 20,
    solution: ['right'],
    rows: ['P..'],
    cells: [['player']],
});
const solvedSnapshot = defensiveBatch.solvedTop();
solvedSnapshot[0].level_hash = 999;
solvedSnapshot[0].cells[0][0] = 'mutated';
solvedSnapshot[0].solution[0] = 'left';
solvedSnapshot[0].rows[0] = 'mutated';
assert.deepStrictEqual(defensiveBatch.solvedTop().map(candidate => candidate.level_hash), [14]);
assert.deepStrictEqual(defensiveBatch.solvedTop()[0].cells, [['player']]);
assert.deepStrictEqual(defensiveBatch.solvedTop()[0].solution, ['right']);
assert.deepStrictEqual(defensiveBatch.solvedTop()[0].rows, ['P..']);
const currentSolvedSnapshot = defensiveBatch.currentSolvedTop();
currentSolvedSnapshot[0].level_hash = 999;
currentSolvedSnapshot[0].cells[0][0] = 'mutated';
currentSolvedSnapshot[0].solution[0] = 'left';
currentSolvedSnapshot[0].rows[0] = 'mutated';
assert.deepStrictEqual(defensiveBatch.solvedTop().map(candidate => candidate.level_hash), [14]);
assert.deepStrictEqual(defensiveBatch.currentSolvedTop().map(candidate => candidate.level_hash), [14]);
assert.deepStrictEqual(defensiveBatch.currentSolvedTop()[0].cells, [['player']]);
assert.deepStrictEqual(defensiveBatch.currentSolvedTop()[0].solution, ['right']);
assert.deepStrictEqual(defensiveBatch.currentSolvedTop()[0].rows, ['P..']);
defensiveBatch.recordEvaluation({
    level_hash: 15,
    status: 'timeout',
    unique_states: 10,
    solver_budget_ms: 1000,
    solution: ['up'],
    rows: ['..O'],
    cells: [['crate']],
});
const timeoutSnapshot = defensiveBatch.timeoutQueue();
timeoutSnapshot[0].level_hash = 999;
timeoutSnapshot[0].cells[0][0] = 'mutated';
timeoutSnapshot[0].solution[0] = 'down';
timeoutSnapshot[0].rows[0] = 'mutated';
assert.deepStrictEqual(defensiveBatch.timeoutQueue().map(candidate => candidate.level_hash), [15]);
assert.deepStrictEqual(defensiveBatch.timeoutQueue()[0].cells, [['crate']]);
assert.deepStrictEqual(defensiveBatch.timeoutQueue()[0].solution, ['up']);
assert.deepStrictEqual(defensiveBatch.timeoutQueue()[0].rows, ['..O']);

const promotedCopyBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
});
promotedCopyBatch.recordEvaluation({
    level_hash: 17,
    status: 'timeout',
    unique_states: 10,
    solver_budget_ms: 1000,
    solution: ['left'],
    rows: ['P.O'],
    cells: [['player']],
});
const promotedCopy = promotedCopyBatch.nextPromotion();
promotedCopy.solution[0] = 'right';
promotedCopy.rows[0] = 'mutated';
promotedCopy.cells[0][0] = 'mutated';
assert.deepStrictEqual(promotedCopyBatch.promoted[0].solution, ['left']);
assert.deepStrictEqual(promotedCopyBatch.promoted[0].rows, ['P.O']);
assert.deepStrictEqual(promotedCopyBatch.promoted[0].cells, [['player']]);

const callerOwnedSolvedCandidate = {
    level_hash: 25,
    status: 'solved',
    unique_states: 20,
    solution: ['right'],
    rows: [['P', '.', '.']],
    cells: [['player']],
};
const callerOwnedTimeoutCandidate = {
    level_hash: 26,
    status: 'timeout',
    unique_states: 10,
    solver_budget_ms: 1000,
    solution: ['left'],
    rows: [['.', 'O', '.']],
    cells: [['crate']],
};
const callerSnapshotBatch = new CandidateBatchState({
    promotionBudgetsMs: [1000, 5000],
});
callerSnapshotBatch.recordEvaluation(callerOwnedSolvedCandidate);
callerOwnedSolvedCandidate.solution[0] = 'down';
callerOwnedSolvedCandidate.rows[0][0] = 'X';
callerOwnedSolvedCandidate.cells[0][0] = 'mutated';
assert.deepStrictEqual(callerSnapshotBatch.solvedTop()[0].solution, ['right']);
assert.deepStrictEqual(callerSnapshotBatch.solvedTop()[0].rows, [['P', '.', '.']]);
assert.deepStrictEqual(callerSnapshotBatch.solvedTop()[0].cells, [['player']]);
callerSnapshotBatch.recordEvaluation(callerOwnedTimeoutCandidate);
callerOwnedTimeoutCandidate.solution[0] = 'up';
callerOwnedTimeoutCandidate.rows[0][1] = 'X';
callerOwnedTimeoutCandidate.cells[0][0] = 'mutated';
assert.deepStrictEqual(callerSnapshotBatch.timeoutQueue()[0].solution, ['left']);
assert.deepStrictEqual(callerSnapshotBatch.timeoutQueue()[0].rows, [['.', 'O', '.']]);
assert.deepStrictEqual(callerSnapshotBatch.timeoutQueue()[0].cells, [['crate']]);

const unsortedBudgetBatch = new CandidateBatchState({
    promotionBudgetsMs: [30000, 1000, 5000, 5000],
});
unsortedBudgetBatch.recordEvaluation({
    level_hash: 16,
    status: 'timeout',
    unique_states: 10,
    solver_budget_ms: 1000,
    cells: [['player']],
});
assert.strictEqual(unsortedBudgetBatch.nextPromotion().next_budget_ms, 5000, 'budgets should promote to the next sorted higher value');

const filteredBudgetBatch = new CandidateBatchState({
    promotionBudgetsMs: [-5, 5000.5, 1000, 5000],
});
assert.deepStrictEqual(filteredBudgetBatch.promotionBudgetsMs, [1000, 5000], 'promotion budgets should keep only positive integers');
filteredBudgetBatch.recordEvaluation({
    level_hash: 22,
    status: 'timeout',
    unique_states: 10,
    solver_budget_ms: 1000,
    cells: [['player']],
});
assert.strictEqual(filteredBudgetBatch.nextPromotion().next_budget_ms, 5000);

const invalidBudgetFallbackBatch = new CandidateBatchState({
    promotionBudgetsMs: [-5, 0, 5000.5, Infinity, 'nope'],
});
invalidBudgetFallbackBatch.recordEvaluation({
    level_hash: 23,
    status: 'timeout',
    unique_states: 10,
    solver_budget_ms: 1000,
    cells: [['target']],
});
const fallbackPromotion = invalidBudgetFallbackBatch.nextPromotion();
assert(fallbackPromotion, 'invalid promotion budget lists should fall back to defaults');
assert.strictEqual(fallbackPromotion.next_budget_ms, 5000);

const invalidOptionsBatch = new CandidateBatchState({
    topCount: -1,
    promotionQueueLimit: 1.5,
    promotionBudgetsMs: [1000, 5000],
});
invalidOptionsBatch.recordEvaluation({
    level_hash: 18,
    status: 'solved',
    unique_states: 30,
    cells: [['player']],
});
invalidOptionsBatch.recordEvaluation({
    level_hash: 19,
    status: 'solved',
    unique_states: 20,
    cells: [['target']],
});
assert.deepStrictEqual(invalidOptionsBatch.solvedTop().map(candidate => candidate.level_hash), [18, 19]);
invalidOptionsBatch.recordEvaluation({
    level_hash: 20,
    status: 'timeout',
    unique_states: 10,
    solver_budget_ms: 1000,
    cells: [['crate']],
});
invalidOptionsBatch.recordEvaluation({
    level_hash: 21,
    status: 'timeout',
    unique_states: 9,
    solver_budget_ms: 1000,
    cells: [['wall']],
});
assert.deepStrictEqual(invalidOptionsBatch.timeoutQueue().map(candidate => candidate.level_hash), [20, 21]);

console.log('candidate scheduler tests passed');
