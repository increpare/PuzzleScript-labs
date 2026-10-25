import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Movement } from '../build/model.js';
import { createRandom, nextRandom } from '../build/random.js';
import { applyCellEdits } from '../build/replacement.js';

const A = { name: 'A' };
const B = { name: 'B' };
const C = { name: 'C' };
const D = { name: 'D' };
const layers = [[A, B], [C, D]];

function movement(layer, direction) {
  return { layer, movement: direction };
}

function cell(objects = [], movements = []) {
  return { objects: new Set(objects), movements };
}

function edits(overrides = {}) {
  return {
    removeObjects: new Set(), addObjects: new Set(), vacateLayers: new Set(),
    removeMovements: [], addMovements: [], resetMovementLayers: new Set(),
    randomObjects: [], randomDirectionLayers: new Set(),
    ...overrides,
  };
}

function canonical(movements) {
  return [...movements].sort((a, b) => a.layer - b.layer || a.movement - b.movement);
}

function assertCell(actual, objects, movements = []) {
  assert.deepEqual(actual.objects, new Set(objects));
  assert.deepEqual(canonical(actual.movements), canonical(movements));
}

function drawCount(before, count) {
  let state = before;
  for (let i = 0; i < count; i++) state = nextRandom(state).state;
  return state;
}

test('removing named objects preserves other occupants and their movement intents', () => {
  const before = cell([A, B, C], [movement(0, Movement.Action), movement(1, Movement.Right)]);
  const random = createRandom('removal');
  const result = applyCellEdits(layers, edits({ removeObjects: new Set([A]) }), before, random);
  assertCell(result.cell, [B, C], before.movements);
  assert.deepEqual(result.created, new Set());
  assert.deepEqual(result.destroyed, new Set([A]));
  assert.equal(result.changed, true);
  assert.equal(result.random, random);
});

test('object additions win both named removals and layer vacancies', () => {
  const result = applyCellEdits(layers, edits({
    removeObjects: new Set([B, D]), addObjects: new Set([B, D]), vacateLayers: new Set([0]),
  }), cell([A, B, C]), createRandom('additions win'));
  assertCell(result.cell, [B, C, D]);
  assert.deepEqual(result.created, new Set([D]));
  assert.deepEqual(result.destroyed, new Set([A]));
  assert.equal(result.changed, true);
});

test('movement additions win individual removals and full layer resets', () => {
  const result = applyCellEdits(layers, edits({
    removeMovements: [movement(1, Movement.Down)],
    resetMovementLayers: new Set([0]),
    addMovements: [movement(0, Movement.Up), movement(0, Movement.Left), movement(1, Movement.Down)],
  }), cell([A, C], [
    movement(0, Movement.Up), movement(0, Movement.Right), movement(0, Movement.Action), movement(1, Movement.Down),
  ]), createRandom('movement additions win'));
  assertCell(result.cell, [A, C], [movement(0, Movement.Up), movement(0, Movement.Left), movement(1, Movement.Down)]);
  assert.equal(result.changed, true);
});

test('movement pairs form a set while several directions and action can coexist on a layer', () => {
  const up = movement(0, Movement.Up);
  const result = applyCellEdits(layers, edits({
    addMovements: [up, up, movement(0, Movement.Left), movement(0, Movement.Action)],
  }), cell([A], [up, up, movement(1, Movement.Up)]), createRandom('movement sets'));
  assertCell(result.cell, [A], [up, movement(0, Movement.Left), movement(0, Movement.Action), movement(1, Movement.Up)]);
  assert.equal(result.changed, true);
});

test('a random object vacates its layer but retains every deterministic addition there', () => {
  const initial = createRandom('one object');
  const result = applyCellEdits(layers, edits({
    addObjects: new Set([B]), randomObjects: [{ object: A, layer: 0 }],
    addMovements: [movement(0, Movement.Action)],
  }), cell([B, C], [movement(0, Movement.Right), movement(1, Movement.Left)]), initial);
  assertCell(result.cell, [A, B, C], [movement(0, Movement.Action), movement(1, Movement.Left)]);
  assert.deepEqual(result.created, new Set([A]));
  assert.deepEqual(result.destroyed, new Set());
  assert.deepEqual(result.random, drawCount(initial, 1));
});

test('random objects use the supplied candidate order and draw before random directions', () => {
  const initial = createRandom('Example');
  const result = applyCellEdits(layers, edits({
    // First draw is 0.234861..., so the first of these three entries wins.
    randomObjects: [{ object: C, layer: 1 }, { object: B, layer: 0 }, { object: A, layer: 0 }],
    randomDirectionLayers: new Set([1, 0]),
  }), cell([A, D], [movement(1, Movement.Action)]), initial);
  // Following draws are 0.797279... (right) and 0.703274... (left).
  assertCell(result.cell, [A, C], [movement(0, Movement.Right), movement(1, Movement.Left)]);
  assert.deepEqual(result.created, new Set([C]));
  assert.deepEqual(result.destroyed, new Set([D]));
  assert.deepEqual(result.random, drawCount(initial, 3));
});

test('random direction draws visit layers in ascending order regardless of Set insertion', () => {
  const initial = createRandom('Example');
  const result = applyCellEdits(Array.from({ length: 10 }, () => []), edits({
    randomDirectionLayers: new Set([9, 2, 5]),
  }), cell(), initial);
  assertCell(result.cell, [], [movement(2, Movement.Up), movement(5, Movement.Right), movement(9, Movement.Left)]);
  assert.deepEqual(result.random, drawCount(initial, 3));
  assert.equal(result.changed, true);
});

test('random directions union with deterministic movement additions after a reset', () => {
  const result = applyCellEdits(layers, edits({
    resetMovementLayers: new Set([0]), randomDirectionLayers: new Set([0]),
    addMovements: [movement(0, Movement.Action), movement(0, Movement.Left)],
  }), cell([A], [movement(0, Movement.Down)]), createRandom('Example'));
  assertCell(result.cell, [A], [movement(0, Movement.Up), movement(0, Movement.Left), movement(0, Movement.Action)]);
  assert.equal(result.changed, true);
});

test('a valid stream rounding uniform to one selects the legacy Action boundary', () => {
  // These seven swaps each read output slot 250, yielding seven 255 bytes.
  const permutation = new Array(256);
  let j = 0;
  for (let k = 1; k <= 7; k++) {
    const a = k + 9;
    j += a;
    permutation[k] = a;
    permutation[j] = 250 - a;
  }
  permutation[250] = 255;
  const used = new Set(permutation.filter(value => value !== undefined));
  let unused = 0;
  for (let index = 0; index < permutation.length; index++) {
    if (permutation[index] !== undefined) continue;
    while (used.has(unused)) unused++;
    permutation[index] = unused;
    used.add(unused);
  }
  assert.deepEqual([...permutation].sort((a, b) => a - b), Array.from({ length: 256 }, (_, index) => index));
  const initial = { seed: 'uniform boundary', i: 0, j: 0, permutation };
  const snapshot = structuredClone(initial);
  const LegacyRandom = runInNewContext(readFileSync(new URL('./vanilla/js/rng.js', import.meta.url), 'utf8') + '\nRNG;');
  const legacy = new LegacyRandom(initial.seed);
  legacy._state.s = [...permutation];
  legacy._state.i = initial.i;
  legacy._state.j = initial.j;
  assert.equal(legacy.uniform(), 1);
  const draw = nextRandom(initial);
  assert.equal(draw.value, 1);

  const result = applyCellEdits(layers, edits({ randomDirectionLayers: new Set([0]) }), cell([A]), initial);
  assertCell(result.cell, [A], [movement(0, Movement.Action)]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.random, draw.state);
  assert.equal(result.random.i, legacy._state.i);
  assert.equal(result.random.j, legacy._state.j);
  assert.deepEqual(result.random.permutation, legacy._state.s);
  assert.deepEqual(initial, snapshot);
});

test('an unchanged random spawn still consumes exactly one draw for its single candidate', () => {
  const initial = createRandom('single no-op');
  const result = applyCellEdits(layers, edits({ randomObjects: [{ object: A, layer: 0 }] }), cell([A]), initial);
  assertCell(result.cell, [A]);
  assert.equal(result.changed, false);
  assert.deepEqual(result.created, new Set());
  assert.deepEqual(result.destroyed, new Set());
  assert.deepEqual(result.random, drawCount(initial, 1));
  assert.notEqual(result.random, initial);
});

test('an unchanged random direction consumes a draw without creating or destroying objects', () => {
  const initial = createRandom('Example');
  const result = applyCellEdits(layers, edits({ randomDirectionLayers: new Set([0]) }), cell([A], [movement(0, Movement.Up)]), initial);
  assertCell(result.cell, [A], [movement(0, Movement.Up)]);
  assert.equal(result.changed, false);
  assert.deepEqual(result.created, new Set());
  assert.deepEqual(result.destroyed, new Set());
  assert.deepEqual(result.random, drawCount(initial, 1));
});

test('object identity distinguishes equal names for editing and creation or destruction', () => {
  const lookalike = { name: A.name };
  const result = applyCellEdits(layers, edits({
    removeObjects: new Set([A]), addObjects: new Set([lookalike]), vacateLayers: new Set([0]),
  }), cell([A]), createRandom('identity'));
  assertCell(result.cell, [lookalike]);
  assert.deepEqual(result.created, new Set([lookalike]));
  assert.deepEqual(result.destroyed, new Set([A]));
  assert.equal(result.cell.objects.has(A), false);
  assert.equal(result.cell.objects.has(lookalike), true);
  assert.equal(result.created.has(A), false);
  assert.equal(result.created.has(lookalike), true);
  assert.equal(result.destroyed.has(A), true);
  assert.equal(result.destroyed.has(lookalike), false);
  assert.equal(result.changed, true);
});

test('redundant edits and movement ordering or duplicates do not count as a change', () => {
  const before = cell([A], [movement(0, Movement.Right), movement(0, Movement.Up), movement(0, Movement.Up)]);
  const result = applyCellEdits(layers, edits({
    removeObjects: new Set([B]), addObjects: new Set([A]),
    removeMovements: [movement(1, Movement.Action)], addMovements: [movement(0, Movement.Right)],
  }), before, createRandom('redundant edits'));
  assertCell(result.cell, [A], [movement(0, Movement.Up), movement(0, Movement.Right)]);
  assert.equal(result.changed, false);
  assert.deepEqual(result.created, new Set());
  assert.deepEqual(result.destroyed, new Set());
});

test('even a no-op returns independent cell containers and movement entries', () => {
  const before = cell([A], [movement(0, Movement.Up)]);
  const initial = createRandom('no-op snapshot');
  const result = applyCellEdits(layers, edits(), before, initial);
  assert.notEqual(result.cell, before);
  assert.notEqual(result.cell.objects, before.objects);
  assert.notEqual(result.cell.movements, before.movements);
  assert.notEqual(result.cell.movements[0], before.movements[0]);
  assertCell(result.cell, [A], before.movements);
  assert.equal(result.changed, false);
  assert.equal(result.random, initial);
});

test('transactions preserve all input snapshots and repeated results do not share mutable containers', () => {
  const initial = createRandom('immutable snapshots');
  const before = cell([A, C], [movement(0, Movement.Right), movement(1, Movement.Action)]);
  const changes = edits({
    removeObjects: new Set([A]), addObjects: new Set([B]), vacateLayers: new Set([1]),
    removeMovements: [movement(0, Movement.Right)], addMovements: [movement(0, Movement.Down)],
    resetMovementLayers: new Set([1]), randomObjects: [{ object: D, layer: 1 }],
    randomDirectionLayers: new Set([1]),
  });
  const snapshot = structuredClone({ layers, before, changes, initial });
  Object.freeze(initial.permutation);
  Object.freeze(initial);
  Object.freeze(before.movements[0]);
  Object.freeze(before.movements[1]);
  Object.freeze(before.movements);
  Object.freeze(before);
  const first = applyCellEdits(layers, changes, before, initial);
  const second = applyCellEdits(layers, changes, before, initial);
  assert.deepEqual({ layers, before, changes, initial }, snapshot);
  assert.deepEqual(first, second);
  const secondSnapshot = structuredClone(second);
  first.cell.objects.clear();
  first.cell.movements[0].layer = 99;
  first.cell.movements.push(movement(99, Movement.Up));
  first.created.clear();
  first.destroyed.clear();
  first.random.permutation.reverse();
  assert.deepEqual(second, secondSnapshot);
  assert.deepEqual(second.created, new Set([B, D]));
  assert.deepEqual(second.destroyed, new Set([A, C]));
  assert.deepEqual({ layers, before, changes, initial }, snapshot);
  assert.deepEqual(second.random, drawCount(initial, 2));
});
