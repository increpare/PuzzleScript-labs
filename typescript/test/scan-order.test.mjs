import assert from 'node:assert/strict';
import test from 'node:test';
import { Direction } from '../build/model.js';

const rectangle = { width: 3, height: 2 };
const rows = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];
const columns = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]];
const coordinates = positions => [...positions].map(({ x, y }) => [x, y]);

test('row and column orders describe coordinates independently of cell storage', async () => {
  const order = await import('../build/scan-order.js');
  assert.deepEqual(coordinates(order.positionsByRow(rectangle)), rows);
  assert.deepEqual(coordinates(order.positionsByColumn(rectangle)), columns);
  assert.deepEqual(coordinates(order.positionsByRow({ width: 0, height: 2 })), []);
  assert.deepEqual(coordinates(order.positionsByColumn({ width: 3, height: 0 })), []);
});

test('oriented matching uses rows horizontally and InPlace, columns vertically', async () => {
  const { matchingPositions } = await import('../build/scan-order.js');
  for (const direction of [Direction.Left, Direction.Right, Direction.InPlace]) {
    assert.deepEqual(coordinates(matchingPositions(rectangle, direction)), rows);
  }
  for (const direction of [Direction.Up, Direction.Down]) {
    assert.deepEqual(coordinates(matchingPositions(rectangle, direction)), columns);
  }
});
