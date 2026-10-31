import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import * as sourceTypes from '../build/source-model.js';
import { CommandKind } from '../build/commands.js';
import { Direction } from '../build/model.js';
import { movementSource } from './scenarios.mjs';
import { createRuleSyntaxOracle } from './legacy-rule-syntax.cjs';
import * as syntax from '../build/rule-syntax.js';
import * as model from '../build/source-rule-model.js';
const oracle = createRuleSyntaxOracle({ readSource, resolveDeclarations, ...sourceTypes, CommandKind, ...syntax });
const fixture = rules => ({ name: rules, source: movementSource({ rules }) });

test('independent source rule syntax recovery exposes numeric domain values', () => {
  assert.equal(typeof syntax.recoverRuleSyntax, 'function', 'recoverRuleSyntax API must exist');
  const names = ['Unspecified', 'Up', 'Down', 'Left', 'Right', 'Action', 'Stationary', 'No', 'RandomObject',
    'RandomDirection', 'Horizontal', 'Vertical', 'Orthogonal', 'Moving', 'Forward', 'Backward',
    'Counterclockwise', 'Clockwise', 'Parallel', 'Perpendicular', 'HorizontalParallel', 'VerticalParallel',
    'HorizontalPerpendicular', 'VerticalPerpendicular', 'Ellipsis'];
  names.forEach((name, index) => assert.equal(model.RuleQualifier[name], index, name));
  assert.equal(sourceTypes.SourceDiagnosticPhase.Rules, 3);
});

const recoveryCases = [
  '[ > up Player ] -> [ Player ]', '[ > Missing Player ] -> [ Player ]', '[ > | Player ] -> [ Player ]',
  'late [ > Player ] -> [ > Player ]', '[ Player | > ] -> [ Player ]', '[ Player -> Player ] -> [ Player ]',
  '[ Player ] -> [ Player win ]', '[ Player ] -> win [ Player ]', '[ Player ] -> [ Player',
  '[ Player ] -> [ Player ] -> [ Player ]', '[ > ... Player ] -> win', '[ Player ] ->', '[ Player ]',
  '[ Player | Crate ] -> [ Player ]', '[ Player ] [ Crate ] -> [ Player ]', '[ Player ] [ Crate ] -> win',
  '[ Player ] -> win [ Player', '[ Player | Crate [ Wall ] -> [ Player | Wall ]', '[ [ Player ] ] -> [ Player ]',
  '[ Player ] ] -> [ Player ]', '[ > win Player ] -> [ Player ]', '[ > ] -> [ Player ]',
  'late rigid [ Player ] -> [ Player ]', '[ no Player no Player ] -> [ Player ]', '[ Player Player ] -> [ Player ]',
  '[ ... Player ] -> win', '[ ... > Player ] -> win', '[ Player ] -> [ Player ] up | ... Player',
];
for (const line of recoveryCases) test('native recovery: ' + line, () => oracle.compareFixture(fixture(line)));

for (const header of ['', 'up down left right', 'right right left', 'horizontal', 'vertical', 'orthogonal', 'moving',
  'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp', 'action', '^ v < > parallel perpendicular',
  'late', 'rigid random', 'random late rigid', 'random +', '+ random', '++', 'up +']) {
  for (const body of ['[ Player ] -> [ Player ]', '[ Player | Crate ] -> [ Player | Crate ]', '[ Player ] -> [ > Player ]']) {
    const line = header + ' ' + body;
    test('sequential header: ' + line, () => oracle.compareFixture(fixture(line)));
  }
}

for (const lines of [
  'late rigid random [ Player ] -> [ Player ]\n+ [ Player ] -> [ Player ]',
  '[ Player ] -> [ Player ]\nstartloop\n+ [ Player ] -> [ Player ]\nendloop\n+ [ Player ] -> [ Player ]',
  '[ Player ] -> [ Player ]\n[ Player ] ->\n+ [ Player ] -> [ Player ]',
  'random\n+ [ Player ] -> [ Player ]',
  '[ Player ] -> [ Player ]\nrandom + [ Player ] -> [ Player ]\n+ random [ Player ] -> [ Player ]',
  '[ Player ] -> [ Player ]\n+ late [ Player ] -> [ Player ]',
]) test('groups keep the last non-null ordinary predecessor: ' + lines, () => oracle.compareFixture(fixture(lines)));

for (const line of [
  '[ Player ] -> sfx0 sfx10 cancel checkpoint restart win again sfx0 message HeLLo (literal)',
  '[ Player ] -> message', '[ Player ] -> [ message Hello', '[ Player ] -> MeSsAgE HeLLo WoRLD',
  'İİ [ Player ] -> message HELLO', '(comment) [ Player ] -> message HeLLo',
  ' (comment) [ Player ] -> message HeLLo', '(outer\n(inner) comment) [ Player ] -> message HeLLo',
  '[ Player ] (comment) -> [ Player ]', '(comment) [ Player ] -> [ Player ]',
  '[ Player\u0085Crate ] -> [ Player ]', '[ Player ] -> [ Player\u200bCrate ]',
]) test('command and capture recovery: ' + line, () => oracle.compareFixture(fixture(line)));

test('known checkpoint is an ordered name before it can be a command', () => {
  const item = fixture('[ checkpoint ] -> [ checkpoint ] checkpoint');
  item.source = item.source.replace('Wall\nblue', 'checkpoint\nblue').replace('# = Wall', '# = checkpoint').replace('Player, Crate, Wall', 'Player, Crate, checkpoint');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.rules[0].lhs[0][0][0].name, 'checkpoint');
  assert.deepEqual(result.rules[0].commands, []);
});

test('recovery keeps named evidence and authored invalid partial rows', () => {
  const { document, result } = oracle.compareFixture(fixture('[ > Missing Player ] -> win [ Player'));
  const term = result.rules[0].lhs[0][0][0];
  assert.equal(term.qualifier, model.RuleQualifier.Forward);
  assert.equal(document.source.slice(term.origin.start.offset, term.origin.end.offset), '> Missing Player');
  assert.equal(document.rules[0].rhs[0].closingBracket, null);
  assert.deepEqual(result.rules[0].rhs, []);
  assert.equal(result.rules[0].source, document.rules[0]);
});

test('late suppression changes directional classification before defaults collapse', () => {
  const { result } = oracle.compareFixture(fixture('late [ > Player ] -> [ > Player ]'));
  assert.deepEqual(result.rules[0].directions, [Direction.Up]);
  assert.equal(result.rules[0].lhs[0][0][0].qualifier, model.RuleQualifier.Unspecified);
});

test('late randomdir is rejected on either side and recovers the following object without movement', () => {
  const { document, result } = oracle.compareFixture(fixture('late [ randomdir Player ] -> [ randomdir Player ]\n[ Player ] -> [ Player ]'));
  assert.deepEqual(result.diagnostics.map(issue => [issue.code, issue.message,
    document.source.slice(issue.span.start.offset, issue.span.end.offset)]), [
    ['movement-in-late-rule', 'Movements cannot appear in late rules.', 'randomdir'],
    ['movement-in-late-rule', 'Movements cannot appear in late rules.', 'randomdir'],
  ]);
  assert.equal(result.rules.length, 2);
  for (const side of [result.rules[0].lhs, result.rules[0].rhs]) {
    assert.equal(side[0][0][0].qualifier, model.RuleQualifier.Unspecified);
  }
});

test('structured token diagnostics retain the exact authored problem span', () => {
  const { document, result } = oracle.compareFixture(fixture('[ > up Missing Player ] -> [ Player ]'));
  const tokenEvidence = result.diagnostics.map(issue => [issue.code,
    document.source.slice(issue.span.start.offset, issue.span.end.offset)]);
  assert.deepEqual(tokenEvidence, [['multiple-rule-qualifiers', 'up'], ['unknown-rule-token', 'Missing']]);
  assert.ok(result.diagnostics.every(issue => issue.severity === sourceTypes.SourceDiagnosticSeverity.Error && issue.countsAsError));
});

for (const qualifier of ['up', 'down', 'left', 'right', 'action', 'stationary', 'no', 'random', 'randomdir',
  'horizontal', 'vertical', 'orthogonal', 'moving', '>', '<', '^', 'v', 'parallel', 'perpendicular',
  'horizontal_par', 'vertical_par', 'horizontal_perp', 'vertical_perp']) {
  test('body qualifier identity: ' + qualifier, () => {
    oracle.compareFixture(fixture(`[ ${qualifier} Player ] -> [ ${qualifier} Player ]`));
  });
}

for (const [name, legend] of [
  ['recovered command-name aggregate', 'message = message or Player and Crate'],
  ['rejected command-name property', 'Pair = Player and Crate\nmessage = Pair or Pair'],
  ['property duplicate warning', 'Pair = Player or Crate'],
]) test('final accepted declaration membership: ' + name, () => {
  const item = fixture(name === 'property duplicate warning' ? '[ Pair Pair ] -> [ Pair ]' : '[ Player ] -> [ Player message ]');
  item.source = item.source.replace('C = Crate', 'C = Crate\n' + legend);
  oracle.compareFixture(item);
});

test('promoted property aliases use the actual final native property namespace', () => {
  const item = fixture('[ Alias Alias ] -> [ Alias ]');
  item.source = item.source.replace('C = Crate', 'C = Crate\nThings = Player or Crate\nAlias = Things');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.diagnostics.filter(issue => issue.code === 'duplicate-property-name').length, 1);
});

test('without a SOUNDS heading the compiler has no known rule names', () => {
  const item = fixture('[ Player ] -> [ Player ]');
  item.source = item.source.replace('\nsounds\n', '\n');
  const { result } = oracle.compareFixture(item);
  assert.deepEqual(result.rules[0].lhs, [[[]]]);
  assert.deepEqual(result.rules[0].rhs, [[[]]]);
  assert.equal(result.diagnostics.filter(issue => issue.code === 'unknown-rule-token').length, 2);
});

test('accepted declarations after the final SOUNDS heading stay unknown to rule syntax', () => {
  const item = fixture('[ AfterSounds ] -> [ AfterSounds ]');
  item.source = item.source.replace('\nrules\n', '\nlegend\nAfterSounds = Player\n\nrules\n');
  const { result, document } = oracle.compareFixture(item);
  const { declarations } = resolveDeclarations(document);
  assert.ok(declarations.firstDeclarationWords.has('aftersounds'));
  assert.equal(declarations.ruleNames.synonyms.get('aftersounds'), 'player');
  assert.deepEqual(result.rules[0].lhs, [[[]]]);
  assert.equal(result.diagnostics.filter(issue => issue.code === 'unknown-rule-token').length, 2);
});

test('repeated SOUNDS headings include earlier registrations and exclude later ones', () => {
  const item = fixture('[ BeforeLast AfterLast ] -> [ BeforeLast AfterLast ]');
  item.source = item.source.replace('\nrules\n', '\nlegend\nBeforeLast = Player\n\nsounds\n\nlegend\nAfterLast = Crate\n\nrules\n');
  const { result } = oracle.compareFixture(item);
  assert.deepEqual(result.rules[0].lhs[0][0].map(term => term.name), ['beforelast']);
  assert.equal(result.diagnostics.filter(issue => issue.code === 'unknown-rule-token').length, 2);
});

test('a later SOUNDS snapshot also supplies names to rules captured before the declaration', () => {
  const item = fixture('[ AfterRule ] -> [ AfterRule ]');
  item.source = item.source.replace('\nwinconditions\n', '\nlegend\nAfterRule = Player\n\nsounds\n\nwinconditions\n');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.rules[0].lhs[0][0][0].name, 'afterrule');
  assert.deepEqual(result.diagnostics, []);
});

test('snapshot membership keeps its first registration while property meaning remains final', () => {
  const item = fixture('[ Pair Pair ] -> [ Pair ]');
  item.source = item.source.replace('C = Crate', 'C = Crate\nPair = Player')
    .replace('\nrules\n', '\nlegend\nPair = Player or Crate\n\nrules\n');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.rules[0].lhs[0][0][0].name, 'pair');
  assert.equal(result.diagnostics.filter(issue => issue.code === 'duplicate-property-name').length, 1);
});

for (const snapshot of ['missing', 'before declaration', 'after rule']) {
  test('checkpoint name versus command uses the final SOUNDS snapshot: ' + snapshot, () => {
    const item = fixture('[ checkpoint ] -> [ checkpoint ] checkpoint');
    if (snapshot === 'missing') {
      item.source = item.source.replace('Wall\nblue', 'checkpoint\nblue').replace('# = Wall', '# = checkpoint')
        .replace('Player, Crate, Wall', 'Player, Crate, checkpoint').replace('\nsounds\n', '\n');
    } else {
      item.source = item.source.replace('\nrules\n', '\nobjects\ncheckpoint\nblue\n\nrules\n');
      if (snapshot === 'after rule') item.source = item.source.replace('\nwinconditions\n', '\nsounds\n\nwinconditions\n');
    }
    const { result } = oracle.compareFixture(item);
    if (snapshot === 'after rule') {
      assert.equal(result.rules[0].lhs[0][0][0].name, 'checkpoint');
      assert.deepEqual(result.rules[0].commands, []);
    } else {
      assert.deepEqual(result.rules[0].commands.map(command => command.kind), Array(3).fill(CommandKind.Checkpoint));
      assert.deepEqual(result.rules[0].lhs, [[[]]]);
    }
  });
}

test('Unicode named terms retain authored spans while using compiler lowercase identities', () => {
  const item = fixture('[ > Player | ^ 𐐀 | v ΟΣ ] -> [ Player | 𐐀 | ΟΣ ]');
  item.source = item.source.replaceAll('Crate', '𐐀').replaceAll('Wall', 'ΟΣ');
  const { document, result } = oracle.compareFixture(item);
  assert.deepEqual(result.rules[0].lhs[0].map(cell => cell[0].name), ['player', '𐐨', 'ος']);
  assert.deepEqual(result.rules[0].lhs[0].map(cell => document.source.slice(cell[0].origin.start.offset, cell[0].origin.end.offset)), ['> Player', '^ 𐐀', 'v ΟΣ']);
});

test('effective syntax never trusts authored term grouping or Invalid rule classification', () => {
  oracle.compareFixture(fixture('[ > up Player ] -> [ Player ]'), { readSource: source => {
    const { document, diagnostics } = readSource(source);
    return { diagnostics, document: { ...document, rules: document.rules.map(rule => ({ ...rule,
      kind: sourceTypes.SourceRuleKind.Invalid, lhs: [], rhs: [], prefixWords: [], commands: [],
    })) } };
  } });
});

for (const [name, line, corrupt] of [
  ['lost pending qualifier', '[ > Missing Player ] -> [ Player ]', result => ({ ...result, rules: result.rules.map(rule => ({ ...rule,
    lhs: rule.lhs.map(row => row.map(cell => cell.map(term => ({ ...term, qualifier: model.RuleQualifier.Unspecified })))) })) })],
  ['wrong source group', '[ Player ] -> [ Player ]\n+ [ Player ] -> [ Player ]', result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, sourceGroup: rule.source.originalLine.span.start.line })) })],
  ['inherited flag', 'late [ Player ] -> [ Player ]\n+ [ Player ] -> [ Player ]', result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, late: true })) })],
  ['omitted recovered rule', '[ > Missing Player ] -> [ Player ]', result => ({ ...result, rules: [] })],
  ['wrong message payload', 'İİ [ Player ] -> message HELLO', result => ({ ...result, rules: result.rules.map(rule => ({ ...rule, commands: [{ kind: CommandKind.Message, text: 'HELLO' }] })) })],
]) test('oracle rejects ' + name, () => {
  assert.throws(() => oracle.compareFixture(fixture(line), { recoverRuleSyntax: (...args) => corrupt(syntax.recoverRuleSyntax(...args)) }), /effective rule syntax/);
});

test('every native parser/compiler/token producer is disabled during candidate work', () => {
  for (const name of ['compile', 'loadFile', 'processRuleString', 'tokenizeRuleLine', 'findIndexAfterToken', 'generateExtraMembers', 'generateMasks', 'lookupLegendName']) {
    assert.throws(() => oracle.compareFixture(fixture('[ Player ] -> win'), { readSource: source => {
      globalThis[name]();
      return readSource(source);
    } }), new RegExp('Candidate called native ' + name));
  }
  assert.throws(() => oracle.independently(() => runInThisContext('new codeMirrorFn().startState()')), /Candidate called native codeMirrorFn/);
});

test('every retained simulation-source rule matches native syntax including errored recovery', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 492);
  const totals = { sources: 0, captured: 0, rules: 0, loops: 0, diagnostics: 0, aborted: 0 };
  for (const item of fixtures) {
    const report = oracle.compareFixture(item);
    totals.sources++;
    for (const key of ['captured', 'rules', 'loops', 'diagnostics', 'aborted']) totals[key] += report[key];
  }
  t.diagnostic(JSON.stringify(totals));
  assert.equal(totals.rules, 16674);
  assert.equal(totals.diagnostics, 217);
});
