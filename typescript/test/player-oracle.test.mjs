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
}, { editorMode: false });

test('overlapping rigid responsibility can name no declared group', () => {
  const observed = [];
  const report = oracle.compareFixture({
    name: 'unknown rigid responsibility',
    source: movementSource({
      rules: [
        'rigid right [ Player ] -> [ > Player ]',
        'rigid right [ Wall ] -> [ > Wall ]',
        'rigid left [ Wall ] -> [ > Wall ]',
        'rigid down [ Player Crate ] -> [ > Player > Crate ]',
      ].join('\n'),
      level: 'P.',
    }).replace('P = Player', 'P = Player and Crate')
      .replace('Player, Crate, Wall', 'Player\nCrate\nWall'),
    inputs: ['tick'], seed: 'unknown-rigid-owner',
  }, {
    // The editor's diagnostic tries to print the missing group's source line
    // and throws. Player mode exercises the retry without that editor diagnostic.
    resolveMovements: (game, before) => {
      observed.push(before.rigidMarks.map(({ layer, group }) => ({ layer, group })));
      return resolveMovements(game, before);
    },
  });
  assert.deepEqual(observed[0], [{ layer: 1, group: null }, { layer: 2, group: 3 }]);
  assert.equal(report.rigidRetries, 1);
});
