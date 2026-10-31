import assert from 'node:assert/strict';
import test from 'node:test';
import { Direction, Movement } from '../build/model.js';
import { resolveMovements } from '../build/movement.js';
import { findMatches, matchesRow } from '../build/matching.js';
import { Ellipsis } from '../build/rule-model.js';
import { createRandom, nextRandom } from '../build/random.js';
import { createRuntimeOracle } from './legacy-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const oracle = createRuntimeOracle({ Direction, Movement, Ellipsis, resolveMovements, findMatches, matchesRow,
  createRandom, nextRandom });

test('compares movement phases and every input snapshot for pushing and blocking', () => {
  const report = oracle.compareFixture({
    name: 'chain then boundary',
    source: movementSource({ sounds: 'Player move 100\nCrate cantmove 200' }),
    inputs: [3, 3, 'undo', 3, 'restart', 3],
    seed: 'movement-oracle',
  });
  assert.ok(report.movementCalls >= 4);
  assert.equal(report.snapshots, 7);
});

test('includes the rigid retry rather than only the final input board', () => {
  const report = oracle.compareFixture({
    name: 'blocked rigid push',
    source: movementSource({
      rules: 'rigid [ > Player | Crate ] -> [ > Player | > Crate ]',
      level: 'PC#',
    }),
    inputs: [3],
    seed: 'rigid-oracle',
  });
  assert.ok(report.rigidRetries > 0);
});

test('preserves host matching summaries across rigid rollback', () => {
  const fixture = oracle.corpusFixtures().find(({ name }) => name === 'rigid body test 2');
  assert.ok(fixture);
  const report = oracle.compareFixture(fixture);
  assert.ok(report.rigidRetries > 0);
});

test('compares complete RNG state while seeded random rules feed movement', () => {
  const report = oracle.compareFixture({
    name: 'random directions',
    source: movementSource({
      rules: 'random [ Player ] -> [ randomdir Player ]',
      level: '..P..',
    }),
    inputs: ['tick', 'tick', 'tick', 'tick'],
    seed: 'random-movement-oracle',
  });
  assert.ok(report.movementCalls >= 4);
  assert.equal(report.snapshots, 5);
});

test('also replaces movement during level-start execution and again substeps', () => {
  const report = oracle.compareFixture({
    name: 'level start and again',
    source: movementSource({
      metadata: 'run_rules_on_level_start',
      rules: 'right [ Player | no Wall ] -> [ > Player | ] again',
      level: 'P...#',
    }),
    inputs: [],
    seed: 'level-start-oracle',
  });
  assert.ok(report.movementCalls > 1);
  assert.ok(report.snapshots > 1, 'level-start again substeps must have their own snapshots');
});

test('the differential oracle rejects a resolver that leaves a moving board unchanged', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'deliberately broken candidate',
    source: movementSource({ rules: '', level: 'P..' }),
    inputs: [3],
    seed: 'broken-oracle',
  }, {
    resolveMovements: (_game, before) => ({
      ...before,
      pendingMovements: [],
      rigidMarks: [],
      retry: false,
    }),
  }), /deliberately broken candidate.*movement/s);
});

test('the differential oracle rejects a resolver that mutates input coordinates', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'deliberately mutating candidate',
    source: movementSource({ rules: '', level: 'P..' }),
    inputs: [3],
    seed: 'mutating-oracle',
  }, {
    resolveMovements: (game, before) => {
      const result = resolveMovements(game, before);
      before.pendingMovements[0].position.x = 999;
      return result;
    },
  }), /mutated its incoming snapshot/);
});

test('replaces ordered rule searches and rechecks after earlier replacements', () => {
  const report = oracle.compareFixture({
    name: 'matching replacement boundary',
    source: movementSource({ rules: 'right [ Crate | Crate ] -> [ Wall | Crate ]', level: 'PCCC' }),
    inputs: ['tick'],
    seed: 'matching-rechecks',
  });
  assert.ok(report.matchSearches > 0);
  assert.ok(report.matchRechecks > 0);
});

test('compares zero-length and multiple ellipsis matches in source order', () => {
  const report = oracle.compareFixture({
    name: 'two ellipsis matching',
    source: movementSource({
      rules: 'right [ Player | ... | Crate | ... | Wall ] -> [ Player | ... | Crate | ... | Wall ] sfx0',
      level: 'PC.C.#',
    }),
    inputs: ['tick'],
    seed: 'matching-ellipses',
  });
  assert.ok(report.matchSearches > 0);
});

test('the oracle rejects a matcher that reverses valid matches', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'deliberately reordered matches',
    source: movementSource({ rules: 'right [ Player ] -> [ Player ] sfx0', level: 'PP.' }),
    inputs: ['tick'],
    seed: 'wrong-match-order',
  }, {
    findMatches: (rule, before) => findMatches(rule, before).map(row => row.slice().reverse()),
  }), /ordered rule matches/);
});

test('the oracle rejects an incorrect fixed-gap recheck', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'deliberately incorrect row check',
    source: movementSource({ rules: 'right [ Crate | Crate ] -> [ Wall | Crate ]', level: 'PCCC' }),
    inputs: ['tick'],
    seed: 'wrong-row-check',
  }, { matchesRow: () => false }), /row recheck/);
});

test('native rechecks observe matches invalidated by an earlier overlapping write', () => {
  const fixture = {
    name: 'invalidated later overlap',
    source: movementSource({ rules: 'right [ Crate | Crate ] -> [ Crate | Wall ]', level: 'PCCCC' }),
    inputs: ['tick'], seed: 'invalidated-row-check',
  };
  const outcomes = [];
  oracle.compareFixture(fixture, { matchesRow: (...args) => {
    const result = matchesRow(...args);
    outcomes.push(result);
    return result;
  } });
  assert.deepEqual(outcomes, [false, true]);
  assert.throws(() => oracle.compareFixture(fixture, { matchesRow: () => true }), /row recheck/);
});

test('replaces random stream initialization and every draw in random rules', () => {
  const report = oracle.compareFixture({
    name: 'random stream replacement',
    source: movementSource({ rules: 'random [ Player ] -> [ randomdir Player ]', level: '..P..' }),
    inputs: ['tick', 'tick', 'tick'],
    seed: 'independent-random-stream',
  });
  assert.ok(report.randomDraws > 0);
});

test('the oracle rejects the wrong random value even with the correct next state', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'deliberately wrong random draw',
    source: movementSource({ rules: 'random [ Player ] -> [ randomdir Player ]', level: '..P..' }),
    inputs: ['tick'],
    seed: 'wrong-random-value',
  }, {
    nextRandom: before => ({ ...nextRandom(before), value: 0 }),
  }), /random draw value/);
});

test('the oracle rejects initialization from the wrong seed', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'deliberately wrong seed',
    source: movementSource({ rules: '', level: 'P..' }),
    inputs: [],
    seed: 'requested-seed',
  }, { createRandom: () => createRandom('different-seed') }), /seeded random state/);
});

test('overlapping rigid layers retain their first contributing owners', () => {
  // Regression for https://github.com/increpare/PuzzleScript/issues/1206.
  const observed = [];
  const report = oracle.compareFixture({
    name: 'overlapping rigid layer provenance',
    source: movementSource({
      rules: [
        'rigid right [ Player ] -> [ > Player ]',
        'rigid down [ Player Crate ] -> [ > Player > Crate ]',
        'rigid right [ Wall ] -> [ > Wall ]',
      ].join('\n'),
      level: 'P.',
    }).replace('P = Player', 'P = Player and Crate')
      .replace('Player, Crate, Wall', 'Player\nCrate\nWall'),
    inputs: ['tick'],
    seed: 'rigid-responsibility-compatibility',
  }, {
    resolveMovements: (game, before) => {
      observed.push(before.rigidMarks.map(({ layer, group }) => ({ layer, group })));
      return resolveMovements(game, before);
    },
  });
  // Group 2 never matched: its Wall is absent. The Player keeps its first
  // contributor while the newly marked Crate layer belongs to group 1.
  assert.deepEqual(observed, [
    [{ layer: 1, group: 0 }, { layer: 2, group: 1 }],
    [{ layer: 1, group: 1 }, { layer: 2, group: 1 }],
    [],
  ]);
  assert.equal(report.rigidRetries, 2);
});
