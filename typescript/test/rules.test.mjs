import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../build/board.js';
import { CommandKind } from '../build/commands.js';
import { Direction, Movement } from '../build/model.js';
import { createRandom, nextRandom } from '../build/random.js';
import { Ellipsis } from '../build/rule-model.js';
import { applyRuleAt, cloneExecutionState, tryApplyRule } from '../build/rules.js';

const A = Object.freeze({ name: 'A' });
const B = Object.freeze({ name: 'B' });
const C = Object.freeze({ name: 'C' });
const D = Object.freeze({ name: 'D' });
const E = Object.freeze({ name: 'E' });
const layers = [[A, B], [C, D], [E]];
const game = { collisionLayers: layers, rigidMerges: new Map() };
const allMovements = [Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action];

function pattern(objects = [], overrides = {}) {
  return {
    requiredObjects: new Set(objects), forbiddenObjects: new Set(), anyObjects: [],
    requiredMovements: [], forbiddenMovements: [],
    ...overrides,
  };
}

function edits(overrides = {}) {
  return {
    removeObjects: new Set(), addObjects: new Set(), vacateLayers: new Set(),
    removeMovements: [], addMovements: [], resetMovementLayers: new Set(),
    randomObjects: [], randomDirectionLayers: new Set(),
    ...overrides,
  };
}

function replacement(changes = {}, overrides = {}) {
  return {
    edits: edits(changes),
    rigidLayers: new Set(), ...overrides,
  };
}

function rule(rows = [[pattern([A])]], replacements = [[replacement()]], overrides = {}) {
  return {
    direction: Direction.Right, rows, sourceLine: 12, hasReplacements: true, replacements,
    commands: [], rigidGroup: null, ...overrides,
  };
}

function state(rows = [[[A]]], overrides = {}) {
  return {
    board: createBoard(rows.map(row => row.map(objects => new Set(objects)))),
    pendingMovements: [], rigidMarks: [], bannedGroups: new Set(),
    canMoveSounds: [], cantMoveSounds: [], random: createRandom('rule tests'),
    commands: { entries: [], message: '' }, createdObjects: new Set(), destroyedObjects: new Set(),
    ...overrides,
  };
}

function match(x = 0, y = 0, gaps = []) {
  return { start: { x, y }, gaps };
}

function request(x, y, layer, movements) {
  return { position: { x, y }, layer, movements: new Set(movements) };
}

function movementSet(actual, x = 0, y = 0, layer = 0) {
  const result = new Set();
  for (const entry of actual.pendingMovements) {
    if (entry.position.x === x && entry.position.y === y && entry.layer === layer) {
      for (const movement of entry.movements) result.add(movement);
    }
  }
  return result;
}

function assertCell(actual, objects, x = 0, y = 0) {
  assert.deepEqual(actual.board.rows[y][x].objects, new Set(objects));
  for (const object of objects) assert.ok(actual.board.rows[y][x].objects.has(object));
}

function drawCount(random, count) {
  for (let index = 0; index < count; index++) random = nextRandom(random).state;
  return random;
}

test('execution clones own every mutable state container while sharing canonical identities', () => {
  const source = rule();
  const command = Object.freeze({ kind: CommandKind.Win });
  const before = state([[[A, C]]], {
    pendingMovements: [request(0, 0, 0, [Movement.Up])],
    rigidMarks: [{ ...request(0, 0, 1, [Movement.Action]), group: null }],
    bannedGroups: new Set([1, null]), canMoveSounds: ['success'], cantMoveSounds: ['failure'],
    commands: { entries: [{ command, source }], message: 'old' },
    createdObjects: new Set([A]), destroyedObjects: new Set([B]),
  });
  const snapshot = structuredClone(before);
  const after = cloneExecutionState(before);
  assert.deepEqual(after, before);
  assert.notEqual(after, before);
  assert.notEqual(after.board, before.board);
  assert.notEqual(after.board.rows, before.board.rows);
  assert.notEqual(after.board.rows[0], before.board.rows[0]);
  assert.notEqual(after.board.rows[0][0], before.board.rows[0][0]);
  assert.notEqual(after.board.rows[0][0].objects, before.board.rows[0][0].objects);
  assert.equal([...after.board.rows[0][0].objects][0], A);
  for (const name of ['pendingMovements', 'rigidMarks']) {
    assert.notEqual(after[name], before[name]);
    assert.notEqual(after[name][0], before[name][0]);
    assert.notEqual(after[name][0].position, before[name][0].position);
    assert.notEqual(after[name][0].movements, before[name][0].movements);
  }
  for (const name of ['bannedGroups', 'canMoveSounds', 'cantMoveSounds', 'createdObjects', 'destroyedObjects']) {
    assert.notEqual(after[name], before[name]);
  }
  assert.notEqual(after.random, before.random);
  assert.notEqual(after.random.permutation, before.random.permutation);
  assert.notEqual(after.commands, before.commands);
  assert.notEqual(after.commands.entries, before.commands.entries);
  assert.notEqual(after.commands.entries[0], before.commands.entries[0]);
  assert.equal(after.commands.entries[0].source, source);
  assert.equal(after.commands.entries[0].command, command);
  after.board.rows[0][0].objects.clear();
  after.pendingMovements[0].movements.clear();
  after.pendingMovements[0].position.x = 2;
  after.rigidMarks[0].group = 4;
  after.rigidMarks[0].movements.clear();
  after.bannedGroups.clear();
  after.random.permutation.reverse();
  after.commands.entries[0].source = rule();
  after.createdObjects.clear();
  assert.deepEqual(before, snapshot);
});

// Rule execution never modifies its input. Unchanged state is returned as is and
// results share unchanged parts; public session operations copy at their boundary.
test('a no-op tuple returns the unchanged state and empty diagnostics', () => {
  const before = state();
  const snapshot = structuredClone(before);
  const result = applyRuleAt(game, rule(), before, [match()], true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, snapshot);
  assert.deepEqual(before, snapshot);
  assert.deepEqual(result.diagnostics, []);
});

test('all rows revalidate before any writes or random draws', () => {
  const before = state([[[A], [B]]]);
  const incoming = rule([[pattern([A])], [pattern([C])]], [
    [replacement({ randomObjects: [{ object: B, layer: 0 }] })],
    [replacement({ addObjects: new Set([D]) })],
  ]);
  const result = applyRuleAt(game, incoming, before, [match(), match(1)], true);
  assert.equal(result.changed, false);
  assert.equal(result.state, before);
});

test('row revalidation includes movement requirements and recorded ellipsis gaps', () => {
  const before = state([[[A], [], [B]]], { pendingMovements: [request(2, 0, 0, [Movement.Up])] });
  const incoming = rule([[pattern([A]), Ellipsis, pattern([B], { requiredMovements: [{ layer: 0, movement: Movement.Right }] })]],
    [[replacement({ addObjects: new Set([C]) }), null, replacement()]]);
  const result = applyRuleAt(game, incoming, before, [match(0, 0, [1])], true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, before);
});

test('the first tuple can apply without rechecking its recorded pattern', () => {
  const incoming = rule([[pattern([B])]], [[replacement({ addObjects: new Set([C]) })]]);
  const result = applyRuleAt(game, incoming, state(), [match()], false);
  assertCell(result.state, [A, C]);
  assert.equal(result.changed, true);
});

for (const [direction, start, target] of [
  [Direction.Right, [0, 1], [1, 1]], [Direction.Left, [2, 1], [1, 1]],
  [Direction.Down, [1, 0], [1, 1]], [Direction.Up, [1, 2], [1, 1]],
]) {
  test(`cell traversal follows ${Direction[direction]} through null replacements`, () => {
    const before = state(Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => [A])));
    const incoming = rule([[pattern([A]), pattern([A])]], [[null, replacement({ addObjects: new Set([C]) })]], { direction });
    const result = applyRuleAt(game, incoming, before, [match(...start)], true);
    assertCell(result.state, [A, C], ...target);
    assertCell(result.state, [A], ...start);
    assert.equal(result.state.createdObjects.size, 1);
  });
}

test('two ellipses in two rows keep replacements aligned with source pattern indices', () => {
  const before = state([Array.from({ length: 7 }, () => [A]), Array.from({ length: 7 }, () => [A])]);
  const row = [pattern([A]), Ellipsis, pattern([A]), Ellipsis, pattern([A])];
  const incoming = rule([row, row], [
    [replacement({ addObjects: new Set([C]) }), null, replacement({ addObjects: new Set([D]) }), null, replacement({ addObjects: new Set([E]) })],
    [replacement({ addObjects: new Set([E]) }), null, null, null, replacement({ addObjects: new Set([C]) })],
  ]);
  const result = applyRuleAt(game, incoming, before, [match(0, 0, [1, 2]), match(1, 1, [0, 2])], true);
  assertCell(result.state, [A, C], 0, 0);
  assertCell(result.state, [A, D], 2, 0);
  assertCell(result.state, [A, E], 5, 0);
  assertCell(result.state, [A, E], 1, 1);
  assertCell(result.state, [A], 2, 1);
  assertCell(result.state, [A, C], 5, 1);
  assertCell(result.state, [A], 4, 0);
});

test('overlapping row writes apply ordered static edits to the current cell', () => {
  const before = state([[[A]]]);
  const incoming = rule([[pattern([A])], [pattern([A])]], [
    [replacement({ vacateLayers: new Set([0]), addObjects: new Set([B]) })],
    [replacement({ removeObjects: new Set([B]), addObjects: new Set([A]),
      addMovements: [{ layer: 0, movement: Movement.Up }] })],
  ]);
  const result = applyRuleAt(game, incoming, before, [match(), match()], true);
  assertCell(result.state, [A]);
  assert.deepEqual(movementSet(result.state), new Set([Movement.Up]));
  assert.deepEqual(result.state.createdObjects, new Set([A, B]));
  assert.deepEqual(result.state.destroyedObjects, new Set([A, B]));
});

test('zero-step replacement cells write one live cell in pattern order', () => {
  const before = state();
  const incoming = rule([[pattern([A]), pattern([A])]], [[
    replacement({ removeObjects: new Set([A]), addObjects: new Set([B]) }),
    replacement({ removeObjects: new Set([B]), addObjects: new Set([C]),
      addMovements: [{ layer: 1, movement: Movement.Action }] }),
  ]], { direction: Direction.InPlace });
  const result = applyRuleAt(game, incoming, before, [match()], false);
  assertCell(result.state, [C]);
  assert.equal(result.changed, true);
  assert.deepEqual(movementSet(result.state, 0, 0, 1), new Set([Movement.Action]));
  assert.deepEqual(result.state.createdObjects, new Set([B, C]));
  assert.deepEqual(result.state.destroyedObjects, new Set([A, B]));
  assertCell(before, [A]);
  const rejected = applyRuleAt(game, incoming, result.state, [match()], true);
  assert.equal(rejected.changed, false);
  assert.deepEqual(rejected.state, result.state);
});

test('unchanged random choices advance the stream without changing the rule result', () => {
  const before = state();
  const incoming = rule(undefined, [[replacement({ randomObjects: [{ object: A, layer: 0 }] })]]);
  const result = applyRuleAt(game, incoming, before, [match()], true);
  assert.equal(result.changed, false);
  assertCell(result.state, [A]);
  assert.deepEqual(result.state.random, drawCount(before.random, 1));
  assert.deepEqual(before.random, createRandom('rule tests'));
});

test('random choices advance in replacement row and cell order', () => {
  const before = state([[[A], [A]]]);
  const changes = replacement({ randomObjects: [{ object: C, layer: 1 }, { object: D, layer: 1 }], randomDirectionLayers: new Set([0]) });
  const incoming = rule([[pattern([A]), pattern([A])], [pattern([A])]], [[changes, changes], [changes]]);
  const result = applyRuleAt(game, incoming, before, [match(), match(1)], true);
  let random = before.random;
  const expected = [];
  for (let index = 0; index < 3; index++) {
    const objectDraw = nextRandom(random);
    const directionDraw = nextRandom(objectDraw.state);
    expected.push({ object: [C, D][Math.floor(objectDraw.value * 2)], direction: allMovements[Math.floor(directionDraw.value * 4)] });
    random = directionDraw.state;
  }
  assertCell(result.state, [A, expected[0].object]);
  assertCell(result.state, [A, expected[2].object], 1);
  assert.deepEqual(movementSet(result.state), new Set([expected[0].direction]));
  assert.deepEqual(movementSet(result.state, 1), new Set([expected[1].direction, expected[2].direction]));
  assert.deepEqual(result.state.random, random);
});

test('creation and destruction accumulate across overlapping writes even with no net change', () => {
  const before = state([[[A]]], { createdObjects: new Set([C]), destroyedObjects: new Set([D]) });
  const incoming = rule([[pattern([A])], [pattern([A])]], [
    [replacement({ vacateLayers: new Set([0]), addObjects: new Set([B]) })],
    [replacement({ vacateLayers: new Set([0]), addObjects: new Set([A]) })],
  ]);
  const result = applyRuleAt(game, incoming, before, [match(), match()], true);
  assertCell(result.state, [A]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.createdObjects, new Set([C, A, B]));
  assert.deepEqual(result.state.destroyedObjects, new Set([D, A, B]));
});

test('rigid provenance alone marks every static affected layer and counts as a change', () => {
  const incoming = rule(undefined, [[replacement({}, { rigidLayers: new Set([0, 1]) })]], { rigidGroup: 3 });
  const result = applyRuleAt(game, incoming, state(), [match()], true);
  assert.equal(result.changed, true);
  assertCell(result.state, [A]);
  assert.deepEqual(result.state.rigidMarks, [
    { ...request(0, 0, 0, allMovements), group: 3 }, { ...request(0, 0, 1, allMovements), group: 3 },
  ]);
  assert.deepEqual(result.state.createdObjects, new Set());
  assert.deepEqual(result.state.destroyedObjects, new Set());
});

test('already fully marked affected layers retain their first owner', () => {
  const before = state([[[A]]], { rigidMarks: [{ ...request(0, 0, 0, allMovements), group: 0 }] });
  const incoming = rule(undefined, [[replacement({}, { rigidLayers: new Set([0]) })]], { rigidGroup: 1 });
  const result = applyRuleAt(game, incoming, before, [match()], true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state.rigidMarks, before.rigidMarks);
});

test('a newly affected layer makes rigid attribution update all affected layers in the cell', () => {
  const before = state([[[A, C]]], { rigidMarks: [{ ...request(0, 0, 0, allMovements), group: 0 }] });
  const incoming = rule(undefined, [[replacement({}, { rigidLayers: new Set([0, 1]) })]], { rigidGroup: 1 });
  const overlapGame = { collisionLayers: layers, rigidMerges: new Map([[0, new Map([[1, 2]])]]) };
  const result = applyRuleAt(overlapGame, incoming, before, [match()], true);
  assert.deepEqual(result.state.rigidMarks, [
    { ...request(0, 0, 0, allMovements), group: 2 }, { ...request(0, 0, 1, allMovements), group: 1 },
  ]);
  assert.equal(result.changed, true);
});

test('rigid overlap may produce a null owner and that owner survives later overlap', () => {
  const before = state([[[A, C]]], { rigidMarks: [{ ...request(0, 0, 0, allMovements), group: 0 }] });
  const incoming = rule(undefined, [[replacement({}, { rigidLayers: new Set([0, 1]) })]], { rigidGroup: 1 });
  const overlapGame = { collisionLayers: layers, rigidMerges: new Map([[0, new Map([[1, null]])], [1, new Map([[2, 2]])]]) };
  const first = applyRuleAt(overlapGame, incoming, before, [match()], true);
  assert.equal(first.state.rigidMarks[0].group, null);
  const next = rule(undefined, [[replacement({}, { rigidLayers: new Set([0, 1, 2]) })]], { rigidGroup: 2 });
  const second = applyRuleAt(overlapGame, next, first.state, [match()], true);
  assert.deepEqual(second.state.rigidMarks.map(mark => mark.group), [null, 2, 2]);
});

test('partially marked rigid layers become complete without requiring a self merge', () => {
  const before = state([[[A]]], { rigidMarks: [{ ...request(0, 0, 0, [Movement.Up]), group: 4 }] });
  const incoming = rule(undefined, [[replacement({}, { rigidLayers: new Set([0]) })]], { rigidGroup: 4 });
  const result = applyRuleAt(game, incoming, before, [match()], true);
  assert.deepEqual(result.state.rigidMarks, [{ ...request(0, 0, 0, allMovements), group: 4 }]);
  assert.equal(result.changed, true);
});

test('missing rigid overlap transitions raise a clear error without changing the input', () => {
  const before = state([[[A]]], { rigidMarks: [{ ...request(0, 0, 0, allMovements), group: 0 }] });
  const snapshot = structuredClone(before);
  const incoming = rule(undefined, [[replacement({ addObjects: new Set([C]) }, { rigidLayers: new Set([0, 1]) })]], { rigidGroup: 1 });
  assert.throws(() => applyRuleAt(game, incoming, before, [match()], true), /[Rr]igid.*0.*1/);
  assert.deepEqual(before, snapshot);
});

test('random object layers do not extend static rigid provenance', () => {
  const before = state([[[C]]]);
  const incoming = rule([[pattern([C])]], [[replacement({ randomObjects: [{ object: E, layer: 2 }] }, {
    rigidLayers: new Set([0]),
  })]], { rigidGroup: 0 });
  const result = applyRuleAt(game, incoming, before, [match()], true);
  assertCell(result.state, [C, E]);
  assert.deepEqual(result.state.rigidMarks, [{ ...request(0, 0, 0, allMovements), group: 0 }]);
  assert.deepEqual(movementSet(result.state, 0, 0, 2), new Set());
});

test('non-rigid replacements leave static rigid layers unmarked', () => {
  const incoming = rule(undefined, [[replacement({ addObjects: new Set([C]) }, { rigidLayers: new Set([0, 1]) })]]);
  const result = applyRuleAt(game, incoming, state(), [match()], true);
  assert.deepEqual(result.state.rigidMarks, []);
});

test('tryApplyRule rechecks later overlapping matches against prior writes', () => {
  const before = state([[[A], [A], [A]]]);
  const incoming = rule([[pattern([A]), pattern([A])]], [[null, replacement({ vacateLayers: new Set([0]), addObjects: new Set([B]) })]]);
  const result = tryApplyRule(game, incoming, before);
  assertCell(result.state, [A]);
  assertCell(result.state, [B], 1);
  assertCell(result.state, [A], 2);
  assert.equal(result.changed, true);
});

test('tryApplyRule enumerates tuples with the first row varying fastest', () => {
  const choices = Array.from({ length: 64 }, (_, index) => Object.freeze({ name: `choice ${index}` }));
  const localGame = { collisionLayers: [[A, B], choices], rigidMerges: new Map() };
  const before = state([[[A], [A]], [[B], [B]]]);
  const random = replacement({ randomObjects: choices.map(object => ({ object, layer: 1 })) });
  const incoming = rule([[pattern([A])], [pattern([B])]], [[random], [random]]);
  const result = tryApplyRule(localGame, incoming, before);
  let expectedRandom = before.random;
  const selected = [];
  for (let index = 0; index < 8; index++) {
    const draw = nextRandom(expectedRandom);
    selected.push(choices[Math.floor(draw.value * choices.length)]);
    expectedRandom = draw.state;
  }
  assertCell(result.state, [A, selected[4]], 0, 0);
  assertCell(result.state, [A, selected[6]], 1, 0);
  assertCell(result.state, [B, selected[3]], 0, 1);
  assertCell(result.state, [B, selected[7]], 1, 1);
  assert.deepEqual(result.state.random, expectedRandom);
});

test('unmatched rules return the unchanged state and do not queue commands', () => {
  const before = state();
  const incoming = rule([[pattern([B])]], undefined, { commands: [{ kind: CommandKind.Win }] });
  const result = tryApplyRule(game, incoming, before);
  assert.equal(result.changed, false);
  assert.equal(result.state, before);
  assert.deepEqual(result.state.commands.entries, []);
  assert.deepEqual(result.diagnostics, []);
});

test('a rule without replacements skips cell writes but queues commands with actual rule identity', () => {
  const before = state();
  const command = Object.freeze({ kind: CommandKind.Message, text: 'matched' });
  const incoming = rule(undefined, [[replacement({ randomObjects: [{ object: B, layer: 0 }] })]], { hasReplacements: false, commands: [command] });
  const result = tryApplyRule(game, incoming, before);
  assert.equal(result.changed, false);
  assertCell(result.state, [A]);
  assert.deepEqual(result.state.random, before.random);
  assert.equal(result.state.commands.entries[0].source, incoming);
  assert.equal(result.state.commands.entries[0].command, command);
  assert.equal(result.state.commands.message, 'matched');
});

test('unchanged matching replacements queue commands without counting commands as changes', () => {
  const incoming = rule(undefined, undefined, { commands: [{ kind: CommandKind.Win }] });
  const result = tryApplyRule(game, incoming, state());
  assert.equal(result.changed, false);
  assert.equal(result.state.commands.entries.length, 1);
  assert.equal(result.state.commands.entries[0].source, incoming);
});

test('commands queue after a matching invocation whose later tuples are rejected', () => {
  const incoming = rule([[pattern([A]), pattern([A])]], [[null, replacement({ removeObjects: new Set([A]) })]],
    { commands: [{ kind: CommandKind.Message, text: 'once' }, { kind: CommandKind.Again }] });
  const result = tryApplyRule(game, incoming, state([[[A], [A], [A]]]));
  assert.equal(result.state.commands.message, 'once');
  assert.equal(result.state.commands.entries.length, 2);
  for (const entry of result.state.commands.entries) assert.equal(entry.source, incoming);
  assertCell(result.state, [A], 2);
});

test('applyRuleAt does not queue commands', () => {
  const incoming = rule(undefined, [[replacement({ addObjects: new Set([C]) })]], { commands: [{ kind: CommandKind.Win }] });
  const result = applyRuleAt(game, incoming, state(), [match()], false);
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.commands, { entries: [], message: '' });
});

test('successive rules can consume earlier objects and movement intentions', () => {
  const firstRule = rule(undefined, [[replacement({ vacateLayers: new Set([0]), addObjects: new Set([B]), addMovements: [{ layer: 0, movement: Movement.Right }] })]]);
  const secondRule = rule([[pattern([B], { requiredMovements: [{ layer: 0, movement: Movement.Right }] })]],
    [[replacement({ removeObjects: new Set([B]), addObjects: new Set([C]), resetMovementLayers: new Set([0]) })]]);
  const first = tryApplyRule(game, firstRule, state());
  const second = tryApplyRule(game, secondRule, first.state);
  assertCell(first.state, [B]);
  assertCell(second.state, [C]);
  assert.deepEqual(movementSet(second.state), new Set());
  assert.deepEqual(second.state.createdObjects, new Set([B, C]));
  assert.deepEqual(second.state.destroyedObjects, new Set([A, B]));
});

test('execution preserves inputs and repeats deterministically', () => {
  const before = state([[[A, C], [B]]], {
    pendingMovements: [request(0, 0, 0, [Movement.Up])],
    rigidMarks: [{ ...request(1, 0, 1, allMovements), group: null }],
    bannedGroups: new Set([null, 2]), canMoveSounds: ['can'], cantMoveSounds: ['cant'],
  });
  const incoming = rule([[pattern([A]), pattern([B])]], [[
    replacement({ randomObjects: [{ object: D, layer: 1 }], vacateLayers: new Set([0]), resetMovementLayers: new Set([0]) }),
    replacement({ vacateLayers: new Set([0]), addObjects: new Set([A]), resetMovementLayers: new Set([0]),
      addMovements: [{ layer: 0, movement: Movement.Down }] }, { rigidLayers: new Set([0]) }),
  ]], { rigidGroup: 3, commands: [{ kind: CommandKind.Win }] });
  const snapshot = structuredClone({ before, incoming, game });
  const first = tryApplyRule(game, incoming, before);
  const second = tryApplyRule(game, incoming, before);
  assert.deepEqual({ before, incoming, game }, snapshot);
  assert.deepEqual(first, second);
  // A later step from the first result still leaves the input untouched.
  tryApplyRule(game, incoming, first.state);
  assert.deepEqual({ before, incoming, game }, snapshot);
});
