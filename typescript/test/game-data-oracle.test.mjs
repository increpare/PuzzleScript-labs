import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compileGameData } from '../build/source-game-data.js';
import { Movement } from '../build/model.js';
import { LevelKind, SimpleSound } from '../build/session-model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { ObjectMatchKind, WinQuantifier, hasWon } from '../build/win-conditions.js';
import { createSession, stepSession, undoSession, restartSession } from '../build/session.js';
import { createGameDataOracle } from './legacy-game-data-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const oracle = createGameDataOracle({ readSource, resolveDeclarations, compileGameData,
  Movement, LevelKind, SimpleSound, PlayerMatchKind, ObjectMatchKind, WinQuantifier, hasWon });
const fixture = { name: 'source game data oracle', source: movementSource() };
const retainedSource = movementSource({ level: 'P.D', rules: 'late [ Dust ] -> [ randomdir Dust ]' })
  .replace('legend\n', 'Dust\nyellow\n\nA\nred\n\nB\nred\n\nE\nred\n\nF\nred\n\nG\nred\n\nlegend\n')
  .replace('# = Wall', '# = Wall\nD = Dust')
  .replace('Background\nPlayer, Crate, Wall\n\nrules', 'Background\nPlayer, Crate, Wall\nA\nB\nE\nF\nG\nDust\n\nrules');

test('independent source compilation agrees on basic game data', () => {
  const report = oracle.compareFixture(fixture);
  assert.equal(report.levels, 1);
});

test('discarding a compiled level is rejected', () => {
  assert.throws(() => oracle.compareFixture(fixture, { compileGameData: (document, declarations) => {
    const result = compileGameData(document, declarations);
    return { ...result, data: { ...result.data, levels: [] } };
  } }), /compiled game data/);
});

test('game data compilation cannot mutate declaration input after computing its result', () => {
  assert.throws(() => oracle.compareFixture(fixture, { compileGameData: (document, declarations) => {
    const result = compileGameData(document, declarations);
    declarations.names.clear();
    return result;
  } }), /mutated declaration input/);
});

test('lookalike objects in compiled boards fail canonical identity checks', () => {
  assert.throws(() => oracle.compareFixture(fixture, { compileGameData: (document, declarations) => {
    const result = compileGameData(document, declarations);
    const levels = result.data.levels.map(level => level.kind === LevelKind.Message ? level : ({ ...level,
      board: { ...level.board, rows: level.board.rows.map(row => row.map(cell =>
        ({ objects: new Set([...cell.objects].map(object => ({ ...object }))) }))) },
    }));
    return { ...result, data: { ...result.data, levels } };
  } }), /canonical object identity/);
});

test('native compiler producers cannot supply candidate game data', () => {
  assert.throws(() => oracle.compareFixture(fixture, { compileGameData: (document, declarations) => {
    globalThis.levelsToArray({});
    return compileGameData(document, declarations);
  } }), /TS game data called JS producer levelsToArray/);
});

test('candidate declaration resolution cannot use the native lexical parser', () => {
  assert.throws(() => oracle.compareFixture(fixture, { resolveDeclarations: document => {
    runInThisContext('new codeMirrorFn().startState()');
    return resolveDeclarations(document);
  } }), /TS game data called JS producer codeMirrorFn/);
});

test('metadata, sounds and win predicates preserve their native meanings', () => {
  const source = movementSource({ metadata: 'flickscreen 2x3\nzoomscreen 4x2\nnoundo\nrequire_player_movement',
    sounds: 'startlevel 00123\nsfx0 456\nPlayer move right 567\nPlayer action 678\nMovable cantmove horizontal 789\nMovable create 890\nCrate destroy 901' })
    .replace('C = Crate', 'C = Crate\nMovable = Player or Crate')
    .replace('winconditions\n', 'winconditions\nsome Crate on Player\n');
  oracle.compareFixture({ name: 'rich source game data', source });
});

test('sound targets declared only in a later section remain parser-rejected', () => {
  oracle.compareFixture({ name: 'later sound target', source: movementSource({ sounds: 'Later move 123' })
    .replace('collisionlayers\n', 'legend\nLater = Player\ncollisionlayers\n') });
});

test('punctuation glyph aliases remain invalid sound targets', () => {
  for (const sounds of ['. create 123', '# move 123']) {
    oracle.compareFixture({ name: 'punctuation sound target: ' + sounds, source: movementSource({ sounds }) });
  }
});

test('native ASCII event boundaries take precedence over Unicode sound target aliases', () => {
  for (const name of ['undoé', 'sfx10é', 'startlevelΣ', 'undoA', 'undo_']) {
    oracle.compareFixture({ name: 'sound event boundary: ' + name,
      source: movementSource({ sounds: name + ' move 123' }).replace('C = Crate', 'C = Crate\n' + name + ' = Player') });
  }
});

test('changing a compiled sound seed is rejected', () => {
  const item = { name: 'sound seed corruption', source: movementSource({ sounds: 'Player move 123' }) };
  assert.throws(() => oracle.compareFixture(item, { compileGameData: (document, declarations) => {
    const result = compileGameData(document, declarations);
    return { ...result, data: { ...result.data, movementSounds: result.data.movementSounds.map(layer =>
      layer.map(sound => ({ ...sound, seed: 'wrong' }))) } };
  } }), /compiled game data/);
});

test('eight-layer source restore data agrees with native movement storage behaviour', () => {
  oracle.compareFixture({ name: 'source restore policy', source: retainedSource });
});

test('source-compiled restore policies drive typed undo and restart', () => {
  const { document } = readSource(retainedSource);
  const { declarations } = resolveDeclarations(document);
  const { data } = compileGameData(document, declarations);
  const schedule = { groups: [], loops: new Map() };
  const game = { ...data, earlyRules: schedule, lateRules: schedule, rigid: false, rigidMerges: new Map() };
  const environment = { nextLevelSeed: () => 'source-restore' };
  const initial = createSession(game, { seed: 'source-restore' }, environment).state;
  const moved = stepSession(game, initial, Movement.Right, environment).state;
  const dust = declarations.names.get('dust').object;
  const pending = { position: { x: 2, y: 0 }, layer: declarations.objectLayers.get(dust), movements: new Set([Movement.Right]) };
  const beforeRestore = { ...moved, execution: { ...moved.execution, pendingMovements: [pending] } };
  for (const restored of [undoSession(game, beforeRestore).state, restartSession(game, beforeRestore, environment).state]) {
    assert.deepEqual(restored.execution.pendingMovements, [pending]);
    assert.deepEqual([...restored.execution.board.rows[0][0].objects].map(object => object.name).sort(), ['background', 'player']);
  }
});

test('all simulation sources compile matching independent game data', () => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  for (const item of fixtures) oracle.compareFixture(item);
});

test('unlayered map objects keep empty glyphs so background filling completes', () => {
  oracle.compareFixture({ name: 'unlayered wall on map',
    source: movementSource({ level: 'P#.' }).replace('Player, Crate, Wall', 'Player, Crate') });
});

test('homepage metadata agrees with final native compiler normalization', () => {
  for (const value of ['https://example.com/MyGame', 'prefixhttp://ahttps://bhttp://c']) {
    oracle.compareFixture({ name: 'homepage ' + value, source: movementSource({ metadata: 'homepage ' + value }) });
  }
});

test('an aggregate keeps its writable orphan after the first assignment is superseded', () => {
  oracle.compareFixture({ name: 'orphan aggregate requirement',
    source: movementSource({ level: 'C', rules: '' }).replace('C = Crate', 'C = Crate\nPair = Wall and Crate')
      .replace('Player, Crate, Wall', 'Player, Crate\nBackground')
      .replace('winconditions\n', 'winconditions\nsome Pair on Crate\n') });
});

test('the independent game-data oracle rejects replacing orphan aggregates or players with Never', () => {
  const source = movementSource({ rules: '', level: 'C' }).replaceAll('Player', 'Avatar')
    .replace('C = Crate', 'C = Crate\nPlayer = Wall and Crate\nPair = Wall and Crate')
    .replace('Avatar, Crate, Wall', 'Avatar, Crate\nBackground')
    .replace('winconditions\n', 'winconditions\nsome Pair on Crate\n');
  for (const player of [false, true]) assert.throws(() => oracle.compareFixture({ name: 'lost orphan match kind', source }, {
    compileGameData: (document, declarations) => {
      const result = compileGameData(document, declarations);
      return { ...result, data: { ...result.data, ...(player
        ? { player: { ...result.data.player, kind: PlayerMatchKind.Never } }
        : { winConditions: result.data.winConditions.map(condition => ({ ...condition,
          subject: { ...condition.subject, kind: ObjectMatchKind.Never } })) }) } };
    },
  }), /compiled game data/);
});

test('zero raw object assignments preserve empty All aggregates', () => {
  oracle.compareFixture({ name: 'zero assignment aggregate',
    source: movementSource({ level: 'C', rules: '' }).replace('C = Crate', 'C = Crate\nPair = Wall and Crate')
      .replace('Background\nPlayer, Crate, Wall', 'Unknown')
      .replace('winconditions\n', 'winconditions\nsome Pair on Pair\n') });
});

test('native homepage formatting cannot supply candidate metadata', () => {
  assert.throws(() => oracle.compareFixture(fixture, { compileGameData: (document, declarations) => {
    globalThis.formatHomePage({});
    return compileGameData(document, declarations);
  } }), /TS game data called JS producer formatHomePage/);
});

test('recognized legend prefixes still compile their map glyphs', () => {
  for (const expression of ['Player!', 'Player #', 'Player=', 'Player! or Crate', 'Player and Crate!']) {
    oracle.compareFixture({ name: 'legend prefix map ' + expression,
      source: movementSource({ level: 'X.' }).replace('C = Crate', 'C = Crate\nX = ' + expression)
        .replace('Player, Crate, Wall', 'Player\nCrate\nWall') });
  }
});
