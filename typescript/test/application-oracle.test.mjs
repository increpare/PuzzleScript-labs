import assert from 'node:assert/strict';
import test from 'node:test';
import { Direction, Movement } from '../build/model.js';
import { Ellipsis } from '../build/rule-model.js';
import { CommandKind } from '../build/commands.js';
import { resolveMovements } from '../build/movement.js';
import { findMatches, matchesRow } from '../build/matching.js';
import { createRandom, nextRandom } from '../build/random.js';
import { applyRules } from '../build/scheduling.js';
import { createRuntimeOracle } from './legacy-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const oracle = createRuntimeOracle({
  Direction, Movement, Ellipsis, CommandKind,
  resolveMovements, findMatches, matchesRow, createRandom, nextRandom, applyRules,
});

test('complete TypeScript rules produce the movement requests in corpus replay', () => {
  const report = oracle.compareFixture({
    name: 'full rules chain', source: movementSource(),
    inputs: [3, 3, 'undo', 3, 'restart', 3], seed: 'full-rules-chain',
  });
  assert.ok(report.rulePhases > 0);
  assert.equal(report.snapshots, 7);
});

test('complete rule replay includes random tuple and random direction consumption', () => {
  const report = oracle.compareFixture({
    name: 'full random rules',
    source: movementSource({ rules: 'random [ Player ] -> [ randomdir Player ]', level: '..P..' }),
    inputs: ['tick', 'tick', 'tick', 'tick'], seed: 'full-rules-random',
  });
  assert.ok(report.randomDraws >= 8);
  assert.ok(report.rulePhases >= 4);
});

test('late rules and command queues are produced by TypeScript', () => {
  const report = oracle.compareFixture({
    name: 'full late rules',
    source: movementSource({
      rules: '[ > Player | Crate ] -> [ > Player | > Crate ]\nlate [ Player ] -> [ Player ] sfx0',
    }),
    inputs: [3, 3], seed: 'full-rules-late',
  });
  assert.ok(report.rulePhases >= 4);
});

test('cross-cell property inference executes concrete members on different collision layers', () => {
  const detected = new Set();
  oracle.compareFixture({
    name: 'cross-layer property transfer',
    source: movementSource({
      rules: 'right [ Movable | no Movable ] -> [ | Movable ]', level: 'PC..',
    }).replace('C = Crate', 'C = Crate\nMovable = Crate or Player')
      .replace('Player, Crate, Wall', 'Player\nCrate\nWall'),
    inputs: [3, 'tick', 'undo', 'tick'], seed: 'cross-layer-property',
  }, {
    applyRules: (game, schedule, before) => {
      for (const rule of schedule.groups.flatMap(group => group.rules)) {
        for (const cell of rule.rows.flat()) for (const object of cell.requiredObjects) detected.add(object.name);
      }
      return applyRules(game, schedule, before);
    },
  });
  assert.deepEqual(detected, new Set(['player', 'crate']));
});

test('movement inference executes each concrete movement alternative', () => {
  const detected = new Set();
  for (const [input, movement] of [Movement.Up, Movement.Left, Movement.Down, Movement.Right, Movement.Action].entries()) {
    let transferred = false;
    oracle.compareFixture({
      name: 'fixed aggregate transfer ' + Movement[movement],
      source: movementSource({
        rules: 'right [ moving Player | Crate ] -> [ Player | moving Crate ]', level: 'PC..',
      }),
      inputs: [input], seed: 'fixed-aggregate',
    }, {
      applyRules: (game, schedule, before) => {
        for (const rule of schedule.groups.flatMap(group => group.rules)) {
          for (const cell of rule.rows.flat()) for (const term of cell.requiredMovements) detected.add(term.movement);
        }
        const result = applyRules(game, schedule, before);
        transferred ||= result.state.pendingMovements.some(request => request.position.x === 1 && request.movements.has(movement));
        return result;
      },
    });
    assert.ok(transferred, 'Crate receives the inferred ' + Movement[movement] + ' request');
  }
  assert.deepEqual(detected, new Set([Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action]));
});

test('property and aggregate inference compose in the complete rule runner', () => {
  const detected = new Map();
  oracle.compareFixture({
    name: 'property aggregate transfer',
    source: movementSource({
      rules: 'right [ moving Movable | no Movable ] -> [ | moving Movable ]', level: 'PC..',
    }).replace('C = Crate', 'C = Crate\nMovable = Player or Crate')
      .replace('Player, Crate, Wall', 'Player\nCrate\nWall'),
    inputs: [3, 'tick', 1], seed: 'property-aggregate',
  }, {
    applyRules: (game, schedule, before) => {
      for (const rule of schedule.groups.flatMap(group => group.rules)) {
        for (const cell of rule.rows.flat()) for (const term of cell.requiredMovements) {
          if (!detected.has(term.layer)) detected.set(term.layer, new Set());
          detected.get(term.layer).add(term.movement);
        }
      }
      return applyRules(game, schedule, before);
    },
  });
  for (const layer of [1, 2]) assert.deepEqual(detected.get(layer),
    new Set([Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action]));
});

test('movement alternatives remain explicit in games with many layers', () => {
  const detected = new Set();
  const source = movementSource({
    rules: [
      'right [ Crate ] -> [ > Crate ]',
      'right [ Wall ] -> [ < Wall ]',
      'right [ moving Movable | Movable ] -> [ moving Movable | moving Movable ]',
    ].join('\n'),
    level: 'C#..',
  }).replace('C = Crate', 'C = Crate\nMovable = Crate or Wall')
    .replace('\nlegend\n', '\nFillerA\nblack\n\nFillerB\nblack\n\nFillerC\nblack\n\nFillerD\nblack\n\nlegend\n')
    .replace('Player, Crate, Wall', 'Player\nFillerA\nFillerB\nFillerC\nFillerD\nCrate\nWall');
  oracle.compareFixture({ name: 'cross-word coupled condition', source, inputs: ['tick', 'tick'], seed: 'coupled' }, {
    applyRules: (game, schedule, before) => {
      for (const rule of schedule.groups.flatMap(group => group.rules)) {
        for (const cell of rule.rows.flat()) for (const term of cell.requiredMovements) {
          if (term.layer === 6) detected.add(term.movement);
        }
      }
      return applyRules(game, schedule, before);
    },
  });
  assert.deepEqual(detected, new Set([Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action]));
});

test('full rule replay preserves rigid retries and source corpus expectations', () => {
  const fixture = oracle.corpusFixtures().find(({ name }) => name === 'rigid body test 2');
  assert.ok(fixture);
  const report = oracle.compareFixture(fixture);
  assert.ok(report.rigidRetries > 0);
});

test('the oracle rejects rule execution that leaves requests unchanged', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'deliberately broken full rules', source: movementSource(),
    inputs: [3], seed: 'broken-full-rules',
  }, {
    applyRules: (_game, _schedule, before) => ({ state: before, changed: false, diagnostics: [] }),
  }), /resulting rule state/);
});

test('vanilla JS retains sound commands enabled by randomdir', () => {
  const fixture = {
    name: 'randomdir enables a sound command',
    source: movementSource({
      rules: '[ stationary Crate ] -> [ randomdir Crate ]\nright [ > Crate | Player ] -> sfx0',
      level: 'CP.',
    }),
    inputs: [0], seed: 'random-rule-sound-6',
  };
  const report = oracle.compareFixture(fixture);
  assert.equal(report.randomDraws, 1);
});

test('paired full-rule replays begin with the same external message and sound transients', () => {
  const fixture = oracle.corpusFixtures().find(({ name }) => name === 'again + message combo');
  assert.ok(fixture);
  const report = oracle.compareFixture(fixture);
  assert.ok(report.rulePhases > 0);
  assert.ok(report.snapshots > 1);
});
