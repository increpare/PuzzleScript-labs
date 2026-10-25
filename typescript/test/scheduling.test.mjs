import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../build/board.js';
import { CommandKind } from '../build/commands.js';
import { ExecutionDiagnosticKind } from '../build/execution-model.js';
import { Direction } from '../build/model.js';
import { createRandom, nextRandom } from '../build/random.js';
import { applyRuleGroup, applyRules } from '../build/scheduling.js';

const A = Object.freeze({ name: 'A' });
const B = Object.freeze({ name: 'B' });
const C = Object.freeze({ name: 'C' });
const D = Object.freeze({ name: 'D' });
const E = Object.freeze({ name: 'E' });
const game = { collisionLayers: [[A, B], [C], [D], [E]], rigidMerges: new Map() };

function pattern(objects = [], overrides = {}) {
  return {
    requiredObjects: new Set(objects), forbiddenObjects: new Set(), anyObjects: [],
    requiredMovements: [], forbiddenMovements: [],
    ...overrides,
  };
}

function replacement(changes = {}) {
  return {
    edits: {
      removeObjects: new Set(), addObjects: new Set(), vacateLayers: new Set(),
      removeMovements: [], addMovements: [], resetMovementLayers: new Set(),
      randomObjects: [], randomDirectionLayers: new Set(),
      ...changes,
    },
    rigidLayers: new Set(),
  };
}

function rule(rows = [[pattern([A])]], replacements = [[replacement()]], overrides = {}) {
  return {
    direction: Direction.Right, rows, sourceLine: 12, hasReplacements: true, replacements,
    commands: [], rigidGroup: null, ...overrides,
  };
}

function change(from, to, overrides = {}) {
  return rule([[pattern([from])]], [[replacement({ removeObjects: new Set([from]), addObjects: new Set([to]) })]], overrides);
}

function group(rules = [], random = false) { return { rules, random }; }
function schedule(groups = [], loops = []) { return { groups, loops: new Map(loops) }; }

function state(rows = [[[A]]], overrides = {}) {
  return {
    board: createBoard(rows.map(row => row.map(objects => new Set(objects)))),
    pendingMovements: [], rigidMarks: [], bannedGroups: new Set(), canMoveSounds: [], cantMoveSounds: [],
    random: createRandom('scheduling tests'), commands: { entries: [], message: '' },
    createdObjects: new Set(), destroyedObjects: new Set(), ...overrides,
  };
}

function assertCell(actual, objects, x = 0, y = 0) {
  assert.deepEqual(actual.board.rows[y][x].objects, new Set(objects));
  for (const object of objects) assert.ok(actual.board.rows[y][x].objects.has(object));
}

function drawCount(random, count) {
  for (let index = 0; index < count; index++) random = nextRandom(random).state;
  return random;
}

function seedForIndex(index, count) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const random = createRandom(`candidate ${attempt}`);
    if (Math.floor(nextRandom(random).value * count) === index) return random;
  }
  throw new Error(`No seed for candidate ${index} of ${count}`);
}

function assertIndependent(result, before) {
  assert.notEqual(result.state, before);
  assert.notEqual(result.state.board, before.board);
  assert.notEqual(result.state.board.rows[0][0].objects, before.board.rows[0][0].objects);
  assert.notEqual(result.state.random, before.random);
  assert.notEqual(result.state.random.permutation, before.random.permutation);
  assert.notEqual(result.state.commands.entries, before.commands.entries);
  assert.notEqual(result.state.bannedGroups, before.bannedGroups);
  assert.notEqual(result.state.createdObjects, before.createdObjects);
  assert.notEqual(result.state.destroyedObjects, before.destroyedObjects);
}

test('missing and empty groups return independent unchanged snapshots', () => {
  const before = state();
  for (const incoming of [undefined, group(), group([], true)]) {
    const result = applyRuleGroup(game, incoming, before);
    assert.equal(result.changed, false);
    assert.deepEqual(result.state, before);
    assert.deepEqual(result.diagnostics, []);
    assertIndependent(result, before);
  }
});

test('deterministic groups repeat in source order for newly enabled earlier rules', () => {
  const before = state();
  const marker = rule([[pattern([C])]], [[replacement({ randomObjects: [{ object: C, layer: 1 }] })]]);
  const result = applyRuleGroup(game, group([change(B, C), change(A, B), marker]), before);
  assertCell(result.state, [C]);
  assert.equal(result.changed, true);
  // The marker runs on the changing pass and on the final unchanged pass.
  assert.deepEqual(result.state.random, drawCount(before.random, 2));
  assert.deepEqual(result.diagnostics, []);
  assertCell(before, [A]);
});

test('an unchanged matching rule retains random draws and queues commands once', () => {
  const before = state();
  const incoming = rule(undefined, [[replacement({ randomObjects: [{ object: A, layer: 0 }] })]],
    { commands: [{ kind: CommandKind.Message, text: 'matched' }] });
  const result = applyRuleGroup(game, group([incoming]), before);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state.random, drawCount(before.random, 1));
  assert.equal(result.state.commands.message, 'matched');
  assert.equal(result.state.commands.entries.length, 1);
  assert.equal(result.state.commands.entries[0].source, incoming);
  assert.deepEqual(before.commands.entries, []);
});

test('deterministic command-only rules run even though they make no changes', () => {
  const incoming = rule(undefined, [], { hasReplacements: false, commands: [{ kind: CommandKind.Win }] });
  const before = state();
  const result = applyRuleGroup(game, group([incoming]), before);
  assert.equal(result.changed, false);
  assert.equal(result.state.commands.entries[0].source, incoming);
  assert.deepEqual(result.state.random, before.random);
});

for (const [width, reachesLimit] of [[199, false], [200, true], [201, true]]) {
  test(`group pass limit preserves the postincrement boundary at width ${width}`, () => {
    const before = state([[ [A], ...Array.from({ length: width - 1 }, () => []) ]]);
    const grow = rule([[pattern([A]), pattern([], { forbiddenObjects: new Set([A]) })]],
      [[null, replacement({ addObjects: new Set([A]) })]], { sourceLine: 41 });
    const result = applyRuleGroup(game, group([grow]), before);
    assert.equal(result.changed, true);
    assert.ok(result.state.board.rows[0].every(cell => cell.objects.has(A)));
    assert.deepEqual(result.diagnostics, reachesLimit
      ? [{ kind: ExecutionDiagnosticKind.GroupIterationLimit, sourceLine: 41 }] : []);
  });
}

test('a continuously changing group applies exactly 200 passes', () => {
  const before = state();
  const marker = rule(undefined, [[replacement({ randomObjects: [{ object: A, layer: 0 }] })]]);
  const result = applyRuleGroup(game, group([change(A, B, { sourceLine: 71 }), change(B, A), marker]), before);
  assertCell(result.state, [A]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.random, drawCount(before.random, 200));
  assert.deepEqual(result.diagnostics, [{ kind: ExecutionDiagnosticKind.GroupIterationLimit, sourceLine: 71 }]);
});

for (let selected = 0; selected < 6; selected++) {
  test(`random groups enumerate all rules and two-row tuples in source order: candidate ${selected}`, () => {
    const before = state([[[A], [A]], [[B], [B]]], { random: seedForIndex(selected, 6) });
    const unmatched = rule([[pattern([E])]], [], { hasReplacements: false, commands: [{ kind: CommandKind.Cancel }] });
    const multirow = rule([[pattern([A])], [pattern([B])]],
      [[replacement({ addObjects: new Set([C]) })], [replacement({ addObjects: new Set([D]) })]],
      { commands: [{ kind: CommandKind.Message, text: 'two rows' }] });
    const single = rule([[pattern([A])]], [[replacement({ addObjects: new Set([E]) })]],
      { commands: [{ kind: CommandKind.Message, text: 'one row' }] });
    const result = applyRuleGroup(game, group([unmatched, multirow, single], true), before);
    assert.equal(result.changed, true);
    assert.deepEqual(result.state.random, drawCount(before.random, 1));
    assert.deepEqual(result.diagnostics, []);
    for (let x = 0; x < 2; x++) {
      assertCell(result.state, selected < 4 && x === selected % 2 ? [A, C]
        : selected >= 4 && x === selected - 4 ? [A, E] : [A], x, 0);
      assertCell(result.state, selected < 4 && x === Math.floor(selected / 2) ? [B, D] : [B], x, 1);
    }
    assert.equal(result.state.commands.entries.length, 1);
    assert.equal(result.state.commands.entries[0].source, selected < 4 ? multirow : single);
  });
}

for (let selected = 0; selected < 8; selected++) {
  test(`random groups preserve first-row-fastest order for three rows: candidate ${selected}`, () => {
    const before = state([[[A], [A]], [[B], [B]], [[C], [C]]], { random: seedForIndex(selected, 8) });
    const incoming = rule([[pattern([A])], [pattern([B])], [pattern([C])]],
      [[replacement({ addObjects: new Set([D]) })], [replacement({ addObjects: new Set([D]) })], [replacement({ addObjects: new Set([D]) })]]);
    const result = applyRuleGroup(game, group([incoming], true), before);
    for (let row = 0; row < 3; row++) {
      for (let x = 0; x < 2; x++) {
        const object = [A, B, C][row];
        assertCell(result.state, x === Math.floor(selected / 2 ** row) % 2 ? [object, D] : [object], x, row);
      }
    }
    assert.deepEqual(result.state.random, drawCount(before.random, 1));
  });
}

test('one-candidate random groups draw once before applying a replacement choice', () => {
  const before = state();
  const incoming = rule(undefined, [[replacement({ randomObjects: [{ object: A, layer: 0 }] })]]);
  const result = applyRuleGroup(game, group([incoming], true), before);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state.random, drawCount(before.random, 2));
  assertIndependent(result, before);
});

test('random command-only groups select one actual rule and queue its commands', () => {
  const before = state();
  const incoming = rule(undefined, [], { hasReplacements: false, commands: [{ kind: CommandKind.Checkpoint }] });
  const result = applyRuleGroup(game, group([incoming], true), before);
  assert.equal(result.changed, false);
  assert.equal(result.state.commands.entries.length, 1);
  assert.equal(result.state.commands.entries[0].source, incoming);
  assert.deepEqual(result.state.random, drawCount(before.random, 1));
});

test('unmatched random groups make no draws and queue no commands', () => {
  const before = state();
  const incoming = change(B, C, { commands: [{ kind: CommandKind.Win }] });
  const result = applyRuleGroup(game, group([incoming], true), before);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, before);
  assert.deepEqual(result.diagnostics, []);
  assertIndependent(result, before);
});

test('a uniform draw rounded to one rejects the invalid random candidate index', () => {
  const before = state(undefined, { random: { seed: 'boundary', i: 0, j: 0, permutation: Array(256).fill(255) } });
  assert.equal(nextRandom(before.random).value, 1);
  assert.throws(() => applyRuleGroup(game, group([rule()], true), before), /random.*(candidate|index)|candidate.*index/i);
  assertCell(before, [A]);
});

test('empty schedules return independent unchanged snapshots', () => {
  const before = state();
  const result = applyRules(game, schedule(), before);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, before);
  assert.deepEqual(result.diagnostics, []);
  assertIndependent(result, before);
});

test('schedules use actual source group indices for bans and ignore the null ban', () => {
  const before = state(undefined, { bannedGroups: new Set([0, 2, null]) });
  const matched = change(A, C, { commands: [{ kind: CommandKind.Win }] });
  const result = applyRules(game, schedule([group([change(A, B)]), group([matched]), group([change(C, D)])]), before);
  assertCell(result.state, [C]);
  assert.equal(result.changed, true);
  assert.equal(result.state.commands.entries[0].source, matched);
  assert.deepEqual(result.state.bannedGroups, before.bannedGroups);
  assertCell(before, [A]);
});

for (const endpoint of ['middle', 'end']) {
  test(`a ${endpoint} loop retains earlier changes through unchanged and banned groups`, () => {
    const before = state(undefined, { bannedGroups: new Set([2]) });
    const groups = [group([change(B, C)]), group([change(A, B)]), group([change(B, E)]), group()];
    const loops = [[endpoint === 'middle' ? 3 : 4, 0]];
    if (endpoint === 'middle') groups.push(group([change(C, D)]));
    const result = applyRules(game, schedule(groups, loops), before);
    assertCell(result.state, endpoint === 'middle' ? [D] : [C]);
    assert.equal(result.changed, true);
    assert.deepEqual(result.diagnostics, []);
  });
}

test('schedules report any group change even when later groups restore the board', () => {
  const before = state();
  const result = applyRules(game, schedule([group([change(A, B)]), group([change(B, A)])]), before);
  assert.equal(result.changed, true);
  assertCell(result.state, [A]);
  assert.deepEqual(result.state.createdObjects, new Set([A, B]));
  assert.deepEqual(result.state.destroyedObjects, new Set([A, B]));
});

for (const endpoint of [1, 2]) {
  test(`loop endpoint ${endpoint} escapes only after jump 201 and reports the target source line`, () => {
    const before = state();
    const first = change(B, A, { sourceLine: 111 });
    const second = rule([[pattern([A])]], [[replacement({ randomObjects: [{ object: B, layer: 0 }] })]], { sourceLine: 222 });
    const result = applyRules(game, schedule([group([first]), group([second])], [[endpoint, 0]]), before);
    assertCell(result.state, [B]);
    assert.equal(result.changed, true);
    assert.deepEqual(result.state.random, drawCount(before.random, 201));
    assert.deepEqual(result.diagnostics, [{ kind: ExecutionDiagnosticKind.LoopIterationLimit, sourceLine: 111 }]);
  });
}

test('a schedule may jump exactly 200 times before settling without a loop diagnostic', () => {
  const before = state([[ [A], ...Array.from({ length: 199 }, () => []) ]]);
  const fill = rule([[pattern([A]), pattern([], { forbiddenObjects: new Set([A, B]) })]],
    [[null, replacement({ addObjects: new Set([B]) })]]);
  const result = applyRules(game, schedule([group([change(B, A)]), group([fill])], [[2, 0]]), before);
  assert.ok(result.state.board.rows[0].every(cell => cell.objects.has(A)));
  assert.deepEqual(result.diagnostics, []);
});

test('group diagnostics accumulate in source order across a schedule', () => {
  const first = group([change(A, B, { sourceLine: 31 }), change(B, A)]);
  const second = group([change(A, C, { sourceLine: 42 }), change(C, A)]);
  const result = applyRules(game, schedule([first, second]), state());
  assert.deepEqual(result.diagnostics, [
    { kind: ExecutionDiagnosticKind.GroupIterationLimit, sourceLine: 31 },
    { kind: ExecutionDiagnosticKind.GroupIterationLimit, sourceLine: 42 },
  ]);
});

for (const target of [-1, 1, 0.5]) {
  test(`an encountered invalid loop target ${target} raises a clear error`, () => {
    const before = state();
    assert.throws(() => applyRules(game, schedule([group([change(A, B)])], [[0, target]]), before), /loop.*target|target.*loop/i);
    assertCell(before, [A]);
  });
}

test('separate schedule invocations preserve inputs and own independent snapshots', () => {
  const before = state();
  const snapshot = structuredClone(before);
  const incoming = schedule([group([change(A, B)])]);
  const first = applyRules(game, incoming, before);
  const second = applyRules(game, incoming, before);
  assert.deepEqual(first, second);
  assertIndependent(first, before);
  assertIndependent(second, first.state);
  first.state.board.rows[0][0].objects.clear();
  first.state.random.permutation.reverse();
  first.state.bannedGroups.add(8);
  first.state.createdObjects.clear();
  assertCell(second.state, [B]);
  assert.deepEqual(before, snapshot);
});
