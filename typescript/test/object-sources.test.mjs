import assert from 'node:assert/strict';
import test from 'node:test';

const sources = await import('../build/rule-object-sources.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const { ObjectSourceKind, sameRuleCell, resolveObjectSource } = sources;

test('object sources expose the pure cell-address API', () => {
  assert.equal(typeof sameRuleCell, 'function', 'sameRuleCell API must exist');
  assert.equal(typeof resolveObjectSource, 'function', 'resolveObjectSource API must exist');
  assert.equal(typeof ObjectSourceKind.Resolved, 'number');
  assert.equal(typeof ObjectSourceKind.Missing, 'number');
  assert.equal(typeof ObjectSourceKind.Ambiguous, 'number');
});

test('cell addresses match only when both row and cell indices agree', () => {
  assert.equal(sameRuleCell({ rowIndex: 1, cellIndex: 2 }, { rowIndex: 1, cellIndex: 2 }), true);
  assert.equal(sameRuleCell({ rowIndex: 1, cellIndex: 2 }, { rowIndex: 0, cellIndex: 2 }), false);
  assert.equal(sameRuleCell({ rowIndex: 1, cellIndex: 2 }, { rowIndex: 1, cellIndex: 0 }), false);
});

test('a corresponding LHS cell takes priority over multiple remote sources', () => {
  const local = { rowIndex: 1, cellIndex: 2 };
  const candidates = [{ rowIndex: 0, cellIndex: 0 }, local, { rowIndex: 2, cellIndex: 0 }];
  assert.deepEqual(resolveObjectSource(candidates, { rowIndex: 1, cellIndex: 2 }), {
    kind: ObjectSourceKind.Resolved, cell: local,
  });
});

test('one remote source resolves when the corresponding cell is absent', () => {
  const remote = { rowIndex: 0, cellIndex: 1 };
  assert.deepEqual(resolveObjectSource([remote], { rowIndex: 2, cellIndex: 3 }), {
    kind: ObjectSourceKind.Resolved, cell: remote,
  });
});

test('no source cells produces a missing result', () => {
  assert.deepEqual(resolveObjectSource([], { rowIndex: 0, cellIndex: 0 }), {
    kind: ObjectSourceKind.Missing,
  });
});

test('several remote sources remain ambiguous in first-occurrence order', () => {
  const first = { rowIndex: 2, cellIndex: 1 };
  const second = { rowIndex: 0, cellIndex: 3 };
  const third = { rowIndex: 1, cellIndex: 0 };
  assert.deepEqual(resolveObjectSource([first, second, first, third, { ...second }],
    { rowIndex: 3, cellIndex: 0 }), {
    kind: ObjectSourceKind.Ambiguous, cells: [first, second, third],
  });
});

test('duplicate term addresses count as one source cell', () => {
  const cell = { rowIndex: 0, cellIndex: 1 };
  assert.deepEqual(resolveObjectSource([cell, { ...cell }, cell], { rowIndex: 1, cellIndex: 0 }), {
    kind: ObjectSourceKind.Resolved, cell,
  });
});

test('the same cell index in different rows names distinct sources', () => {
  const candidates = [{ rowIndex: 0, cellIndex: 1 }, { rowIndex: 1, cellIndex: 1 }];
  assert.deepEqual(resolveObjectSource(candidates, { rowIndex: 2, cellIndex: 1 }), {
    kind: ObjectSourceKind.Ambiguous, cells: candidates,
  });
});

test('different cell indices in the same row name distinct sources', () => {
  const candidates = [{ rowIndex: 0, cellIndex: 1 }, { rowIndex: 0, cellIndex: 2 }];
  assert.deepEqual(resolveObjectSource(candidates, { rowIndex: 0, cellIndex: 3 }), {
    kind: ObjectSourceKind.Ambiguous, cells: candidates,
  });
});

test('resolution leaves frozen candidates and target unchanged', () => {
  const first = Object.freeze({ rowIndex: 2, cellIndex: 1 });
  const second = Object.freeze({ rowIndex: 0, cellIndex: 0 });
  const duplicate = Object.freeze({ ...first });
  const candidates = Object.freeze([first, second, duplicate]);
  const target = Object.freeze({ rowIndex: 1, cellIndex: 0 });
  assert.deepEqual(resolveObjectSource(candidates, target), {
    kind: ObjectSourceKind.Ambiguous, cells: [first, second],
  });
  assert.deepEqual(candidates, [first, second, duplicate]);
  assert.deepEqual(target, { rowIndex: 1, cellIndex: 0 });
  assert.deepEqual(resolveObjectSource(candidates, second), {
    kind: ObjectSourceKind.Resolved, cell: second,
  });
});
