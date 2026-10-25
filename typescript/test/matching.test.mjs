import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../build/board.js';
import { Direction, Movement } from '../build/model.js';
import { Ellipsis } from '../build/rule-model.js';
import { findMatches, matchesCell, matchesRow, matchTuples } from '../build/matching.js';

const A = { name: 'A' };
const B = { name: 'B' };
const C = { name: 'C' };
const declarations = { A, B, C };

function cell(overrides = {}) {
  return {
    requiredObjects: new Set(), forbiddenObjects: new Set(), anyObjects: [],
    requiredMovements: [], forbiddenMovements: [],
    ...overrides,
  };
}

function has(...objects) {
  return cell({ requiredObjects: new Set(objects) });
}

function intent(layer, movement) {
  return { layer, movement };
}

function pending(x, y, layer, ...movements) {
  return { position: { x, y }, layer, movements: new Set(movements) };
}

function state(rows, pendingMovements = []) {
  return {
    board: createBoard(rows.map(row => [...row].map(glyph => new Set(declarations[glyph] ? [declarations[glyph]] : [])))),
    pendingMovements,
  };
}

function rule(direction, ...rows) {
  return { direction, rows };
}

function match(x, y, ...gaps) {
  return { start: { x, y }, gaps };
}

test('an unconstrained cell accepts empty contents and movements', () => {
  assert.equal(matchesCell(cell(), new Set(), []), true);
});

test('required objects all exist and forbidden objects are all absent', () => {
  const pattern = cell({ requiredObjects: new Set([A, B]), forbiddenObjects: new Set([C]) });
  assert.equal(matchesCell(pattern, new Set([A, B]), []), true);
  assert.equal(matchesCell(pattern, new Set([A]), []), false);
  assert.equal(matchesCell(pattern, new Set([A, B, C]), []), false);
});

test('object membership preserves declaration identity when names coincide', () => {
  const lookalike = { name: A.name };
  assert.equal(matchesCell(has(A), new Set([lookalike]), []), false);
  assert.equal(matchesCell(has(A, lookalike), new Set([A]), []), false);
  assert.equal(matchesCell(has(A, lookalike), new Set([A, lookalike]), []), true);
  assert.equal(matchesCell(cell({ forbiddenObjects: new Set([A]) }), new Set([lookalike]), []), true);
});

test('each object disjunction needs an intersection and an empty disjunction fails', () => {
  const pattern = cell({ anyObjects: [new Set([A, B]), new Set([B, C])] });
  assert.equal(matchesCell(pattern, new Set([B]), []), true);
  assert.equal(matchesCell(pattern, new Set([A, C]), []), true);
  assert.equal(matchesCell(pattern, new Set([A]), []), false);
  assert.equal(matchesCell(cell({ anyObjects: [new Set()] }), new Set([A]), []), false);
});

test('required and forbidden movement pairs compare both layer and movement', () => {
  const up = intent(0, Movement.Up);
  const action = intent(4, Movement.Action);
  const pattern = cell({ requiredMovements: [up, action], forbiddenMovements: [intent(0, Movement.Left)] });
  assert.equal(matchesCell(pattern, new Set(), [up, action, intent(4, Movement.Left)]), true);
  assert.equal(matchesCell(pattern, new Set(), [intent(1, Movement.Up), action]), false);
  assert.equal(matchesCell(pattern, new Set(), [up]), false);
  assert.equal(matchesCell(pattern, new Set(), [up, action, intent(0, Movement.Left)]), false);
});

const orderedStarts = [
  ['right', Direction.Right, [match(0, 0), match(1, 0), match(0, 1), match(1, 1), match(0, 2), match(1, 2)]],
  ['left', Direction.Left, [match(1, 0), match(2, 0), match(1, 1), match(2, 1), match(1, 2), match(2, 2)]],
  ['down', Direction.Down, [match(0, 0), match(0, 1), match(1, 0), match(1, 1), match(2, 0), match(2, 1)]],
  ['up', Direction.Up, [match(0, 1), match(0, 2), match(1, 1), match(1, 2), match(2, 1), match(2, 2)]],
];

for (const [name, direction, expected] of orderedStarts) {
  test(`${name} scans origins in legacy order and never wraps a row or column`, () => {
    const pattern = rule(direction, [cell(), cell()]);
    const input = state(['...', '...', '...']);
    assert.deepEqual(findMatches(pattern, input), [expected]);
    for (const candidate of expected) assert.equal(matchesRow(pattern, 0, input, candidate), true);
  });
}

for (const [name, direction, rows, expected] of [
  ['right', Direction.Right, ['AB'], match(0, 0)],
  ['left', Direction.Left, ['BA'], match(1, 0)],
  ['down', Direction.Down, ['A', 'B'], match(0, 0)],
  ['up', Direction.Up, ['B', 'A'], match(0, 1)],
]) {
  test(`${name} traverses predicates in the named direction`, () => {
    assert.deepEqual(findMatches(rule(direction, [has(A), has(B)]), state(rows)), [[expected]]);
  });
}

test('adjacent cells on separate rows or columns cannot form a match', () => {
  assert.deepEqual(findMatches(rule(Direction.Right, [has(A), has(B)]), state(['.A', 'B.'])), []);
  assert.deepEqual(findMatches(rule(Direction.Left, [has(A), has(B)]), state(['B.', '.A'])), []);
  assert.deepEqual(findMatches(rule(Direction.Down, [has(A), has(B)]), state(['.B', 'A.'])), []);
  assert.deepEqual(findMatches(rule(Direction.Up, [has(A), has(B)]), state(['.A', 'B.'])), []);
});

test('empty rules and boards and a row wider than the board yield no rule matches', () => {
  assert.deepEqual(findMatches(rule(Direction.Right), state(['A'])), []);
  assert.deepEqual(findMatches(rule(Direction.Right, [cell()]), state([])), []);
  assert.deepEqual(findMatches(rule(Direction.Right, [cell(), cell()]), state(['A'])), []);
  assert.deepEqual(findMatches(rule(Direction.Down, [cell(), cell()]), state(['AA'])), []);
});

test('bracket rows match independently, and one failing row rejects the whole rule', () => {
  const input = state(['ABA', '..B']);
  assert.deepEqual(findMatches(rule(Direction.Right, [has(A)], [has(B)]), input), [
    [match(0, 0), match(2, 0)], [match(1, 0), match(2, 1)],
  ]);
  assert.deepEqual(findMatches(rule(Direction.Right, [has(A)], [has(C)]), input), []);
});

test('matching sees every pending movement entry at only the requested cell', () => {
  const input = state(['AAA'], [
    pending(0, 0, 0, Movement.Right), pending(0, 0, 0, Movement.Action),
    pending(1, 0, 0, Movement.Right), pending(2, 0, 1, Movement.Right, Movement.Action),
  ]);
  const pattern = rule(Direction.Right, [cell({ requiredMovements: [intent(0, Movement.Right), intent(0, Movement.Action)] })]);
  assert.deepEqual(findMatches(pattern, input), [[match(0, 0)]]);
});

for (const [name, direction, rows, first, second] of [
  ['right', Direction.Right, ['AAAA'], match(0, 0, 0), match(0, 0, 1)],
  ['left', Direction.Left, ['AAAA'], match(1, 0, 0), match(2, 0, 0)],
  ['down', Direction.Down, ['A', 'A', 'A', 'A'], match(0, 0, 0), match(0, 0, 1)],
  ['up', Direction.Up, ['A', 'A', 'A', 'A'], match(0, 1, 0), match(0, 2, 0)],
]) {
  test(`${name} ellipsis consumes zero or more cells with each origin consecutive`, () => {
    const pattern = rule(direction, [has(A), Ellipsis, has(A)]);
    const matches = findMatches(pattern, state(rows));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].length, 6);
    assert.deepEqual(matches[0].slice(0, 2), [first, second]);
    assert.equal(matches[0].some(candidate => candidate.gaps[0] === 2), true);
    for (const candidate of matches[0]) assert.equal(matchesRow(pattern, 0, state(rows), candidate), true);
  });
}

test('an ellipsis tests the whole suffix at each increasing gap length', () => {
  const pattern = rule(Direction.Right, [has(A), Ellipsis, has(B), has(C)]);
  assert.deepEqual(findMatches(pattern, state(['ABCBC'])), [[match(0, 0, 0), match(0, 0, 2)]]);
  assert.deepEqual(findMatches(pattern, state(['AB', 'C.'])), []);
});

test('two ellipses enumerate the first gap outside the second gap', () => {
  const pattern = rule(Direction.Right, [cell(), Ellipsis, cell(), Ellipsis, cell()]);
  assert.deepEqual(findMatches(pattern, state(['.....'])), [[
    match(0, 0, 0, 0), match(0, 0, 0, 1), match(0, 0, 0, 2),
    match(0, 0, 1, 0), match(0, 0, 1, 1), match(0, 0, 2, 0),
    match(1, 0, 0, 0), match(1, 0, 0, 1), match(1, 0, 1, 0), match(2, 0, 0, 0),
  ]]);
});

test('rechecking uses the recorded ellipsis gap instead of discovering a new match', () => {
  const pattern = rule(Direction.Right, [has(A), Ellipsis, has(B)]);
  const input = state(['ABB']);
  const found = findMatches(pattern, input)[0];
  assert.deepEqual(found, [match(0, 0, 0), match(0, 0, 1)]);
  input.board.rows[0][1].objects.clear();
  assert.equal(matchesRow(pattern, 0, input, found[0]), false);
  assert.equal(matchesRow(pattern, 0, input, found[1]), true);
});

test('rechecking two ellipses follows both fixed gaps and checks every cell', () => {
  const pattern = rule(Direction.Right, [has(A), Ellipsis, has(B), Ellipsis, has(C)]);
  const input = state(['A.B..C']);
  const found = match(0, 0, 1, 2);
  assert.equal(matchesRow(pattern, 0, input, found), true);
  assert.equal(matchesRow(pattern, 0, input, match(0, 0, 0, 3)), false);
  input.board.rows[0][5].objects.clear();
  assert.equal(matchesRow(pattern, 0, input, found), false);
});

test('rechecking reads updated objects and movement intents for a fixed nonellipsis row', () => {
  const pattern = rule(Direction.Right, [cell({ requiredObjects: new Set([A]), requiredMovements: [intent(2, Movement.Action)] }), has(B)]);
  const input = state(['AB'], [pending(0, 0, 2, Movement.Action)]);
  const found = match(0, 0);
  assert.equal(matchesRow(pattern, 0, input, found), true);
  input.pendingMovements[0].movements.clear();
  assert.equal(matchesRow(pattern, 0, input, found), false);
  input.pendingMovements[0].movements.add(Movement.Action);
  input.board.rows[0][1].objects.clear();
  assert.equal(matchesRow(pattern, 0, input, found), false);
});

test('rechecking rejects missing rows, wrong gap counts, invalid gaps and out-of-bounds origins', () => {
  const input = state(['AAA']);
  const pattern = rule(Direction.Right, [has(A), Ellipsis, has(A)]);
  for (const candidate of [match(0, 0), match(0, 0, 0, 0), match(0, 0, -1), match(0, 0, 0.5), match(0, 0, 2), match(-1, 0, 0), match(0, 1, 0)]) {
    assert.equal(matchesRow(pattern, 0, input, candidate), false);
  }
  assert.equal(matchesRow(pattern, 1, input, match(0, 0, 0)), false);
  assert.equal(matchesRow(pattern, -1, input, match(0, 0, 0)), false);
});

test('tuples keep the first row varying fastest across three independent rows', () => {
  const a = match(0, 0), b = match(1, 0), c = match(2, 0), d = match(3, 0), e = match(4, 0), f = match(5, 0);
  assert.deepEqual(matchTuples([[a, b], [c, d], [e, f]]), [
    [a, c, e], [b, c, e], [a, d, e], [b, d, e],
    [a, c, f], [b, c, f], [a, d, f], [b, d, f],
  ]);
  assert.deepEqual(matchTuples([]), [[]]);
  assert.deepEqual(matchTuples([[a], [], [e]]), []);
});

test('matching leaves inputs untouched and each returned origin and gaps are independent', () => {
  const input = state(['AAAA'], [pending(0, 0, 0, Movement.Right)]);
  const pattern = rule(Direction.Right, [has(A), Ellipsis, has(A)]);
  const snapshot = structuredClone({ input, predicate: pattern.rows[0][0] });
  const first = findMatches(pattern, input);
  const second = findMatches(pattern, input);
  assert.deepEqual({ input, predicate: pattern.rows[0][0] }, snapshot);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0][0].start, first[0][1].start);
  assert.notEqual(first[0][0].gaps, first[0][1].gaps);
  first[0][0].start.x = 99;
  first[0][0].gaps[0] = 99;
  assert.deepEqual(second[0][0], match(0, 0, 0));
  assert.deepEqual(first[0][1], match(0, 0, 1));
  assert.deepEqual({ input, predicate: pattern.rows[0][0] }, snapshot);
});
