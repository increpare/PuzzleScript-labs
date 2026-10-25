import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { Direction, Movement } from '../build/model.js';
import { Ellipsis } from '../build/rule-model.js';
import { findMatches, matchesRow } from '../build/matching.js';
import { applyRuleAt } from '../build/rules.js';
import { CommandKind } from '../build/commands.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { LevelKind, SimpleSound } from '../build/session-model.js';
import { ObjectMatchKind, WinQuantifier } from '../build/win-conditions.js';
import { loadPuzzleScript } from './native-host.cjs';
import { decodeMatches, decodeRulePattern, encodeMatches } from './legacy-patterns.cjs';
import { decodeSessionGame } from './legacy-session-data.cjs';
import { movementSource } from './scenarios.mjs';

const messages = [];
loadPuzzleScript({ messageSink: messages });

function nativeFixture(rules = 'moving [ Player | Crate ] -> sfx0') {
  messages.length = 0;
  resetParserErrorState();
  const source = movementSource({ rules, sounds: 'sfx0 123', level: 'XX\nXX' })
    .replace('C = Crate', 'C = Crate\nX = Player and Crate')
    .replace('Player, Crate, Wall', 'Player\nCrate\nWall');
  compile(['loadLevel', 0], source + '\n', 'zero-step');
  state.calculateRowColMasks(level);
  const objects = state.idDict.map(name => Object.freeze({ name }));
  const context = { Direction, Movement, Ellipsis, legacyEllipsis: ellipsisPattern,
    objects, layerCount: state.collisionLayers.length };
  const before = {
    board: {
      width: level.width, height: level.height,
      rows: Array.from({ length: level.height }, (_, y) =>
        Array.from({ length: level.width }, (_, x) => ({
          objects: new Set(objects.filter((_object, id) => level.getCell(x * level.height + y).get(id))),
        }))),
    },
    pendingMovements: [],
  };
  return { rules: state.rules.flat(), context, before };
}

function expectedNativeDiagnostic(t, action, count = 1) {
  const errors = [];
  const original = console.error;
  let result;
  try {
    console.error = message => errors.push(String(message));
    result = action();
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, Array(count).fill('Unexpected direction: 16'));
  t.diagnostic('EXPECTED native recovery diagnostic: Unexpected direction: 16 (' + count + ' occurrence(s))');
  return result;
}

async function boundedMatches(rule, before) {
  const worker = new Worker(new URL('./support/bounded-matches.mjs', import.meta.url), {
    workerData: { rule: { ...rule, rows: rule.rows.map(row => row.map(cell => cell === Ellipsis ? null : cell)) }, before },
  });
  let deadline;
  try {
    return await new Promise((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Zero-step ellipsis search did not finish')), 1000);
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => { if (code !== 0) reject(new Error('Search worker exited: ' + code)); });
    });
  } finally {
    clearTimeout(deadline);
    await worker.terminate();
  }
}

function nativeRowMatches(rule, candidate) {
  const tile = candidate.start.x * level.height + candidate.start.y;
  const [first, second] = candidate.gaps;
  const args = first === undefined ? [] : second === undefined ? [first + 1, first]
    : [first + second + 1, first + second, first + 1, first, second + 1, second];
  const result = rule.cellRowMatches[0](rule.patterns[0], tile, ...args,
    level.delta_index(rule.direction), level.objects, level.movements);
  return first === undefined ? Boolean(result) : result.length > 0;
}

function nativeExecutionFrame(decoded) {
  return decoded.frame({ level, random: RandomGen, canMoveSounds: seedsToPlay_CanMove,
    cantMoveSounds: seedsToPlay_CantMove, message: messagetext, created: sfxCreateMask, destroyed: sfxDestroyMask });
}

test('native recovery retains Action as a zero-step rule orientation', t => {
  const fixture = nativeFixture();
  assert.ok(messages.some(message => message.includes('Name "moving", referred to in a rule, does not exist.')));
  assert.deepEqual(fixture.rules.map(rule => rule.direction), [2, 2, 8, 8, 16]);
  const native = fixture.rules[4];
  assert.equal(level.delta_index(native.direction), 0);
  assert.deepEqual(native.patterns[0].map(cell =>
    fixture.context.objects.filter((_object, id) => cell.objectsPresent.get(id)).map(object => object.name)),
  [['player'], ['crate']]);
  const matches = expectedNativeDiagnostic(t, () => native.findMatches(level));
  assert.deepEqual(decodeMatches(matches, level.height), [[
    { start: { x: 0, y: 0 }, gaps: [] }, { start: { x: 1, y: 0 }, gaps: [] },
    { start: { x: 0, y: 1 }, gaps: [] }, { start: { x: 1, y: 1 }, gaps: [] },
  ]]);
});

test('decoded zero-step rows test every pattern cell at each row-major origin', t => {
  const fixture = nativeFixture();
  const native = fixture.rules[4];
  const pattern = decodeRulePattern(native, fixture.context);
  assert.ok(Object.hasOwn(Direction, 'InPlace'));
  assert.equal(pattern.direction, Direction.InPlace);
  const expected = decodeMatches(expectedNativeDiagnostic(t, () => native.findMatches(level)), level.height);
  assert.deepEqual(findMatches(pattern, fixture.before), expected);
  for (const candidate of expected[0]) assert.equal(matchesRow(pattern, 0, fixture.before, candidate), true);
  const crate = fixture.context.objects.find(object => object.name === 'crate');
  fixture.before.board.rows[0][1].objects.delete(crate);
  assert.equal(matchesRow(pattern, 0, fixture.before, expected[0][1]), false);
});

for (const row of ['Player | ... | Crate', 'Player | ... | Crate | ... | Player']) {
  test('zero-step ellipsis searches return no candidates: ' + row, async t => {
    const fixture = nativeFixture('moving [ ' + row + ' ] -> sfx0');
    const native = fixture.rules.at(-1);
    assert.equal(native.direction, 16);
    const expected = decodeMatches(expectedNativeDiagnostic(t, () => native.findMatches(level), 5), level.height);
    assert.deepEqual(expected, []);
    assert.deepEqual(await boundedMatches(decodeRulePattern(native, fixture.context), fixture.before), expected);
  });
}

for (const [row, gaps] of [
  ['Player | Crate', []],
  ['Player | ... | Crate', [37]],
  ['Player | ... | Crate | ... | Player', [2, 37]],
]) {
  test('fixed-gap zero-step rechecks evaluate live predicates: ' + row, () => {
    const fixture = nativeFixture('moving [ ' + row + ' ] -> sfx0');
    const native = fixture.rules.at(-1);
    const pattern = decodeRulePattern(native, fixture.context);
    const candidate = { start: { x: 1, y: 1 }, gaps };
    assert.equal(nativeRowMatches(native, candidate), true);
    assert.equal(matchesRow(pattern, 0, fixture.before, candidate), nativeRowMatches(native, candidate));
    const crateId = state.idDict.indexOf('crate');
    const occupants = level.getCell(3);
    occupants.ibitclear(crateId);
    level.setCell(3, occupants);
    fixture.before.board.rows[1][1].objects.delete(fixture.context.objects[crateId]);
    assert.equal(nativeRowMatches(native, candidate), false);
    assert.equal(matchesRow(pattern, 0, fixture.before, candidate), nativeRowMatches(native, candidate));
  });
}

test('native zero-step replacements share one live cell and recheck before later tuples', t => {
  const fixture = nativeFixture('moving [ Player | Crate ] -> [ Crate | Player ]');
  const native = fixture.rules.at(-1);
  const decoded = decodeSessionGame(state, { Direction, Movement, Ellipsis, CommandKind,
    PlayerMatchKind, LevelKind, SimpleSound, ObjectMatchKind, WinQuantifier });
  const rule = decoded.execution.rules.get(native);
  const matches = decodeMatches(expectedNativeDiagnostic(t, () => native.findMatches(level)), level.height);
  sfxCreateMask.setZero();
  sfxDestroyMask.setZero();
  let before = nativeExecutionFrame(decoded);
  for (const [candidate, recheck] of [[matches[0][0], false], [matches[0][0], true], [matches[0][1], true]]) {
    const tuple = [candidate];
    const nativeTuple = encodeMatches([tuple], level.height)[0];
    const changed = native.applyAt(level, nativeTuple, recheck, level.delta_index(native.direction));
    const expected = nativeExecutionFrame(decoded);
    const result = applyRuleAt(decoded.execution.game, rule, before, tuple, recheck);
    assert.deepEqual(result, { state: expected, changed, diagnostics: [] });
    assert.deepEqual([...result.state.board.rows[0][0].objects].map(object => object.name).sort(), ['background', 'player']);
    before = result.state;
  }
});
