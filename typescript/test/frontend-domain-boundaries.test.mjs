import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../build/source-reader.js';
import { compileMetadata } from '../build/source-game-data.js';
import { movementSource } from './scenarios.mjs';
import { createSourceCompilerOracle } from './legacy-source-compiler.cjs';

const modules = await Promise.all(['source-compiler', 'source-model', 'model', 'session-model',
  'turn-rules', 'win-conditions', 'commands', 'rule-model', 'source-assets', 'declaration-model']
  .map(name => import('../build/' + name + '.js')));
const types = Object.assign({}, ...modules);
const oracle = createSourceCompilerOracle(types);

test('contradictory rule removal preserves its native warning and accepted empty schedule', () => {
  const source = movementSource({ rules: 'right [ Player no Avatar ] -> [ Crate ]' })
    .replace('C = Crate', 'C = Crate\nAvatar = Player');
  const { result } = oracle.compareFixture({ name: 'diagnosed contradictory rule removal', source });
  assert.equal(result.outcome.kind, types.SourceCompilationKind.Accepted);
  assert.deepEqual(result.rawDiagnostics.map(issue => [issue.code, issue.severity, issue.countsAsError]),
    [['contradictory-rule-objects', types.SourceDiagnosticSeverity.Warning, false]]);
  assert.equal(result.outcome.game.earlyRules.groups.length, 0);
});

test('rule sounds retain finite indices, authored spelling and invalid SFX11 diagnostics', () => {
  const source = movementSource({ sounds: 'sfx0 001\nsfx10 010', rules: '[ Player ] -> SFX0 SfX10 sfx11' });
  const { result } = oracle.compareFixture({ name: 'rule sound index boundaries', source });
  const commands = result.document.rules[0].commands;
  assert.deepEqual(commands.map(command => [command.kind, command.index, command.word.spelling]), [
    [types.SourceRuleCommandKind.SoundEffect, 0, 'SFX0'], [types.SourceRuleCommandKind.SoundEffect, 10, 'SfX10'],
  ]);
  const issue = result.rawDiagnostics.find(issue => issue.code === 'unknown-rule-token');
  assert.ok(issue);
  assert.equal(source.slice(issue.span.start.offset, issue.span.end.offset), 'sfx11');
  assert.equal(result.rawDiagnostics.some(issue => issue.code === 'undefined-rule-sound'), false);
});

test('declared sound-shaped names retain contextual precedence over rule commands', () => {
  const source = movementSource({ sounds: 'sfx0 001\nsfx10 010', rules: '[ SfX0 ] -> [ SfX0 ] SFX0 sfx10' })
    .replace('Player\nwhite', 'Player SFX0\nwhite');
  const { result } = oracle.compareFixture({ name: 'rule sound name precedence', source });
  const rule = result.document.rules[0];
  assert.deepEqual(rule.commands.map(command => [command.kind, command.index]), [[types.SourceRuleCommandKind.SoundEffect, 10]]);
  for (const row of [...rule.lhs, ...rule.rhs]) {
    assert.equal(row.cells[0].terms[0].nameValue, 'sfx0');
    assert.equal(row.cells[0].terms[0].name.spelling, 'SfX0');
  }
  assert.deepEqual(rule.trailingWords.map(word => word.spelling), ['SFX0']);
  const issue = result.rawDiagnostics.find(issue => issue.code === 'name-outside-row');
  assert.ok(issue);
  assert.equal(source.slice(issue.span.start.offset, issue.span.end.offset), 'SFX0');
});

const metadataDocument = metadata => readSource(metadata).document;
const noIssues = (...issue) => assert.fail('Unexpected metadata diagnostic: ' + JSON.stringify(issue));

test('metadata compilation consumes an accepted key and value without a second vocabulary', () => {
  const document = metadataDocument('title Authored');
  const entry = document.metadata[0];
  const definition = { ...entry, key: { ...entry.key, spelling: 'retained_setting', normalized: 'retained_setting' }, value: 'Tree value' };
  const result = compileMetadata({ ...document, metadata: [definition] }, noIssues);
  assert.deepEqual([...result.values], [['retained_setting', 'Tree value']]);
  assert.equal(entry.key.spelling, 'title');
  assert.equal(entry.authoredValue, 'Authored');
  assert.equal(document.source.slice(entry.span.start.offset, entry.span.end.offset), 'title Authored');
});

test('accepted empty metadata values remain available to domain consumers', () => {
  const document = metadataDocument('title Authored');
  const result = compileMetadata({ ...document, metadata: [{ ...document.metadata[0], value: '' }] }, noIssues);
  assert.deepEqual([...result.values], [['title', '']]);
});

test('metadata acceptance remains authoritative for session flags and rejected entries', () => {
  const document = metadataDocument('title Authored');
  const entry = document.metadata[0];
  const retained = { ...entry, key: { ...entry.key, spelling: 'noundo', normalized: 'noundo' }, value: 'tree flag' };
  const rejected = { ...entry, key: { ...entry.key, spelling: 'norestart', normalized: 'norestart' }, accepted: false };
  const result = compileMetadata({ ...document, metadata: [retained, rejected, { ...entry, accepted: false }] }, noIssues);
  assert.deepEqual([...result.values], [['noundo', 'tree flag']]);
  assert.deepEqual(result.session, { requirePlayerMovement: false, runRulesOnLevelStart: false, noUndo: true, noRestart: false });
});

const wholeNumberIssue = coordinate => ['invalid-dimension', `Wasn't able to make sense of "${coordinate}" as a (whole number) dimension.`];
const parsedNumberIssue = coordinate => ['invalid-dimension', `Wasn't able to make sense of "${coordinate}" as a dimension.`];
const nonpositiveIssue = coordinate => ['nonpositive-dimension', `The dimension given to me (you gave "${coordinate}") is baad - it should be greater than 0.`];
const invalidPairIssue = value => ['invalid-dimensions', `Couldn't understand the dimensions given to me (you gave "${value}") - should be of the form AxB.`];
const nonpositivePairIssue = value => ['nonpositive-dimensions', `The dimensions given to me (you gave "${value}") are baad - they should be > 0.`];

for (const [value, expected] of [
  ['axb', [wholeNumberIssue('a'), wholeNumberIssue('b'), invalidPairIssue('axb')]],
  ['0xno', [nonpositiveIssue('0'), wholeNumberIssue('no'), invalidPairIssue('0xno')]],
  ['nox0', [wholeNumberIssue('no'), nonpositiveIssue('0'), invalidPairIssue('nox0')]],
  ['0x.0', [nonpositiveIssue('0'), parsedNumberIssue('.0'), invalidPairIssue('0x.0')]],
  ['.0x-2', [parsedNumberIssue('.0'), nonpositiveIssue('-2'), invalidPairIssue('.0x-2')]],
  ['-2x0', [nonpositiveIssue('-2'), nonpositiveIssue('0'), nonpositivePairIssue('-2x0')]],
  ['2147483648x-2147483649', [wholeNumberIssue('2147483648'), wholeNumberIssue('-2147483649'), invalidPairIssue('2147483648x-2147483649')]],
  ['2x3x4', [['invalid-dimensions', 'Dimensions must be of the form AxB.']]],
]) {
  test('dimension diagnostics preserve coordinate order and failure branch: ' + value, () => {
    const document = metadataDocument('flickscreen ' + value);
    const issues = [];
    const result = compileMetadata(document, (...issue) => issues.push(issue));
    assert.deepEqual(issues.map(([code, message]) => [code, message]), expected);
    for (const [, , span, warning] of issues) {
      assert.equal(span, document.metadata[0].span);
      assert.equal(warning, true);
    }
    assert.equal(result.values.has('flickscreen'), false);
    assert.equal(Object.hasOwn(result.session, 'flickscreen'), false);
  });
}

test('a reporter interruption stops dimension diagnostics at the interrupted coordinate', () => {
  const document = metadataDocument('flickscreen axb');
  for (const limit of [1, 2]) {
    const issues = [];
    const interruption = new Error('issue cap');
    assert.throws(() => compileMetadata(document, (code, message) => {
      issues.push([code, message]);
      if (issues.length === limit) throw interruption;
    }), error => error === interruption);
    assert.deepEqual(issues, [wholeNumberIssue('a'), wholeNumberIssue('b')].slice(0, limit));
  }
});

for (const value of [
  'axb', '2x3x4', 'x2', '2x', '0xno', 'nox0', '0x.0', '.0x-2', '-2x0',
  'İx2', '３x2', '2x∞', '3X4', '+3x4', '1e2x2.0', '.1e1x2', '0b10x2', '0o10x2',
  '2147483647x2', '2147483648x2', '-2147483648x2', '-2147483649x2',
  '0x10x2', '-0x2', 'Infinityx2', 'NaNx2', '2.5x2',
]) {
  test('independent full source compilation preserves dimension parsing: ' + value, () => {
    oracle.compareFixture({ name: 'dimension domain: ' + value,
      source: movementSource({ metadata: `flickscreen ${value}\nzoomscreen ${value}` }) });
  });
}
