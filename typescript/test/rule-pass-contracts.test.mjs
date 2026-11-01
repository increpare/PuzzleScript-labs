import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import { checkEarlyNegativeTerms } from '../build/rule-negatives.js';
import { orientRule, orientRules } from '../build/rule-orientations.js';
import { expandRuleNames } from '../build/rule-names.js';
import { expandRuleMovements } from '../build/rule-movements.js';
import { expandRuleProperties } from '../build/rule-properties.js';
import { inferSpawnedStationary } from '../build/rule-spawns.js';
import { normalizeRuleDuplicates } from '../build/rule-duplicates.js';
import { lowerRules } from '../build/rule-lowering.js';
import { Direction } from '../build/model.js';
import { RuleQualifier as Q } from '../build/source-rule-model.js';
import { movementSource } from './scenarios.mjs';

function prepare(rules, legend = '', layers = 'Player, Crate, Wall') {
  const source = movementSource({ rules }).replace('C = Crate', 'C = Crate\n' + legend)
    .replace('Player, Crate, Wall', layers);
  const { document } = readSource(source);
  const { declarations } = resolveDeclarations(document);
  const syntax = recoverRuleSyntax(document, declarations);
  const negatives = checkEarlyNegativeTerms(syntax.rules, declarations);
  const names = expandRuleNames(orientRules(negatives.rules), declarations);
  return { document, declarations, syntax, names: names.rules };
}
const terms = rule => [...rule.lhs, ...rule.rhs].flatMap(row => row.flatMap(cell => cell));
const atomic = new Set([Q.Unspecified, Q.Up, Q.Down, Q.Left, Q.Right, Q.Action, Q.Stationary,
  Q.No, Q.RandomObject, Q.RandomDirection, Q.Ellipsis]);

test('successful movement expansion remains atomic through property, spawn, duplicate and lowering passes', () => {
  const { declarations, names } = prepare('right [ horizontal Things ] -> [ horizontal Things Background ]',
    'Things = Player or Crate');
  const movements = expandRuleMovements(names);
  assert.equal(movements.abortsCompilation, false);
  assert.deepEqual(movements.rules.map(rule => rule.lhs[0][0][0].qualifier), [Q.Left, Q.Right]);
  assert.ok(movements.rules.every(rule => terms(rule).every(term => atomic.has(term.qualifier))));
  const properties = expandRuleProperties(movements.rules, declarations);
  assert.deepEqual(properties.diagnostics, []);
  const spawned = inferSpawnedStationary(properties.rules, declarations);
  assert.ok(spawned.every(rule => rule.rhs[0][0][1].qualifier === Q.Stationary));
  assert.ok(spawned.every(rule => terms(rule).every(term => atomic.has(term.qualifier))));
  const normalized = normalizeRuleDuplicates(spawned);
  normalized.forEach(rule => assert.ok(spawned.includes(rule), 'duplicate filtering returns original records'));
  const lowered = lowerRules(normalized, declarations);
  assert.equal(lowered.rules.length, 2);
  lowered.rules.forEach((rule, index) => assert.equal(rule.namedRule, normalized[index]));
  for (const rule of spawned) {
    assert.equal(rule.source, names[0].source);
    assert.equal(rule.commands, names[0].commands);
    assert.equal(rule.lhs[0][0][0].origin, names[0].lhs[0][0][0].origin);
  }
});

test('invalid movement output retains unresolved families while property diagnostics still run', () => {
  const { declarations, names } = prepare('right [ Player ] -> [ horizontal Crate ]\nright [ random Things ] -> [ Things ]',
    'Things = Player or Crate');
  const movements = expandRuleMovements(names);
  assert.equal(movements.abortsCompilation, true);
  assert.deepEqual(movements.diagnostics.map(issue => issue.code), ['ambiguous-rule-movement']);
  assert.equal(movements.rules.length, 2);
  assert.equal(movements.rules[0].rhs[0][0][0].qualifier, Q.Horizontal);
  const properties = expandRuleProperties(movements.rules, declarations);
  assert.deepEqual(properties.diagnostics.map(issue => issue.code), ['ambiguous-rule-property']);
  assert.equal(properties.rules.length, 1);
  assert.equal(properties.rules[0].rhs[0][0][0].qualifier, Q.Horizontal);
  const spawned = inferSpawnedStationary(properties.rules, declarations);
  assert.equal(spawned[0].rhs[0][0][0].qualifier, Q.Horizontal);
  assert.equal(spawned[0].rhs[0][0][0].origin, names[0].rhs[0][0][0].origin);
});

test('lowering fails on impossible family or relative qualifiers instead of silently requesting no movement', () => {
  const { declarations, names } = prepare('right [ Player ] -> [ Player ]');
  for (const qualifier of [Q.Horizontal, Q.HorizontalParallel, Q.Forward]) {
    for (const side of ['lhs', 'rhs']) {
      const rule = { ...names[0], [side]: [[[{ ...names[0][side][0][0][0], qualifier }]]] };
      assert.throws(() => lowerRules([rule], declarations), /unsupported.*qualifier/iu);
    }
  }
});

test('orientation resolves recovered extra RHS rows and preserves their source evidence', () => {
  const { syntax } = prepare('left [ Player ] [ Crate ] -> [ Player ] [ > Crate parallel Wall ]');
  // Match the existing artificial stage boundary: the recovered RHS has a row
  // beyond the retained LHS. Orientation must still visit every RHS term.
  const source = { ...syntax.rules[0], lhs: syntax.rules[0].lhs.slice(0, 1) };
  const oriented = orientRule(source, Direction.Left);
  assert.equal(oriented.rhs.length, 2);
  assert.deepEqual(oriented.rhs[1][0].map(term => term.qualifier), [Q.Left, Q.HorizontalParallel]);
  oriented.rhs[1][0].forEach((term, index) => assert.equal(term.origin, source.rhs[1][0][index].origin));
  assert.equal(oriented.source, source.source);
  assert.throws(() => orientRule(source, Direction.InPlace), TypeError);
});

test('property expansion retains local and random property names and recovery names', () => {
  for (const layers of ['Player, Crate, Wall', 'Wall']) {
    const { declarations, names } = prepare('right [ Things random Things ] -> [ Things random Things ]',
      'Things = Player or Crate', layers);
    const movements = expandRuleMovements(names);
    const properties = expandRuleProperties(movements.rules, declarations);
    assert.equal(properties.rules.length, 1);
    assert.deepEqual(terms(properties.rules[0]).map(term => term.name), ['things', 'things', 'things', 'things']);
    assert.deepEqual(terms(properties.rules[0]).map(term => term.qualifier), [Q.Unspecified, Q.RandomObject, Q.Unspecified, Q.RandomObject]);
    const recovery = { ...movements.rules[0], rhs: [[[{ ...movements.rules[0].rhs[0][0][0], name: 'recovery-name' }]]] };
    const retained = expandRuleProperties([recovery], declarations);
    assert.equal(retained.rules[0].rhs[0][0][0].name, 'recovery-name');
  }
});
