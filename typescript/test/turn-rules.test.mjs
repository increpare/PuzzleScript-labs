import test from 'node:test';
import { vanillaQuirks } from '../build/compatibility.js';
import assert from 'node:assert/strict';
import { createBoard } from '../build/board.js';
import { CommandKind } from '../build/commands.js';
import { ExecutionDiagnosticKind } from '../build/execution-model.js';
import { Direction, Movement } from '../build/model.js';
import { createRandom, nextRandom } from '../build/random.js';
import { PlayerMatchKind, startPlayerMovement, applyTurnRules } from '../build/turn-rules.js';

const Player = Object.freeze({ name: 'Player' });
const Partner = Object.freeze({ name: 'Partner' });
const Crate = Object.freeze({ name: 'Crate' });
const Wall = Object.freeze({ name: 'Wall' });
const Marker = Object.freeze({ name: 'Marker' });
const Other = Object.freeze({ name: 'Other' });

function schedule(groups = [], loops = []) { return { groups, loops: new Map(loops) }; }
function group(rules = [], random = false) { return { rules, random }; }
function game(overrides = {}) {
  return {
    collisionLayers: [[Player, Crate, Wall], [Partner], [Marker, Other]],
    player: { kind: PlayerMatchKind.Any, objects: new Set([Player, Partner]) },
    rigidMerges: new Map(), rigid: false, movementSounds: [[], [], []], failureSounds: [],
    earlyRules: schedule(), lateRules: schedule(), ...overrides,
  };
}
function state(rows = [[[Player]]], overrides = {}) {
  return {
    board: createBoard(rows.map(row => row.map(objects => new Set(objects)))),
    pendingMovements: [], rigidMarks: [], bannedGroups: new Set(), canMoveSounds: [], cantMoveSounds: [],
    random: createRandom('turn rules tests'), commands: { entries: [], message: '' },
    createdObjects: new Set(), destroyedObjects: new Set(), ...overrides,
  };
}
function request(x, y, layer, ...movements) {
  return { position: { x, y }, layer, movements: new Set(movements) };
}
function mark(x, y, layer, owner, ...movements) { return { ...request(x, y, layer, ...movements), group: owner }; }
function assertCell(actual, objects, x = 0, y = 0) {
  assert.deepEqual(actual.board.rows[y][x].objects, new Set(objects));
  for (const object of objects) assert.ok(actual.board.rows[y][x].objects.has(object));
}
function assertIndependent(actual, before) {
  assert.notEqual(actual, before);
  assert.notEqual(actual.board, before.board);
  assert.notEqual(actual.board.rows, before.board.rows);
  assert.notEqual(actual.board.rows[0], before.board.rows[0]);
  assert.notEqual(actual.board.rows[0][0], before.board.rows[0][0]);
  assert.notEqual(actual.board.rows[0][0].objects, before.board.rows[0][0].objects);
  assert.notEqual(actual.pendingMovements, before.pendingMovements);
  for (let index = 0; index < Math.min(actual.pendingMovements.length, before.pendingMovements.length); index++) {
    assert.notEqual(actual.pendingMovements[index], before.pendingMovements[index]);
    assert.notEqual(actual.pendingMovements[index].position, before.pendingMovements[index].position);
    assert.notEqual(actual.pendingMovements[index].movements, before.pendingMovements[index].movements);
  }
  assert.notEqual(actual.rigidMarks, before.rigidMarks);
  for (let index = 0; index < Math.min(actual.rigidMarks.length, before.rigidMarks.length); index++) {
    assert.notEqual(actual.rigidMarks[index], before.rigidMarks[index]);
    assert.notEqual(actual.rigidMarks[index].position, before.rigidMarks[index].position);
    assert.notEqual(actual.rigidMarks[index].movements, before.rigidMarks[index].movements);
  }
  assert.notEqual(actual.bannedGroups, before.bannedGroups);
  assert.notEqual(actual.canMoveSounds, before.canMoveSounds);
  assert.notEqual(actual.cantMoveSounds, before.cantMoveSounds);
  assert.notEqual(actual.random, before.random);
  assert.notEqual(actual.random.permutation, before.random.permutation);
  assert.notEqual(actual.commands, before.commands);
  assert.notEqual(actual.commands.entries, before.commands.entries);
  if (actual.commands.entries.length > 0 && before.commands.entries.length > 0) {
    assert.notEqual(actual.commands.entries[0], before.commands.entries[0]);
    assert.equal(actual.commands.entries[0].source, before.commands.entries[0].source);
    assert.equal(actual.commands.entries[0].command, before.commands.entries[0].command);
  }
  assert.notEqual(actual.createdObjects, before.createdObjects);
  assert.notEqual(actual.destroyedObjects, before.destroyedObjects);
}

test('player matching kinds are numeric enums', () => {
  assert.equal(typeof PlayerMatchKind.Any, 'number');
  assert.equal(PlayerMatchKind[PlayerMatchKind.All], 'All');
});

test('Never player selection keeps known members without selecting a cell or adding movement', () => {
  assert.equal(typeof PlayerMatchKind.Never, 'number');
  const before = state([[[Player, Partner]]], { pendingMovements: [request(0, 0, 2, Movement.Down)] });
  const result = startPlayerMovement(game({ player: { kind: PlayerMatchKind.Never, objects: new Set([Player, Partner]) } }), before, Movement.Right);
  assert.deepEqual(result.playerPositions, []);
  assert.deepEqual(result.state.pendingMovements, before.pendingMovements);
});

test('any-player cells are selected once in x-then-y order using actual present members', () => {
  const before = state([[[Player, Partner], [Player]], [[Partner], [Crate]]]);
  const result = startPlayerMovement(game(), before, Movement.Right);
  assert.deepEqual(result.playerPositions, [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }]);
  assert.deepEqual(result.state.pendingMovements, [
    request(0, 0, 0, Movement.Right), request(0, 0, 1, Movement.Right),
    request(0, 1, 1, Movement.Right), request(1, 0, 0, Movement.Right),
  ]);
  assertCell(before, [Player, Partner]);
});

test('all-player matching excludes partial aggregate cells and moves every present member layer', () => {
  const before = state([[[Player], [Player, Partner], [Partner]]]);
  const result = startPlayerMovement(game({ player: { kind: PlayerMatchKind.All, objects: new Set([Player, Partner]) } }),
    before, Movement.Left);
  assert.deepEqual(result.playerPositions, [{ x: 1, y: 0 }]);
  assert.deepEqual(result.state.pendingMovements, [request(1, 0, 0, Movement.Left), request(1, 0, 1, Movement.Left)]);
});

test('several actual player objects in one layer create one intent request', () => {
  const before = state([[[Player, Crate, Partner]]]);
  const result = startPlayerMovement(game({
    collisionLayers: [[Player, Crate, Partner]],
    player: { kind: PlayerMatchKind.All, objects: new Set([Player, Crate, Partner]) },
  }), before, Movement.Action);
  assert.deepEqual(result.playerPositions, [{ x: 0, y: 0 }]);
  assert.deepEqual(result.state.pendingMovements, [request(0, 0, 0, Movement.Action)]);
});

for (const input of [Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action]) {
  test(`player intent accepts ${Movement[input]}`, () => {
    const result = startPlayerMovement(game(), state(), input);
    assert.deepEqual(result.state.pendingMovements, [request(0, 0, 0, input)]);
  });
}

for (const [name, before, input] of [
  ['null input', state(), null], ['no players', state([[[Crate]]]), Movement.Right],
]) {
  test(`${name} selects no cells and preserves pending requests`, () => {
    const incoming = { ...before, pendingMovements: [request(0, 0, 2, Movement.Down)] };
    const result = startPlayerMovement(game(), incoming, input);
    assert.deepEqual(result.playerPositions, []);
    assert.deepEqual(result.state, incoming);
    assertIndependent(result.state, incoming);
  });
}

test('player input unions existing requests while preserving other values and canonical identities', () => {
  const source = { sourceLine: 9 };
  const command = { kind: CommandKind.Win };
  const before = state([[[Player, Partner], []]], {
    pendingMovements: [request(0, 0, 0, Movement.Up), request(0, 0, 2, Movement.Left), request(1, 0, 0, Movement.Down)],
    rigidMarks: [mark(0, 0, 0, 6, Movement.Up)], bannedGroups: new Set([7]),
    commands: { entries: [{ command, source }], message: 'keep' },
    createdObjects: new Set([Player]), destroyedObjects: new Set([Crate]),
    canMoveSounds: ['success'], cantMoveSounds: ['failure'],
  });
  const snapshot = structuredClone(before);
  const result = startPlayerMovement(game(), before, Movement.Right);
  assert.deepEqual(result.state.pendingMovements, [
    request(0, 0, 0, Movement.Up, Movement.Right), request(0, 0, 2, Movement.Left), request(1, 0, 0, Movement.Down),
    request(0, 0, 1, Movement.Right),
  ]);
  assertIndependent(result.state, before);
  assert.equal(result.state.commands.entries[0].source, source);
  assert.equal(result.state.commands.entries[0].command, command);
  assert.ok(result.state.createdObjects.has(Player));
  result.state.board.rows[0][0].objects.clear();
  result.state.pendingMovements[0].movements.clear();
  result.state.rigidMarks[0].movements.clear();
  result.state.random.permutation.reverse();
  result.state.commands.entries.pop();
  assert.deepEqual(before, snapshot);
});

function pattern(objects = [], overrides = {}) {
  return {
    requiredObjects: new Set(objects), forbiddenObjects: new Set(), anyObjects: [],
    requiredMovements: [], forbiddenMovements: [], ...overrides,
  };
}
function replacement(edits = {}, overrides = {}) {
  return {
    edits: {
      removeObjects: new Set(), addObjects: new Set(), vacateLayers: new Set(),
      removeMovements: [], addMovements: [], resetMovementLayers: new Set(),
      randomObjects: [], randomDirectionLayers: new Set(), ...edits,
    },
    rigidLayers: new Set(), ...overrides,
  };
}
function rule(rows = [[pattern([Player])]], replacements = [[replacement()]], overrides = {}) {
  return {
    direction: Direction.Right, rows, replacements, sourceLine: 12, hasReplacements: true,
    commands: [], rigidGroup: null, ...overrides,
  };
}
function blocked(owner, edits = {}, overrides = {}) {
  return rule(undefined, [[replacement({
    resetMovementLayers: new Set([0]), addMovements: [{ layer: 0, movement: Movement.Up }], ...edits,
  }, { rigidLayers: new Set([0]) })]], { rigidGroup: owner, ...overrides });
}
function sound(seed, object, layer, movement) {
  return { seed, objects: new Set([object]), layer, movements: new Set([movement]) };
}
function drawCount(random, count) {
  for (let index = 0; index < count; index++) random = nextRandom(random).state;
  return random;
}
function assertAttempts(result, attempts, rigidRetries, rigidLimitReached = false) {
  assert.equal(result.attempts, attempts);
  assert.equal(result.rigidRetries, rigidRetries);
  assert.equal(result.rigidLimitReached, rigidLimitReached);
}

test('input moves through an empty early schedule before late rules inspect the destination', () => {
  const late = rule(undefined, [[replacement({
    addObjects: new Set([Marker]), addMovements: [{ layer: 0, movement: Movement.Left }],
  })]], { commands: [{ kind: CommandKind.Win }] });
  const before = state([[[Player], []]]);
  const result = applyTurnRules(game({ lateRules: schedule([group([late])]) }), before, Movement.Right);
  assertCell(result.state, [], 0);
  assertCell(result.state, [Player, Marker], 1);
  assert.deepEqual(result.playerPositions, [{ x: 0, y: 0 }]);
  assert.deepEqual(result.state.pendingMovements, []);
  const historical = applyTurnRules(game({ quirks: { ...vanillaQuirks, lateMovementsCarryOver: true },
    lateRules: schedule([group([late])]) }), before, Movement.Right);
  assert.deepEqual(historical.state.pendingMovements, [request(1, 0, 0, Movement.Left)]);
  assert.equal(result.state.commands.entries[0].command.kind, CommandKind.Win);
  assert.equal(result.state.commands.entries[0].source, late);
  assert.deepEqual(result.state.createdObjects, new Set([Marker]));
  assertAttempts(result, 1, 0);
});

test('early rules see player input and push a crate before movement settles', () => {
  const push = rule([[pattern([Player], { requiredMovements: [{ layer: 0, movement: Movement.Right }] }), pattern([Crate])]],
    [[null, replacement({ addMovements: [{ layer: 0, movement: Movement.Right }] })]]);
  const before = state([[[Player], [Crate], []]]);
  const result = applyTurnRules(game({ earlyRules: schedule([group([push])]) }), before, Movement.Right);
  assertCell(result.state, [], 0);
  assertCell(result.state, [Player], 1);
  assertCell(result.state, [Crate], 2);
  assert.deepEqual(result.state.pendingMovements, []);
  assertAttempts(result, 1, 0);
});

test('null input still applies early rules and resolves preexisting intent without selecting players', () => {
  const add = rule([[pattern([Crate])]], [[replacement({ addObjects: new Set([Marker]) })]]);
  const before = state([[[Crate], []]], { pendingMovements: [request(0, 0, 0, Movement.Right)] });
  const result = applyTurnRules(game({ earlyRules: schedule([group([add])]) }), before, null);
  assert.deepEqual(result.playerPositions, []);
  assertCell(result.state, [Marker], 0);
  assertCell(result.state, [Crate], 1);
  assertAttempts(result, 1, 0);
});

test('turn start clears stale bans, command entries, events and sounds but retains message and RNG', () => {
  const add = rule(undefined, [[replacement({ addObjects: new Set([Marker]) })]]);
  const old = { kind: CommandKind.Cancel };
  const before = state(undefined, {
    bannedGroups: new Set([0, null]), commands: { entries: [{ command: old, source: add }], message: 'previous message' },
    createdObjects: new Set([Crate]), destroyedObjects: new Set([Other]),
    canMoveSounds: ['old success'], cantMoveSounds: ['old failure'],
  });
  const snapshot = structuredClone(before);
  const result = applyTurnRules(game({ earlyRules: schedule([group([add])]) }), before, null);
  assertCell(result.state, [Player, Marker]);
  assert.deepEqual(result.state.bannedGroups, new Set());
  assert.deepEqual(result.state.commands, { entries: [], message: 'previous message' });
  assert.deepEqual(result.state.createdObjects, new Set([Marker]));
  assert.deepEqual(result.state.destroyedObjects, new Set());
  assert.deepEqual(result.state.canMoveSounds, []);
  assert.deepEqual(result.state.cantMoveSounds, []);
  assert.deepEqual(result.state.random, before.random);
  assert.deepEqual(before, snapshot);
});

test('a rigid retry restores post-input intent and late group zero ignores early ban zero', () => {
  const early = blocked(0, { addObjects: new Set([Other]), removeObjects: new Set([Marker]) });
  const late = rule(undefined, [[replacement({ addObjects: new Set([Marker]) })]], { commands: [{ kind: CommandKind.Again }] });
  const result = applyTurnRules(game({ rigid: true, earlyRules: schedule([group([early])]), lateRules: schedule([group([late])]) }),
    state([[[Player, Marker], []]]), Movement.Right);
  assertAttempts(result, 2, 1);
  assert.deepEqual(result.state.bannedGroups, new Set([0]));
  assertCell(result.state, [Marker], 0);
  assertCell(result.state, [Player, Marker], 1);
  assert.deepEqual(result.state.createdObjects, new Set([Marker]));
  assert.deepEqual(result.state.destroyedObjects, new Set());
  assert.equal(result.state.commands.entries[0].source, late);
  assert.deepEqual(result.playerPositions, [{ x: 0, y: 0 }]);
});

test('rollback discards commands, events and success sounds while retaining advanced RNG and current message', () => {
  const early = blocked(0, {
    randomObjects: [{ object: Other, layer: 2 }],
    addMovements: [{ layer: 0, movement: Movement.Up }, { layer: 2, movement: Movement.Right }],
  }, { commands: [{ kind: CommandKind.Message, text: 'message from discarded attempt' }, { kind: CommandKind.Sound, index: 3 }] });
  const late = rule(undefined, [], { hasReplacements: false, commands: [{ kind: CommandKind.Checkpoint }] });
  const incoming = game({
    rigid: true, earlyRules: schedule([group([early])]), lateRules: schedule([group([late])]),
    movementSounds: [[sound('final success', Player, 0, Movement.Right)], [], [sound('discarded success', Other, 2, Movement.Right)]],
    failureSounds: [sound('rigid failure', Player, 0, Movement.Up)],
  });
  const before = state([[[Player, Marker], []]], { commands: { entries: [], message: 'original message' } });
  const result = applyTurnRules(incoming, before, Movement.Right);
  assertAttempts(result, 2, 1);
  assertCell(result.state, [Marker], 0);
  assertCell(result.state, [Player], 1);
  assert.deepEqual(result.state.createdObjects, new Set());
  assert.deepEqual(result.state.destroyedObjects, new Set());
  assert.deepEqual(result.state.canMoveSounds, ['final success']);
  assert.deepEqual(result.state.cantMoveSounds, ['rigid failure']);
  assert.deepEqual(result.state.commands.entries.map(entry => entry.command.kind), [CommandKind.Checkpoint]);
  assert.equal(result.state.commands.message, 'message from discarded attempt');
  assert.deepEqual(result.state.random, drawCount(before.random, 2));
});

test('different failed attempts accumulate failure sounds in first occurrence order', () => {
  const first = blocked(0, { addObjects: new Set([Marker]) });
  const second = rule([[pattern([Player], { forbiddenObjects: new Set([Marker]) })]], [[replacement({
    resetMovementLayers: new Set([0]), addMovements: [{ layer: 0, movement: Movement.Left }],
  }, { rigidLayers: new Set([0]) })]], { rigidGroup: 1 });
  const result = applyTurnRules(game({
    rigid: true, earlyRules: schedule([group([first]), group([second])]),
    failureSounds: [sound('up failure', Player, 0, Movement.Up), sound('left failure', Player, 0, Movement.Left)],
  }), state([[[Player], []]]), Movement.Right);
  assertAttempts(result, 3, 2);
  assert.deepEqual(result.state.cantMoveSounds, ['up failure', 'left failure']);
  assert.deepEqual(result.state.bannedGroups, new Set([0, 1]));
  assertCell(result.state, [], 0);
  assertCell(result.state, [Player], 1);
});

test('null rigid provenance bans null once, restores its mark and settles on the next attempt', () => {
  const before = state(undefined, {
    pendingMovements: [request(0, 0, 0, Movement.Up)],
    rigidMarks: [mark(0, 0, 0, null, Movement.Up)],
  });
  const result = applyTurnRules(game({ rigid: true }), before, null);
  assertAttempts(result, 2, 1);
  assert.deepEqual(result.state.bannedGroups, new Set([null]));
  assert.deepEqual(result.state.pendingMovements, []);
  assert.deepEqual(result.state.rigidMarks, []);
  assertCell(result.state, [Player]);
});

test('a failed fiftieth attempt restores board, input and rigid marks and skips late rules', () => {
  const late = rule(undefined, [], { hasReplacements: false, commands: [{ kind: CommandKind.Win }] });
  const groups = Array.from({ length: 50 }, (_, owner) => group([blocked(owner, {
    removeObjects: new Set([Marker]), addObjects: new Set([Other]),
  })]));
  const before = state([[[Player, Marker], []]], { rigidMarks: [mark(1, 0, 2, 77, Movement.Action)] });
  const result = applyTurnRules(game({ rigid: true, earlyRules: schedule(groups), lateRules: schedule([group([late])]) }), before, Movement.Right);
  assertAttempts(result, 50, 50, true);
  assertCell(result.state, [Player, Marker], 0);
  assertCell(result.state, [], 1);
  assert.deepEqual(result.state.pendingMovements, [request(0, 0, 0, Movement.Right)]);
  assert.deepEqual(result.state.rigidMarks, before.rigidMarks);
  assert.deepEqual(result.state.bannedGroups, new Set(Array.from({ length: 50 }, (_, index) => index)));
  assert.deepEqual(result.state.commands.entries, []);
  assert.deepEqual(result.state.createdObjects, new Set());
  assert.deepEqual(result.state.destroyedObjects, new Set());
  assert.deepEqual(result.state.canMoveSounds, []);
});

test('a successful fiftieth attempt still reports the boundary and runs late rules', () => {
  const late = rule(undefined, [], { hasReplacements: false, commands: [{ kind: CommandKind.Win }] });
  const groups = Array.from({ length: 49 }, (_, owner) => group([blocked(owner)]));
  const result = applyTurnRules(game({ rigid: true, earlyRules: schedule(groups), lateRules: schedule([group([late])]) }),
    state([[[Player], []]]), Movement.Right);
  assertAttempts(result, 50, 49, true);
  assertCell(result.state, [], 0);
  assertCell(result.state, [Player], 1);
  assert.deepEqual(result.state.pendingMovements, []);
  assert.deepEqual(result.state.rigidMarks, []);
  assert.deepEqual(result.state.bannedGroups, new Set(Array.from({ length: 49 }, (_, index) => index)));
  assert.equal(result.state.commands.entries[0].source, late);
});

test('scheduler diagnostics retain attempt order, including discarded early work and final late work', () => {
  function oscillating(line) {
    return group([
      rule([[pattern([Marker])]], [[replacement({ removeObjects: new Set([Marker]), addObjects: new Set([Other]) })]], { sourceLine: line }),
      rule([[pattern([Other])]], [[replacement({ removeObjects: new Set([Other]), addObjects: new Set([Marker]) })]]),
    ]);
  }
  const result = applyTurnRules(game({
    rigid: true, earlyRules: schedule([oscillating(31), group([blocked(1)])]), lateRules: schedule([oscillating(42)]),
  }), state([[[Player, Marker], []]]), Movement.Right);
  assertAttempts(result, 2, 1);
  assert.deepEqual(result.diagnostics, [
    { kind: ExecutionDiagnosticKind.GroupIterationLimit, sourceLine: 31 },
    { kind: ExecutionDiagnosticKind.GroupIterationLimit, sourceLine: 31 },
    { kind: ExecutionDiagnosticKind.GroupIterationLimit, sourceLine: 42 },
  ]);
});

test('historical research turns own independent carried movements and preserve input, game and rule identities', () => {
  const early = blocked(0);
  const late = rule(undefined, [[replacement({ addObjects: new Set([Marker]), addMovements: [{ layer: 0, movement: Movement.Left }] })]],
    { commands: [{ kind: CommandKind.Message, text: 'late message' }] });
  const incoming = game({ rigid: true, quirks: { ...vanillaQuirks, lateMovementsCarryOver: true },
    earlyRules: schedule([group([early])]), lateRules: schedule([group([late])]) });
  const before = state([[[Player], []]]);
  const beforeSnapshot = structuredClone(before);
  const gameSnapshot = structuredClone(incoming);
  const first = applyTurnRules(incoming, before, Movement.Right);
  const second = applyTurnRules(incoming, before, Movement.Right);
  assert.deepEqual(first, second);
  assertIndependent(first.state, before);
  assertIndependent(second.state, first.state);
  assert.notEqual(first.playerPositions, second.playerPositions);
  assert.notEqual(first.playerPositions[0], second.playerPositions[0]);
  assert.notEqual(first.diagnostics, second.diagnostics);
  assert.equal(first.state.commands.entries[0].source, late);
  assert.equal(first.state.commands.entries[0].command, late.commands[0]);
  first.playerPositions[0].x = 99;
  first.state.board.rows[0][1].objects.clear();
  first.state.pendingMovements[0].movements.clear();
  first.state.bannedGroups.clear();
  first.state.createdObjects.clear();
  first.state.commands.entries.pop();
  first.state.random.permutation.reverse();
  assertCell(second.state, [Player, Marker], 1);
  assert.deepEqual(second.state.pendingMovements, [request(1, 0, 0, Movement.Left)]);
  assert.deepEqual(second.state.bannedGroups, new Set([0]));
  assert.deepEqual(before, beforeSnapshot);
  assert.deepEqual(incoming, gameSnapshot);
});
