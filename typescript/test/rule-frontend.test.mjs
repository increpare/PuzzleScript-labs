import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compilerRuleTokens } from '../build/rule-lexing.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import { compileSourceRules } from '../build/source-rule-compiler.js';
import { RuleQualifier } from '../build/source-rule-model.js';
import { CommandKind } from '../build/commands.js';
import { movementSource } from './scenarios.mjs';

function prepare(rules, transform = source => source) {
  const { document } = readSource(transform(movementSource({ rules })));
  const { declarations } = resolveDeclarations(document);
  return { document, declarations };
}

function forbidRead(object, field) {
  Object.defineProperty(object, field, { configurable: true,
    get() { throw new Error('Compiler tried to read raw rule evidence: ' + field); } });
}

test('canonical rule tokens are stored once with their authored words', () => {
  const { document } = prepare('right [ > Player | Crate ] -> [ Player | > Crate ]');
  const rule = document.rules[0];
  assert.ok(Array.isArray(rule.lexicalTokens));
  assert.equal(compilerRuleTokens(rule), rule.lexicalTokens);
  assert.equal(compilerRuleTokens(rule), compilerRuleTokens(rule));
  assert.deepEqual(rule.tokens, rule.lexicalTokens.map(token => token.word));
  for (const token of rule.lexicalTokens) {
    assert.equal(document.source.slice(token.word.span.start.offset, token.word.span.end.offset), token.word.spelling);
  }
});

test('rule compilation consumes parsed syntax without reading physical text or tokens', () => {
  const { document, declarations } = prepare('right [ > Player | Crate ] -> [ Player | > Crate ] message HeLLo (literal)');
  const rule = document.rules[0];
  for (const field of ['compilerLine', 'legacyCapturedText', 'legacyCapturedSpan', 'tokens', 'lexicalTokens']) forbidRead(rule, field);
  forbidRead(rule.originalLine, 'original');
  forbidRead(document, 'source');
  const result = recoverRuleSyntax(document, declarations);
  assert.equal(result.rules[0].source, rule);
  assert.equal(result.rules[0].lhs[0][0][0].qualifier, RuleQualifier.Forward);
  assert.equal(result.rules[0].lhs[0][1][0].name, 'crate');
  assert.deepEqual(result.rules[0].commands, [{ kind: CommandKind.Message, text: 'HeLLo (literal)' }]);
  const compiled = compileSourceRules(document, declarations);
  assert.ok(compiled.data);
  assert.equal(compiled.data.earlyRules.groups.length, 1);
  assert.equal(compiled.data.earlyRules.groups[0].rules.length, 1);
});

test('changing the parsed row changes compiler input without changing the captured line', () => {
  const { document, declarations } = prepare('[ Player ] -> [ Player ]\n[ > Crate ] -> [ Crate ]');
  const [player, crate] = document.rules;
  const substituted = { ...player, lhs: crate.lhs };
  const result = recoverRuleSyntax({ ...document, rules: [substituted] }, declarations);
  assert.equal(result.rules[0].lhs[0][0][0].name, 'crate');
  assert.equal(result.rules[0].lhs[0][0][0].qualifier, RuleQualifier.Forward);
  assert.equal(document.source.slice(result.rules[0].lhs[0][0][0].origin.start.offset,
    result.rules[0].lhs[0][0][0].origin.end.offset), '> Crate');
  assert.match(player.legacyCapturedText, /player/);
});

test('contextual name recognition is settled by parsing, independently of later declaration lookup', () => {
  const { document, declarations } = prepare('[ checkpoint ] -> [ checkpoint ] checkpoint', source => source
    .replace('Wall\nblue', 'checkpoint\nblue').replace('# = Wall', '# = checkpoint')
    .replace('Player, Crate, Wall', 'Player, Crate, checkpoint'));
  const result = recoverRuleSyntax(document, { ...declarations, firstDeclarationWords: new Map() });
  assert.equal(result.rules[0].lhs[0][0][0].name, 'checkpoint');
  assert.deepEqual(result.rules[0].commands, []);
  assert.equal(result.diagnostics.filter(issue => issue.code === 'name-outside-row').length, 1);
});

test('final SOUNDS vocabulary applies to an earlier parsed rule with raw evidence intact', () => {
  const { document, declarations } = prepare('[ AfterRule ] -> [ AfterRule ]', source => source
    .replace('\nwinconditions\n', '\nlegend\nAfterRule = Player\n\nsounds\n\nwinconditions\n'));
  const rule = document.rules[0];
  assert.equal(rule.lhs[0].cells[0].terms[0].name.spelling, 'AfterRule');
  assert.equal(recoverRuleSyntax(document, declarations).rules[0].lhs[0][0][0].name, 'afterrule');
});

test('only final property meaning controls the supplemental note, preserving issue order', () => {
  const { document, declarations } = prepare('[ Things Things Missing ] -> [ Things ]', source => source
    .replace('C = Crate', 'C = Crate\nThings = Player or Crate'));
  const original = structuredClone(document);
  assert.deepEqual(recoverRuleSyntax(document, declarations).diagnostics.map(issue => issue.code), [
    'duplicate-cell-name', 'duplicate-property-name', 'unknown-rule-token',
  ]);
  const withoutProperties = { ...declarations, ruleNames: { ...declarations.ruleNames, properties: new Map() } };
  assert.deepEqual(recoverRuleSyntax(document, withoutProperties).diagnostics.map(issue => issue.code), [
    'duplicate-cell-name', 'unknown-rule-token',
  ]);
  assert.deepEqual(document, original, 'validation leaves parsed source unchanged');
});

test('deferred issue reporting can stop at the existing compiler checkpoint', () => {
  const { document, declarations } = prepare('[ Things Things Missing ] -> [ Things ]', source => source
    .replace('C = Crate', 'C = Crate\nThings = Player or Crate'));
  const observed = [];
  const stop = new Error('checkpoint stop');
  assert.throws(() => recoverRuleSyntax(document, declarations, issue => {
    observed.push(issue.code);
    if (issue.code === 'duplicate-property-name') throw stop;
  }), error => error === stop);
  assert.deepEqual(observed, ['duplicate-cell-name', 'duplicate-property-name']);
});

test('grammar issues stay on parsed rules until the compiler reaches the Rules checkpoint', () => {
  const { document, diagnostics } = readSource(movementSource({ rules: '[ Player Player ] -> [ Player ]' }));
  assert.deepEqual(diagnostics, [], 'reader diagnostics do not prematurely report rule grammar issues');
  assert.ok(document.rules[0].syntaxIssues.length > 0);
  const { declarations } = resolveDeclarations(document);
  assert.deepEqual(recoverRuleSyntax(document, declarations).diagnostics.map(issue => issue.code), ['duplicate-cell-name']);
});
