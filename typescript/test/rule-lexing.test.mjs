import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { SourceRuleCommandKind } from '../build/source-model.js';
import { compilerMessagePayload, compilerRuleTokens } from '../build/rule-lexing.js';
import * as sourceText from '../build/source-text.js';
import { loadPuzzleScript } from './native-host.cjs';
import { buildParserStateSnapshot } from './support/parser-snapshot.cjs';
import { movementSource } from './scenarios.mjs';

loadPuzzleScript({ includeTests: true });

function freezeSource(value, source) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  if ('spelling' in value) checkWord(value, source);
  for (const item of Object.values(value)) freezeSource(item, source);
  Object.freeze(value);
}

function checkWord(word, source) {
  assert.equal(word.normalized, word.spelling.toLowerCase());
  assert.equal(source.slice(word.span.start.offset, word.span.end.offset), word.spelling);
}

function independently(callback) {
  const names = ['tokenizeRuleLine', 'findIndexAfterToken'];
  const originals = names.map(name => globalThis[name]);
  for (const name of names) globalThis[name] = () => { throw new Error('Candidate called native ' + name); };
  try { return callback(); }
  finally { names.forEach((name, index) => { globalThis[name] = originals[index]; }); }
}

function compilerTokens(rule) {
  return independently(() => compilerRuleTokens(rule));
}

function compilerPayload(rule, tokens, index) {
  return independently(() => compilerMessagePayload(rule, tokens, index));
}

function readRule(line) {
  const source = movementSource({ rules: line });
  const native = buildParserStateSnapshot(source).parser_state.rules;
  assert.equal(native.length, 1, line + ': native rule count');
  const { document } = readSource(source);
  assert.equal(document.rules.length, 1, line);
  const before = structuredClone(document);
  freezeSource(document, source);
  return { source, document, rule: document.rules[0], native: native[0], before };
}

function nativePayload(native, values, index) {
  const cursor = globalThis.findIndexAfterToken(native.mixed_case, values, index);
  return native.mixed_case.substring(cursor).trim() || ' ';
}

function checkTokens(rule, source, native) {
  assert.equal(rule.originalLine.span.start.line, native.line_number, 'native rule source line');
  assert.equal(rule.legacyCapturedText, native.rule, 'native captured rule text');
  assert.equal(rule.compilerLine, native.mixed_case, 'native effective compiler line');
  const expected = globalThis.tokenizeRuleLine(native.rule);
  const tokens = compilerTokens(rule);
  assert.deepEqual(tokens.map(token => token.value), expected, rule.originalLine.original);
  for (const token of tokens) {
    checkWord(token.word, source);
    assert.equal(token.word.span.start.line, rule.originalLine.span.start.line);
    assert.equal(token.word.span.end.line, rule.originalLine.span.start.line);
    assert.equal(token.word.span.start.column - 1,
      token.word.span.start.offset - rule.originalLine.span.start.offset);
    assert.equal(token.word.span.end.column - 1,
      token.word.span.end.offset - rule.originalLine.span.start.offset);
  }
  return tokens;
}

test('a lowercase range maps expanded and astral units to original line offsets', () => {
  const line = sourceText.splitSourceLines('previous\nxx İ𐐀ΟΣΑ zz')[1];
  const view = sourceText.lowercaseSourceRange(line, 3, 8);
  assert.equal(view.value, 'i\u0307𐐨ος');
  assert.deepEqual(view.authoredRanges, [
    { start: 3, end: 4 }, { start: 3, end: 4 },
    { start: 4, end: 6 }, { start: 4, end: 6 },
    { start: 6, end: 7 }, { start: 7, end: 8 },
  ]);
  assert.equal(sourceText.lowercaseSourceRange(line, 3, 9).value, 'i\u0307𐐨οσα');
  assert.deepEqual(sourceText.lowercaseSourceRange(line, 8, 8), { value: '', authoredRanges: [] });
  for (const range of view.authoredRanges) {
    const word = sourceText.sourceWord(line, range.start, range.end);
    checkWord(word, 'previous\n' + line.original);
  }
});

test('the comment-masked lowercase view keeps physical-line sigma context and complete Unicode ranges', () => {
  const line = sourceText.splitSourceLines("ΟΣ'Α (İ 𐐀) X")[0];
  const view = sourceText.lowercaseSourceView(line, "ΟΣ'Α " + ' '.repeat('(İ 𐐀)'.length) + ' X');
  assert.equal(view.value, "οσ'α " + ' '.repeat('(i\u0307 𐐨)'.length) + ' x');
  assert.deepEqual(view.authoredRanges.slice(6, 8), [{ start: 6, end: 7 }, { start: 6, end: 7 }]);
  assert.deepEqual(view.authoredRanges.slice(9, 11), [{ start: 8, end: 10 }, { start: 8, end: 10 }]);
});

for (const line of [
  '[Player|Crate]->[>Player|>Crate]',
  '+right[Player]->[Player]',
  '++right[Player]->[Player]',
  '  +right +right[Player]->[Player]',
  'right right left right[Player]->[Player] again again',
  '[>Player]->[>Player]',
  '[İ|𐐀|ΟΣ\u0301Α|ΟΣ]->[İ𐐀]',
  '\t\v\f\r\u00a0\u1680\u2000\u2028\u2029\u202f\u205f\u3000\ufeff+[Player]\t->\u00a0[Player]\r',
  '[Player\u0085Crate]->[Player\u200bCrate]',
]) {
  test('compiler token values match native boundaries: ' + JSON.stringify(line), () => {
    const { source, document, rule, native, before } = readRule(line);
    checkTokens(rule, source, native);
    assert.deepEqual(document, before);
  });
}

test('compiler tokens retain exact authored evidence after expansion, astral text and contextual lowercasing', () => {
  const { source, document, rule, native, before } = readRule('  +right[İ𐐀|ΟΣ\u0301Α|ΟΣ]->[İ]');
  const tokens = checkTokens(rule, source, native);
  assert.deepEqual(tokens.map(token => token.value), ['+', 'right', '[', 'i\u0307𐐨', '|', 'οσ\u0301α', '|', 'ος', ']', '->', '[', 'i\u0307', ']']);
  const expanded = tokens[3].word;
  assert.equal(expanded.spelling, 'İ𐐀');
  assert.equal(expanded.span.start.column, 10);
  assert.equal(expanded.span.end.column, 13);
  assert.equal(tokens[5].word.spelling, 'ΟΣ\u0301Α');
  assert.deepEqual(document, before);
});

for (const [line, captured] of [
  ['[ Player ] (comment) -> [ Player ]', '[ player ] '],
  ['(comment) [ Player ] -> [ Player ]', 'comment) [ player ] -> [ player ]'],
  [' (comment) [ Player ] -> [ Player ]', ' '],
  ['[ Player ] -> message Hello (literal)', '[ player ] -> message hello '],
]) {
  test('compiler lexing respects the selected native capture: ' + line, () => {
    const { source, document, rule, native, before } = readRule(line);
    assert.equal(rule.legacyCapturedText, captured);
    assert.equal(native.rule, captured);
    assert.equal(source.slice(rule.legacyCapturedSpan.start.offset, rule.legacyCapturedSpan.end.offset).toLowerCase(), captured);
    checkTokens(rule, source, native);
    assert.deepEqual(document, before);
  });
}

for (const [line, payload] of [
  ['[ Player ] -> message', ' '],
  ['[ Player ] -> MeSsAgE HeLLo WoRLD', 'HeLLo WoRLD'],
  ['[ Player ] -> message Hello (literal)', 'Hello (literal)'],
  ['(message message) [ Player ] -> message HeLLo (literal)', 'HeLLo (literal)'],
  ['İİ [ Player ] -> message HELLO', 'ELLO'],
]) {
  test('compiler message payload matches the native normalized cursor: ' + line, () => {
    const { source, document, rule, native, before } = readRule(line);
    const values = globalThis.tokenizeRuleLine(native.rule);
    // Choose the final message so repeated occurrences must be searched in order.
    const index = values.lastIndexOf('message');
    assert.notEqual(index, -1);
    assert.equal(nativePayload(native, values, index), payload);
    const tokens = checkTokens(rule, source, native);
    freezeSource(tokens, source);
    assert.equal(compilerPayload(rule, tokens, index), payload);
    if (line.startsWith('İİ')) {
      const command = rule.commands.find(command => command.kind === SourceRuleCommandKind.Message);
      assert.equal(command.authoredPayload, 'HELLO');
      assert.equal(command.legacyPayload, 'HELLO');
      assert.equal(source.slice(command.payloadSpan.start.offset, command.payloadSpan.end.offset), 'HELLO');
    }
    assert.deepEqual(document, before);
  });
}

test('message cursor retains native indexOf failure arithmetic without assuming mapped tokens', () => {
  const { source, rule, native } = readRule('[ Player ] -> message Hello');
  const word = rule.tokens[0];
  for (const values of [['absent', 'message'], ['absent'], ['muchlongerabsenttoken'], [''], ['message', 'message']]) {
    const tokens = values.map(value => ({ value, word }));
    freezeSource(tokens, source);
    const expected = nativePayload(native, values, values.length - 1);
    assert.equal(compilerPayload(rule, tokens, values.length - 1), expected, JSON.stringify(values));
  }
});

test('a rule entered after a leading comment preserves native and authored message case', () => {
  const { source, rule, native } = readRule('(comment) [ Player ] -> message HeLLo (literal)');
  const values = globalThis.tokenizeRuleLine(native.rule);
  const index = values.indexOf('message');
  assert.equal(nativePayload(native, values, index), 'HeLLo (literal)');
  assert.equal(rule.commands[0].authoredPayload, 'HeLLo (literal)');
  assert.equal(rule.commands[0].legacyPayload, 'HeLLo (literal)');
  const tokens = compilerTokens(rule);
  freezeSource(tokens, source);
  assert.equal(compilerPayload(rule, tokens, index), 'HeLLo (literal)');
});

for (const line of [
  '[ Player ] -> message HeLLo (literal)',
  '(comment) [ Player ] -> message HeLLo',
  '(outer (inner)) [ Player ] -> message HeLLo',
  '(one) (two) [ Player ] -> message HeLLo',
  ' \t(comment) [ Player ] -> message HeLLo',
  '(comment\n) [ Player ] -> message HeLLo',
  '(outer\n(inner) comment) [ Player ] -> message HeLLo',
  '(İ) İİ [ Player ] -> message HeLLo (literal)',
]) {
  test('effective compiler casing follows native comment reentry: ' + JSON.stringify(line), () => {
    const { source, document, rule, native, before } = readRule(line);
    const authoredLine = line.split('\n').at(-1);
    assert.equal(rule.originalLine.original, authoredLine);
    assert.equal(native.mixed_case, authoredLine);
    const tokens = checkTokens(rule, source, native);
    freezeSource(tokens, source);
    for (let index = 0; index < tokens.length; index++) {
      if (tokens[index].value !== 'message') continue;
      const payload = nativePayload(native, tokens.map(token => token.value), index);
      assert.equal(compilerPayload(rule, tokens, index), payload);
    }
    const command = rule.commands.find(command => command.kind === SourceRuleCommandKind.Message);
    if (command !== undefined) assert.match(command.authoredPayload, /^HeLLo/);
    assert.deepEqual(document, before);
  });
}

test('native compiler lexical producers are guarded during candidate calls', () => {
  for (const name of ['tokenizeRuleLine', 'findIndexAfterToken']) {
    assert.throws(() => independently(() => globalThis[name]()), new RegExp('Candidate called native ' + name));
  }
});

function compareSources(fixtures) {
  let rules = 0;
  let tokens = 0;
  let messages = 0;
  for (const [name, data] of fixtures) {
    const source = data[0];
    const nativeRules = buildParserStateSnapshot(source).parser_state.rules;
    const { document } = independently(() => readSource(source));
    const before = structuredClone(document);
    freezeSource(document, source);
    assert.equal(document.rules.length, nativeRules.length, name + ': native rule count');
    for (let ruleIndex = 0; ruleIndex < nativeRules.length; ruleIndex++) {
      const rule = document.rules[ruleIndex];
      const native = nativeRules[ruleIndex];
      const values = globalThis.tokenizeRuleLine(native.rule);
      const expectedPayloads = values.flatMap((value, index) => value === 'message'
        ? [{ index, payload: nativePayload(native, values, index) }] : []);
      const actual = checkTokens(rule, source, native);
      freezeSource(actual, source);
      for (const { index, payload } of expectedPayloads) {
        assert.equal(compilerPayload(rule, actual, index), payload, name + ': message token ' + index);
        messages++;
      }
      rules++;
      tokens += actual.length;
    }
    assert.deepEqual(document, before, name + ': immutable authored AST');
  }
  return { sources: fixtures.length, rules, tokens, messages };
}

test('compiler lexing compares every retained simulation-source rule with native producers', t => {
  assert.equal(globalThis.testdata.length, 492);
  const report = compareSources(globalThis.testdata);
  assert.ok(report.rules > 0);
  assert.ok(report.messages > 0);
  t.diagnostic(JSON.stringify(report));
});

test('compiler lexing compares every retained compilation-source rule with native producers', t => {
  assert.equal(globalThis.errormessage_testdata.length, 335);
  const report = compareSources(globalThis.errormessage_testdata);
  assert.ok(report.rules > 0);
  t.diagnostic(JSON.stringify(report));
});
