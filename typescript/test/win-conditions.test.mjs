import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createBoard } from '../build/board.js';
import { ObjectMatchKind, WinQuantifier, matchesObjects, hasWon } from '../build/win-conditions.js';

const Crate = Object.freeze({ name: 'Crate' });
const Player = Object.freeze({ name: 'Player' });
const Target = Object.freeze({ name: 'Target' });
const Floor = Object.freeze({ name: 'Floor' });
const OtherCrate = Object.freeze({ name: 'Crate' });
const declarations = [Crate, Player, Target, Floor, OtherCrate];

const any = (...objects) => ({ kind: ObjectMatchKind.Any, objects: new Set(objects) });
const all = (...objects) => ({ kind: ObjectMatchKind.All, objects: new Set(objects) });
const condition = (quantifier, subject = any(Crate), target = any(Target)) => ({ quantifier, subject, target });
const board = (...rows) => createBoard(rows.map(row => row.map(objects => new Set(objects))));

// Run the unchanged legacy predicates in their own test-only global scope.
// Capturing DoWin records their result without entering session transitions.
const engine = readFileSync(new URL('./vanilla/js/engine.js', import.meta.url), 'utf8');
function sourceBetween(start, end) {
  assert.equal(engine.split(start).length - 1, 1, `Unique source anchor: ${start}`);
  assert.equal(engine.split(end).length - 1, 1, `Unique source anchor: ${end}`);
  assert.ok(engine.indexOf(start) < engine.indexOf(end));
  return engine.slice(engine.indexOf(start), engine.indexOf(end));
}
const legacy = vm.createContext({
  STRIDE_OBJ: 1, levelEditorOpened: false, runrulesonlevelstart_phase: false,
  consolePrint() {},
});
vm.runInContext([
  readFileSync(new URL('./vanilla/js/bitvec.js', import.meta.url), 'utf8'),
  readFileSync(new URL('./vanilla/js/level.js', import.meta.url), 'utf8'),
  'var _o10 = new BitVec(1);',
  sourceBetween('function checkWin(', 'function DoWin('),
  'function DoWin() { won = true; }',
].join('\n'), legacy, { filename: 'test-only-win-predicates.js' });
function legacyHasWon(incoming, conditions) {
  function mask(objects) {
    let bits = 0;
    for (const object of objects) {
      const id = declarations.indexOf(object);
      assert.ok(id >= 0, 'Oracle inputs use canonical test declarations');
      bits |= 1 << id;
    }
    return bits;
  }
  const tiles = [];
  for (let x = 0; x < incoming.width; x++) {
    for (let y = 0; y < incoming.height; y++) tiles.push(mask(incoming.rows[y][x].objects));
  }
  legacy.level = new legacy.Level(null, incoming.width, incoming.height, 0, new Int32Array(tiles));
  legacy.state = { winconditions: conditions.map(entry => [
    entry.quantifier === WinQuantifier.No ? -1 : entry.quantifier === WinQuantifier.Some ? 0 : 1,
    new legacy.BitVec([mask(entry.subject.objects)]),
    new legacy.BitVec([mask(entry.target.objects)]),
    null, entry.subject.kind === ObjectMatchKind.All, entry.target.kind === ObjectMatchKind.All,
  ]) };
  legacy.won = false;
  legacy.checkWin(false, false);
  return legacy.won;
}
function assertWin(incoming, conditions, expected) {
  assert.equal(hasWon(incoming, conditions), expected);
  assert.equal(legacyHasWon(incoming, conditions), expected, 'Independent legacy win check');
}
function checkQuantifiers(name, incoming, subject, target, expected) {
  for (const [index, quantifier] of [WinQuantifier.No, WinQuantifier.Some, WinQuantifier.All].entries()) {
    test(`${WinQuantifier[quantifier]}: ${name}`, () => {
      assertWin(incoming, [condition(quantifier, subject, target)], expected[index]);
    });
  }
}

test('object match kinds and win quantifiers are numeric enums', () => {
  assert.equal(typeof ObjectMatchKind.Any, 'number');
  assert.equal(ObjectMatchKind[ObjectMatchKind.All], 'All');
  for (const name of ['No', 'Some', 'All']) {
    assert.equal(typeof WinQuantifier[name], 'number');
    assert.equal(WinQuantifier[WinQuantifier[name]], name);
  }
});

test('a Never operand retains known members but cannot match any cell', () => {
  assert.equal(typeof ObjectMatchKind.Never, 'number');
  const impossible = { kind: ObjectMatchKind.Never, objects: new Set([Crate]) };
  assert.equal(matchesObjects(impossible, new Set([Crate, Player, Target, Floor])), false);
  assert.equal(matchesObjects(impossible, new Set()), false);
  assert.equal(hasWon(board([[Crate, Target]]), [condition(WinQuantifier.Some, impossible)]), false);
  assert.equal(hasWon(board([[Crate, Target]]), [condition(WinQuantifier.No, impossible)]), true);
  assert.equal(hasWon(board([[Crate, Target]]), [condition(WinQuantifier.All, any(Crate), impossible)]), false);
});

for (const [name, predicate, occupants, expected] of [
  ['any property member is present', any(Crate, Player), [Player, Floor], true],
  ['any property member is absent', any(Crate, Player), [Target, Floor], false],
  ['all aggregate members are present', all(Crate, Player), [Crate, Player, Floor], true],
  ['a partial aggregate is absent', all(Crate, Player), [Crate, Floor], false],
  ['an aggregate misses every member', all(Crate, Player), [Target], false],
  ['any nonempty property in an empty cell', any(Crate), [], false],
  ['all nonempty aggregate in an empty cell', all(Crate), [], false],
  ['any empty property in an occupied cell', any(), [Crate], false],
  ['any empty property in an empty cell', any(), [], false],
  ['all empty aggregate in an occupied cell', all(), [Crate], true],
  ['all empty aggregate in an empty cell', all(), [], true],
  ['same-name objects are distinct for any', any(Crate), [OtherCrate], false],
  ['same-name objects are distinct for all', all(Crate), [OtherCrate], false],
  ['aggregate requires both same-name declarations', all(Crate, OtherCrate), [Crate], false],
  ['aggregate contains both same-name declarations', all(Crate, OtherCrate), [Crate, OtherCrate], true],
]) {
  test(`object matching: ${name}`, () => {
    assert.equal(matchesObjects(predicate, new Set(occupants)), expected);
  });
}

for (const [name, incoming, expected] of [
  ['neither crate nor target is present', board([[]]), [true, false, true]],
  ['a crate has no target', board([[Crate]]), [true, false, false]],
  ['a target has no crate', board([[Target]]), [true, false, true]],
  ['a crate occupies a target', board([[Crate, Target]]), [false, true, true]],
  ['crate and target occupy separate cells', board([[Crate], [Target]]), [true, false, false]],
  ['one crate is on target and another is off target', board([[Crate, Target], [Crate]]), [false, true, false]],
  ['every crate is on target with an extra empty target', board([[Crate, Target], [Target]]), [false, true, true]],
  ['the only crate occupies a target on the last row', board([[Floor], [Floor]], [[Floor], [Crate, Target]]), [false, true, true]],
  ['a same-name declaration does not satisfy the subject', board([[OtherCrate, Target]]), [true, false, true]],
]) checkQuantifiers(name, incoming, any(Crate), any(Target), expected);

for (const [name, incoming, expected] of [
  ['a complete subject aggregate is on target', board([[Crate, Player, Target]]), [false, true, true]],
  ['a complete subject aggregate has no target', board([[Crate, Player]]), [true, false, false]],
  ['a partial subject aggregate on target does not count', board([[Crate, Target]]), [true, false, true]],
  ['subject members spread over target cells do not combine', board([[Crate, Target], [Player, Target]]), [true, false, true]],
]) checkQuantifiers(name, incoming, all(Crate, Player), any(Target), expected);

for (const [name, incoming, expected] of [
  ['a crate occupies the complete target aggregate', board([[Crate, Target, Floor]]), [false, true, true]],
  ['a crate occupies only part of the target aggregate', board([[Crate, Target]]), [true, false, false]],
  ['a crate occupies none of the target aggregate', board([[Crate]]), [true, false, false]],
  ['target members spread over crate cells do not combine', board([[Crate, Target], [Crate, Floor]]), [true, false, false]],
]) checkQuantifiers(name, incoming, any(Crate), all(Target, Floor), expected);

checkQuantifiers('subject and target can both be aggregates', board([[Crate, Player, Target, Floor]]),
  all(Crate, Player), all(Target, Floor), [false, true, true]);
checkQuantifiers('subject property can match its second member', board([[Player, Target]]),
  any(Crate, Player), any(Target), [false, true, true]);
checkQuantifiers('target property can match its second member', board([[Crate, Floor]]),
  any(Crate), any(Target, Floor), [false, true, true]);

for (const [name, incoming, subject, target, expected] of [
  ['empty any subject never matches', board([[Target]]), any(), any(Target), [true, false, true]],
  ['empty any target never matches', board([[Crate]]), any(Crate), any(), [true, false, false]],
  ['empty all subject matches a cell without target', board([[]]), all(), any(Target), [true, false, false]],
  ['empty all subject matches a cell with target', board([[Target]]), all(), any(Target), [false, true, true]],
  ['empty all target matches a subject cell', board([[Crate]]), any(Crate), all(), [false, true, true]],
  ['empty all target does not create subject cells', board([[]]), any(Crate), all(), [true, false, true]],
  ['two empty aggregates match an empty cell', board([[]]), all(), all(), [false, true, true]],
]) checkQuantifiers(name, incoming, subject, target, expected);

for (const [name, incoming] of [
  ['zero rows', board()], ['zero columns with two rows', board([], [])],
]) {
  checkQuantifiers(`${name} has no subject cells`, incoming, any(Crate), any(Target), [true, false, true]);
  checkQuantifiers(`${name} has no cells even for empty aggregates`, incoming, all(), all(), [true, false, true]);
}

test('zero declared win conditions never wins', () => {
  assertWin(board([[Crate, Target]]), [], false);
  assertWin(board(), [], false);
});

test('every declared win condition must hold', () => {
  const incoming = board([[Crate, Target], [Player, Floor]]);
  const satisfied = [
    condition(WinQuantifier.No, any(Player), any(Target)),
    condition(WinQuantifier.Some),
    condition(WinQuantifier.All),
  ];
  assertWin(incoming, satisfied, true);
  const failing = condition(WinQuantifier.All, any(Player), any(Target));
  for (let index = 0; index <= satisfied.length; index++) {
    const conditions = [...satisfied];
    conditions.splice(index, 0, failing);
    assertWin(incoming, conditions, false);
  }
});

test('predicates preserve boards, declarations and input sets across repeated checks', () => {
  const subject = Object.freeze(all(Crate, Player));
  const target = Object.freeze(any(Target, Floor));
  const conditions = Object.freeze([Object.freeze(condition(WinQuantifier.All, subject, target))]);
  const incoming = board([[Crate, Player, Target], [Floor]], [[OtherCrate], []]);
  const boardSnapshot = structuredClone(incoming);
  const conditionSnapshot = structuredClone(conditions);
  const rows = incoming.rows;
  const firstRow = rows[0];
  const cell = firstRow[0];
  const objects = cell.objects;
  Object.freeze(cell);
  Object.freeze(firstRow);
  Object.freeze(rows);
  Object.freeze(incoming);
  for (let count = 0; count < 3; count++) {
    assert.equal(matchesObjects(subject, objects), true);
    assert.equal(matchesObjects(target, objects), true);
    assertWin(incoming, conditions, true);
    assertWin(incoming, [condition(WinQuantifier.No, subject, target)], false);
  }
  assert.deepEqual(incoming, boardSnapshot);
  assert.deepEqual(conditions, conditionSnapshot);
  assert.equal(incoming.rows, rows);
  assert.equal(rows[0], firstRow);
  assert.equal(firstRow[0], cell);
  assert.equal(cell.objects, objects);
  assert.ok(objects.has(Crate));
  assert.ok(objects.has(Player));
  assert.ok(subject.objects.has(Crate));
  assert.ok(target.objects.has(Target));
  assert.equal(Crate.name, 'Crate');
});
