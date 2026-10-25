import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import * as sourceTypes from '../build/source-model.js';
import { CommandKind } from '../build/commands.js';
import { RuleQualifier } from '../build/source-rule-model.js';
import { movementSource } from './scenarios.mjs';
import { createRuleNegativesOracle } from './legacy-rule-negatives.cjs';

// The first red run exercises the missing public API as an assertion failure.
const negatives = await import('../build/rule-negatives.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const oracle = createRuleNegativesOracle({ readSource, resolveDeclarations, recoverRuleSyntax,
  ...sourceTypes, CommandKind, ...negatives });
const fixture = (rules, legend = '') => ({ name: rules + '; ' + legend,
  source: movementSource({ rules }).replace('C = Crate', 'C = Crate\n' + legend) });
const names = cell => cell.map(term => [term.qualifier, term.name]);

test('early negative pass exposes its independent pure API', () => {
  assert.equal(typeof negatives.checkEarlyNegativeTerms, 'function', 'checkEarlyNegativeTerms API must exist');
});

test('RHS contradiction reports raw concrete positives before deleting inherited negatives', () => {
  const { result } = oracle.compareFixture(fixture('[ no Player ] -> [ Player no Player ]'));
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].severity, sourceTypes.SourceDiagnosticSeverity.Error);
  assert.deepEqual(names(result.rules[0].rhs[0][0]), [[RuleQualifier.Unspecified, 'player']]);
});

for (const [positive, legend] of [
  ['Player', ''], ['AliasPlayer', 'AliasPlayer = Player'],
  ['Things', 'Things = Player or Crate'], ['Pair', 'Pair = Player and Crate'],
]) test('RHS concrete-name-only positive membership: ' + positive, () => {
  const { result } = oracle.compareFixture(fixture(`[ ${positive} ] -> [ ${positive} no Player ]`, legend));
  assert.equal(result.diagnostics.length, positive === 'Player' ? 1 : 0);
});

test('RHS deletion skips the immediately shifted negative while LHS deletion revisits it', () => {
  const { result } = oracle.compareFixture(fixture('[ Player no Wall no Crate ] -> [ Player no Wall no Crate ]'));
  assert.deepEqual(names(result.rules[0].rhs[0][0]), [[RuleQualifier.Unspecified, 'player'], [RuleQualifier.No, 'crate']]);
  assert.deepEqual(names(result.rules[0].lhs[0][0]), [[RuleQualifier.Unspecified, 'player']]);
  assert.equal(result.diagnostics.length, 2);
});

test('RHS inherited exclusion uses verbatim names without substituting aliases', () => {
  const { result } = oracle.compareFixture(fixture('[ no Player no Crate ] -> [ no AliasPlayer no Crate ]', 'AliasPlayer = Player'));
  assert.deepEqual(names(result.rules[0].rhs[0][0]), [[RuleQualifier.No, 'aliasplayer']]);
});

test('RHS diagnostics retain every concrete positive label in authored order', () => {
  const { result } = oracle.compareFixture(fixture('[ Player ] -> [ Crate Player no Player no Crate ]'));
  assert.equal(result.diagnostics.length, 2);
  assert.match(result.diagnostics[0].message, /NO PLAYER.*CRATE, PLAYER be here/);
  assert.match(result.diagnostics[1].message, /NO CRATE.*CRATE, PLAYER be here/);
});

for (const rules of [
  '[ Player no Player ] -> [ Player ]', '[ Player no Wall ] -> [ Player ]',
  '[ Player no Things ] -> [ Player ]', '[ Things no Wall ] -> [ Things ]',
  '[ Pair no Wall ] -> [ Pair ]', '[ AliasPlayer no Wall ] -> [ AliasPlayer ]',
  '[ Player no Pair ] -> [ Player ]', '[ Player no AliasWall ] -> [ Player ]',
  '[ Player | no Wall ] -> [ Player | no Wall ]', '[ no Player no Crate ] -> [ no Player no Crate ]',
  '[ Player no Wall ] -> message Keep Rows', '[ ... | Player no Wall ] -> [ ... | Player ]',
]) test('ordered overlap, raw-name occupancy and missing lookup: ' + rules, () => {
  oracle.compareFixture(fixture(rules, 'Things = Player or Crate\nPair = Player and Crate\nAliasPlayer = Player\nAliasWall = Wall'));
});

test('a negative property requires coverage of every final layer', () => {
  const item = fixture('[ Player no Obstacles ] -> [ Player ]\n[ Player Background no Obstacles ] -> [ Player Background ]',
    'Obstacles = Wall or Crate');
  item.source = item.source.replace('Player, Crate, Wall', 'Player, Wall\nCrate');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.rules[0].lhs[0][0].length, 2);
  assert.equal(result.rules[1].lhs[0][0].length, 3);
});

test('disjoint positive requirements together cover a negative property across layers', () => {
  const item = fixture('[ Player Other no Obstacles ] -> [ Player Other ]', 'Obstacles = Wall or Crate');
  item.source = item.source.replace('Wall\nblue\n', 'Wall\nblue\n\nOther\ngreen\n')
    .replace('Player, Crate, Wall', 'Player, Wall\nCrate, Other');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.rules[0].lhs[0][0].length, 2);
  assert.match(result.diagnostics[0].message, /PLAYER, OTHER.*Layers 2, 3/);
});

test('warnings list all occupied layers in order and keep duplicate aggregate labels', () => {
  const item = fixture('[ Pair no Wall ] -> [ Pair ]', 'Pair = Player and Crate');
  item.source = item.source.replace('Player, Crate, Wall', 'Player, Wall\nCrate');
  const { result } = oracle.compareFixture(item);
  assert.match(result.diagnostics[0].message, /PAIR, PAIR.*Layers 2, 3/);
});

test('later positive terms replace each occupied layer label', () => {
  const { result } = oracle.compareFixture(fixture('[ Player Crate no Wall ] -> [ Player Crate ]'));
  assert.match(result.diagnostics[0].message, /that CRATE be there/);
});

for (const expression of ['Player and Missing', 'Missing and Player']) {
  test('unknown aggregate members supply no positive requirement: ' + expression, () => {
    const { result } = oracle.compareFixture(fixture('[ Pair no Wall ] -> [ Pair ]', 'Pair = ' + expression));
    assert.equal(result.rules[0].lhs[0][0].length, 1);
  });
}

test('final object layer assignments determine negative coverage', () => {
  const item = fixture('[ Player no Wall ] -> [ Player ]');
  item.source = item.source.replace('Player, Crate, Wall', 'Player, Crate, Wall\nWall');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.rules[0].lhs[0][0].length, 2);
  assert.deepEqual(result.diagnostics, []);
});

for (const legend of [
  'Player = Crate', 'Player = Crate or Wall', 'Player = Crate and Wall',
  'Player = Crate or Wall\nPlayer = Crate and Wall',
  'Player = Crate and Wall\nPlayer = Crate or Wall',
  'Things = Crate or Wall\nPlayer = Things',
]) test('same-name namespace priority: ' + legend, () => {
  oracle.compareFixture(fixture('[ Player no Wall ] -> [ Player no Player ]', legend));
});

test('concrete-name random precursor trims exclusions and retains directional/group evidence', () => {
  const rules = 'random horizontal [ Player no Wall | Player no Crate ] -> message row\n+ [ Player ] -> message single';
  const item = fixture(rules);
  item.source = item.source.replace('PC.', 'PP');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.rules[0].lhs[0].flat().filter(term => term.qualifier === RuleQualifier.No).length, 0);
  assert.equal(result.rules[0].directions.length, 2);
  assert.equal(result.rules[0].sourceGroup, result.rules[1].sourceGroup);
  assert.equal(result.rules[1].random, false);
});

test('concrete synonyms retain random precursor exclusions', () => {
  const item = fixture(
    'random horizontal [ AliasPlayer no Wall | AliasPlayer no Crate ] -> message row\n+ [ AliasPlayer ] -> message single',
    'AliasPlayer = Player');
  item.source = item.source.replace('PC.', 'PP');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.rules[0].lhs[0].flat().filter(term => term.qualifier === RuleQualifier.No).length, 2);
});

test('spawn precursor trims the raw concrete name before a conflicting alias changes its layer', () => {
  const item = fixture('[ Player no Wall ] -> [ Crate ]', 'Player = Other');
  item.source = item.source.replace('Wall\nblue\n', 'Wall\nblue\n\nOther\ngreen\n')
    .replace('Player, Crate, Wall', 'Player, Crate, Wall\nOther');
  const { result } = oracle.compareFixture(item);
  assert.deepEqual(names(result.rules[0].lhs[0][0]), [[RuleQualifier.Unspecified, 'player']]);
});

test('loop markers never become ordinary group predecessors', () => {
  oracle.compareFixture(fixture('late rigid random [ Player no Wall ] -> [ Player ]\nstartloop\n+ [ Player no Crate ] -> [ Player ]\nendloop'));
});

test('an unlayered raw RHS positive retains the native recovered object overlap', () => {
  const item = fixture('[ Player ] -> [ Wall no Background ]');
  item.source = item.source.replace('Player, Crate, Wall', 'Player, Crate');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].severity, sourceTypes.SourceDiagnosticSeverity.Error);
});

test('unlayered positives occupy the recovered first layer without supplying a numeric warning label', () => {
  const item = fixture('[ Crate no Wall ] -> [ Crate ]');
  item.source = item.source.replace('Background\nPlayer, Crate, Wall', 'Background, Wall\nPlayer\nBackground');
  const { result } = oracle.compareFixture(item);
  assert.deepEqual(names(result.rules[0].lhs[0][0]), [[RuleQualifier.Unspecified, 'crate']]);
  assert.match(result.diagnostics[0].message, /requirement that  be there.*Layers \)/);
});

for (const rules of [
  '[ Player ] -> [ Crate no Crate ]', '[ Crate no Crate ] -> [ Crate ]',
  '[ Things no Wall ] -> [ Things ]', '[ Pair no Wall ] -> [ Pair ]',
  '[ Wall no Mixed ] -> [ Wall ]', '[ Player ] -> [ Wall no Mixed ]',
]) test('writable orphan overlap remains explicit: ' + rules, () => {
  const item = fixture(rules, 'Things = Crate or Crate\nPair = Crate and Crate\nMixed = Crate or Wall');
  item.source = item.source.replace('Background\nPlayer, Crate, Wall', 'Background, Wall\nPlayer\nBackground');
  oracle.compareFixture(item);
});

test('the early-negative oracle rejects replacing a raw orphan lookup with its same-name final object', () => {
  const item = fixture('[ Player ] -> [ Crate no Crate ]');
  item.source = item.source.replace('Background\nPlayer, Crate, Wall', 'Background, Wall\nPlayer\nBackground');
  assert.throws(() => oracle.compareFixture(item, { resolveDeclarations: document => {
    const result = resolveDeclarations(document);
    const { declarations } = result;
    const rawObjectLookups = new Map([...declarations.rawObjectLookups].map(([object, members]) => [object,
      new Set([...members].map(member => member === declarations.orphanedObject ? member.orphanedFrom : member))]));
    return { ...result, declarations: { ...declarations, rawObjectLookups } };
  } }), /independent raw and final object lookups/);
});

test('raw concrete overlap ignores a same-name synonym override', () => {
  const item = fixture('[ Player ] -> [ Wall no Background ]', 'Wall = Player');
  item.source = item.source.replace('Player, Crate, Wall', 'Player, Crate');
  const { result } = oracle.compareFixture(item);
  assert.equal(result.diagnostics.length, 1);
});

test('with zero raw layer assignments all recovered object requirements stay empty', () => {
  const item = fixture('[ Wall no Player ] -> [ Wall no Wall ]');
  item.source = item.source.replace('Background\nPlayer, Crate, Wall', 'Unknown');
  const { result } = oracle.compareFixture(item);
  assert.deepEqual(result.rules[0].lhs[0][0].map(term => term.name), ['wall']);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].severity, sourceTypes.SourceDiagnosticSeverity.Warning);
});

for (const [name, rules, legend, corrupt] of [
  ['alias exclusions', '[ AliasPlayer no Wall ] -> [ AliasPlayer ]', 'AliasPlayer = Player', result => ({ ...result,
    rules: result.rules.map(rule => ({ ...rule, lhs: rule.lhs.map(row => row.map(cell => cell.filter(term => term.qualifier !== RuleQualifier.No))) })) })],
  ['both adjacent RHS exclusions', '[ no Player no Crate ] -> [ no Player no Crate ]', '', result => ({ ...result,
    rules: result.rules.map(rule => ({ ...rule, rhs: rule.rhs.map(row => row.map(cell => cell.filter(term => term.qualifier !== RuleQualifier.No))) })) })],
  ['contradiction checked after deletion', '[ no Player ] -> [ Player no Player ]', '', result => ({ ...result, diagnostics: [] })],
]) test('oracle rejects incorrect ' + name, () => {
  assert.throws(() => oracle.compareFixture(fixture(rules, legend), {
    checkEarlyNegativeTerms: (...args) => corrupt(negatives.checkEarlyNegativeTerms(...args)),
  }), /effective early negatives|early negative diagnostics/);
});

test('oracle detects input map mutation even though Object.freeze cannot freeze Map contents', () => {
  assert.throws(() => oracle.compareFixture(fixture('[ Player no Wall ] -> [ Player ]'), {
    checkEarlyNegativeTerms: (rules, declarations) => {
      const result = negatives.checkEarlyNegativeTerms(rules, declarations);
      declarations.namedObjects.clear();
      return result;
    },
  }), /inputs are unchanged/);
});

test('all native producers, including the early negative pass, are guarded', () => {
  for (const name of ['compile', 'loadFile', 'processRuleString', 'tokenizeRuleLine', 'findIndexAfterToken',
    'generateExtraMembers', 'generateMasks', 'lookupLegendName', 'checkSuperfluousCoincidences']) {
    assert.throws(() => oracle.compareFixture(fixture('[ Player ] -> win'), {
      readSource: source => { globalThis[name](); return readSource(source); },
    }), new RegExp('Candidate called native ' + name));
  }
  assert.throws(() => oracle.independently(() => runInThisContext('new codeMirrorFn().startState()')), /Candidate called native codeMirrorFn/);
});

test('all 478 retained simulation sources match before and after the native early negative pass', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  const totals = { sources: 0, captured: 0, rules: 0, diagnostics: 0 };
  for (const item of fixtures) {
    const { result, captured } = oracle.compareFixture(item);
    totals.sources++;
    totals.captured += captured;
    totals.rules += result.rules.length;
    totals.diagnostics += result.diagnostics.length;
  }
  t.diagnostic(JSON.stringify(totals));
});
