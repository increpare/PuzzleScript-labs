import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { readSource } from '../build/source-reader.js';
import * as sourceTypes from '../build/source-model.js';
import { createSourceOracle } from './legacy-source-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const oracle = createSourceOracle({ readSource, ...sourceTypes });
const fixture = { name: 'source reader oracle', source: movementSource() };

test('the independent source reader agrees on common authored data', () => {
  const report = oracle.compareFixture(fixture);
  assert.equal(report.rules, 1);
  assert.equal(report.objects, 4);
  assert.equal(report.levels, 1);
});

test('a recovered self-referential declaration takes precedence over a command word', () => {
  oracle.compareFixture({ name: 'recovered command-name aggregate',
    source: movementSource({ rules: '[ Player ] -> [ Player message ]' })
      .replace('C = Crate', 'C = Crate\nmessage = message or Player and Crate') });
});

test('a rejected empty property does not shadow a command word', () => {
  oracle.compareFixture({ name: 'rejected command-name property',
    source: movementSource({ rules: '[ Player ] -> [ Player message ]' })
      .replace('C = Crate', 'C = Crate\nPair = Player and Crate\nmessage = Pair or Pair') });
});

test('discarding an authored rule is rejected', () => {
  assert.throws(() => oracle.compareFixture(fixture, { readSource: source => {
    const result = readSource(source);
    return { ...result, document: { ...result.document, rules: [] } };
  } }), /authored source/);
});

test('losing a movement qualifier is rejected even when captured rule text is correct', () => {
  assert.throws(() => oracle.compareFixture(fixture, { readSource: source => {
    const result = readSource(source);
    const rules = result.document.rules.map(rule => ({ ...rule, rhs: rule.rhs.map(row => ({ ...row,
      cells: row.cells.map(cell => ({ ...cell, terms: cell.terms.map(term => ({ ...term, qualifier: null })) })),
    })) }));
    return { ...result, document: { ...result.document, rules } };
  } }), /authored rule structure/);
});

test('losing a parsed command is rejected even when captured rule text is correct', () => {
  const item = { name: 'lost command', source: movementSource({ rules: '[ Player ] -> sfx0 message Hello' }) };
  assert.throws(() => oracle.compareFixture(item, { readSource: source => {
    const result = readSource(source);
    return { ...result, document: { ...result.document, rules: result.document.rules.map(rule => ({ ...rule, commands: [] })) } };
  } }), /authored rule structure/);
});

test('native rule rejections report errors and warning-only recovery separately', () => {
  const errored = oracle.compareFixture({ name: 'errored rule rejection', source: movementSource({ rules: '[ Player ]' }) });
  assert.equal(errored.rules, 1);
  assert.equal(errored.ruleStructures, 0);
  assert.equal(errored.skippedErroredRules, 1);
  assert.equal(errored.rejectedRuleStructures, 1);

  const warned = oracle.compareFixture({ name: 'warning-only rule rejection', source: movementSource({ rules: '[ Player ] ->' }) });
  assert.equal(warned.rules, 1);
  assert.equal(warned.ruleStructures, 0);
  assert.equal(warned.skippedErroredRules, 0);
  assert.equal(warned.rejectedRuleStructures, 1);
});

test('incorrect physical source locations are rejected', () => {
  assert.throws(() => oracle.compareFixture(fixture, { readSource: source => {
    const result = readSource(source);
    const lines = result.document.lines.map((line, index) => index === 0
      ? { ...line, span: { ...line.span, start: { ...line.span.start, offset: 1 } } } : line);
    return { ...result, document: { ...result.document, lines } };
  } }), /source span/);
});

for (const field of ['payloadSpan', 'legacyCapturedSpan']) {
  test('named source spans are checked: ' + field, () => {
    const item = { name: 'named span corruption', source: movementSource({ rules: '[ Player ] -> message Hello' }) };
    assert.throws(() => oracle.compareFixture(item, { readSource: source => {
      const result = readSource(source);
      const invalid = { start: { offset: -99, line: 1, column: -99 }, end: { offset: -98, line: 1, column: -98 } };
      const rules = result.document.rules.map(rule => field === 'payloadSpan'
        ? { ...rule, commands: rule.commands.map(command => ({ ...command, payloadSpan: invalid })) }
        : { ...rule, legacyCapturedSpan: invalid });
      return { ...result, document: { ...result.document, rules } };
    } }), /source span/);
  });
}

test('the independent reader cannot use a native JS parser producer', () => {
  assert.throws(() => oracle.compareFixture(fixture, { readSource: source => {
    globalThis.loadFile(source);
    return readSource(source);
  } }), /TS source reader called JS producer loadFile/);
});

test('the native parser lexical binding is guarded too', () => {
  assert.throws(() => oracle.compareFixture(fixture, { readSource: source => {
    runInThisContext('new codeMirrorFn().startState()');
    return readSource(source);
  } }), /TS source reader called JS producer codeMirrorFn/);
});

test('all simulation sources retain common authored data independently of JS', () => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 492);
  for (const item of fixtures) oracle.compareFixture(item);
});

test('compilation fixtures preserve recoverable source and valid spans without throwing', () => {
  const fixtures = oracle.compilationFixtures();
  assert.equal(fixtures.length, 335);
  // This checks syntax preservation/recovery, not the later compiler's exact
  // diagnostic counts/messages or its executable output.
  for (const item of fixtures) oracle.checkPreservation(item);
});
