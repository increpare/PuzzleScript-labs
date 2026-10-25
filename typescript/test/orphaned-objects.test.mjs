import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { loadPuzzleScript } from './native-host.cjs';
import { movementSource } from './scenarios.mjs';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compileGameData } from '../build/source-game-data.js';
import { PlayerMatchKind, startPlayerMovement } from '../build/turn-rules.js';
import { Direction, Movement, getObjectIntentLayer } from '../build/model.js';
import { hasWon, ObjectMatchKind } from '../build/win-conditions.js';
import { applyCellEdits } from '../build/replacement.js';
import { createRandom } from '../build/random.js';
import { resolveMovements } from '../build/movement.js';
import { createSession, stepSession } from '../build/session.js';
import { SessionEffectKind } from '../build/session-model.js';

loadPuzzleScript();
const orphanSource = (options = {}) => movementSource({ rules: '[ Crate ] -> [ random Player ]', level: 'C', ...options })
  .replace('Background\nPlayer, Crate, Wall', 'Background\nBackground\nCrate, Wall');
function native(source, input = -1, seed = 'orphan-check') {
  globalThis.__orphanSource = source;
  globalThis.__orphanSeed = seed;
  try {
    return runInThisContext(`(() => {
      unitTesting = true;
      level = new Level(0, 0, 0, 0, new Int32Array(0));
      backups = []; restartTarget = undefined; oldflickscreendat = [];
      messagetext = ''; soundHistory = [];
      compile(['loadLevel', 0], __orphanSource, __orphanSeed);
      const before = [...level.objects];
      const savedWin = DoWin;
      let won = false;
      try { DoWin = () => { won = true; }; processInput(${input}); }
      finally { DoWin = savedWin; }
      return ({ before, after: [...level.objects], playerPositions: getPlayerPositions(), won,
        ids: {...state.objects}, idNames: [...state.idDict], errors: errorCount,
        layers: getLayersOfMask(level.getCell(0)), game: state,
        created: [...sfxCreateMask.data], destroyed: [...sfxDestroyMask.data], sounds: [...soundHistory],
        cells: Array.from({ length: level.n_tiles }, (_, tile) => state.idDict.flatMap((name, id) =>
          level.getCell(tile).get(id) ? [{ name, orphaned: state.objects[name].id !== id }] : [])),
        random: { i: RandomGen._state.i, j: RandomGen._state.j, permutation: [...RandomGen._state.s] } });
    })()`);
  } finally { delete globalThis.__orphanSource; delete globalThis.__orphanSeed; }
}
function edits(overrides = {}) {
  return { removeObjects: new Set(), addObjects: new Set(), vacateLayers: new Set(),
    removeMovements: [], addMovements: [], resetMovementLayers: new Set(),
    randomObjects: [], randomDirectionLayers: new Set(), ...overrides };
}
const describe = objects => [...objects].map(object => ({ name: object.name, orphaned: object.orphanedFrom !== undefined }))
  .sort((a, b) => a.name.localeCompare(b.name) || Number(b.orphaned) - Number(a.orphaned));
function compileSource(source) {
  const { document } = readSource(source);
  const before = structuredClone(document);
  function freeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  freeze(document);
  const { declarations } = resolveDeclarations(document);
  const { data } = compileGameData(document, declarations);
  assert.deepEqual(document, before);
  return { document, declarations, data };
}

test('native random creation writes the overwritten first assignment and it counts as player', () => {
  const source = orphanSource();
  const observed = native(source);
  assert.deepEqual(observed.before, [6]);
  assert.deepEqual(observed.after, [1]);
  assert.deepEqual(observed.idNames, ['background', 'background', 'crate', 'wall']);
  assert.equal(observed.ids.background.id, 1);
  assert.equal(observed.ids.crate.id, 2);
  assert.equal(observed.errors, 1);
  assert.deepEqual(observed.playerPositions, [0]);
  assert.deepEqual(observed.layers, [1]);
  const { declarations } = compileSource(source);
  const orphan = [...declarations.namedObjects.get('player')][0];
  assert.ok(orphan, 'the writable orphan must survive the named player lookup');
  assert.equal(orphan.name, 'background');
  assert.equal(orphan.orphanedFrom, declarations.objects.find(object => object.name === 'background'));
  assert.notEqual(orphan, orphan.orphanedFrom);
  assert.equal(declarations.orphanedObject, orphan);
  assert.equal(declarations.objectChoiceOrder[0], orphan);
  assert.ok(Object.isFrozen(orphan));
  assert.equal(declarations.objectLayers.has(orphan), false);
  assert.ok(declarations.collisionLayers.every(layer => !layer.includes(orphan)));
  assert.ok([...declarations.glyphs.values()].every(objects => !objects.has(orphan)));
});

test('native aggregate player and win predicates become satisfiable after the orphan is written', () => {
  const source = orphanSource().replaceAll('Player', 'Avatar')
    .replace('C = Crate', 'C = Crate\nPlayer = Avatar and Avatar\nPair = Avatar and Avatar')
    .replace('winconditions\n', 'winconditions\nsome Pair\n');
  const observed = native(source);
  assert.deepEqual(observed.after, [1]);
  assert.deepEqual(observed.playerPositions, [0]);
  assert.equal(observed.won, true);
  const { declarations, data } = compileSource(source);
  const orphan = [...declarations.namedObjects.get('avatar')][0];
  assert.ok(orphan, 'aggregate members retain the writable orphan');
  assert.equal(declarations.player.kind, PlayerMatchKind.All);
  assert.deepEqual([...declarations.player.objects], [orphan]);
  assert.equal(data.winConditions[0].subject.kind, ObjectMatchKind.All);
  assert.deepEqual([...data.winConditions[0].subject.objects], [orphan]);
  const board = { width: 1, height: 1, rows: [[{ objects: new Set([orphan]) }]] };
  assert.equal(hasWon(board, data.winConditions), true);
  assert.equal(hasWon(data.levels[0].board, data.winConditions), false);
  const before = { board, pendingMovements: [], rigidMarks: [], bannedGroups: new Set(),
    canMoveSounds: [], cantMoveSounds: [], random: createRandom('orphan-check'),
    commands: { entries: [], message: '' }, createdObjects: new Set(), destroyedObjects: new Set() };
  const started = startPlayerMovement(data, before, Movement.Right);
  assert.deepEqual(started.playerPositions, [{ x: 0, y: 0 }]);
  assert.deepEqual(started.state.pendingMovements, [{ position: { x: 0, y: 0 }, layer: 1, movements: new Set([Movement.Right]) }]);
});

test('concrete RHS recovery clears fallback layer zero while random recovery clears the current declaration layer', () => {
  for (const random of [false, true]) {
    const source = orphanSource({ rules: `[ Crate ] -> [ ${random ? 'random ' : ''}Player ]` });
    const observed = native(source);
    assert.deepEqual(observed.after, [random ? 1 : 3]);
    const { declarations, data } = compileSource(source);
    const orphan = declarations.orphanedObject;
    const crate = declarations.objects.find(object => object.name === 'crate');
    const write = applyCellEdits(data.collisionLayers, edits({ removeObjects: new Set([crate]),
      ...(random ? { randomObjects: [{ object: orphan, layer: getObjectIntentLayer(data.collisionLayers, orphan) }] }
        : { addObjects: new Set([orphan]), vacateLayers: new Set([0]) }) }),
    { objects: data.levels[0].board.rows[0][0].objects, movements: [] }, createRandom('orphan-check'));
    assert.deepEqual(describe(write.cell.objects), observed.cells[0]);
    const { seed: _seed, ...randomState } = write.random;
    assert.deepEqual(randomState, observed.random);
  }
});

test('random properties choose the orphan before ordinary candidates and preserve native RNG draws', () => {
  const choices = new Set();
  for (const seed of ['orphan-check', 'orphan-1', 'orphan-2', 'orphan-3', 'orphan-4']) {
    const source = orphanSource({ rules: '[ Crate ] -> [ random Choice ]' })
      .replace('C = Crate', 'C = Crate\nChoice = Wall or Player or Wall');
    const observed = native(source, -1, seed);
    const { declarations, data } = compileSource(source);
    const candidates = declarations.objectChoiceOrder.filter(object => declarations.namedObjects.get('choice').has(object));
    assert.deepEqual(candidates.map(object => object.name), ['background', 'wall']);
    assert.equal(candidates[0], declarations.orphanedObject);
    const crate = declarations.objects.find(object => object.name === 'crate');
    const write = applyCellEdits(data.collisionLayers, edits({ removeObjects: new Set([crate]),
      randomObjects: candidates.map(object => ({ object, layer: getObjectIntentLayer(data.collisionLayers, object) })) }),
    { objects: data.levels[0].board.rows[0][0].objects, movements: [] }, createRandom(seed));
    assert.deepEqual(describe(write.cell.objects), observed.cells[0]);
    choices.add(write.cell.objects.has(declarations.orphanedObject) ? 'orphan' : 'ordinary');
    const { seed: _seed, ...randomState } = write.random;
    assert.deepEqual(randomState, observed.random);
  }
  assert.deepEqual(choices, new Set(['ordinary', 'orphan']));
});

test('intent lookup follows explicit source identity without a same-name or orphan-chain search', () => {
  const declaration = Object.freeze({ name: 'Same' });
  const other = Object.freeze({ name: 'Same' });
  const orphan = Object.freeze({ name: 'Same', orphanedFrom: declaration });
  assert.equal(getObjectIntentLayer([[], [other], [declaration]], orphan), 2);
  assert.equal(getObjectIntentLayer([[other]], orphan), undefined);
  assert.equal(getObjectIntentLayer([[declaration]], Object.freeze({ name: 'Same' })), undefined);
  assert.equal(getObjectIntentLayer([[declaration]], Object.freeze({ name: 'Same', orphanedFrom: orphan })), undefined);
});

test('the orphan stays put while its player intent moves a current layer occupant', () => {
  const source = orphanSource({ rules: '[ Crate ] -> [ Player ]', level: 'C.' });
  const { declarations, data } = compileSource(source);
  const orphan = declarations.orphanedObject;
  const background = orphan.orphanedFrom;
  const board = { width: 2, height: 1, rows: [[{ objects: new Set([orphan, background]) }, { objects: new Set() }]] };
  const before = { board, pendingMovements: [], rigidMarks: [], bannedGroups: new Set(),
    canMoveSounds: [], cantMoveSounds: [], random: createRandom('orphan-check'),
    commands: { entries: [], message: '' }, createdObjects: new Set(), destroyedObjects: new Set() };
  const started = startPlayerMovement(data, before, Movement.Right);
  const moved = resolveMovements({ ...data, rigid: false }, started.state);
  assert.deepEqual([...moved.board.rows[0][0].objects], [orphan]);
  assert.deepEqual([...moved.board.rows[0][1].objects], [background]);
  assert.deepEqual([...before.board.rows[0][0].objects], [orphan, background]);
});

test('creation and destruction sounds distinguish the orphan from its same-name final declaration', () => {
  const source = orphanSource({ sounds: 'Player create 100\nBackground create 200\nBackground destroy 300\nPlayer destroy 400\nPlayer move 500\nPlayer cantmove 600' });
  const observed = native(source);
  assert.deepEqual(observed.sounds.map(String), ['100', '300']);
  const { declarations, data } = compileSource(source);
  const orphan = declarations.orphanedObject;
  assert.deepEqual([...data.sounds.creation[0].objects], [orphan]);
  assert.deepEqual([...data.sounds.creation[1].objects], [orphan.orphanedFrom]);
  assert.deepEqual([...data.sounds.destruction[0].objects], [orphan.orphanedFrom]);
  assert.deepEqual([...data.sounds.destruction[1].objects], [orphan]);
  assert.deepEqual(data.movementSounds.flat(), []);
  assert.deepEqual(data.failureSounds, []);
  const crate = declarations.objects.find(object => object.name === 'crate');
  const pattern = { requiredObjects: new Set([crate]), forbiddenObjects: new Set(), anyObjects: [],
    requiredMovements: [], forbiddenMovements: [] };
  // Independent domain literal for this known source rule; source lowering is a
  // separate stage. Native rule masks and compiled records are never consulted.
  const rule = { direction: Direction.InPlace, rows: [[pattern]], sourceLine: 0, hasReplacements: true,
    replacements: [[{ edits: edits({ removeObjects: new Set([crate]),
      randomObjects: [{ object: orphan, layer: 1 }] }), rigidLayers: new Set() }]], commands: [], rigidGroup: null };
  const game = { ...data, rigid: false, rigidMerges: new Map(),
    earlyRules: { groups: [{ rules: [rule], random: false }], loops: new Map() },
    lateRules: { groups: [], loops: new Map() } };
  const environment = { nextLevelSeed: () => 'orphan-check' };
  const initial = createSession(game, { seed: 'orphan-check' }, environment).state;
  const result = stepSession(game, initial, null, environment);
  assert.deepEqual(describe(result.state.execution.board.rows[0][0].objects), observed.cells[0]);
  assert.deepEqual(result.effects.filter(effect => effect.kind === SessionEffectKind.Sound).map(effect => effect.seed), ['100', '300']);
  assert.deepEqual([...initial.execution.board.rows[0][0].objects], [...data.levels[0].board.rows[0][0].objects]);
});

test('aggregate predicates require both same-name identities when the source names orphan and final declaration', () => {
  for (const random of [false, true]) {
    const source = orphanSource({ rules: `[ Crate ] -> [ ${random ? 'random ' : ''}Player ]` }).replaceAll('Player', 'Avatar')
      .replace('C = Crate', 'C = Crate\nPlayer = Avatar and Background\nPair = Avatar and Background')
      .replace('winconditions\n', 'winconditions\nsome Pair\n');
    const observed = native(source);
    assert.equal(observed.won, !random);
    assert.deepEqual(observed.playerPositions, random ? [] : [0]);
    const { declarations, data } = compileSource(source);
    const orphan = declarations.orphanedObject;
    assert.deepEqual([...declarations.player.objects], [orphan, orphan.orphanedFrom]);
    assert.deepEqual([...data.winConditions[0].subject.objects], [orphan, orphan.orphanedFrom]);
    const board = { width: 1, height: 1, rows: [[{ objects: new Set(random ? [orphan] : [orphan, orphan.orphanedFrom]) }]] };
    assert.equal(hasWon(board, data.winConditions), !random);
  }
});
