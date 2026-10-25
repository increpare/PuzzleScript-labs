import assert from 'node:assert/strict';
import test from 'node:test';
import { Direction, Movement } from '../build/model.js';
import { Ellipsis } from '../build/rule-model.js';
import { CommandKind } from '../build/commands.js';
import { resolveMovements } from '../build/movement.js';
import { findMatches, matchesRow } from '../build/matching.js';
import { createRandom, nextRandom } from '../build/random.js';
import { applyTurnRules, PlayerMatchKind } from '../build/turn-rules.js';
import { createRuntimeOracle } from './legacy-oracle.cjs';
import { movementSource } from './scenarios.mjs';
import { instrumentTurnInput } from './legacy-turn-hook.cjs';

const oracle = createRuntimeOracle({
  Direction, Movement, Ellipsis, CommandKind, PlayerMatchKind,
  resolveMovements, findMatches, matchesRow, createRandom, nextRandom, applyTurnRules,
});
const fixture = (rules = '', inputs = [3]) => ({
  name: 'complete turn pipeline', source: movementSource({ rules, level: 'P...' }),
  inputs, seed: 'turn-pipeline',
});

test('the whole-turn-only candidate owns input movement and retains session history', () => {
  let calls = 0;
  const report = oracle.compareFixture(fixture('', [3, 3, 'undo', 'restart', 3, 'tick']), {
    resolveMovements: () => { throw new Error('Candidate must bypass legacy movement hooks'); },
    applyRules: () => { throw new Error('Candidate must bypass legacy rule hooks'); },
    findMatches: () => { throw new Error('Candidate must bypass legacy matching hooks'); },
    applyTurnRules: (game, before, input) => {
      calls++;
      return applyTurnRules(game, before, input);
    },
  });
  assert.equal(calls, report.turnPhases);
  assert.ok(calls >= 4);
  assert.equal(report.snapshots, 7);
  assert.equal(report.matchSearches, 0, 'Candidate whole-turn execution bypasses legacy rule matching hooks');
});

test('a pipeline that ignores player input is rejected at the turn boundary', () => {
  assert.throws(() => oracle.compareFixture(fixture(), {
    applyTurnRules: (game, before) => applyTurnRules(game, before, null),
  }), /resulting turn state/);
});

test('a pipeline with incorrect source player positions is rejected', () => {
  assert.throws(() => oracle.compareFixture(fixture(), {
    applyTurnRules: (...args) => ({ ...applyTurnRules(...args), playerPositions: [] }),
  }), /source player positions/);
});


test('early pushing and late sound commands share the complete turn boundary', () => {
  const report = oracle.compareFixture({
    name: 'turn push and late command',
    source: movementSource({
      rules: '[ > Player | Crate ] -> [ > Player | > Crate ]\nlate [ Player ] -> sfx0',
      sounds: 'Player move 100\nCrate cantmove 200\nsfx0 300',
    }),
    inputs: [3, 3, 'undo', 3, 'restart', 3], seed: 'turn-push-late',
  });
  assert.ok(report.turnPhases >= 4);
  assert.ok(report.rulePhases >= 8);
  assert.equal(report.snapshots, 7);
});

test('whole turns compare random tuples and directions with complete RNG state', () => {
  const report = oracle.compareFixture({
    name: 'turn random direction',
    source: movementSource({ rules: 'random [ Player ] -> [ randomdir Player ]', level: '..P..' }),
    inputs: ['tick', 'tick', 'tick', 'tick'], seed: 'turn-random',
  });
  assert.equal(report.turnPhases, 4);
  assert.ok(report.randomDraws >= 8);
});

test('rigid rollback preserves the discarded attempt message and advanced RNG', () => {
  let retried = false;
  const report = oracle.compareFixture({
    name: 'turn rigid message and RNG',
    source: movementSource({
      rules: 'rigid up [ Player ] -> [ > Player random Crate ] message discarded attempt\nlate [ Player ] -> sfx0',
      level: 'P..', sounds: 'Player move 100\nPlayer cantmove 200\nCrate create 300\nsfx0 400',
    }).replace('Player, Crate, Wall', 'Player, Wall\nCrate'),
    inputs: [3], seed: 'turn-rigid-random',
  }, {
    applyTurnRules: (...args) => {
      const result = applyTurnRules(...args);
      if (result.rigidRetries > 0) {
        assert.equal(result.state.commands.message, 'discarded attempt');
        assert.ok(result.state.commands.entries.every(({ command }) => command.kind !== CommandKind.Message));
        assert.equal(result.state.createdObjects.size, 0);
        retried = true;
      }
      return result;
    },
  });
  assert.ok(retried);
  assert.ok(report.rigidRetries > 0);
  assert.ok(report.randomDraws > 0);
});

test('aggregate players decode all-member matching across collision layers', () => {
  let observed = false;
  const source = movementSource({ rules: '', level: 'APC..' })
    .replace('Player\nwhite', 'Hero\nwhite')
    .replace('P = Player', 'P = Hero\nPlayer = Hero and Crate\nA = Player')
    .replace('Player, Crate, Wall', 'Hero, Wall\nCrate');
  const report = oracle.compareFixture({ name: 'turn aggregate player', source, inputs: [3, 1, 4, 0, 2], seed: 'turn-aggregate' }, {
    applyTurnRules: (game, before, input) => {
      assert.equal(game.player.kind, PlayerMatchKind.All);
      assert.equal(game.player.objects.size, 2);
      const result = applyTurnRules(game, before, input);
      assert.equal(result.playerPositions.length, 1);
      observed = true;
      return result;
    },
  });
  assert.ok(observed);
  assert.equal(report.turnPhases, 5);
});

test('level-start rules and recursive again probes use the selected whole-turn implementation', () => {
  let noInputTurns = 0;
  const report = oracle.compareFixture({
    name: 'turn level start and again',
    source: movementSource({
      metadata: 'run_rules_on_level_start',
      rules: 'right [ Player | no Wall ] -> [ > Player | ] again', level: 'P...#',
    }), inputs: ['restart'], seed: 'turn-again',
  }, {
    applyTurnRules: (...args) => {
      if (args[2] === null) noInputTurns++;
      return applyTurnRules(...args);
    },
  });
  assert.equal(noInputTurns, report.turnPhases);
  assert.ok(report.snapshots > 2, 'Again substeps retain their own snapshots');
  assert.ok(report.levelLoads >= 1);
});

test('whole-turn replay retains source corpus final-board and sound expectations', () => {
  const sourceFixture = oracle.corpusFixtures().find(({ name }) => name === 'rigid body test 2');
  assert.ok(sourceFixture);
  const report = oracle.compareFixture(sourceFixture);
  assert.ok(report.rigidRetries > 0);
  assert.ok(report.turnPhases > 0);
});

test('a candidate cannot return an unchanged board or mutate its incoming board', () => {
  assert.throws(() => oracle.compareFixture(fixture(), {
    applyTurnRules: (game, before, input) => ({ ...applyTurnRules(game, before, input), state: before }),
  }), /resulting turn state/);
  assert.throws(() => oracle.compareFixture(fixture(), {
    applyTurnRules: (game, before, input) => {
      const result = applyTurnRules(game, before, input);
      before.board.rows[0][0].objects.clear();
      return result;
    },
  }), /turn input mutated/);
});

for (const field of ['attempts', 'rigidRetries', 'rigidLimitReached']) {
  test(`whole-turn replay checks ${field}`, () => {
    assert.throws(() => oracle.compareFixture(fixture(), {
      applyTurnRules: (...args) => {
        const result = applyTurnRules(...args);
        return { ...result, [field]: field === 'rigidLimitReached' ? !result[field] : result[field] + 1 };
      },
    }), field === 'attempts' ? /turn attempts/ : field === 'rigidRetries' ? /rigid retries/ : /rigid attempt cap/);
  });
}

test('whole-turn replay rejects altered RNG permutations and noncanonical rule sources', () => {
  assert.throws(() => oracle.compareFixture(fixture(), {
    applyTurnRules: (...args) => {
      const result = applyTurnRules(...args);
      result.state.random.permutation.reverse();
      return result;
    },
  }), /resulting turn state/);
  assert.throws(() => oracle.compareFixture(fixture('late [ Player ] -> sfx0'), {
    applyTurnRules: (...args) => {
      const result = applyTurnRules(...args);
      result.state.commands.entries[0].source = { ...result.state.commands.entries[0].source };
      return result;
    },
  }), /declared source rule/);
});

test('the test-only source hook rejects absent, duplicate, and reversed anchors', () => {
  const start = '\tlet inputindex = dir;';
  const end = '\n\t// Post move stuff';
  const source = `function processInput(dir) {\n${start}\nlet playerPositions = []; let i = 1; let bannedGroup = [];${end}\n}`;
  const callbacks = { before() {}, after() {}, candidate() { return []; } };
  assert.throws(() => instrumentTurnInput(source.replace(start, ''), callbacks), /exactly one turn hook anchor/);
  assert.throws(() => instrumentTurnInput(source + end, callbacks), /exactly one turn hook anchor/);
  assert.throws(() => instrumentTurnInput(source.replace(start, '').replace(end, end + start), callbacks), /must be ordered/);
});

test('legacy input slots map to named TypeScript movements on a rectangular board', () => {
  const expected = [Movement.Up, Movement.Right, Movement.Down, Movement.Left, Movement.Action];
  const report = oracle.compareFixture({
    name: 'turn cardinal input mapping',
    source: movementSource({ rules: '', level: '....\n.P..\n....' }),
    inputs: [0, 3, 2, 1, 4], seed: 'turn-cardinals',
  }, {
    applyTurnRules: (game, before, input) => {
      assert.equal(input, expected.shift());
      return applyTurnRules(game, before, input);
    },
  });
  assert.equal(expected.length, 0);
  assert.equal(report.turnPhases, 5);
});

test('source player positions retain require_player_movement cancellation in the host', () => {
  const report = oracle.compareFixture({
    name: 'turn player movement requirement',
    source: movementSource({
      metadata: 'require_player_movement',
      rules: 'right [ Player | Crate ] -> [ Player | > Crate ]', level: 'PC..',
    }), inputs: [4, 3, 'undo', 'restart'], seed: 'turn-required-player',
  });
  assert.equal(report.snapshots, 5);
  assert.equal(report.turnPhases, 2);
});

test('whole-turn replay pairs transient messages for the again and message corpus fixture', () => {
  const sourceFixture = oracle.corpusFixtures().find(({ name }) => name === 'again + message combo');
  assert.ok(sourceFixture);
  const report = oracle.compareFixture(sourceFixture);
  assert.ok(report.turnPhases > 0);
  assert.ok(report.snapshots > 1);
});

const orphanFixture = {
  name: 'writable orphan input', source: movementSource({ rules: '[ Crate ] -> [ random Player ]', level: 'C.' })
    .replace('Background\nPlayer, Crate, Wall', 'Background\nBackground\nCrate, Wall'),
  inputs: ['tick', 3, 4, 'undo', 'restart', 'tick', 1], seed: 'orphan-turn',
};
test('whole turns preserve writable orphan player positions, current intent layers and physical immobility', () => {
  let orphanTurns = 0;
  const report = oracle.compareFixture(orphanFixture, { applyTurnRules: (game, before, input) => {
    const present = [...before.board.rows[0][0].objects].find(object => object.orphanedFrom !== undefined);
    if (present && input !== null) {
      orphanTurns++;
      assert.ok(game.collisionLayers.every(layer => !layer.includes(present)));
      assert.ok(game.collisionLayers[1].includes(present.orphanedFrom));
    }
    return applyTurnRules(game, before, input);
  } });
  assert.ok(orphanTurns >= 2);
  assert.equal(report.snapshots, 8);
});

test('a candidate that assigns orphan player intent to fallback layer zero is rejected', () => {
  assert.throws(() => oracle.compareFixture(orphanFixture, { applyTurnRules: (game, before, input) => {
    const layers = game.collisionLayers.map(layer => [...layer]);
    for (const object of game.player.objects) if (object.orphanedFrom !== undefined) {
      layers[1] = layers[1].filter(member => member !== object.orphanedFrom);
      layers[0].push(object.orphanedFrom);
    }
    return applyTurnRules({ ...game, collisionLayers: layers }, before, input);
  } }), /resulting turn state|source player positions/);
});

test('native turns leave the orphan in place while input moves its same-name current declaration', () => {
  const source = movementSource({ level: 'C.',
    rules: '[ Crate ] -> [ Player ]\nright [ Player | Background ] -> [ Player | ]' })
    .replace('Background\nPlayer, Crate, Wall', 'Background\nBackground\nCrate, Wall');
  let witnessed = false;
  oracle.compareFixture({ name: 'orphan remains while final object moves', source, inputs: ['tick', 3], seed: 'orphan-physical' }, {
    applyTurnRules: (game, before, input) => {
      const result = applyTurnRules(game, before, input);
      if (input === Movement.Right) {
        const orphan = [...game.player.objects][0];
        assert.ok(orphan.orphanedFrom);
        assert.deepEqual([...result.state.board.rows[0][0].objects], [orphan]);
        assert.deepEqual([...result.state.board.rows[0][1].objects], [orphan.orphanedFrom]);
        assert.deepEqual(result.playerPositions, [{ x: 0, y: 0 }]);
        witnessed = true;
      }
      return result;
    },
  });
  assert.equal(witnessed, true);
});
