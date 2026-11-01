import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSource } from '../build/source-compiler.js';
import { ObjectSourceKind } from '../build/rule-object-sources.js';
import { movementSource } from './scenarios.mjs';

function compile(rules, legend = '') {
  const source = movementSource({ rules }).replace('C = Crate', 'C = Crate\n' + legend);
  return { source, result: compileSource(source) };
}

async function problemOf(result, code, kind) {
  const diagnostic = result.rawDiagnostics.find(issue => issue.code === code);
  assert.ok(diagnostic, code);
  assert.ok(diagnostic.problem, 'diagnostic carries structured rule facts');
  const { RuleProblemKind } = await import('../build/rule-problems.js');
  assert.equal(diagnostic.problem.kind, RuleProblemKind[kind]);
  return diagnostic.problem;
}

const textAt = (source, span) => source.slice(span.start.offset, span.end.offset);

test('row count errors retain both authored row lists and their counts', async () => {
  const { source, result } = compile('right [ Player ] [ Crate ] -> [ Player ]');
  const problem = await problemOf(result, 'unequal-rule-row-count', 'RowCountMismatch');
  assert.equal(problem.leftRowCount, 2);
  assert.equal(problem.rightRowCount, 1);
  assert.deepEqual(problem.leftRows.map(span => textAt(source, span)), ['[ Player ]', '[ Crate ]']);
  assert.deepEqual(problem.rightRows.map(span => textAt(source, span)), ['[ Player ]']);
});

test('cell count errors carry paired row spans independently of their legacy whole-line span', async () => {
  const { source, result } = compile('right [ Player | Crate ] -> [ Player ]');
  const problem = await problemOf(result, 'unequal-rule-cell-count', 'CellCountMismatch');
  assert.equal(problem.rowIndex, 0);
  assert.equal(problem.leftCellCount, 2);
  assert.equal(problem.rightCellCount, 1);
  assert.equal(textAt(source, problem.leftSpan), '[ Player | Crate ]');
  assert.equal(textAt(source, problem.rightSpan), '[ Player ]');
  const diagnostic = result.rawDiagnostics.find(issue => issue.problem === problem);
  assert.equal(textAt(source, diagnostic.span), 'right [ Player | Crate ] -> [ Player ]');
});

test('ambiguous property errors expose target and distinct source cells with authored locations', async () => {
  const { source, result } = compile('right [ Things | Things | Wall ] -> [ | | Things ]', 'Things = Player or Crate');
  const problem = await problemOf(result, 'ambiguous-rule-property', 'PropertyInference');
  assert.equal(problem.property, 'things');
  assert.deepEqual(problem.target.cell, { rowIndex: 0, cellIndex: 2 });
  assert.equal(textAt(source, problem.target.span), 'Things');
  assert.equal(problem.source.kind, ObjectSourceKind.Ambiguous);
  assert.deepEqual(problem.candidates.map(candidate => candidate.cell), [
    { rowIndex: 0, cellIndex: 0 }, { rowIndex: 0, cellIndex: 1 },
  ]);
  assert.deepEqual(problem.candidates.map(candidate => textAt(source, candidate.span)), ['Things', 'Things']);
});

test('a missing property source is explicit and has no invented candidate location', async () => {
  const { result } = compile('right [ Player | Wall ] -> [ Player | Things ]', 'Things = Player or Crate');
  const problem = await problemOf(result, 'ambiguous-rule-property', 'PropertyInference');
  assert.equal(problem.source.kind, ObjectSourceKind.Missing);
  assert.deepEqual(problem.candidates, []);
  assert.deepEqual(problem.target.cell, { rowIndex: 0, cellIndex: 1 });
});

test('movement errors retain entity-cell and family-event evidence as distinct collections', async () => {
  const { source, result } = compile('right [ horizontal Player | horizontal Player | Crate ] -> [ Player | Player | horizontal Player ]');
  const problem = await problemOf(result, 'ambiguous-rule-movement', 'MovementInference');
  assert.equal(problem.entityName, 'player');
  assert.deepEqual(problem.target.cell, { rowIndex: 0, cellIndex: 2 });
  assert.equal(textAt(source, problem.target.span), 'horizontal Player');
  assert.deepEqual(problem.entitySources.map(location => location.cell), [
    { rowIndex: 0, cellIndex: 0 }, { rowIndex: 0, cellIndex: 1 },
  ]);
  assert.deepEqual(problem.familySources.map(location => location.entityName), ['player', 'player']);
  assert.deepEqual(problem.familySources.map(location => textAt(source, location.span)), ['horizontal Player', 'horizontal Player']);
});

test('movement errors with no source report empty evidence collections', async () => {
  const { result } = compile('right [ Player ] -> [ horizontal Player ]');
  const problem = await problemOf(result, 'ambiguous-rule-movement', 'MovementInference');
  assert.deepEqual(problem.entitySources, []);
  assert.deepEqual(problem.familySources, []);
});

test('different entities in one cell remain separate family events for an unresolved movement', async () => {
  const { result } = compile('right [ horizontal Player horizontal Crate | Wall ] -> [ Player | horizontal Wall ]');
  const problem = await problemOf(result, 'ambiguous-rule-movement', 'MovementInference');
  assert.equal(problem.entityName, 'wall');
  assert.deepEqual(problem.entitySources, []);
  assert.deepEqual(problem.familySources.map(source => [source.entityName, source.cell]), [
    ['player', { rowIndex: 0, cellIndex: 0 }], ['crate', { rowIndex: 0, cellIndex: 0 }],
  ]);
});

test('repeated property terms supply one candidate per cell while retaining the last RHS target', async () => {
  const { source, result } = compile('right [ Things Things | Things | Wall ] -> [ | | Things Things ]', 'Things = Player or Crate');
  const problem = await problemOf(result, 'ambiguous-rule-property', 'PropertyInference');
  assert.deepEqual(problem.candidates.map(candidate => candidate.cell), [
    { rowIndex: 0, cellIndex: 0 }, { rowIndex: 0, cellIndex: 1 },
  ]);
  assert.equal(problem.target.span.start.offset, source.lastIndexOf('Things'));
});

test('oriented rule coordinates retain the original authored spans after row reversal', async () => {
  const { source, result } = compile('left [ Things | Things | Wall ] -> [ | | Things ]', 'Things = Player or Crate');
  const problem = await problemOf(result, 'ambiguous-rule-property', 'PropertyInference');
  assert.deepEqual(problem.target.cell, { rowIndex: 0, cellIndex: 0 });
  assert.equal(problem.target.span.start.offset, source.lastIndexOf('Things'));
  assert.deepEqual(problem.candidates.map(candidate => candidate.cell), [
    { rowIndex: 0, cellIndex: 1 }, { rowIndex: 0, cellIndex: 2 },
  ]);
  assert.ok(problem.candidates[0].span.start.offset > problem.candidates[1].span.start.offset);
});
