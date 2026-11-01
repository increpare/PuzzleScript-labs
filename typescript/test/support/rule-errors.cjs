'use strict';
const assert = require('node:assert/strict');

const fields = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'exact rule evidence fields');
const count = value => assert.ok(Number.isInteger(value) && value >= 0, 'nonnegative rule evidence count');
function checkSpan(document, span) {
  fields(span, ['start', 'end']);
  assert.ok(span.start.offset <= span.end.offset, 'rule evidence span order');
  for (const position of [span.start, span.end]) {
    fields(position, ['offset', 'line', 'column']);
    const line = document.lines[position.line - 1];
    assert.ok(line && position.column >= 1 && position.column <= line.original.length + 1, 'rule evidence span bounds');
    assert.equal(position.offset, line.span.start.offset + position.column - 1, 'rule evidence span offsets');
  }
}
function checkCell(cell, rows) {
  fields(cell, ['rowIndex', 'cellIndex']);
  count(cell.rowIndex); count(cell.cellIndex);
  assert.ok(rows[cell.rowIndex]?.cells[cell.cellIndex], 'rule evidence cell bounds');
}
function checkLocation(document, location, rows, entity = false) {
  fields(location, entity ? ['cell', 'span', 'entityName'] : ['cell', 'span']);
  checkCell(location.cell, rows); checkSpan(document, location.span);
  assert.ok(rows.flatMap(row => row.cells.flatMap(cell => cell.terms))
    .some(term => term.span.start.offset === location.span.start.offset && term.span.end.offset === location.span.end.offset),
  'rule inference evidence is an authored term');
  if (entity) assert.equal(typeof location.entityName, 'string');
}
function checkRuleProblem(document, issue) {
  const problem = issue.problem;
  const codes = ['unequal-rule-row-count', 'unequal-rule-cell-count', 'ambiguous-rule-property', 'ambiguous-rule-movement'];
  if (!codes.includes(issue.code)) { assert.equal(Object.hasOwn(issue, 'problem'), false, 'other diagnostics have no generic context'); return; }
  assert.ok(problem, 'structured rule problem is required');
  const rule = document.rules.find(rule => 'lhs' in rule && rule.originalLine.span.start.line === issue.span?.start.line);
  assert.ok(rule, 'rule problem has an authored owner');
  assert.equal(problem.kind, codes.indexOf(issue.code), 'finite rule problem kind agrees with code');
  switch (problem.kind) {
    case 0:
      fields(problem, ['kind', 'leftRowCount', 'rightRowCount', 'leftRows', 'rightRows']);
      assert.equal(problem.leftRowCount, rule.lhs.length); assert.equal(problem.rightRowCount, rule.rhs.length);
      assert.deepEqual(problem.leftRows, rule.lhs.map(row => row.span));
      assert.deepEqual(problem.rightRows, rule.rhs.map(row => row.span));
      [...problem.leftRows, ...problem.rightRows].forEach(span => checkSpan(document, span));
      break;
    case 1:
      fields(problem, ['kind', 'rowIndex', 'leftCellCount', 'rightCellCount', 'leftSpan', 'rightSpan']);
      count(problem.rowIndex);
      assert.equal(problem.leftCellCount, rule.lhs[problem.rowIndex].cells.length);
      assert.equal(problem.rightCellCount, rule.rhs[problem.rowIndex].cells.length);
      assert.deepEqual(problem.leftSpan, rule.lhs[problem.rowIndex].span);
      assert.deepEqual(problem.rightSpan, rule.rhs[problem.rowIndex].span);
      checkSpan(document, problem.leftSpan); checkSpan(document, problem.rightSpan);
      break;
    case 2:
      fields(problem, ['kind', 'property', 'target', 'source', 'candidates']);
      assert.equal(typeof problem.property, 'string');
      checkLocation(document, problem.target, rule.rhs);
      problem.candidates.forEach(location => checkLocation(document, location, rule.lhs));
      switch (problem.source.kind) {
        case 0: fields(problem.source, ['kind', 'cell']); checkCell(problem.source.cell, rule.lhs); break;
        case 1: fields(problem.source, ['kind']); break;
        case 2: fields(problem.source, ['kind', 'cells']); problem.source.cells.forEach(cell => checkCell(cell, rule.lhs)); break;
        default: assert.fail('finite object source kind');
      }
      break;
    case 3:
      fields(problem, ['kind', 'entityName', 'family', 'target', 'entitySources', 'familySources']);
      assert.equal(typeof problem.entityName, 'string');
      assert.ok([10, 11, 12, 13, 20, 21, 22, 23].includes(problem.family), 'finite movement family');
      checkLocation(document, problem.target, rule.rhs);
      problem.entitySources.forEach(location => checkLocation(document, location, rule.lhs));
      problem.familySources.forEach(location => checkLocation(document, location, rule.lhs, true));
      break;
    default: assert.fail('finite rule problem kind');
  }
}
function checkRuleRecovery(document, rule) {
  if (!('lhs' in rule)) return;
  const issues = rule.syntaxIssues.filter(issue => 'diagnostic' in issue).map(issue => issue.diagnostic);
  issues.forEach(issue => checkRuleProblem(document, issue));
  assert.equal(rule.kind, 0, 'one structural Pattern kind');
  assert.equal(Object.hasOwn(rule, 'retained'), false); assert.equal(Object.hasOwn(rule, 'abortsCompilation'), false);
  switch (rule.recovery.kind) {
    case 0: fields(rule.recovery, ['kind']); break;
    case 1:
      fields(rule.recovery, ['kind', 'cause']); assert.ok(issues.includes(rule.recovery.cause), 'discard cause is the authored diagnostic'); break;
    case 2:
      fields(rule.recovery, ['kind', 'causes']); assert.ok(rule.recovery.causes.length > 0);
      assert.deepEqual(rule.recovery.causes, issues.filter(issue => issue.code === 'unequal-rule-cell-count'));
      rule.recovery.causes.forEach(issue => assert.ok(issues.includes(issue), 'blocking cause is the authored diagnostic'));
      break;
    default: assert.fail('finite recovery kind');
  }
}
function checkRuleFailure(document, failure, diagnostics, complete = false) {
  fields(failure, complete ? ['kind', 'checkpoint', 'causes'] : ['checkpoint', 'causes']);
  if (complete) assert.equal(failure.kind, 1, 'complete rule compilation failure kind');
  assert.ok([0, 1].includes(failure.checkpoint), 'finite compilation checkpoint');
  assert.ok(failure.causes.length > 0, 'failure requires diagnostic causes');
  failure.causes.forEach(issue => {
    assert.ok(diagnostics.includes(issue), 'failure keeps original diagnostic objects');
    assert.ok(['unequal-rule-cell-count', 'ambiguous-rule-movement'].includes(issue.code), 'failure cause blocks rule expansion');
    checkRuleProblem(document, issue);
  });
  if (failure.checkpoint === 0) assert.ok(failure.causes.every(issue => issue.code === 'unequal-rule-cell-count'));
}
module.exports = { checkRuleProblem, checkRuleRecovery, checkRuleFailure };
