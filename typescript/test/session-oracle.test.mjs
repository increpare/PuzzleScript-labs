import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { Direction, Movement } from '../build/model.js';
import { Ellipsis } from '../build/rule-model.js';
import { CommandKind } from '../build/commands.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { ObjectMatchKind, WinQuantifier } from '../build/win-conditions.js';
import * as sessionTypes from '../build/session-model.js';
import * as session from '../build/session.js';
import { compileSource, SourceCompilationKind, SourceCompilationStopReason } from '../build/source-compiler.js';
import * as sourceTypes from '../build/source-model.js';
import * as assets from '../build/source-assets.js';
import * as declarationModel from '../build/declaration-model.js';
import { ExecutionDiagnosticKind } from '../build/execution-model.js';
import { createSessionOracle } from './legacy-session-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const oracle = createSessionOracle({
  compileSource, SourceCompilationKind, SourceCompilationStopReason, ...sourceTypes, ...assets, ...declarationModel,
  ExecutionDiagnosticKind, Direction, Movement, Ellipsis, CommandKind, PlayerMatchKind,
  ObjectMatchKind, WinQuantifier, ...sessionTypes, ...session,
});

test('accepted conflicting random writes remain present after their source warnings', () => {
  const source = movementSource({ rules: 'right [ Player ] -> [ Player random Thing ]', level: 'P.' })
    .replace('# = Wall', '# = Wall\nThing = Crate or Wall');
  const compilation = compileSource(source);
  assert.equal(compilation.outcome.kind, SourceCompilationKind.Accepted);
  assert.equal(compilation.errorCount, 0);
  assert.ok(compilation.rawDiagnostics.some(issue => issue.message.includes('same layer')));
  const game = compilation.outcome.game;
  const environment = { nextLevelSeed() { throw new Error('Unexpected level change'); } };
  const initial = session.createSession(game, { seed: 'layer-conflict' }, environment).state;
  const moved = session.stepSession(game, initial, Movement.Action, environment).state;
  const occupants = [...moved.execution.board.rows[0][0].objects].map(object => object.name);
  assert.ok(occupants.includes('player'));
  assert.equal(occupants.filter(name => name === 'crate' || name === 'wall').length, 1);
  assert.equal(oracle.compareFixture({ name: 'diagnosed conflicting writes', source,
    inputs: [4, 'undo', 'restart', 4], seed: 'layer-conflict' }).snapshots, 5);
});

test('standalone sessions distinguish orphan creation, final-object destruction and skipped unlayered movement sounds', () => {
  const source = movementSource({ rules: '[ Crate ] -> [ random Player ]', level: 'C.',
    sounds: 'Player create 100\nBackground create 200\nBackground destroy 300\nPlayer destroy 400\nPlayer move 500\nPlayer cantmove 600\nBackground move 700\nBackground cantmove 800' })
    .replace('Background\nPlayer, Crate, Wall', 'Background\nBackground\nCrate, Wall');
  const effects = [];
  const report = oracle.compareFixture({ name: 'orphan session sounds', source,
    inputs: ['tick', 3, 'undo', 'restart', 'tick', 4], seed: 'orphan-sounds' }, {
    stepSession: (...args) => {
      const result = session.stepSession(...args);
      effects.push(...result.effects.filter(effect => effect.kind === sessionTypes.SessionEffectKind.Sound).map(effect => effect.seed));
      return result;
    },
  });
  assert.equal(report.snapshots, 7);
  assert.ok(effects.includes('100'));
  assert.ok(effects.includes('300'));
  for (const absent of ['200', '400', '500', '600', '700', '800']) assert.equal(effects.includes(absent), false);
});

test('the standalone session owns moves, undo and restart without JS producers', () => {
  const report = oracle.compareFixture({
    name: 'independent session input and history',
    source: movementSource({ rules: '', level: 'P...' }),
    inputs: [3, 3, 'undo', 'restart', 3], seed: 'session-history',
  });
  assert.equal(report.snapshots, 6);
  assert.ok(report.candidateOperations >= 6);
});

test('a standalone session that ignores input is rejected', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'broken independent session', source: movementSource({ rules: '', level: 'P..' }),
    inputs: [3], seed: 'broken-session',
  }, {
    stepSession: (_game, state) => ({ state, modified: false, effects: [] }),
  }), /session snapshot/);
});

test('checkpoints and restart targets are compared as complete boards', () => {
  const report = oracle.compareFixture({
    name: 'independent checkpoint',
    source: movementSource({
      rules: '[ Player Crate ] -> [ Player Crate ] checkpoint', level: 'PC.',
      sounds: 'restart 100\nundo 200',
    }).replace('Player, Crate, Wall', 'Player, Wall\nCrate'),
    inputs: [3, 3, 'restart', 'undo', 'restart'], seed: 'session-checkpoint',
  });
  assert.equal(report.snapshots, 6);
});

test('the oracle detects missing simple sound events as well as recorded sounds', () => {
  assert.throws(() => oracle.compareFixture({
    name: 'missing restart audio',
    source: movementSource({ rules: '', level: 'P..', sounds: 'restart 100' }),
    inputs: ['restart'], seed: 'simple-sound',
  }, {
    restartSession: (...args) => {
      const result = session.restartSession(...args);
      return { ...result, effects: result.effects.filter(effect =>
        effect.kind !== sessionTypes.SessionEffectKind.Sound) };
    },
  }), /session snapshot/);
});

for (const [name, options, inputs] of [
  ['level-start AGAIN and restart', {
    metadata: 'run_rules_on_level_start', level: 'P...#',
    rules: 'right [ Player | no Wall ] -> [ > Player | ] again',
  }, ['restart', 'undo', 3]],
  ['random quiet AGAIN probes', {
    level: 'P...',
    rules: 'right [ > Player ] -> [ > Player ] again message outer\nlate random [ Player ] -> message probe',
  }, [3, 'tick', 'undo', 'restart']],
  ['cancel output commands', {
    level: 'P..', rules: '[ Player ] -> cancel sfx0 message cancelled',
    sounds: 'cancel 700\nsfx0 100\nundo 300\nrestart 200',
  }, [3, 'tick', 'undo', 'restart']],
  ['quiet probe checkpoint', {
    level: 'P..', rules: 'right [ > Player ] -> [ > Player ] again\nlate [ Player ] -> checkpoint',
  }, [3, 'tick', 'undo', 'restart']],
  ['required player movement rollback', {
    metadata: 'require_player_movement', level: 'PC..',
    rules: 'right [ Player | Crate ] -> [ Player | > Crate ]',
  }, [3, 'undo', 'restart']],
]) {
  test('standalone session parity: ' + name, () => {
    const report = oracle.compareFixture({ name, source: movementSource(options), inputs, seed: name });
    assert.ok(report.snapshots >= inputs.length + 1);
  });
}

test('wins load fresh seeded levels and finish at the title screen', () => {
  const source = movementSource({ rules: '', level: 'PC.\n\nP.C\n\nP.C',
    sounds: 'startlevel 100\nendlevel 200\nendgame 300' })
    .replace('Player, Crate, Wall', 'Player, Wall\nCrate')
    .replace('winconditions\n\nlevels', 'winconditions\nsome Player on Crate\n\nlevels');
  const report = oracle.compareFixture({ name: 'standalone win transitions', source,
    inputs: [3, 3, 3, 3, 3], seed: 'win-transitions' });
  assert.equal(report.levelLoads, 3);
});

test('actual multiword late movements survive same-size undo and restart exactly', () => {
  const source = movementSource({ level: 'P.D', rules: 'late [ Dust ] -> [ randomdir Dust ]' })
    .replace('legend\n', 'Dust\nyellow\n\nA\nred\n\nB\nred\n\nE\nred\n\nF\nred\n\nG\nred\n\nlegend\n')
    .replace('# = Wall', '# = Wall\nD = Dust')
    .replace('Background\nPlayer, Crate, Wall\n\nrules', 'Background\nPlayer, Crate, Wall\nA\nB\nE\nF\nG\nDust\n\nrules');
  const report = oracle.compareFixture({ name: 'multiword restore requests', source,
    inputs: [3, 'undo', 'restart', 0, 'undo'], seed: 'late-restore' });
  assert.equal(report.snapshots, 6);
});

test('candidate execution cannot call a JS producer', () => {
  assert.throws(() => oracle.compareFixture({ name: 'JS producer guard',
    source: movementSource({ rules: '', level: 'P..' }), inputs: [3], seed: 'guard',
  }, { stepSession: () => globalThis.processInput(3) }), /TS session called JS producer processInput/);
});

test('candidate execution cannot use a compiled JS movement producer', () => {
  assert.throws(() => oracle.compareFixture({ name: 'compiled producer guard',
    source: movementSource({ rules: '', level: 'P..' }), inputs: [3], seed: 'compiled-guard',
  }, { stepSession: (...args) => {
    runInThisContext('state.resolveMovements(level, [])');
    return session.stepSession(...args);
  } }), /TS session called JS producer state.resolveMovements/);
});

for (const expression of [
  'RandomGen._state.next()',
  'state.rules[0][0].cellRowMatches[0](state.rules[0][0].patterns[0], 0, level.height, level.objects, level.movements)',
]) {
  test('candidate execution rejects nested JS producers: ' + expression, () => {
    assert.throws(() => oracle.compareFixture({ name: 'nested producer guard',
      source: movementSource({ rules: '[ Player ] -> [ Player ]', level: 'P..' }),
      inputs: [3], seed: 'nested-guard',
    }, { stepSession: (...args) => {
      runInThisContext(expression);
      return session.stepSession(...args);
    } }), /TS session called JS producer/);
  });
}

test('the complete history is compared even when the current board is correct', () => {
  assert.throws(() => oracle.compareFixture({ name: 'bad history',
    source: movementSource({ rules: '', level: 'P..' }), inputs: [3], seed: 'history',
  }, { stepSession: (...args) => {
    const result = session.stepSession(...args);
    return { ...result, state: { ...result.state, history: [] } };
  } }), /session snapshot/);
});

test('immutable compiled data checks preserve the explicit ellipsis symbol', () => {
  const report = oracle.compareFixture({ name: 'session ellipsis',
    source: movementSource({ rules: 'right [ Player | ... | Crate ] -> sfx0', level: 'P.C', sounds: 'sfx0 100' }),
    inputs: [0], seed: 'ellipsis',
  });
  assert.equal(report.snapshots, 2);
});

test('quiet-probe persistence writes are compared even when saved values agree', () => {
  assert.throws(() => oracle.compareFixture({ name: 'missing duplicate checkpoint write',
    source: movementSource({ level: 'P..',
      rules: 'right [ > Player ] -> [ > Player ] again\nlate [ Player ] -> checkpoint' }),
    inputs: [3], seed: 'checkpoint-writes',
  }, { stepSession: (...args) => {
    const result = session.stepSession(...args);
    const checkpoints = result.effects.filter(effect => effect.kind === sessionTypes.SessionEffectKind.Persistence
      && effect.operation === sessionTypes.PersistenceKind.Checkpoint);
    assert.equal(checkpoints.length, 2);
    return { ...result, effects: result.effects.filter(effect => effect !== checkpoints[0]) };
  } }), /session snapshot/);
});

test('sound and persistence effects retain their order relative to one another', () => {
  const source = movementSource({ rules: '', level: 'PC.\n\nP..', sounds: 'endlevel 100\nstartlevel 200' })
    .replace('Player, Crate, Wall', 'Player, Wall\nCrate')
    .replace('winconditions\n\nlevels', 'winconditions\nsome Player on Crate\n\nlevels');
  assert.throws(() => oracle.compareFixture({ name: 'reordered sound and save', source,
    inputs: [3], seed: 'effect-order',
  }, { stepSession: (...args) => {
    const result = session.stepSession(...args);
    const saves = effect => effect.kind === sessionTypes.SessionEffectKind.Persistence;
    return { ...result, effects: [...result.effects.filter(saves), ...result.effects.filter(effect => !saves(effect))] };
  } }), /session snapshot/);
});

test('recorded random and AGAIN/message fixtures use the standalone session', () => {
  const fixtures = oracle.corpusFixtures().filter(({ name }) =>
    name.toLowerCase().includes('random') || name === 'again + message combo');
  assert.ok(fixtures.length >= 4);
  for (const fixture of fixtures) oracle.compareFixture(fixture);
});
