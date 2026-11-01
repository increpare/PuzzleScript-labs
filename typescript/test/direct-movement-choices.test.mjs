import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import { checkEarlyNegativeTerms } from '../build/rule-negatives.js';
import { orientRules } from '../build/rule-orientations.js';
import { expandRuleNames } from '../build/rule-names.js';
import { expandRuleMovements } from '../build/rule-movements.js';
import { RuleQualifier as Q } from '../build/source-rule-model.js';
import { movementSource } from './scenarios.mjs';

function expand(rules) {
  const { document } = readSource(movementSource({ rules }));
  const { declarations } = resolveDeclarations(document);
  const syntax = recoverRuleSyntax(document, declarations);
  const negatives = checkEarlyNegativeTerms(syntax.rules, declarations);
  const named = expandRuleNames(orientRules(negatives.rules), declarations);
  return expandRuleMovements(named.rules);
}

const choices = result => result.rules.map(rule => rule.lhs.flatMap(row => row.flatMap(cell => cell.map(term => term.qualifier))));

test('two movement cells produce four concrete assignments in surviving native order', () => {
  const result = expand('right [ horizontal Player | vertical Crate ] -> [ horizontal Player | vertical Crate ]');
  assert.equal(result.rules.length, 4);
  assert.deepEqual(choices(result), [
    [Q.Left, Q.Up], [Q.Right, Q.Up], [Q.Left, Q.Down], [Q.Right, Q.Down],
  ]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.abortsCompilation, false);
});

test('last bracket cells vary slowest while families within a cell retain term order', () => {
  const result = expand('right [ horizontal Player vertical Crate ] [ horizontal Wall ] -> [ horizontal Player vertical Crate ] [ horizontal Wall ]');
  assert.deepEqual(choices(result), [
    [Q.Left, Q.Up, Q.Left], [Q.Left, Q.Down, Q.Left],
    [Q.Right, Q.Up, Q.Left], [Q.Right, Q.Down, Q.Left],
    [Q.Left, Q.Up, Q.Right], [Q.Left, Q.Down, Q.Right],
    [Q.Right, Q.Up, Q.Right], [Q.Right, Q.Down, Q.Right],
  ]);
});
