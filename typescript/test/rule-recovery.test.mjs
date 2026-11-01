import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import { compileSourceRules, expandSourceRules } from '../build/source-rule-compiler.js';
import { compileSource, SourceCompilationKind, SourceCompilationFailureKind } from '../build/source-compiler.js';
import * as sourceTypes from '../build/source-model.js';
import { movementSource } from './scenarios.mjs';
const recovery = await import('../build/rule-recovery.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const problems = await import('../build/rule-problems.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const diagnostics = rule => rule.syntaxIssues.filter(issue => 'diagnostic' in issue).map(issue => issue.diagnostic);
function fixture(rules, legend = '') {
  const source = movementSource({ rules }).replace('. = Background', legend + '\n. = Background');
  const { document } = readSource(source);
  const { declarations } = resolveDeclarations(document);
  return { source, document, declarations };
}

for (const [line, decision, severity, cause] of [
  ['[ > up Missing Player ] -> [ Player ]', 'Keep', 'Error'],
  ['[ Player ] -> [ Player ] up', 'Keep', 'Warning'],
  ['[ Player ] ] -> [ Player ]', 'Discard', 'Warning', 'excess-closing-bracket'],
  ['[ Player ] ->', 'Discard', 'Warning', 'unequal-rule-row-count'],
  ['[ Player ] -> [ Player ] -> [ Player ]', 'Discard', 'Error', 'multiple-rule-arrows'],
  ['[ Player ] (cut) -> [ Player ]', 'Discard', 'Error', 'comment-before-arrow'],
  ['right [ Player | Crate ] -> [ Player ]', 'KeepForDiagnostics', 'Error', 'unequal-rule-cell-count'],
  ['random', 'Keep', 'Error'],
]) test('recovery is independent of severity: ' + line, () => {
  assert.equal(typeof recovery.RuleRecoveryKind?.[decision], 'number', 'explicit numeric recovery kind');
  const { document, declarations } = fixture(line + '\n+ [ Player ] -> [ Player ]');
  const rule = document.rules[0];
  assert.equal(rule.kind, sourceTypes.SourceRuleKind.Pattern);
  assert.equal(rule.recovery.kind, recovery.RuleRecoveryKind[decision]);
  assert.equal(Object.hasOwn(rule, 'retained'), false);
  assert.equal(Object.hasOwn(rule, 'abortsCompilation'), false);
  assert.ok(diagnostics(rule).some(issue => issue.severity === sourceTypes.SourceDiagnosticSeverity[severity]));
  assert.equal(document.lines[rule.span.start.line - 1].kind === sourceTypes.SourceLineKind.Invalid, severity === 'Error');
  if (decision === 'Discard') {
    assert.equal(rule.recovery.cause, diagnostics(rule).find(issue => issue.code === cause), 'discard points to the exact syntax issue');
    assert.ok(diagnostics(document.rules[1]).some(issue => issue.code === 'group-without-previous-rule'));
  } else {
    assert.equal(document.rules[1].sourceGroup, rule.sourceGroup, 'retained errors remain the group predecessor');
  }
  const syntax = recoverRuleSyntax(document, declarations);
  assert.equal(syntax.rules.some(entry => entry.source === rule), decision !== 'Discard');
  assert.deepEqual(syntax.blockingIssues, decision === 'KeepForDiagnostics' ? rule.recovery.causes : []);
  if (decision === 'KeepForDiagnostics') assert.equal(rule.recovery.causes[0], diagnostics(rule).find(issue => issue.code === cause));
});

test('shape payloads preserve authored row spans and each raw blocking cause despite recorded deduplication', () => {
  assert.equal(typeof problems.RuleProblemKind?.CellCountMismatch, 'number');
  const { source, document, declarations } = fixture('right [ Player | Crate ] [ Player | Crate ] -> [ Player ] [ Player ]');
  const rule = document.rules[0], issues = diagnostics(rule);
  assert.equal(issues.length, 2);
  assert.deepEqual(rule.recovery.causes, issues);
  for (let index = 0; index < 2; index++) {
    const issue = issues[index];
    assert.equal(rule.recovery.causes[index], issue);
    assert.deepEqual(issue.problem, { kind: problems.RuleProblemKind.CellCountMismatch, rowIndex: index,
      leftCellCount: 2, rightCellCount: 1, leftSpan: rule.lhs[index].span, rightSpan: rule.rhs[index].span });
    assert.equal(issue.problem.leftSpan, rule.lhs[index].span);
    assert.equal(issue.problem.rightSpan, rule.rhs[index].span);
    assert.equal(issue.span, rule.originalLine.span, 'legacy primary span stays whole-line');
  }
  const syntax = recoverRuleSyntax(document, declarations);
  assert.equal(syntax.blockingIssues[0], issues[0]);
  assert.equal(syntax.blockingIssues[1], issues[1]);
  const complete = compileSource(source);
  assert.equal(complete.outcome.kind, SourceCompilationKind.Invalid);
  assert.equal(complete.errorCount, 1, 'rich payload does not change diagnostic duplicate identity');
  assert.equal(complete.rawDiagnostics.filter(issue => issue.code === 'unequal-rule-cell-count').length, 2);
});

test('row-count discard carries row counts and exact authored row spans', () => {
  const { document } = fixture('[ Player ] [ Crate ] -> [ Player ]');
  const rule = document.rules[0];
  assert.deepEqual(rule.recovery.cause.problem, { kind: problems.RuleProblemKind.RowCountMismatch,
    leftRowCount: 2, rightRowCount: 1, leftRows: rule.lhs.map(row => row.span), rightRows: rule.rhs.map(row => row.span) });
  assert.equal(rule.recovery.cause.problem.leftRows[1], rule.lhs[1].span);
});

test('syntax failure exposes the aggregate checkpoint and the original syntax diagnostic causes', () => {
  const { source, document, declarations } = fixture('right [ Player | Crate ] -> [ Player ]');
  const cause = document.rules[0].recovery?.causes[0];
  const expanded = expandSourceRules(document, declarations);
  assert.equal(expanded.kind, recovery.RuleExpansionKind?.Blocked);
  assert.equal(Object.hasOwn(expanded, 'rules'), false);
  assert.deepEqual(expanded.failure, { checkpoint: recovery.RuleCompilationCheckpoint.AfterAggregateExpansion, causes: [cause] });
  assert.equal(expanded.failure.causes[0], cause);
  const result = compileSourceRules(document, declarations);
  assert.equal(result.data, null);
  assert.equal(result.failure.causes[0], cause);
  const complete = compileSource(source);
  assert.equal(complete.outcome.kind, SourceCompilationKind.Invalid);
  const failure = complete.outcome.failure;
  assert.deepEqual(Object.keys(failure).sort(), ['causes', 'checkpoint', 'kind']);
  assert.equal(failure.kind, SourceCompilationFailureKind.RuleCompilation);
  assert.equal(failure.checkpoint, recovery.RuleCompilationCheckpoint.AfterAggregateExpansion);
  assert.equal(failure.causes[0], complete.rawDiagnostics.find(issue => issue.code === 'unequal-rule-cell-count'));
});

test('empty selectors reach the final syntax checkpoint while errorful random syntax still compiles', () => {
  const { document, declarations } = fixture('right [ Player | Crate ] -> [ Player ]');
  const source = document.rules[0];
  const noSelectors = { ...document, rules: [{ ...source, directions: [] }] };
  const expanded = expandSourceRules(noSelectors, declarations);
  assert.equal(expanded.kind, recovery.RuleExpansionKind?.Blocked);
  assert.deepEqual(expanded.failure, { checkpoint: recovery.RuleCompilationCheckpoint.AfterPropertyInference, causes: source.recovery.causes });
  const random = fixture('random');
  const result = compileSourceRules(random.document, random.declarations);
  assert.notEqual(result.data, null);
  assert.deepEqual(Object.keys(result).sort(), ['data', 'diagnostics']);
});

test('movement failure causes exclude later property diagnostics', () => {
  const { document, declarations } = fixture('right [ random Things ] -> [ horizontal Things ]', 'Things = Player or Crate');
  const expanded = expandSourceRules(document, declarations);
  assert.equal(expanded.kind, recovery.RuleExpansionKind?.Blocked);
  assert.equal(expanded.failure.checkpoint, recovery.RuleCompilationCheckpoint.AfterPropertyInference);
  assert.ok(expanded.diagnostics.some(issue => issue.code === 'ambiguous-rule-property'));
  const movementIssues = expanded.diagnostics.filter(issue => issue.code === 'ambiguous-rule-movement');
  assert.ok(movementIssues.length > 0);
  assert.deepEqual(expanded.failure.causes, movementIssues);
  assert.equal(expanded.failure.causes[0], movementIssues[0]);
});
