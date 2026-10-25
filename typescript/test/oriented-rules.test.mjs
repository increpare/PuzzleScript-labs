import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import { checkEarlyNegativeTerms } from '../build/rule-negatives.js';
import * as sourceTypes from '../build/source-model.js';
import { Direction } from '../build/model.js';
import { CommandKind } from '../build/commands.js';
import { RuleQualifier as Q } from '../build/source-rule-model.js';
import { movementSource } from './scenarios.mjs';
import { createOrientedRulesOracle } from './legacy-oriented-rules.cjs';

// Missing new APIs produce assertion failures in the initial red run.
const optionalModule = path => import(path).catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const orientations = await optionalModule('../build/rule-orientations.js');
const names = await optionalModule('../build/rule-names.js');
const oracle = createOrientedRulesOracle({ readSource, resolveDeclarations, recoverRuleSyntax, checkEarlyNegativeTerms,
  ...sourceTypes, CommandKind, ...orientations, ...names });
const fixture = (rules, legend = '') => ({ name: rules + '; ' + legend,
  source: movementSource({ rules }).replace('C = Crate', 'C = Crate\n' + legend) });
const terms = cell => cell.map(term => [term.qualifier, term.name]);

test('orientation and name passes expose independent pure APIs', () => {
  assert.equal(typeof orientations.orientRules, 'function', 'orientRules API must exist');
  assert.equal(typeof names.expandRuleNames, 'function', 'expandRuleNames API must exist');
});

for (const direction of ['up', 'down', 'left', 'right']) {
  test('every relative qualifier resolves on both sides before ' + direction + ' reversal', () => {
    oracle.compareFixture(fixture(`${direction} [ ^ Player v Crate < Wall > Background parallel Player perpendicular Crate | Player ] -> [ > Crate < Player v Background ^ Wall perpendicular Player parallel Crate | Crate ]`));
  });
}

test('repeated selectors remain repeated in their original order', () => {
  const { result } = oracle.compareFixture(fixture('up up left [ Player | Crate ] -> [ Player | Crate ]'));
  assert.deepEqual(result.rules.map(rule => rule.direction), [Direction.Down, Direction.Down, Direction.Right]);
  assert.deepEqual(result.rules.map(rule => rule.lhs[0].map(cell => cell[0].name)), Array(3).fill(['crate', 'player']));
});

test('negative deletion does not reconsider already chosen directional selectors', () => {
  const { negatives, result } = oracle.compareFixture(fixture('[ Player no Wall ] -> [ Player ]'));
  assert.equal(negatives.rules[0].lhs[0][0].length, 1);
  assert.deepEqual(negatives.rules[0].directions, [Direction.Up]);
  assert.deepEqual(result.rules.map(rule => rule.direction), [Direction.Down]);
});

test('relative resolution precedes reversal and aggregate append order', () => {
  const { result } = oracle.compareFixture(fixture('up left [ > Pair vertical AliasC | ^ Player ] -> [ < Pair | v Player ] again',
    'Pair = Crate and Wall\nAliasC = Background'));
  assert.deepEqual(result.rules.map(rule => rule.direction), [Direction.Down, Direction.Right]);
  assert.deepEqual(result.rules.map(rule => rule.lhs[0].map(terms)), [
    [[[Q.Left, 'player']], [[Q.Up, 'crate'], [Q.Vertical, 'background'], [Q.Up, 'wall']]],
    [[[Q.Down, 'player']], [[Q.Left, 'crate'], [Q.Vertical, 'background'], [Q.Left, 'wall']]],
  ]);
  assert.deepEqual(result.rules.map(rule => rule.rhs[0].map(terms)), [
    [[[Q.Right, 'player']], [[Q.Down, 'crate'], [Q.Down, 'wall']]],
    [[[Q.Up, 'player']], [[Q.Right, 'crate'], [Q.Right, 'wall']]],
  ]);
});

test('parallel and perpendicular provenance remains distinct from horizontal and vertical', () => {
  const { result } = oracle.compareFixture(fixture('right [ parallel Pair perpendicular Player ] -> [ horizontal Pair vertical Player ]',
    'Pair = Crate and Wall'));
  assert.deepEqual(terms(result.rules[0].lhs[0][0]), [[Q.HorizontalParallel, 'crate'], [Q.VerticalPerpendicular, 'player'], [Q.HorizontalParallel, 'wall']]);
  assert.deepEqual(terms(result.rules[0].rhs[0][0]), [[Q.Horizontal, 'crate'], [Q.Vertical, 'player'], [Q.Horizontal, 'wall']]);
});

for (const rules of [
  'up [ Player | Crate ] [ Wall | Background ] -> [ Crate | Player ] [ Background | Wall ]',
  'left [ Player | Crate ] [ Wall | Background ] -> [ AliasPlayer | AliasCrate ]',
  'up [ Player | Crate ] -> [ AliasPlayer | AliasCrate ] [ AliasCrate | AliasPlayer ]',
  'left [ Player ] -> [ AliasPlayer | AliasCrate ]',
  'up [ Player | Crate ] -> [ AliasPlayer ]',
  'left [ Player | Crate ] -> message missing',
]) test('recovered row and cell boundaries: ' + rules, () => {
  oracle.compareFixture(fixture(rules, 'AliasPlayer = Player\nAliasCrate = Crate'));
});

for (const rules of [
  'up [ ... | Player | Crate ] -> [ ... | Crate | Player ]',
  'left [ Player | ... | Crate ] -> [ Player | ... | Crate ]',
  'up [ Player ... | Crate ] -> [ Player ... | Crate ]',
  'left [ ... Player | Crate ] -> [ ... Player | Crate ]',
  'up [ Player | Crate ] -> [ ... | Player ]',
]) test('ellipsis reversal checks the first LHS term name: ' + rules, () => oracle.compareFixture(fixture(rules)));

test('malformed non-first ellipsis still reverses, while first-name ellipsis keeps up', () => {
  const nonfirst = oracle.compareFixture(fixture('up [ Player ... | Crate ] -> [ Player | Crate ]'));
  const first = oracle.compareFixture(fixture('up [ ... Player | Crate ] -> [ Player | Crate ]'));
  assert.equal(nonfirst.result.rules[0].direction, Direction.Down);
  assert.equal(first.result.rules[0].direction, Direction.Up);
});

for (const [rules, legend] of [
  ['right [ Pair Player ] -> [ Pair Player ]', 'Pair = Wall and Crate'],
  ['right [ Pair Pair ] -> [ Pair Pair ]', 'Pair = Crate and Crate'],
  ['right [ AliasPair ] -> [ AliasPair ]', 'Pair = Crate and Wall\nAliasPair = Pair'],
  ['right [ AliasThings ] -> [ AliasThings ]', 'Things = Crate or Wall\nAliasThings = Things'],
  ['right [ Pair ] -> [ Pair ]', 'Pair = Wall and Missing'],
  ['right [ Pair ] -> [ Pair ]', 'Pair = Missing and Wall'],
  ['right [ Pair ] -> [ Pair ]', 'Pair = Crate and Wall\nPair = Player'],
  ['right [ Pair ] -> [ Pair ]', 'Pair = Player\nPair = Crate and Wall'],
  ['right [ Player ] -> [ Player ]', 'Player = Crate and Wall\nPlayer = Background'],
  ['right [ Pair ] -> [ Pair ]', 'Pair = Crate and Wall\nCrate = Player'],
  ['late random right [ random Pair stationary AliasPlayer ] -> [ random Pair randomdir AliasPlayer ] again', 'Pair = Crate and Wall\nAliasPlayer = Player'],
]) test('ordered aggregate expansion and final synonym substitution: ' + rules + '; ' + legend, () => {
  oracle.compareFixture(fixture(rules, legend));
});

test('aggregate first member replaces in place and remaining members append without deduplication', () => {
  const { result } = oracle.compareFixture(fixture('right [ Pair Player Pair ] -> [ Pair Player Pair ]', 'Pair = Wall and Crate'));
  assert.deepEqual(result.rules[0].lhs[0][0].map(term => term.name), ['wall', 'player', 'wall', 'crate', 'crate']);
});

test('no aggregate reports the native error for every occurrence and still expands', () => {
  const { result } = oracle.compareFixture(fixture('up right [ Player | Crate ] -> [ no Pair | Player ]', 'Pair = Crate and Wall'));
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.diagnostics.every(issue => issue.code === 'negative-rule-aggregate'));
  assert.match(result.diagnostics[0].message, /^You cannot use 'no' to exclude the aggregate object PAIR \(defined using 'AND'\)/);
  assert.deepEqual(terms(result.rules[0].rhs[0][1]), [[Q.No, 'crate'], [Q.No, 'wall']]);
});

test('extra malformed RHS cells expand aggregates but keep unsubstituted aliases', () => {
  const { result } = oracle.compareFixture(fixture('right [ Player ] -> [ AliasPlayer AliasPair | AliasPlayer AliasPair ]',
    'AliasPlayer = Player\nPair = Crate and Wall\nAliasPair = Pair'));
  assert.deepEqual(result.rules[0].rhs.map(row => row.map(cell => cell.map(term => term.name))), [
    [['player', 'crate', 'wall'], ['aliasplayer', 'crate', 'wall']],
  ]);
});

test('artificial stage boundary: unmatched RHS rows neither reverse nor substitute aliases', () => {
  const { result } = oracle.compareFixture(fixture('up [ Player | Crate ] [ Wall | Background ] -> [ AliasPlayer | AliasCrate ] [ AliasCrate AliasPair | AliasPlayer AliasPair ]',
    'AliasPlayer = Player\nAliasCrate = Crate\nPair = Crate and Wall\nAliasPair = Pair'), { lhsRowsAtStageBoundary: 1 });
  assert.deepEqual(result.rules[0].rhs.map(row => row.map(cell => cell.map(term => term.name))), [
    [['crate'], ['player']], [['aliascrate', 'crate', 'wall'], ['aliasplayer', 'crate', 'wall']],
  ]);
});

test('one synonym lookup does not chase a name introduced by that lookup', () => {
  const { result, declarations } = oracle.compareFixture(fixture('right [ First ] -> [ First ]',
    'First = Second\nSecond = Third\nThird = Player'));
  assert.equal(declarations.ruleNames.synonyms.get('first'), 'third');
  assert.equal(declarations.ruleNames.synonyms.get('third'), 'player');
  assert.deepEqual(result.rules[0].lhs[0][0].map(term => term.name), ['third']);
  assert.deepEqual(result.rules[0].rhs[0][0].map(term => term.name), ['third']);
});

test('moving selector without relative terms preserves the fifth InPlace variant', () => {
  const { result } = oracle.compareFixture(fixture('moving [ Player | Crate ] -> [ Player | Crate ]'));
  assert.deepEqual(result.rules.map(rule => rule.direction), [Direction.Down, Direction.Down, Direction.Right, Direction.Right, Direction.InPlace]);
  assert.deepEqual(result.rules[4].lhs[0].map(cell => cell[0].name), ['player', 'crate']);
});

test('native and candidate independently preserve the InPlace-relative TypeError category', () => {
  const item = fixture('moving [ > Player ] -> [ Player ]');
  assert.throws(() => oracle.nativeStages(item.source), TypeError);
  assert.throws(() => oracle.candidateStages(item.source), error => error instanceof TypeError && /InPlace.*relative/i.test(error.message));
});

const emptyAggregate = () => {
  const item = fixture('right [ Player ] -> [ Player ]', 'Pair = Player and Player\nPlayer = Pair');
  return { ...item, source: item.source.replace('P = Player\n', '') };
};

test('empty aggregate recovery preserves the full native compilation TypeError category', () => {
  const item = emptyAggregate();
  const observed = oracle.nativeStages(item.source);
  assert.deepEqual(observed.aggregates, { pair: [], player: [] });
  assert.deepEqual(observed.after[0].lhs, [[['', undefined]]]);
  assert.deepEqual(observed.after[0].rhs, [[['', undefined]]]);
  assert.deepEqual(observed.diagnostics, []);
  // Run both pipelines separately with only original text shared across them.
  const programs = [
    `const {loadPuzzleScript}=require('./test/native-host.cjs');
     loadPuzzleScript();
     try { compile(['loadLevel',0],${JSON.stringify(item.source)},null); process.stdout.write(JSON.stringify({name:null})); }
     catch(error) { process.stdout.write(JSON.stringify({name:error.name})); }`,
    `Promise.all([import('./build/source-reader.js'),import('./build/declarations.js'),import('./build/rule-syntax.js'),
      import('./build/rule-negatives.js'),import('./build/rule-orientations.js'),import('./build/rule-names.js')])
     .then(([reader,resolver,syntax,negatives,orientation,names])=>{
       const {document}=reader.readSource(${JSON.stringify(item.source)});
       const {declarations}=resolver.resolveDeclarations(document);
       const before=negatives.checkEarlyNegativeTerms(syntax.recoverRuleSyntax(document,declarations).rules,declarations);
       try { names.expandRuleNames(orientation.orientRules(before.rules),declarations); process.stdout.write(JSON.stringify({name:null})); }
       catch(error) { process.stdout.write(JSON.stringify({name:error.name,message:error.message})); }
     });`,
  ];
  const failures = programs.map(program => {
    const child = spawnSync(process.execPath, ['-e', program], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 4000 });
    assert.equal(child.error, undefined, 'bounded child finishes');
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  });
  assert.equal(failures[0].name, 'TypeError');
  assert.equal(failures[1].name, 'TypeError');
  assert.match(failures[1].message, /empty aggregate.*player/i);
});

test('empty-aggregate failure leaves every candidate input unchanged', () => {
  const { document } = readSource(emptyAggregate().source);
  const { declarations } = resolveDeclarations(document);
  const syntax = recoverRuleSyntax(document, declarations);
  const negative = checkEarlyNegativeTerms(syntax.rules, declarations);
  const oriented = orientations.orientRules(negative.rules);
  const inputs = { document, declarations, syntax, negative, oriented };
  const before = structuredClone(inputs);
  const freeze = (value, seen = new Set()) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) for (const [key, entry] of value) { freeze(key, seen); freeze(entry, seen); }
    else if (value instanceof Set) for (const entry of value) freeze(entry, seen);
    else for (const entry of Object.values(value)) freeze(entry, seen);
    Object.freeze(value);
  };
  freeze(inputs);
  assert.throws(() => names.expandRuleNames(oriented, declarations), TypeError);
  assert.deepEqual(inputs, before, 'failure inputs are unchanged');
});

for (const [name, item, corrupt] of [
  ['early variant deduplication', fixture('up up left [ Player | Crate ] -> [ Player | Crate ]'), rules => rules.filter((_, index) => index !== 1)],
  ['rotation after reversal', fixture('up [ > Player | ^ Crate ] -> [ < Player | v Crate ]'), rules => rules.map(rule => ({ ...rule,
    lhs: rule.lhs.map(row => row.map(cell => cell.map(term => ({ ...term, qualifier: Q.Down })))) }))],
  ['changed rule metadata', fixture('random [ Player | Crate ] -> [ Player | Crate ] again'), rules => rules.map(rule => ({ ...rule, random: false }))],
  ['changed source evidence', fixture('up [ Player | Crate ] -> [ Player | Crate ]'), rules => rules.map(rule => ({ ...rule,
    lhs: rule.lhs.map(row => row.map(cell => cell.map(term => ({ ...term, origin: structuredClone(term.origin) })))) }))],
]) test('oracle rejects ' + name, () => {
  assert.throws(() => oracle.compareFixture(item, { orientRules: (...args) => corrupt(orientations.orientRules(...args)) }),
    /effective orientations|evidence identity|identity\/value/);
});

test('oracle rejects sorted aggregate members', () => {
  assert.throws(() => oracle.compareFixture(fixture('right [ Pair ] -> [ Pair ]', 'Pair = Wall and Crate'), {
    expandRuleNames: (...args) => {
      const result = names.expandRuleNames(...args);
      return { ...result, rules: result.rules.map(rule => ({ ...rule,
        lhs: rule.lhs.map(row => row.map(cell => [...cell].sort((a, b) => a.name.localeCompare(b.name)))) })) };
    },
  }), /effective expanded names/);
});

test('oracle rejects alias substitution before aggregate expansion', () => {
  assert.throws(() => oracle.compareFixture(fixture('right [ Pair ] -> [ Pair ]', 'Pair = Crate and Wall\nPair = Player'), {
    expandRuleNames: (rules, declarations) => names.expandRuleNames(rules.map(rule => ({ ...rule,
      lhs: rule.lhs.map(row => row.map(cell => cell.map(term => ({ ...term,
        name: declarations.ruleNames.synonyms.get(term.name) ?? term.name })))),
    })), declarations),
  }), /effective expanded names|preserve expanded evidence/);
});

test('oracle detects input map mutation beyond Object.freeze', () => {
  assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> [ Player ]'), {
    expandRuleNames: (rules, declarations) => {
      const result = names.expandRuleNames(rules, declarations);
      declarations.ruleNames.aggregates.clear();
      declarations.ruleNames.synonyms.clear();
      return result;
    },
  }), /inputs are unchanged/);
});

test('every native producer including orientation and name functions is guarded', () => {
  for (const name of oracle.producers) {
    assert.throws(() => oracle.compareFixture(fixture('[ Player ] -> win'), {
      readSource: source => { globalThis[name](); return readSource(source); },
    }), new RegExp('Candidate called native ' + name));
  }
  assert.throws(() => oracle.independently(() => runInThisContext('new codeMirrorFn().startState()')), /Candidate called native codeMirrorFn/);
});

test('all 478 retained simulation sources match orientations, names, order and new diagnostics', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  const totals = { sources: 0, captured: 0, before: 0, oriented: 0, diagnostics: 0 };
  for (const item of fixtures) {
    const report = oracle.compareFixture(item);
    totals.sources++;
    totals.captured += report.captured;
    totals.before += report.negatives.rules.length;
    totals.oriented += report.result.rules.length;
    totals.diagnostics += report.result.diagnostics.length;
  }
  t.diagnostic(JSON.stringify(totals));
});
