import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import { checkEarlyNegativeTerms } from '../build/rule-negatives.js';
import { orientRules } from '../build/rule-orientations.js';
import { expandRuleNames } from '../build/rule-names.js';
import { expandRuleMovements } from '../build/rule-movements.js';
import * as sourceTypes from '../build/source-model.js';
import { CommandKind } from '../build/commands.js';
import { RuleQualifier as Q } from '../build/source-rule-model.js';
import { movementSource } from './scenarios.mjs';
import { createRulePropertiesOracle } from './legacy-rule-properties.cjs';

const optional = path => import(path).catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const properties = await optional('../build/rule-properties.js');
const spawns = await optional('../build/rule-spawns.js');
const oracle = createRulePropertiesOracle({ readSource, resolveDeclarations, recoverRuleSyntax, checkEarlyNegativeTerms,
  orientRules, expandRuleNames, expandRuleMovements, ...sourceTypes, CommandKind, RuleQualifier: Q, ...properties, ...spawns });
const fixture = (rules, legend = '', layers = 'Player, Crate, Wall') => ({ name: rules + '; ' + legend,
  source: movementSource({ rules }).replace('C = Crate', 'C = Crate\n' + legend)
    .replace('Player, Crate, Wall', layers) });
const names = rules => rules.map(rule => rule.lhs.flatMap(row => row.flatMap(cell => cell.map(term => term.name))));
const rightNames = rules => rules.map(rule => rule.rhs.flatMap(row => row.flatMap(cell => cell.map(term => term.name))));
const changeRight = (rules, transform) => rules.map(rule => ({ ...rule,
  rhs: rule.rhs.map(row => row.map(cell => cell.map(term => transform({ ...term })))) }));

test('property and spawn stages expose independent pure APIs', () => {
  assert.equal(typeof properties.expandRuleProperties, 'function', 'expandRuleProperties API must exist');
  assert.equal(typeof spawns.inferSpawnedStationary, 'function', 'inferSpawnedStationary API must exist');
});

test('native multi-layer baseline requires the candidate property API', () => {
  const item = fixture('right [ Things ] -> [ Things ]', 'Things = Player or Background');
  const native = oracle.nativeStages(item.source);
  assert.deepEqual(native.after.map(rule => rule.lhs[0][0]), [['', 'player'], ['', 'background']]);
  assert.equal(typeof properties.expandRuleProperties, 'function', 'native-backed property API must exist');
  oracle.compareFixture(item);
});

test('native new-layer baseline requires the candidate spawn API', () => {
  const item = fixture('right [ Player ] -> [ Background ]');
  const native = oracle.nativeStages(item.source);
  assert.deepEqual(native.spawned[0].rhs[0][0], ['stationary', 'background']);
  assert.equal(typeof spawns.inferSpawnedStationary, 'function', 'native-backed spawn API must exist');
  oracle.compareFixture(item);
});

test('empty collections are fresh and carry no private evidence', () => {
  const input = Object.freeze([]);
  const { declarations } = resolveDeclarations(readSource(movementSource()).document);
  const result = properties.expandRuleProperties(input, declarations);
  assert.deepEqual(result, { rules: [], diagnostics: [] });
  assert.notEqual(result.rules, input);
  const spawned = spawns.inferSpawnedStationary(input, declarations);
  assert.deepEqual(spawned, []);
  assert.notEqual(spawned, input);
});

test('single-layer local properties remain named predicates', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things ] -> [ Things ]', 'Things = Player or Crate'));
  assert.deepEqual(names(result.rules), [['things']]);
  assert.deepEqual(rightNames(result.rules), [['things']]);
});

test('multi-layer local properties expand in dictionary member order', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things ] -> [ Things ]', 'Things = Background or Player'));
  assert.deepEqual(names(result.rules), [['background'], ['player']]);
  assert.deepEqual(rightNames(result.rules), [['background'], ['player']]);
});

test('transported properties expand at every LHS occurrence in first-cell work order', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things | Things ] -> [ Things | Things ]',
    'Things = Player or Background'));
  assert.deepEqual(names(result.rules), [['player', 'player'], ['player', 'background'], ['background', 'player'], ['background', 'background']]);
  assert.deepEqual(rightNames(result.rules), names(result.rules));
});

test('one expanded cell infers remote same-name properties', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things | Wall ] -> [ Player | Things ]', 'Things = Crate or Player'));
  assert.deepEqual(names(result.rules), [['crate', 'wall'], ['player', 'wall']]);
  assert.deepEqual(rightNames(result.rules), [['player', 'crate'], ['player', 'player']]);
});

test('duplicate members remain distinct choices and preserve order', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things | Wall ] -> [ Player | Things ]', 'Things = Crate or Player or Crate'));
  assert.deepEqual(names(result.rules), [['crate', 'wall'], ['player', 'wall'], ['crate', 'wall']]);
});

test('several same-name terms in one cell count as one expansion and replace all participating terms', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things stationary Things | Wall ] -> [ Things | Things ]', 'Things = Crate or Player'));
  assert.deepEqual(names(result.rules), [['crate', 'crate', 'wall'], ['player', 'player', 'wall']]);
  assert.deepEqual(rightNames(result.rules), [['crate', 'crate'], ['player', 'player']]);
});

test('several properties in a cell expand the first eligible property before the next', () => {
  const { result } = oracle.compareFixture(fixture('right [ First Second ] -> [ First Second ]',
    'First = Player or Background\nSecond = Crate or Background'));
  assert.deepEqual(names(result.rules), [['player', 'crate'], ['player', 'background'], ['background', 'crate'], ['background', 'background']]);
});

test('retained first property is skipped while later multi-layer properties expand', () => {
  const { result } = oracle.compareFixture(fixture('right [ Local Multi ] -> [ Local Multi ]',
    'Local = Player or Crate\nMulti = Wall or Background'));
  assert.deepEqual(names(result.rules), [['local', 'wall'], ['local', 'background']]);
});

test('promoted property aliases keep their own raw name and choice evidence', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things Alias | Wall ] -> [ Player | Things Alias ]',
    'Things = Crate or Player\nAlias = Things'));
  assert.deepEqual(names(result.rules), [['crate', 'crate', 'wall'], ['crate', 'player', 'wall'], ['player', 'crate', 'wall'], ['player', 'player', 'wall']]);
  assert.deepEqual(rightNames(result.rules), [['player', 'crate', 'crate'], ['player', 'crate', 'player'], ['player', 'player', 'crate'], ['player', 'player', 'player']]);
});

test('equal-member distinct aliases cannot supply each other with remote inference', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things | Wall ] -> [ Player | Alias ]',
    'Things = Crate or Player\nAlias = Things'));
  assert.equal(result.rules.length, 0);
  assert.match(result.diagnostics[0].message, /"ALIAS"/);
});

test('multiple expanded cells cannot infer remote properties even when selected values agree', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things | Things | Wall ] -> [ Player | Player | Things ]', 'Things = Crate or Player'));
  assert.equal(result.rules.length, 0);
  assert.equal(result.diagnostics.length, 1);
});

test('the last remaining transported property diagnoses once and later inputs continue', () => {
  const { result } = oracle.compareFixture(fixture([
    'right [ Player ] -> [ First Second First Third ]',
    '+ right [ Player ] -> [ Second ]',
    'random rigid right [ Multi ] -> [ Multi ] win',
  ].join('\n'), 'First = Player or Crate\nSecond = Wall or Crate\nThird = Player or Wall\nMulti = Background or Crate'));
  assert.equal(result.rules.length, 2);
  assert.equal(result.diagnostics.length, 2);
  assert.match(result.diagnostics[0].message, /"THIRD"/);
  assert.match(result.diagnostics[1].message, /"SECOND"/);
  assert.ok(result.rules.every(rule => rule.commands[0].kind === CommandKind.Win && rule.rigid && rule.random));
});

test('no-prefixed properties expand before transport analysis with duplicate members', () => {
  const { result } = oracle.compareFixture(fixture('right [ no Things ] -> [ Things ]', 'Things = Crate or Player or Crate'));
  assert.equal(result.rules.length, 0);
  assert.equal(result.diagnostics.length, 1);
  const expanded = oracle.compareFixture(fixture('right [ no Things ] -> [ no Others ]',
    'Things = Crate or Player or Crate\nOthers = Background or Wall'));
  assert.deepEqual(names(expanded.result.rules), [['crate', 'player', 'crate']]);
  assert.deepEqual(rightNames(expanded.result.rules), [['background', 'wall']]);
});

test('empty properties erase negative terms and remove an eligible empty choice branch', () => {
  const empty = rules => {
    const item = fixture(rules, 'Choices = Player or Player\nPlayer = Choices');
    return { ...item, source: item.source.replace('P = Player\n', '') };
  };
  const negative = oracle.compareFixture(empty('right [ no Choices ] -> [ Wall ]'));
  assert.deepEqual(negative.declarations.ruleNames.properties.get('choices'), []);
  assert.deepEqual(names(negative.result.rules), [[]]);
  const rightNegative = oracle.compareFixture(empty('right [ Wall ] -> [ no Choices ]'));
  assert.deepEqual(rightNegative.movement.rules[0].rhs[0][0].map(term => [term.qualifier, term.name]), [[Q.No, 'choices']]);
  assert.deepEqual(rightNegative.result.rules[0].rhs, [[[]]]);
  const choices = oracle.compareFixture(empty('right [ Choices ] -> [ Wall ]'));
  assert.deepEqual(choices.result.rules, []);
});

test('isolated invalid stage-input boundary preserves the native missing-cell TypeError category', () => {
  const item = fixture('right [ no Empty ] -> [ Player ]', 'Pair = Crate and Wall\nEmpty = Pair or Pair');
  let nativeBoundary;
  assert.throws(() => oracle.nativeStages(item.source, { beforeProperties: boundary => { nativeBoundary = boundary; } }), error => error instanceof TypeError
    && /getPropertiesFromCell/.test(error.stack));
  assert.equal(nativeBoundary.syntaxInvalid, true);
  assert.deepEqual(nativeBoundary.rules[0].lhs, [[]]);
  assert.deepEqual(nativeBoundary.rules[0].rhs, [[['', 'player']]]);
  const { document } = readSource(item.source);
  const { declarations } = resolveDeclarations(document);
  assert.equal(recoverRuleSyntax(document, declarations).abortsCompilation, true);
  assert.throws(() => oracle.candidateStages(item.source), TypeError);
});

test('random-object terms do not participate in property lookup or substitution', () => {
  const { result } = oracle.compareFixture(fixture('right [ Things random Things | Wall ] -> [ random Things | Things random Things ]',
    'Things = Player or Crate'));
  assert.deepEqual(names(result.rules), [['player', 'things', 'wall'], ['crate', 'things', 'wall']]);
  assert.deepEqual(rightNames(result.rules), [['things', 'player', 'things'], ['things', 'crate', 'things']]);
});

test('random-only LHS occurrence cannot infer an ordinary RHS property', () => {
  const { result } = oracle.compareFixture(fixture('right [ random Things ] -> [ Things ]', 'Things = Player or Crate'));
  assert.equal(result.rules.length, 0);
  assert.equal(result.diagnostics.length, 1);
});

test('resolved movement families and aggregate append order survive property expansion', () => {
  const { result } = oracle.compareFixture(fixture('right [ horizontal Pair Multi ] -> [ horizontal Pair Multi ]',
    'Pair = Player and Crate\nMulti = Wall or Background'));
  assert.equal(result.rules.length, 8);
  assert.ok(result.rules.every(rule => rule.lhs[0][0].map(term => term.name).join(',').startsWith('player,')));
  assert.ok(result.rules.every(rule => rule.lhs[0][0][2].name === 'crate'));
});

test('command-only and late rules still expand properties', () => {
  const item = fixture('late right [ Multi ] -> message Keep PROPERTY', 'Multi = Player or Background');
  const { result } = oracle.compareFixture(item);
  assert.deepEqual(names(result.rules), [['player'], ['background']]);
  assert.ok(result.rules.every(rule => rule.rhs.length === 0 && rule.commands[0].text === 'Keep PROPERTY'));
});

test('present undefined single-layer entries retain unlayered local properties', () => {
  const { declarations, result } = oracle.compareFixture(fixture('right [ Things ] -> [ Things ]',
    'Things = Crate or Wall', 'Player'));
  assert.ok(declarations.ruleNames.singleLayerProperties.has('things'));
  assert.equal(declarations.ruleNames.singleLayerProperties.get('things'), undefined);
  assert.deepEqual(names(result.rules), [['things']]);
});

for (const [rule, expected] of [
  ['right [ Player ] -> [ Player ]', Q.Unspecified],
  ['right [ Player ] -> [ Crate ]', Q.Unspecified],
  ['right [ Player ] -> [ Background ]', Q.Stationary],
  ['right [ no Wall ] -> [ Crate ]', Q.Unspecified],
  ['right [ random Wall ] -> [ Crate ]', Q.Unspecified],
  ['right [ Things ] -> [ Crate ]', Q.Unspecified],
  ['right [ Player ] -> [ Things ]', null],
  ['late right [ Player ] -> [ Background ]', Q.Unspecified],
  ['right [ Player ] -> [ up Background ]', Q.Up],
  ['right [ Player ] -> [ stationary Background ]', Q.Stationary],
  ['right [ Player ] -> [ no Background ]', Q.No],
  ['right [ Player ] -> [ random Background ]', Q.RandomObject],
  ['right [ Player ] -> [ randomdir Background ]', Q.RandomDirection],
]) test('spawn qualifier handling: ' + rule, () => {
  const { spawned } = oracle.compareFixture(fixture(rule, 'Things = Wall or Crate'));
  if (expected === null) assert.deepEqual(spawned, []);
  else assert.equal(spawned[0].rhs[0][0][0].qualifier, expected);
});

test('spawn inference uses actual undefined layers of known unlayered objects', () => {
  const { spawned } = oracle.compareFixture(fixture('right [ Crate ] -> [ Wall ]', '', 'Player'));
  assert.equal(spawned[0].rhs[0][0][0].qualifier, Q.Unspecified);
  const newLayer = oracle.compareFixture(fixture('right [ Player ] -> [ Wall ]', '', 'Player'));
  assert.equal(newLayer.spawned[0].rhs[0][0][0].qualifier, Q.Stationary);
});

for (const expression of ['Missing or Wall', 'Wall or Missing']) test('unknown property members supply no objects or undefined layers: ' + expression, () => {
  const { spawned } = oracle.compareFixture(fixture('right [ random Things ] -> [ Crate ]',
    'Things = ' + expression, 'Player\nWall'));
  assert.equal(spawned[0].rhs[0][0][0].qualifier, Q.Stationary);
});

for (const [expression, expected] of [['Missing or Wall', ['missing', 'wall']], ['Wall or Missing', ['wall', 'missing']]]) {
  test('property expansion preserves unknown member names and order: ' + expression, () => {
    const { result } = oracle.compareFixture(fixture('right [ Things ] -> [ Things ]', 'Things = ' + expression));
    assert.deepEqual(names(result.rules), expected.map(name => [name]));
    assert.deepEqual(rightNames(result.rules), expected.map(name => [name]));
  });
}

test('property occurrence lookup uses the property namespace even for a raw concrete name', () => {
  const { result } = oracle.compareFixture(fixture('right [ Player ] -> [ Player ]', 'Player = Background or Wall'));
  assert.deepEqual(names(result.rules), [['background'], ['wall']]);
});

test('unknown final synonym names are unchanged and supply no LHS object or layer', () => {
  const unknownRight = oracle.compareFixture(fixture('right [ Player ] -> [ Lost ]', 'Lost = Missing'));
  assert.equal(unknownRight.spawned[0].rhs[0][0][0].name, 'missing');
  assert.equal(unknownRight.spawned[0].rhs[0][0][0].qualifier, Q.Unspecified);
  const unknownLeft = oracle.compareFixture(fixture('right [ Lost ] -> [ Crate ]', 'Lost = Missing'));
  assert.equal(unknownLeft.spawned[0].rhs[0][0][0].qualifier, Q.Stationary);
});

test('a retained LHS property contributes every possible concrete layer to spawning', () => {
  const { spawned } = oracle.compareFixture(fixture('right [ Things ] -> [ Crate ]', 'Things = Player or Wall'));
  assert.equal(spawned[0].rhs[0][0][0].qualifier, Q.Unspecified);
});

test('spawn raw concrete lookup takes priority over a colliding property', () => {
  const { movement, spawned } = oracle.compareFixture(fixture('right [ random Player ] -> [ Crate ]',
    'Player = Background or Wall', 'Player\nCrate, Wall'));
  assert.equal(movement.rules[0].lhs[0][0][0].name, 'player');
  assert.equal(spawned[0].rhs[0][0][0].qualifier, Q.Stationary);
});

test('spawn RHS properties remain named even with a colliding raw concrete object', () => {
  const { spawned } = oracle.compareFixture(fixture('right [ Player ] -> [ Player ]', 'Player = Crate or Wall'));
  assert.equal(spawned[0].rhs[0][0][0].name, 'player');
  assert.equal(spawned[0].rhs[0][0][0].qualifier, Q.Unspecified);
});

test('early negative removal precedes synonym substitution and spawn inference', () => {
  const item = fixture('right [ Player no Wall ] -> [ Crate ]', 'Player = Other');
  item.source = item.source.replace('legend\n', 'Other\nyellow\n\nlegend\n')
    .replace('Player, Crate, Wall\n', 'Player, Crate, Wall\nOther\n');
  const { negatives, movement, spawned } = oracle.compareFixture(item);
  assert.deepEqual(negatives.rules[0].lhs[0][0].map(term => term.name), ['player']);
  assert.deepEqual(movement.rules[0].lhs[0][0].map(term => term.name), ['other']);
  assert.equal(spawned[0].rhs[0][0][0].qualifier, Q.Stationary);
});

test('property and spawn inference still run after movement ambiguity without changing invalidity', () => {
  const { movement, result, spawned, expected } = oracle.compareFixture(fixture(
    'right [ Things | Player ] -> [ Things | horizontal Background ]', 'Things = Crate or Background'));
  assert.equal(movement.abortsCompilation, true);
  assert.equal(result.rules.length, 2);
  assert.equal(spawned.length, 2);
  assert.equal(expected.propertyInvalid, true);
});

for (const [name, item, corrupt] of [
  ['first-member capture', fixture('right [ Things | Wall ] -> [ Player | Things ]', 'Things = Crate or Player'), result => ({ ...result,
    rules: result.rules.map(rule => ({ ...rule, rhs: rule.rhs.map(row => row.map((cell, index) =>
      cell.map(term => ({ ...term, name: index === 1 ? 'crate' : term.name })))) })) })],
  ['duplicate collapse', fixture('right [ Things | Wall ] -> [ Player | Things ]', 'Things = Crate or Player or Crate'), result => ({ ...result, rules: result.rules.slice(0, 2) })],
  ['wrong work order', fixture('right [ Things | Things ] -> [ Things | Things ]', 'Things = Crate or Background'), result => ({ ...result, rules: [...result.rules].reverse() })],
  ['first instead of last ambiguity', fixture('right [ Player ] -> [ First Second ]', 'First = Crate or Player\nSecond = Crate or Wall'), result => ({ ...result,
    diagnostics: result.diagnostics.map(issue => ({ ...issue, message: issue.message.replace('SECOND', 'FIRST') })) })],
  ['changed source', fixture('right [ Player ] -> [ Player ]'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, source: structuredClone(rule.source) })) })],
  ['changed commands', fixture('right [ Player ] -> [ Player ] win'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, commands: [...rule.commands] })) })],
  ['changed flags', fixture('rigid random right [ Player ] -> [ Player ]'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, rigid: false })) })],
  ['changed origins', fixture('right [ no Things ] -> [ Player ]', 'Things = Crate or Wall'), result => ({ ...result,
    rules: result.rules.map(rule => ({ ...rule, lhs: rule.lhs.map(row => row.map(cell => cell.map(term => ({ ...term, origin: structuredClone(term.origin) })))) })) })],
  ['runtime binding leak', fixture('right [ Player ] -> [ Player ]'), result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, bindings: {} })) })],
  ['term binding leak', fixture('right [ Player ] -> [ Player ]'), result => ({ ...result,
    rules: changeRight(result.rules, term => ({ ...term, chosenObject: term.name })) })],
  ['private evidence leak', fixture('right [ Player ] -> [ Player ]'), result => ({ ...result, evidence: [] })],
]) test('oracle rejects ' + name, () => {
  assert.throws(() => oracle.compareFixture(item, { expandRuleProperties: (rules, declarations) => corrupt(properties.expandRuleProperties(rules, declarations)) }),
    /complete property sequence|identity\/value|origin identity|leaked .* bookkeeping|property diagnostics/);
});

test('oracle rejects inference across distinct equal-member aliases', () => {
  assert.throws(() => oracle.compareFixture(fixture('right [ Things | Wall ] -> [ Player | Alias ]',
    'Things = Crate or Player\nAlias = Things'), {
    expandRuleProperties: (rules, declarations) => properties.expandRuleProperties(
      changeRight(rules, term => ({ ...term, name: term.name === 'alias' ? 'things' : term.name })), declarations),
  }), /complete property sequence/);
});

test('oracle rejects ignoring negative LHS layers during spawn inference', () => {
  assert.throws(() => oracle.compareFixture(fixture('right [ no Wall ] -> [ Crate ]'), {
    inferSpawnedStationary: (rules, declarations) => changeRight(spawns.inferSpawnedStationary(rules, declarations), term => ({ ...term, qualifier: Q.Stationary })),
  }), /complete spawn sequence/);
});

for (const [name, corrupt] of [
  ['source', rules => rules.map(rule => ({ ...rule, source: structuredClone(rule.source) }))],
  ['commands', rules => rules.map(rule => ({ ...rule, commands: [...rule.commands] }))],
  ['origin', rules => changeRight(rules, term => ({ ...term, origin: structuredClone(term.origin) }))],
  ['runtime binding', rules => rules.map(rule => ({ ...rule, bindings: {} }))],
]) test('spawn oracle rejects changed ' + name, () => {
  assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> [ Background ] win'), {
    inferSpawnedStationary: (rules, declarations) => corrupt(spawns.inferSpawnedStationary(rules, declarations)),
  }), /identity\/value|origin identity|leaked rule bookkeeping/);
});

test('oracle rejects mutation of frozen property and spawn inputs', () => {
  const item = fixture('right [ Things ] -> [ Things ]', 'Things = Player or Background');
  assert.throws(() => oracle.compareFixture(item, { expandRuleProperties: rules => { rules[0].lhs[0][0][0].name = 'wall'; } }), TypeError);
  assert.throws(() => oracle.compareFixture(item, { inferSpawnedStationary: rules => { rules[0].rhs[0][0][0].qualifier = Q.Up; } }), TypeError);
});

for (const stage of ['expandRuleProperties', 'inferSpawnedStationary']) test('oracle snapshots reject Map mutation in ' + stage, () => {
  const probe = new Map([['original', true]]);
  assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> [ Player ]'), {
    readSource: source => { const read = readSource(source); read.document.probe = probe; return read; },
    [stage]: (rules, declarations) => { probe.clear(); return (stage === 'expandRuleProperties' ? properties[stage] : spawns[stage])(rules, declarations); },
  }), /inputs are unchanged/);
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

test('all 478 vanilla sources match complete property and spawn sequences', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  const totals = { sources: 0, syntax: 0, named: 0, movement: 0, properties: 0, spawned: 0, diagnostics: 0, movementInvalid: 0 };
  for (const item of fixtures) {
    const { expected, movement, result, spawned } = oracle.compareFixture(item);
    totals.sources++;
    totals.syntax += expected.syntaxCount;
    totals.named += expected.namedCount;
    totals.movement += movement.rules.length;
    totals.properties += result.rules.length;
    totals.spawned += spawned.length;
    totals.diagnostics += result.diagnostics.length;
    totals.movementInvalid += Number(movement.abortsCompilation);
  }
  assert.deepEqual(totals, { sources: 478, syntax: 16577, named: 25985, movement: 30005,
    properties: 106273, spawned: 106273, diagnostics: 0, movementInvalid: 0 });
  t.diagnostic(JSON.stringify(totals));
});
