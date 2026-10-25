import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, cloneBoard } from '../build/board.js';
import { Direction, Movement } from '../build/model.js';
import { resolveMovements } from '../build/movement.js';

const Player = { name: 'Player' };
const Crate = { name: 'Crate' };
const Wall = { name: 'Wall' };
const Background = { name: 'Background' };
const objects = { '@': Player, O: Crate, '#': Wall, _: Background };

function board(...rows) {
  return createBoard(rows.map(row => [...row].map(glyph => new Set(objects[glyph] ? [objects[glyph]] : []))));
}

function request(x, y, layer, ...movements) {
  return { position: { x, y }, layer, movements: new Set(movements) };
}

function mark(x, y, layer, group, ...movements) {
  return { ...request(x, y, layer, ...movements), group };
}

function game(overrides = {}) {
  return {
    collisionLayers: [[Player, Crate, Wall], [Background]],
    rigid: false,
    movementSounds: [[], []],
    failureSounds: [],
    ...overrides,
  };
}

function state(board, pendingMovements = [], overrides = {}) {
  return {
    board,
    pendingMovements,
    rigidMarks: [],
    bannedGroups: new Set(),
    canMoveSounds: [],
    cantMoveSounds: [],
    ...overrides,
  };
}

function sound(seed, object, layer, ...movements) {
  return { seed, objects: new Set([object]), layer, movements: new Set(movements) };
}

function view(board) {
  return board.rows.map(row => row.map(cell => [...cell.objects].map(object => object.name).sort()));
}

function assertBoard(actual, expected) {
  assert.deepEqual(view(actual), view(expected));
}

function assertCleared(result) {
  assert.deepEqual(result.pendingMovements, []);
  assert.deepEqual(result.rigidMarks, []);
}

test('directions and movements are named numeric enums', () => {
  assert.equal(typeof Direction.Up, 'number');
  assert.equal(Direction[Direction.Right], 'Right');
  assert.equal(typeof Movement.Action, 'number');
  assert.equal(Movement[Movement.Action], 'Action');
});

for (const [name, movement, x, y] of [
  ['up', Movement.Up, 1, 0],
  ['down', Movement.Down, 1, 2],
  ['left', Movement.Left, 0, 1],
  ['right', Movement.Right, 2, 1],
]) {
  test(`a free request moves ${name}`, () => {
    const result = resolveMovements(game(), state(board('...', '.@.', '...'), [request(1, 1, 0, movement)]));
    const expected = board('...', '...', '...');
    expected.rows[y][x].objects.add(Player);
    assertBoard(result.board, expected);
    assertCleared(result);
    assert.equal(result.retry, false);
  });

  test(`the ${name} board edge blocks movement`, () => {
    const initial = board('...', '...', '...');
    initial.rows[y][x].objects.add(Player);
    const result = resolveMovements(game(), state(initial, [request(x, y, 0, movement)]));
    assertBoard(result.board, initial);
    assertCleared(result);
  });
}

test('an occupied destination in the same layer blocks movement', () => {
  const result = resolveMovements(game(), state(board('@#'), [request(0, 0, 0, Movement.Right)]));
  assertBoard(result.board, board('@#'));
  assertCleared(result);
});

test('a chain settles after the front object frees the next cell', () => {
  const result = resolveMovements(game(), state(board('@O.'), [
    request(0, 0, 0, Movement.Right), request(1, 0, 0, Movement.Right),
  ]));
  assertBoard(result.board, board('.@O'));
  assertCleared(result);
});

test('the left-scanned contender wins an empty shared destination', () => {
  const result = resolveMovements(game(), state(board('@.O'), [
    request(2, 0, 0, Movement.Left), request(0, 0, 0, Movement.Right),
  ]));
  assertBoard(result.board, board('.@O'));
});

test('column order precedes row order when contenders meet', () => {
  const result = resolveMovements(game(), state(board('.O', '@.'), [
    request(1, 0, 0, Movement.Down), request(0, 1, 0, Movement.Right),
  ]));
  assertBoard(result.board, board('.O', '.@'));
});

test('an object can pass through an occupied separate collision layer', () => {
  const result = resolveMovements(game(), state(board('@_'), [request(0, 0, 0, Movement.Right)]));
  assert.deepEqual(view(result.board), [[[], ['Background', 'Player']]]);
});

test('all source objects in the requested layer move together', () => {
  const initial = createBoard([[new Set([Player, Crate, Background]), new Set()]]);
  const result = resolveMovements(game(), state(initial, [request(0, 0, 0, Movement.Right)]));
  assert.deepEqual(view(result.board), [[['Background'], ['Crate', 'Player']]]);
});

test('Action consumes its request while preserving occupied source cells', () => {
  const result = resolveMovements(game(), state(board('@'), [request(0, 0, 0, Movement.Action)]));
  assertBoard(result.board, board('@'));
  assertCleared(result);
});

test('an empty source layer can succeed and its intent is not carried to the target', () => {
  const result = resolveMovements(game({ rigid: true }), state(board('..@'), [
    request(0, 0, 0, Movement.Right), request(2, 0, 0, Movement.Left),
  ], { rigidMarks: [mark(0, 0, 0, 8, Movement.Right)] }));
  assertBoard(result.board, board('.@.'));
  assert.equal(result.retry, false);
  assert.deepEqual([...result.bannedGroups], []);
  assertCleared(result);
});

test('a vacant layer request at the edge still fails and can ban a rigid group', () => {
  const result = resolveMovements(game({ rigid: true }), state(board('.'), [request(0, 0, 0, Movement.Up)], {
    rigidMarks: [mark(0, 0, 0, 12, Movement.Up)],
  }));
  assert.equal(result.retry, true);
  assert.deepEqual([...result.bannedGroups], [12]);
});

test('a stationary board is returned as an independent copy', () => {
  const input = state(board('@_'), [], { rigidMarks: [mark(0, 0, 0, 4, Movement.Left)] });
  const result = resolveMovements(game({ rigid: true }), input);
  assertBoard(result.board, input.board);
  assert.notEqual(result.board, input.board);
  assert.notEqual(result.board.rows, input.board.rows);
  assert.notEqual(result.board.rows[0][0].objects, input.board.rows[0][0].objects);
  assertCleared(result);
  assert.equal(result.retry, false);
});

test('object declarations are compared by identity, even when names coincide', () => {
  const lookalike = { name: 'Player' };
  const initial = createBoard([[new Set([Player]), new Set([lookalike])]]);
  const result = resolveMovements(game(), state(initial, [request(0, 0, 0, Movement.Right)]));
  assert.equal(result.board.rows[0][1].objects.has(Player), true);
  assert.equal(result.board.rows[0][1].objects.has(lookalike), true);
  assert.equal(result.board.rows[0][0].objects.size, 0);
});

test('createBoard and cloneBoard copy cell sets while preserving declaration identity', () => {
  const input = [[new Set([Player])]];
  const first = createBoard(input);
  input[0][0].clear();
  assert.equal(first.rows[0][0].objects.has(Player), true);
  const second = cloneBoard(first);
  assert.notEqual(second.rows, first.rows);
  assert.notEqual(second.rows[0], first.rows[0]);
  assert.notEqual(second.rows[0][0], first.rows[0][0]);
  second.rows[0][0].objects.clear();
  assert.equal(first.rows[0][0].objects.has(Player), true);
});

test('createBoard rejects ragged rows instead of dropping cells beyond the declared width', () => {
  assert.throws(() => createBoard([[new Set()], [new Set(), new Set([Player])]]),
    /Board rows must all have the same width/);
});

test('input board, movements, rigid marks, bans and seed lists remain untouched', () => {
  const input = state(board('@..'), [request(0, 0, 0, Movement.Right)], {
    rigidMarks: [mark(0, 0, 0, 3, Movement.Right)],
    bannedGroups: new Set([7]), canMoveSounds: ['old-success'], cantMoveSounds: ['old-failure'],
  });
  const snapshot = structuredClone(input);
  const result = resolveMovements(game({ rigid: true }), input);
  assert.deepEqual(input, snapshot);
  result.board.rows[0][0].objects.add(Wall);
  result.bannedGroups.add(99);
  result.canMoveSounds.push('later');
  result.cantMoveSounds.push('later');
  result.pendingMovements.push(request(2, 0, 0, Movement.Up));
  result.rigidMarks.push(mark(2, 0, 0, 100, Movement.Up));
  assert.deepEqual(input, snapshot);
  assert.equal(result.board.rows[0][1].objects.has(Player), true);
});

test('a blocked rigid request bans its actual group index and requests a retry', () => {
  const result = resolveMovements(game({ rigid: true }), state(board('@#'), [request(0, 0, 0, Movement.Right)], {
    rigidMarks: [mark(0, 0, 0, 42, Movement.Right)], bannedGroups: new Set([9]),
  }));
  assert.deepEqual([...result.bannedGroups], [9, 42]);
  assert.equal(result.retry, true);
  assertCleared(result);
});

test('an already banned rigid group does not request another retry', () => {
  const result = resolveMovements(game({ rigid: true }), state(board('@#'), [request(0, 0, 0, Movement.Right)], {
    rigidMarks: [mark(0, 0, 0, 42, Movement.Right)], bannedGroups: new Set([42]),
  }));
  assert.deepEqual([...result.bannedGroups], [42]);
  assert.equal(result.retry, false);
});

test('only the first failing layer at a cell is banned, even if already banned', () => {
  const result = resolveMovements(game({ rigid: true }), state(board('@'), [
    request(0, 0, 0, Movement.Up), request(0, 0, 1, Movement.Left),
  ], {
    rigidMarks: [mark(0, 0, 1, 80, Movement.Left), mark(0, 0, 0, 40, Movement.Up)],
    bannedGroups: new Set([40]),
  }));
  assert.deepEqual([...result.bannedGroups], [40]);
  assert.equal(result.retry, false);
});

test('different blocked cells can each ban their first rigid layer in column order', () => {
  const result = resolveMovements(game({ rigid: true }), state(board('@O'), [
    request(1, 0, 0, Movement.Up), request(0, 0, 0, Movement.Up),
  ], { rigidMarks: [mark(1, 0, 0, 20, Movement.Up), mark(0, 0, 0, 10, Movement.Up)] }));
  assert.deepEqual([...result.bannedGroups], [10, 20]);
  assert.equal(result.retry, true);
});

test('rigid marks only ban a group when marked and remaining movements intersect', () => {
  const result = resolveMovements(game({ rigid: true }), state(board('@'), [request(0, 0, 0, Movement.Up)], {
    rigidMarks: [mark(0, 0, 0, 42, Movement.Left)],
  }));
  assert.deepEqual([...result.bannedGroups], []);
  assert.equal(result.retry, false);
});

test('non-rigid games ignore rigid marks while clearing them', () => {
  const result = resolveMovements(game(), state(board('@'), [request(0, 0, 0, Movement.Up)], {
    rigidMarks: [mark(0, 0, 0, 42, Movement.Up)],
  }));
  assert.equal(result.retry, false);
  assert.deepEqual([...result.bannedGroups], []);
  assertCleared(result);
});

test('successful sounds use configured order and retain globally deduplicated seed order', () => {
  const result = resolveMovements(game({ movementSounds: [[
    sound('existing', Player, 0, Movement.Right),
    sound('second', Player, 0, Movement.Right),
    sound('first', Player, 0, Movement.Right),
    sound('second', Crate, 0, Movement.Right),
    sound('absent-object', Wall, 0, Movement.Right),
    sound('wrong-direction', Player, 0, Movement.Left),
  ], []] }), state(board('@O.'), [request(0, 0, 0, Movement.Right), request(1, 0, 0, Movement.Right)], {
    canMoveSounds: ['existing'],
  }));
  assert.deepEqual(result.canMoveSounds, ['existing', 'second', 'first']);
  assert.deepEqual(result.cantMoveSounds, []);
});

test('successful sound matching sees all source objects and the cell movement snapshot', () => {
  const initial = createBoard([[new Set([Player, Background]), new Set()]]);
  const result = resolveMovements(game({ movementSounds: [[], [
    sound('earlier-intent', Background, 0, Movement.Right),
    sound('removed-object', Player, 1, Movement.Right),
  ]] }), state(initial, [request(0, 0, 0, Movement.Right), request(0, 0, 1, Movement.Right)]));
  assert.deepEqual(result.canMoveSounds, ['earlier-intent']);
});

test('an empty moving layer may emit a sound for another object in the source cell', () => {
  const result = resolveMovements(game({ movementSounds: [[sound('empty-layer', Background, 0, Movement.Right)], []] }),
    state(board('_.'), [request(0, 0, 0, Movement.Right)]));
  assert.deepEqual(result.canMoveSounds, ['empty-layer']);
  assertBoard(result.board, board('_.'));
});

test('failure sounds use remaining intents and preserve seed order without duplicates', () => {
  const result = resolveMovements(game({ failureSounds: [
    sound('existing', Player, 0, Movement.Right),
    sound('blocked', Player, 0, Movement.Right),
    sound('blocked', Player, 0, Movement.Right),
    sound('wrong-direction', Player, 0, Movement.Left),
  ] }), state(board('@#'), [request(0, 0, 0, Movement.Right)], { cantMoveSounds: ['existing'] }));
  assert.deepEqual(result.cantMoveSounds, ['existing', 'blocked']);
  assert.deepEqual(result.canMoveSounds, []);
});

test('nonempty rigid marks filter failure sounds even on unrelated layers', () => {
  const initial = createBoard([[new Set([Player, Background])]]);
  const result = resolveMovements(game({ rigid: true, failureSounds: [
    sound('marked', Player, 0, Movement.Up), sound('unmarked', Background, 1, Movement.Left),
  ] }), state(initial, [request(0, 0, 0, Movement.Up), request(0, 0, 1, Movement.Left)], {
    rigidMarks: [mark(0, 0, 0, 42, Movement.Up)],
  }));
  assert.deepEqual(result.cantMoveSounds, ['marked']);
});

test('a nonempty rigid mark with no intersection suppresses all failure sounds at the cell', () => {
  const result = resolveMovements(game({ rigid: true, failureSounds: [sound('blocked', Player, 0, Movement.Up)] }),
    state(board('@'), [request(0, 0, 0, Movement.Up)], { rigidMarks: [mark(0, 0, 0, 42, Movement.Left)] }));
  assert.deepEqual(result.cantMoveSounds, []);
});

test('empty rigid marks do not filter failure sounds', () => {
  const result = resolveMovements(game({ rigid: true, failureSounds: [sound('blocked', Player, 0, Movement.Up)] }),
    state(board('@'), [request(0, 0, 0, Movement.Up)], { rigidMarks: [mark(0, 0, 0, 42)] }));
  assert.deepEqual(result.cantMoveSounds, ['blocked']);
});

test('successful requests do not emit failure sounds or bans from leftover rigid marks', () => {
  const result = resolveMovements(game({ rigid: true, failureSounds: [sound('blocked', Player, 0, Movement.Right)] }),
    state(board('@.'), [request(0, 0, 0, Movement.Right)], { rigidMarks: [mark(0, 0, 0, 42, Movement.Right)] }));
  assert.deepEqual(result.cantMoveSounds, []);
  assert.deepEqual([...result.bannedGroups], []);
  assert.equal(result.retry, false);
});

for (const movements of [[Movement.Up, Movement.Down], [Movement.Up, Movement.Down, Movement.Left, Movement.Right]]) {
  test(`legacy zero-offset combination ${movements.map(m => Movement[m]).join('/')} is blocked by an occupied source layer`, () => {
    const result = resolveMovements(game({ rigid: true }), state(board('@'), [request(0, 0, 0, ...movements)], {
      rigidMarks: [mark(0, 0, 0, 17, ...movements)],
    }));
    assertBoard(result.board, board('@'));
    assert.equal(result.retry, true);
    assert.deepEqual([...result.bannedGroups], [17]);
  });

  test(`legacy zero-offset combination ${movements.map(m => Movement[m]).join('/')} succeeds on a vacant layer`, () => {
    const result = resolveMovements(game({ rigid: true }), state(board('_'), [request(0, 0, 0, ...movements)], {
      rigidMarks: [mark(0, 0, 0, 17, ...movements)],
    }));
    assertBoard(result.board, board('_'));
    assert.equal(result.retry, false);
    assert.deepEqual([...result.bannedGroups], []);
    assertCleared(result);
  });
}

test('unsupported movement combinations raise an explicit error', () => {
  assert.throws(() => resolveMovements(game(), state(board('@.'), [request(0, 0, 0, Movement.Up, Movement.Right)])),
    /Unsupported movement combination/);
});
