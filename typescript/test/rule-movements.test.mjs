import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import { checkEarlyNegativeTerms } from '../build/rule-negatives.js';
import { orientRules } from '../build/rule-orientations.js';
import { expandRuleNames } from '../build/rule-names.js';
import * as sourceTypes from '../build/source-model.js';
import { CommandKind } from '../build/commands.js';
import { RuleQualifier as Q } from '../build/source-rule-model.js';
import { movementSource } from './scenarios.mjs';
import { createRuleMovementsOracle } from './legacy-rule-movements.cjs';

const movements = await import('../build/rule-movements.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const oracle = createRuleMovementsOracle({ readSource, resolveDeclarations, recoverRuleSyntax, checkEarlyNegativeTerms,
  orientRules, expandRuleNames, ...sourceTypes, CommandKind, ...movements });
const fixture = (rules, legend = '') => ({ name: rules + '; ' + legend,
  source: movementSource({ rules }).replace('C = Crate', 'C = Crate\n' + legend) });
const pairs = rules => rules.map(rule => rule.lhs[0].flatMap(cell => cell.map(term => term.qualifier)));
const rewriteRight = (rules, transform) => rules.map(rule => ({ ...rule,
  rhs: rule.rhs.map(row => row.map(cell => cell.map(term => ({ ...term, qualifier: transform(term.qualifier) })))) }));

test('movement family expansion exposes an independent pure API', () => {
  assert.equal(typeof movements.expandRuleMovements, 'function', 'expandRuleMovements API must exist');
});

test('native horizontal baseline matches the independent candidate API', () => {
  const item = fixture('right [ horizontal Player ] -> [ horizontal Player ]');
  const native = oracle.nativeStages(item.source);
  assert.deepEqual(native.after.map(rule => rule.lhs[0][0]), [['left', 'player'], ['right', 'player']]);
  assert.equal(typeof movements.expandRuleMovements, 'function', 'native-backed movement API must exist');
  oracle.compareFixture(item);
});

test('empty input returns fresh empty movement collections', () => {
  const input = Object.freeze([]);
  const result = movements.expandRuleMovements(input);
  assert.deepEqual(result, { rules: [], diagnostics: [], abortsCompilation: false });
  assert.notEqual(result.rules, input);
});

for (const [family, choices] of [
  ['horizontal', [Q.Left, Q.Right]], ['vertical', [Q.Up, Q.Down]],
  ['orthogonal', [Q.Up, Q.Down, Q.Left, Q.Right]], ['moving', [Q.Up, Q.Down, Q.Left, Q.Right, Q.Action]],
]) test(family + ' expands in native option order and transports corresponding RHS terms', () => {
  const { result } = oracle.compareFixture(fixture(`right [ ${family} Player ] -> [ ${family} Player ]`));
  assert.deepEqual(result.rules.map(rule => rule.lhs[0][0][0].qualifier), choices);
  assert.deepEqual(result.rules.map(rule => rule.rhs[0][0][0].qualifier), choices);
  assert.equal(result.abortsCompilation, false);
});

for (const direction of ['up', 'down', 'left', 'right']) for (const family of ['parallel', 'perpendicular']) {
  test(direction + ' retains ' + family + ' family identity during inference', () => {
    const { result } = oracle.compareFixture(fixture(`${direction} [ ${family} Player | Crate ] -> [ Player | ${family} Crate ]`));
    const horizontal = family === 'parallel' ? ['left', 'right'].includes(direction) : ['up', 'down'].includes(direction);
    const choices = horizontal ? [Q.Left, Q.Right] : [Q.Up, Q.Down];
    assert.deepEqual(result.rules.map(rule => rule.rhs[0].flatMap(cell => cell.map(term => term.qualifier)).find(q => q !== Q.Unspecified)), choices);
  });
}

for (const rules of [
  'right [ horizontal Player | Crate ] -> [ Player | horizontal Player ]',
  'right [ horizontal Player | Crate ] -> [ Player | horizontal Crate ]',
  'right [ horizontal Player horizontal Player | Crate ] -> [ Player | horizontal Player ]',
  'right [ horizontal Player | vertical Crate | Wall ] -> [ Player | Crate | horizontal Player vertical Crate ]',
  'right [ horizontal Player | horizontal Crate | Wall ] -> [ Player | Crate | horizontal Player horizontal Crate ]',
  'right [ horizontal Player vertical Player | Crate ] -> [ Player | horizontal Player vertical Player ]',
]) test('unique entity or family evidence infers distant RHS: ' + rules, () => {
  const { result } = oracle.compareFixture(fixture(rules));
  assert.equal(result.abortsCompilation, false);
});

test('multiple identical terms in one cell count as one expansion site', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player horizontal Player | Crate ] -> [ Player | horizontal Wall ]'));
  assert.equal(result.rules.length, 2);
  assert.deepEqual(pairs(result.rules), [[Q.Left, Q.Left, Q.Unspecified], [Q.Right, Q.Right, Q.Unspecified]]);
  assert.deepEqual(result.rules.map(rule => rule.rhs[0][1][0].qualifier), [Q.Left, Q.Right]);
});

test('a local choice replaces every matching duplicate on both sides and keeps other families separate', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player horizontal Player vertical Player ] -> [ horizontal Player horizontal Player vertical Player ]'));
  const expected = [[Q.Left, Q.Left, Q.Up], [Q.Left, Q.Left, Q.Down], [Q.Right, Q.Right, Q.Up], [Q.Right, Q.Right, Q.Down]];
  assert.deepEqual(pairs(result.rules), expected);
  assert.deepEqual(result.rules.map(rule => rule.rhs[0][0].map(term => term.qualifier)), expected);
});

test('different entities in one cell count as separate family events', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player horizontal Crate | Wall ] -> [ Player | horizontal Wall ]'));
  assert.equal(result.rules.length, 4);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.abortsCompilation, true);
  assert.ok(result.rules.every(rule => rule.rhs[0][1][0].qualifier === Q.Horizontal));
});

test('equal concrete choices at repeated sites do not make distant inference unique', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player | horizontal Player | Crate ] -> [ Player | Player | horizontal Player ]'));
  assert.equal(result.rules.length, 8);
  const equal = result.rules.filter(rule => rule.lhs[0][0][0].qualifier === rule.lhs[0][1][0].qualifier);
  assert.equal(equal.length, 4);
  assert.ok(equal.every(rule => rule.rhs[0][2][0].qualifier === Q.Horizontal));
  assert.equal(result.diagnostics.length, 1);
});

test('local RHS transport survives ambiguous global family evidence', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player | horizontal Player | Crate ] -> [ horizontal Player | horizontal Player | horizontal Crate ]'));
  assert.equal(result.abortsCompilation, true);
  for (const rule of result.rules) {
    assert.equal(rule.rhs[0][0][0].qualifier, rule.lhs[0][0][0].qualifier);
    assert.equal(rule.rhs[0][1][0].qualifier, rule.lhs[0][1][0].qualifier);
    assert.equal(rule.rhs[0][2][0].qualifier, Q.Horizontal);
  }
});

test('same option sets retain distinct horizontal and parallel family identities', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player | Crate ] -> [ Player | parallel Player ]'));
  assert.equal(result.rules.length, 2);
  assert.ok(result.rules.every(rule => rule.rhs[0][1][0].qualifier === Q.HorizontalParallel));
  assert.match(result.diagnostics[0].message, /"horizontal_par"/);
});

test('split cells retain every append/remove duplicate in the exact intermediate order', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player | vertical Crate ] -> [ horizontal Player | vertical Crate ]'));
  assert.deepEqual(pairs(result.rules), [
    [Q.Left, Q.Up], [Q.Left, Q.Down], [Q.Right, Q.Up], [Q.Right, Q.Down],
    [Q.Left, Q.Up], [Q.Right, Q.Up], [Q.Left, Q.Down], [Q.Right, Q.Down],
  ]);
});

test('two families in one cell expand only its first family before the second', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player vertical Crate ] -> [ horizontal Player vertical Crate ]'));
  assert.deepEqual(pairs(result.rules), [[Q.Left, Q.Up], [Q.Left, Q.Down], [Q.Right, Q.Up], [Q.Right, Q.Down]]);
});

test('cell scanning proceeds through later bracket rows from the unchanged parent', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Player ] [ vertical Crate ] -> [ horizontal Player ] [ vertical Crate ]'));
  assert.deepEqual(result.rules.map(rule => [rule.lhs[0][0][0].qualifier, rule.lhs[1][0][0].qualifier]), [
    [Q.Left, Q.Up], [Q.Left, Q.Down], [Q.Right, Q.Up], [Q.Right, Q.Down],
    [Q.Left, Q.Up], [Q.Right, Q.Up], [Q.Left, Q.Down], [Q.Right, Q.Down],
  ]);
});

for (const [direction, family, spelling] of [
  ['right', 'horizontal', 'horizontal'], ['right', 'vertical', 'vertical'],
  ['right', 'orthogonal', 'orthogonal'], ['right', 'moving', 'moving'],
  ['right', 'parallel', 'horizontal_par'], ['up', 'parallel', 'vertical_par'],
  ['right', 'perpendicular', 'vertical_perp'], ['up', 'perpendicular', 'horizontal_perp'],
]) test('RHS-only family diagnoses native spelling ' + spelling, () => {
  const { result } = oracle.compareFixture(fixture(`${direction} [ Player ] -> [ ${family} Crate ]`));
  assert.equal(result.rules.length, 1);
  assert.equal(result.abortsCompilation, true);
  assert.equal(result.diagnostics.length, 1);
  assert.ok(result.diagnostics[0].message.startsWith(`This rule has an ambiguous movement on the right-hand side, "${spelling}",`));
});

test('first remaining RHS family is reported once per input and later inputs continue', () => {
  const { result, named } = oracle.compareFixture(fixture([
    'right [ horizontal Player | Crate ] -> [ horizontal Crate | vertical Wall orthogonal Player ]',
    '+ right [ Player ] -> [ moving Crate ]',
    'right [ vertical Player ] -> [ vertical Player ] win',
  ].join('\n')));
  assert.equal(named.rules.length, 3);
  assert.equal(result.rules.length, 5);
  assert.equal(result.diagnostics.length, 2);
  assert.match(result.diagnostics[0].message, /"vertical"/);
  assert.match(result.diagnostics[1].message, /"moving"/);
  assert.equal(result.rules.at(-1).commands[0].kind, CommandKind.Win);
});

test('repeated orientation inputs retain repeated diagnostics and variants', () => {
  const { result } = oracle.compareFixture(fixture('right right [ horizontal Player | Crate ] -> [ vertical Player | Crate ]'));
  assert.equal(result.rules.length, 4);
  assert.equal(result.diagnostics.length, 2);
});

test('command-only RHS still expands and preserves command identities', () => {
  const { result } = oracle.compareFixture(fixture('rigid random right [ moving Player ] -> message Keep MOVING'));
  assert.equal(result.rules.length, 5);
  assert.ok(result.rules.every(rule => rule.rhs.length === 0));
  assert.ok(result.rules.every(rule => rule.rigid && rule.random));
  assert.equal(result.rules[0].commands[0].text, 'Keep MOVING');
});

test('late syntax suppresses movement before this pass, while randomdir and spawning remain untouched', () => {
  const late = oracle.compareFixture(fixture('late right [ moving Player ] -> [ horizontal Player ]'));
  assert.equal(late.result.rules.length, 1);
  assert.equal(late.result.abortsCompilation, false);
  const { result } = oracle.compareFixture(fixture('right [ Player ] -> [ randomdir Crate Wall ]'));
  assert.deepEqual(result.rules[0].rhs[0][0].map(term => term.qualifier), [Q.RandomDirection, Q.Unspecified]);
});

test('earlier native invalid state stays separate from this stage abort signal', () => {
  const { expected, result, syntax } = oracle.compareFixture(fixture('right [ Player ] -> [ Player | Crate ]\nright [ horizontal Player ] -> [ horizontal Player ]'));
  assert.equal(expected.invalidBeforeMovement, true);
  assert.equal(syntax.abortsCompilation, true);
  assert.equal(expected.abortsCompilation, false);
  assert.equal(result.abortsCompilation, false);
  assert.equal(result.rules.length, 3);
});

test('properties retain named string identities without property expansion', () => {
  const { result } = oracle.compareFixture(fixture('right [ moving Things | Player ] -> [ Things | moving Things ]', 'Things = Wall or Crate'));
  assert.equal(result.rules.length, 5);
  assert.ok(result.rules.every(rule => rule.lhs[0][0][0].name === 'things' && rule.rhs[0][1][0].name === 'things'));
});

test('aggregate-appended terms retain their order and authored evidence', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Pair vertical Player ] -> [ horizontal Pair vertical Player ]', 'Pair = Wall and Crate'));
  assert.equal(result.rules.length, 8);
  assert.ok(result.rules.every(rule => rule.lhs[0][0].map(term => term.name).join(',') === 'wall,player,crate'));
});

for (const [name, item, corrupt] of [
  ['Cartesian product or early dedup', fixture('right [ horizontal Player | vertical Crate ] -> [ horizontal Player | vertical Crate ]'), result => ({ ...result, rules: result.rules.slice(0, 4) })],
  ['Cartesian-product order with all duplicate paths retained', fixture('right [ horizontal Player | vertical Crate ] -> [ horizontal Player | vertical Crate ]'), result => ({ ...result,
    rules: [...result.rules].sort((a, b) => a.lhs[0][0][0].qualifier - b.lhs[0][0][0].qualifier || a.lhs[0][1][0].qualifier - b.lhs[0][1][0].qualifier) })],
  ['reordered work', fixture('right [ horizontal Player | vertical Crate ] -> [ horizontal Player | vertical Crate ]'), result => ({ ...result, rules: [...result.rules].reverse() })],
  ['merged equal-option families', fixture('right [ horizontal Player ] -> [ parallel Player ]'), result => ({ ...result, rules: rewriteRight(result.rules, q => q === Q.HorizontalParallel ? Q.Left : q) })],
  ['inference from equal values at multiple sites', fixture('right [ horizontal Player | horizontal Player | Crate ] -> [ Player | Player | horizontal Player ]'), result => ({ ...result,
    rules: result.rules.map(rule => rule.lhs[0][0][0].qualifier === rule.lhs[0][1][0].qualifier
      ? rewriteRight([rule], q => q === Q.Horizontal ? rule.lhs[0][0][0].qualifier : q)[0] : rule) })],
  ['changed metadata', fixture('random right [ horizontal Player ] -> [ horizontal Player ]'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, random: false })) })],
  ['changed source identity', fixture('right [ horizontal Player ] -> [ horizontal Player ]'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, source: structuredClone(rule.source) })) })],
  ['changed origin identity', fixture('right [ horizontal Player ] -> [ horizontal Player ]'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule,
    lhs: rule.lhs.map(row => row.map(cell => cell.map(term => ({ ...term, origin: structuredClone(term.origin) })))) })) })],
  ['leaked native bookkeeping', fixture('right [ horizontal Player ] -> [ horizontal Player ]'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, movingReplacement: {} })) })],
  ['leaked descriptive bookkeeping', fixture('right [ horizontal Player ] -> [ horizontal Player ]'), result => ({ ...result, evidence: [] })],
  ['leaked term bookkeeping', fixture('right [ horizontal Player ] -> [ horizontal Player ]'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule,
    lhs: rule.lhs.map(row => row.map(cell => cell.map(term => ({ ...term, chosenQualifier: term.qualifier })))) })) })],
  ['lost diagnostics', fixture('right [ Player ] -> [ horizontal Player ]'), result => ({ ...result, diagnostics: [] })],
  ['lost stage abort', fixture('right [ Player ] -> [ horizontal Player ]'), result => ({ ...result, abortsCompilation: false })],
  ['dropped ambiguous variants', fixture('right [ Player ] -> [ horizontal Player ]'), result => ({ ...result, rules: [] })],
  ['cloned equal commands', fixture('right [ horizontal Player ] -> [ horizontal Player ] win'), result => ({ ...result,
    rules: result.rules.map(rule => ({ ...rule, commands: [...rule.commands] })) })],
]) test('oracle rejects ' + name, () => {
  assert.throws(() => oracle.compareFixture(item, { expandRuleMovements: rules => corrupt(movements.expandRuleMovements(rules)) }),
    /complete movement sequence|identity\/value|origin identity|leaked .* bookkeeping|movement diagnostics|movement stage invalid/);
});

test('oracle rejects mutation of frozen movement inputs', () => {
  assert.throws(() => oracle.compareFixture(fixture('right [ horizontal Player ] -> [ horizontal Player ]'), {
    expandRuleMovements: rules => { rules[0].lhs[0][0][0].qualifier = Q.Left; return movements.expandRuleMovements(rules); },
  }), TypeError);
});

test('oracle snapshots detect map mutation beyond Object.freeze', () => {
  const probe = new Map([['original', true]]);
  assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> [ Player ]'), {
    readSource: source => {
      const read = readSource(source);
      // Attach a Map to prove snapshots detect changes freezing cannot prevent.
      read.document.probe = probe;
      return read;
    },
    expandRuleMovements: rules => { probe.clear(); return movements.expandRuleMovements(rules); },
  }), /movement inputs are unchanged/);
});

test('every native parser/compiler producer is guarded during candidate execution', () => {
  for (const name of oracle.producers) {
    assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> win'), {
      readSource: source => { globalThis[name](); return readSource(source); },
    }), new RegExp('Candidate called native ' + name));
  }
  assert.throws(() => oracle.independently(() => runInThisContext('new codeMirrorFn().startState()')), /Candidate called native codeMirrorFn/);
  assert.throws(() => oracle.independently(() => runInThisContext('new CodeMirror.StringStream("", 4)')), /Candidate called native CodeMirror.StringStream/);
});

test('all 478 vanilla sources match complete movement order, duplicates, diagnostics and stage invalidity', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  const totals = { sources: 0, syntax: 0, inputs: 0, outputs: 0, diagnostics: 0, aborted: 0 };
  for (const item of fixtures) {
    const { expected, named, result } = oracle.compareFixture(item);
    totals.sources++;
    totals.syntax += expected.syntaxCount;
    totals.inputs += named.rules.length;
    totals.outputs += result.rules.length;
    totals.diagnostics += result.diagnostics.length;
    totals.aborted += Number(result.abortsCompilation);
  }
  assert.deepEqual(totals, { sources: 478, syntax: 16577, inputs: 25985, outputs: 30005, diagnostics: 0, aborted: 0 });
  t.diagnostic(JSON.stringify(totals));
});
