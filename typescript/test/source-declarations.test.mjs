import test from 'node:test';
import assert from 'node:assert/strict';

import { SourceDeclarations, SourceDeclarationKind, SourceDeclarationAdviceKind, SourceExpansionKind } from '../build/source-declarations.js';
import { NativeLegendExpression } from '../build/source-legend.js';
import { SourceLegendKind } from '../build/source-model.js';
import { sourceWord, sourceWords, splitSourceLines } from '../build/source-text.js';
import { readSource } from '../build/source-reader.js';

function token(value, line = 1) {
  const sourceLine = splitSourceLines('\n'.repeat(line - 1) + value).at(-1);
  return { value, word: sourceWord(sourceLine, 0, value.length) };
}

function registry() {
  const issues = [];
  const declarations = new SourceDeclarations((message, warning = false) => issues.push({ message, warning }));
  for (const [index, name] of ['a', 'b', 'c', 'background'].entries()) declarations.declareObject(token(name, index + 1));
  return { declarations, issues };
}

test('object registration reports every earlier alias before its keyword warning and accepts compound collisions', () => {
  const issues = [];
  const declarations = new SourceDeclarations(message => issues.push(message), new Set(['all']));
  declarations.declareAlias(token('all', 1), token('a', 1)); declarations.declareAlias(token('all', 2), token('b', 2));
  declarations.declareProperty(token('all', 3), ['a', 'b'].map(name => token(name, 3)));
  assert.notEqual(declarations.declareObject(token('all', 4)), null);
  assert.deepEqual(issues, [
    'Name "ALL" already in use.', 'Name "ALL" already in use.',
    'You named an object "ALL", but this is a keyword. Don\'t do that!',
  ]);
  assert.equal(declarations.findDeclaration('all').kind, SourceDeclarationKind.Object);
});

test('existence and expansion deliberately prefer different same-name namespaces', () => {
  const { declarations } = registry();
  declarations.declareAlias(token('mixed', 10), token('c', 10));
  declarations.declareProperty(token('mixed', 11), ['a', 'b'].map(name => token(name, 11)));
  declarations.declareAggregate(token('mixed', 12), ['b', 'a'].map(name => token(name, 12)));
  assert.equal(declarations.findDeclaration('mixed').kind, SourceDeclarationKind.Aggregate);
  assert.equal(declarations.findDeclaration('mixed').line, 12);
  assert.deepEqual(declarations.expandName('mixed'), { kind: SourceExpansionKind.Object, name: 'c' });
  declarations.declareObject(token('mixed', 13));
  assert.equal(declarations.findDeclaration('mixed').kind, SourceDeclarationKind.Object);
  assert.deepEqual(declarations.expandName('mixed'), { kind: SourceExpansionKind.Object, name: 'mixed' });
});

test('aliases have one target and preserve first registration while compounds retain ordered repeated members', () => {
  const { declarations } = registry();
  declarations.declareAlias(token('alias', 10), token('a', 10));
  declarations.declareAlias(token('alias', 11), token('b', 11));
  declarations.declareProperty(token('choice', 12), ['alias', 'b', 'alias'].map(name => token(name, 12)));
  declarations.declareAggregate(token('stack', 13), ['a', 'a', 'b'].map(name => token(name, 13)));
  declarations.declareAggregate(token('nested', 14), ['stack', 'a'].map(name => token(name, 14)));
  const aliases = declarations.registrations.filter(item => item.kind === SourceDeclarationKind.Alias);
  assert.deepEqual(aliases.map(item => item.target), ['a', 'b']);
  assert.equal(Object.hasOwn(aliases[0], 'alternatives'), false);
  assert.deepEqual(declarations.expandName('choice').alternatives, ['a', 'b', 'a']);
  assert.deepEqual(declarations.expandName('nested').constituents, ['a', 'a', 'b', 'a']);
  assert.deepEqual(declarations.findDeclaration('nested').references, ['stack', 'a']);
});

test('forward aliases are source-time names and later resolve without changing earlier compound expansion', () => {
  const { declarations } = registry();
  declarations.declareAlias(token('early', 10), token('later', 10));
  declarations.declareProperty(token('before', 11), ['early', 'a'].map(name => token(name, 11)));
  assert.deepEqual(declarations.expandName('early'), { kind: SourceExpansionKind.Undeclared, name: 'later' });
  declarations.declareAlias(token('later', 12), token('b', 12));
  assert.deepEqual(declarations.expandName('early'), { kind: SourceExpansionKind.Object, name: 'b' });
  assert.deepEqual(declarations.findDeclaration('before').alternatives, ['later', 'a']);
});

test('rule and level vocabularies accumulate only at their explicit checkpoints and snapshots stay detached', () => {
  const { declarations } = registry();
  declarations.declareAlias(token('x', 10), token('a', 10));
  declarations.declareProperty(token('p', 11), ['a', 'b'].map(name => token(name, 11)));
  declarations.declareAggregate(token('g', 12), ['a', 'b'].map(name => token(name, 12)));
  declarations.captureRuleVocabulary();
  declarations.captureLevelVocabulary();
  const rules = declarations.ruleVocabulary, levels = declarations.levelVocabulary;
  declarations.declareAlias(token('y', 13), token('b', 13));
  assert.equal(declarations.ruleVocabulary.has('y'), false);
  assert.equal(declarations.levelVocabulary.has('p'), false);
  assert.equal(declarations.levelVocabulary.has('g'), true);
  declarations.captureRuleVocabulary();
  declarations.captureLevelVocabulary();
  assert.equal(declarations.ruleVocabulary.has('y'), true);
  assert.equal(declarations.levelVocabulary.has('y'), true);
  assert.equal(rules.has('y'), false);
  assert.equal(levels.has('y'), false);
});

test('inherited native object names remain compatibility lookups and never become registrations or vocabulary', () => {
  const { declarations, issues } = registry();
  assert.notEqual(declarations.findDeclaration('constructor'), null);
  assert.deepEqual(declarations.expandName('constructor'), { kind: SourceExpansionKind.Object, name: 'constructor' });
  assert.equal(declarations.declareObject(token('constructor', 10)), null);
  declarations.captureRuleVocabulary();
  assert.equal(declarations.ruleVocabulary.has('constructor'), false);
  assert.equal(declarations.registrations.some(item => item.name === 'constructor'), false);
  assert.match(issues[0].message, /defined multiple times/);
});

test('layers expand properties and keep duplicate-layer warning multiplicity and visit order', () => {
  const { declarations, issues } = registry();
  declarations.declareProperty(token('p', 10), ['a', 'b', 'a'].map(name => token(name, 10)));
  declarations.beginCollisionLayer(); declarations.addCollisionName(token('a'));
  declarations.beginCollisionLayer(); declarations.addCollisionName(token('b'));
  declarations.beginCollisionLayer(); declarations.addCollisionName(token('p')); declarations.addCollisionName(token('p'));
  assert.deepEqual(declarations.collisionLayers, [['a'], ['b'], ['a', 'b', 'a', 'a', 'b', 'a']]);
  assert.deepEqual(issues.map(issue => issue.message), [
    'Object "P" included in multiple collision layers ( layers #1, #2, #1, #3 ). You should fix this! (The compiler will just pick one layer to assign it to).',
    'Object "P" included in multiple collision layers ( layers #1, #2, #1, #3 ). You should fix this! (The compiler will just pick one layer to assign it to).',
    'Object "P" included explicitly multiple times in the same layer. Don\'t do that innit.',
  ]);
});

test('layer diagnostics report background isolation before aggregate rejection and unknown names', () => {
  const { declarations, issues } = registry();
  declarations.declareAggregate(token('pair', 10), ['a', 'b'].map(name => token(name, 10)));
  declarations.beginCollisionLayer(); declarations.addCollisionName(token('background'));
  declarations.addCollisionName(token('pair')); declarations.addCollisionName(token('missing'));
  assert.deepEqual(issues.map(issue => issue.message), [
    'Background must be in a layer by itself.',
    '"pair" is an aggregate (defined using "and"), and cannot be added to a single layer because its constituent objects must be able to coexist.',
    'Background must be in a layer by itself.',
    'Cannot add "MISSING" to a collision layer; it has not been declared.',
  ]);
});

test('a synchronous diagnostic can interrupt layer processing before either explicit names or members mutate', () => {
  let interrupt = false;
  const declarations = new SourceDeclarations(() => { if (interrupt) throw new Error('cap'); });
  declarations.declareObject(token('a', 1));
  declarations.beginCollisionLayer(); declarations.addCollisionName(token('a')); declarations.beginCollisionLayer();
  interrupt = true;
  assert.throws(() => declarations.addCollisionName(token('a')), /cap/);
  assert.deepEqual(declarations.collisionLayers, [['a'], []]);
  interrupt = false;
  declarations.addCollisionName(token('a'));
  assert.deepEqual(declarations.collisionLayers, [['a'], ['a']]);
});

test('a synchronous cross-kind diagnostic interrupts compound registration before mutation', () => {
  let interrupt = false;
  const declarations = new SourceDeclarations(() => { if (interrupt) throw new Error('cap'); });
  declarations.declareObject(token('a', 1)); declarations.declareObject(token('b', 2));
  declarations.declareProperty(token('choice', 3), ['a', 'b'].map(name => token(name, 3)));
  interrupt = true;
  assert.throws(() => declarations.declareAggregate(token('stack', 4), ['a', 'choice'].map(name => token(name, 4))), /cap/);
  assert.equal(declarations.findDeclaration('stack'), null);
});

function expression(text) {
  const expression = new NativeLegendExpression();
  const line = splitSourceLines('\n'.repeat(9) + text).at(-1);
  for (const word of sourceWords(line, text)) expression.append({ value: word.normalized, word });
  return expression;
}

test('legend recovery changes kind after self removal and retains the same mutable expression on revisits', () => {
  const { declarations, issues } = registry();
  const working = expression('mixed = mixed and a or a');
  assert.equal(working.kind, SourceLegendKind.Aggregate);
  declarations.registerLegend(working);
  assert.equal(working.kind, SourceLegendKind.Property);
  assert.deepEqual(working.references, ['a', 'a']);
  assert.deepEqual(declarations.findDeclaration('mixed').alternatives, ['a', 'a']);
  declarations.registerLegend(working);
  assert.deepEqual(issues.map(issue => issue.message), [
    "You can't define object MIXED in terms of itself!",
    "You're repeating the object A here multiple times on the RHS.  This makes no sense.  Don't do that.",
    'Name "MIXED" already in use (on line <a onclick="jumpToLine(10);" href="javascript:void(0);"><span class="errorTextLineNumber">line 10</span></a>).',
    "You're repeating the object A here multiple times on the RHS.  This makes no sense.  Don't do that.",
  ]);
  assert.equal(declarations.registrations.filter(item => item.name === 'mixed').length, 2);
});

test('a synchronous self-reference diagnostic interrupts before working expression removal or declaration mutation', () => {
  const working = expression('mixed = mixed and a or b');
  const declarations = new SourceDeclarations(() => { throw new Error('cap'); });
  declarations.declareObject(token('a', 1)); declarations.declareObject(token('b', 2));
  assert.throws(() => declarations.registerLegend(working), /cap/);
  assert.deepEqual(working.references, ['mixed', 'a', 'b']);
  assert.equal(working.kind, SourceLegendKind.Aggregate);
  assert.equal(declarations.findDeclaration('mixed'), null);
});

test('an operator matching a declaration name does not trigger compiler self-reference removal', () => {
  const { document } = readSource('OBJECTS\nA\nRed\n\nB\nBlue\nLEGEND\nor = A or B\nand = A and B');
  for (const [index, kind] of [SourceDeclarationKind.Property, SourceDeclarationKind.Aggregate].entries()) {
    const accepted = document.acceptedDeclarations.registrations.find(entry => entry.source === document.legend[index]);
    assert.equal(accepted.kind, kind);
    assert.deepEqual(accepted.referenceTokens.map(reference => reference.value), ['a', 'b']);
    assert.deepEqual(accepted.referenceTokens.map(reference => reference.word), document.legend[index].references);
    assert.equal(document.acceptedDeclarations.advice.some(fact => fact.kind === SourceDeclarationAdviceKind.SelfReference), false);
  }
});
