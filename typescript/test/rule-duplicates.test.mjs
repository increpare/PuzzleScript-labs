import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { runInThisContext } from 'node:vm';
import { readSource } from '../build/source-reader.js';
import { resolveDeclarations } from '../build/declarations.js';
import { recoverRuleSyntax } from '../build/rule-syntax.js';
import { checkEarlyNegativeTerms } from '../build/rule-negatives.js';
import { orientRules } from '../build/rule-orientations.js';
import { expandRuleNames } from '../build/rule-names.js';
import { expandRuleMovements } from '../build/rule-movements.js';
import { expandRuleProperties } from '../build/rule-properties.js';
import { inferSpawnedStationary } from '../build/rule-spawns.js';
import { CommandKind } from '../build/commands.js';
import { Direction } from '../build/model.js';
import { RuleQualifier as Q } from '../build/source-rule-model.js';
import { movementSource } from './scenarios.mjs';
import { createRuleDuplicatesOracle } from './legacy-rule-duplicates.cjs';

const duplicates = await import('../build/rule-duplicates.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const oracle = createRuleDuplicatesOracle({ readSource, resolveDeclarations, recoverRuleSyntax, checkEarlyNegativeTerms,
  orientRules, expandRuleNames, expandRuleMovements, expandRuleProperties, inferSpawnedStationary,
  CommandKind, RuleQualifier: Q, ...duplicates });
const fixture = (rules, legend = '', layers = 'Player, Crate, Wall') => ({ name: rules + '; ' + legend,
  source: movementSource({ rules }).replace('C = Crate', 'C = Crate\n' + legend)
    .replace('Player, Crate, Wall', layers) });

// These records deliberately exercise a stage boundary. Native records and
// typed records are built separately; neither is translated from the other.
const boundarySource = readSource(movementSource({ rules: 'right [ Player ] -> win' })).document.rules[0];
const span = line => ({ start: { line, column: 1, offset: 0 }, end: { line, column: 2, offset: 1 } });
const sourceAt = line => ({ ...structuredClone(boundarySource), originalLine: {
  ...structuredClone(boundarySource.originalLine), span: span(line),
} });
const term = (name = 'player', qualifier = Q.Unspecified, line = 41) => ({ name, qualifier, origin: span(line) });
const nativeRule = (patch = {}) => ({ lineNumber: 41, groupNumber: 41, direction: 'right',
  lhs: [[['', 'player']]], rhs: [], late: false, rigid: false, randomRule: false, commands: [['win']], ...patch });
const candidateRule = (patch = {}) => ({ source: sourceAt(41), sourceGroup: 41, direction: Direction.Right,
  lhs: [[[term()]]], rhs: [], late: false, rigid: false, random: false, commands: [{ kind: CommandKind.Win }], ...patch });
const boundary = (name, native, candidate) => ({ name: 'stage-boundary: ' + name, native, candidate });

test('native repeated-selector baseline requires the duplicate API', () => {
  const item = fixture('right right [ Player | Wall ] -> [ Player | Wall ]');
  const native = oracle.nativeStages(item.source);
  assert.equal(native.before.length, 2);
  assert.deepEqual(native.indices, [1], 'native keeps the last repeated selector');
  assert.equal(typeof duplicates.normalizeRuleDuplicates, 'function', 'native-backed normalizeRuleDuplicates API must exist');
  oracle.compareFixture(item);
});

test('empty input returns a fresh ordinary array', () => {
  const inputs = Object.freeze([]);
  const result = duplicates.normalizeRuleDuplicates(inputs);
  assert.deepEqual(result, []);
  assert.notEqual(result, inputs);
});

test('equivalent reversed orientations keep the last horizontal variant', () => {
  const { spawned, result, expected } = oracle.compareFixture(fixture('horizontal [ Player | Player ] -> message row'));
  assert.equal(spawned.length, 2);
  assert.equal(result.length, 1);
  assert.deepEqual(expected.indices, [1]);
});

test('different reversed cell orders stay distinct', () => {
  const { result } = oracle.compareFixture(fixture('horizontal [ Player | Wall ] -> message row'));
  assert.deepEqual(result.map(rule => rule.lhs[0].map(cell => cell[0].name)), [['wall', 'player'], ['player', 'wall']]);
});

test('single-cell relative movement values remain distinct after orientation', () => {
  const { result } = oracle.compareFixture(fixture('up down left right [ > Player ] -> [ > Player ]'));
  assert.deepEqual(result.map(rule => rule.lhs[0][0][0].qualifier), [Q.Up, Q.Down, Q.Left, Q.Right]);
});

test('several single-cell rows survive syntax selector trimming', () => {
  const { syntax, result } = oracle.compareFixture(fixture('up down left right [ Player ] [ Wall ] -> win'));
  assert.equal(syntax.rules[0].directions.length, 1, 'native syntax already trims non-directional selectors');
  assert.equal(result.length, 1);
  assert.equal(result[0].lhs.length, 2);
});

test('ordered duplicate property choices collapse to the last occurrence of each value', () => {
  const { spawned, result, expected } = oracle.compareFixture(fixture(
    'right [ Things | Wall ] -> [ Player | Things ]', 'Things = Crate or Player or Crate'));
  assert.equal(spawned.length, 3);
  assert.deepEqual(expected.indices, [1, 2]);
  assert.deepEqual(result.map(rule => rule.lhs[0][0][0].name), ['player', 'crate']);
});

test('property aliases collapse equal variants without losing repeated aggregate terms', () => {
  const { result, expected } = oracle.compareFixture(fixture(
    'right right [ Alias Pair | Wall ] -> [ Player Pair | Alias ]',
    'Things = Crate or Player or Crate\nAlias = Things\nPair = Player and Player'));
  assert.deepEqual(expected.indices, [4, 5]);
  assert.equal(result.length, 2);
  assert.ok(result.every(rule => rule.lhs[0][0].length === 3 && rule.lhs[0][0][1].name === 'player'
    && rule.lhs[0][0][2].name === 'player'));
});

test('duplicate movement paths retain ordered concrete movement choices', () => {
  const { movement, result, expected } = oracle.compareFixture(fixture(
    'right right [ horizontal Pair | Wall ] -> [ horizontal Pair | Wall ]', 'Pair = Player and Player'));
  assert.equal(movement.rules.length, 4);
  assert.deepEqual(expected.indices, [2, 3]);
  assert.deepEqual(result.map(rule => rule.lhs[0][0].map(value => value.qualifier)), [[Q.Left, Q.Left], [Q.Right, Q.Right]]);
});

test('aggregate members and authored repeated terms keep their ordered slots', () => {
  for (const rule of ['right right [ Pair | Wall ] -> [ Pair | Wall ]',
    'right right [ Player Player | Wall ] -> [ Player Player | Wall ]']) {
    const { result } = oracle.compareFixture(fixture(rule, 'Pair = Player and Player'));
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].lhs[0][0].map(value => value.name), ['player', 'player']);
  }
});

test('same-group rules on different physical source lines remain separate candidates', () => {
  const { result } = oracle.compareFixture(fixture('right [ Player ] -> win\n+ right [ Player ] -> win'));
  assert.equal(result.length, 2);
  assert.equal(result[0].sourceGroup, result[1].sourceGroup);
  assert.notEqual(result[0].source.originalLine.span.start.line, result[1].source.originalLine.span.start.line);
});

for (const header of ['rigid', 'random', 'late', 'late rigid random']) {
  test('source variants preserve flags and command payloads: ' + header, () => {
    const { result } = oracle.compareFixture(fixture(header + ' right right [ Player | Wall ] -> message Mixed CASE'));
    assert.equal(result.length, 1);
    assert.equal(result[0].commands[0].text, 'Mixed CASE');
    assert.equal(result[0].late, header.includes('late'));
    assert.equal(result[0].rigid, header.includes('rigid'));
    assert.equal(result[0].random, header.includes('random'));
  });
}

test('source command order and distinct sound indices remain intact', () => {
  const { result } = oracle.compareFixture(fixture('right right [ Player | Wall ] -> sfx0 sfx1 win again'));
  assert.deepEqual(result[0].commands, [{ kind: CommandKind.Sound, index: 0 }, { kind: CommandKind.Sound, index: 1 },
    { kind: CommandKind.Win }, { kind: CommandKind.Again }]);
});

test('malformed ellipsis recovery retains a real non-ellipsis name before normalization', () => {
  const { syntax, spawned, result } = oracle.compareFixture(fixture('right right [ > ... Player ] -> win'));
  assert.deepEqual(syntax.rules[0].lhs[0][0].map(value => [value.qualifier, value.name]), [[Q.Forward, '...'], [Q.Ellipsis, 'player']]);
  assert.equal(spawned.length, 2);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].lhs[0][0].map(value => [value.qualifier, value.name]), [[Q.Right, '...'], [Q.Ellipsis, 'player']]);
});

const lastBoundary = boundary('last occurrence ignores distinct authored sources and origins',
  () => [nativeRule(), nativeRule()],
  () => [candidateRule({ lhs: [[[term('player', Q.Unspecified, 12)]]] }),
    candidateRule({ lhs: [[[term('player', Q.Unspecified, 99)]]] })]);
test(lastBoundary.name, () => {
  const { inputs, result, expected } = oracle.compareBoundary(lastBoundary);
  assert.deepEqual(expected.indices, [1]);
  assert.notEqual(inputs[0].source, inputs[1].source);
  assert.notEqual(inputs[0].lhs[0][0][0].origin, inputs[1].lhs[0][0][0].origin);
  assert.equal(result[0], inputs[1]);
});

const contiguousBoundary = boundary('non-contiguous source groups restart comparison scope',
  () => [nativeRule(), nativeRule(), nativeRule({ groupNumber: 42 }), nativeRule(), nativeRule()],
  () => [candidateRule(), candidateRule(), candidateRule({ sourceGroup: 42 }), candidateRule(), candidateRule()]);
test(contiguousBoundary.name, () => {
  const { expected } = oracle.compareBoundary(contiguousBoundary);
  assert.deepEqual(expected.indices, [1, 2, 4]);
});

const oneCellDirection = boundary('one-cell direction is omitted from identity',
  () => [nativeRule(), nativeRule({ direction: 'down' })],
  () => [candidateRule(), candidateRule({ direction: Direction.Down })]);
const severalRowsDirection = boundary('several single-cell rows still omit direction',
  () => ['right', 'down'].map(direction => nativeRule({ direction, lhs: [[['', 'player']], [['', 'wall']]] })),
  () => [Direction.Right, Direction.Down].map(direction => candidateRule({ direction, lhs: [[[term()]], [[term('wall')]]] })));
const relativeDirection = boundary('relative qualifier alone does not make direction significant',
  () => ['right', 'down'].map(direction => nativeRule({ direction, lhs: [[['>', 'player']]] })),
  () => [Direction.Right, Direction.Down].map(direction => candidateRule({ direction, lhs: [[[term('player', Q.Forward)]]] })));
const rhsDirection = boundary('only LHS row lengths make direction significant',
  () => ['right', 'down'].map(direction => nativeRule({ direction, rhs: [[['', 'player'], ['', 'wall']]] })),
  () => [Direction.Right, Direction.Down].map(direction => candidateRule({ direction, rhs: [[[term()], [term('wall')]]] })));
const multiCellDirection = boundary('any multi-cell LHS row makes direction significant',
  () => ['right', 'down'].map(direction => nativeRule({ direction, lhs: [[['', 'player']], [['', 'player'], ['', 'wall']]] })),
  () => [Direction.Right, Direction.Down].map(direction => candidateRule({ direction, lhs: [[[term()]], [[term()], [term('wall')]]] })));
for (const item of [oneCellDirection, severalRowsDirection, relativeDirection, rhsDirection, multiCellDirection]) {
  test(item.name, () => {
    const { expected } = oracle.compareBoundary(item);
    assert.deepEqual(expected.indices, item === multiCellDirection ? [0, 1] : [1]);
  });
}

const ellipsisBoundary = boundary('malformed recovered ellipsis names are omitted from identity',
  () => ['player', 'crate'].map(name => nativeRule({ lhs: [[['right', '...', '...', name]]] })),
  () => ['player', 'crate'].map(name => candidateRule({ lhs: [[[term('...', Q.Right), term(name, Q.Ellipsis)]]] })));
test(ellipsisBoundary.name, () => {
  const { result, expected } = oracle.compareBoundary(ellipsisBoundary);
  assert.deepEqual(expected.indices, [1]);
  assert.equal(result[0].lhs[0][0][1].name, 'crate', 'survivor keeps the omitted recovery name');
});

test('stage-boundary: RHS ellipsis names are also omitted from identity', () => {
  const { expected } = oracle.compareBoundary(boundary('RHS ellipsis name omission',
    () => ['player', 'crate'].map(name => nativeRule({ rhs: [[['...', name]]] })),
    () => ['player', 'crate'].map(name => candidateRule({ rhs: [[[term(name, Q.Ellipsis)]]] }))));
  assert.deepEqual(expected.indices, [1]);
});

test('stage-boundary: normalization preserves impossible cells and redundant exclusions', () => {
  const { result, expected } = oracle.compareBoundary(boundary('no impossible-rule pruning or repeated early cleanup',
    () => [nativeRule({ lhs: [[['', 'player', 'no', 'player']]] }), nativeRule({ lhs: [[['', 'player', 'no', 'wall']]] })],
    () => [candidateRule({ lhs: [[[term(), term('player', Q.No)]]] }), candidateRule({ lhs: [[[term(), term('wall', Q.No)]]] })]));
  assert.deepEqual(expected.indices, [0, 1]);
  assert.ok(result.every(rule => rule.lhs[0][0].length === 2));
});

const distinctFields = [
  ['physical line', { lineNumber: 42 }, { source: sourceAt(42) }],
  ['late', { late: true }, { late: true }],
  ['rigid', { rigid: true }, { rigid: true }],
  ['random', { randomRule: true }, { random: true }],
  ['term name', { lhs: [[['', 'wall']]] }, { lhs: [[[term('wall')]]] }],
  ['term qualifier', { lhs: [[['stationary', 'player']]] }, { lhs: [[[term('player', Q.Stationary)]]] }],
  ['repeated terms', { lhs: [[['', 'player', '', 'player']]] }, { lhs: [[[term(), term()]]] }],
  ['LHS row count', { lhs: [[['', 'player']], [['', 'player']]] }, { lhs: [[[term()]], [[term()]]] }],
  ['LHS cell count', { lhs: [[['', 'player'], ['', 'player']]] }, { lhs: [[[term()], [term()]]] }],
  ['RHS row count', { rhs: [[['', 'player']]] }, { rhs: [[[term()]]] }],
  ['command kind', { commands: [['cancel']] }, { commands: [{ kind: CommandKind.Cancel }] }],
  ['command count', { commands: [['win'], ['again']] }, { commands: [{ kind: CommandKind.Win }, { kind: CommandKind.Again }] }],
];
for (const [name, nativePatch, candidatePatch] of distinctFields) {
  test('stage-boundary: equality includes ' + name, () => {
    const { expected } = oracle.compareBoundary(boundary(name,
      () => [nativeRule(), nativeRule(nativePatch)], () => [candidateRule(), candidateRule(candidatePatch)]));
    assert.deepEqual(expected.indices, [0, 1]);
  });
}

const termOrder = boundary('term order is significant',
  () => [nativeRule({ lhs: [[['', 'player', '', 'crate']]] }), nativeRule({ lhs: [[['', 'crate', '', 'player']]] })],
  () => [candidateRule({ lhs: [[[term(), term('crate')]]] }), candidateRule({ lhs: [[[term('crate'), term()]]] })]);
const commandPayload = boundary('message text is significant',
  () => ['First Message', 'Second Message'].map(text => nativeRule({ commands: [['message', text]] })),
  () => ['First Message', 'Second Message'].map(text => candidateRule({ commands: [{ kind: CommandKind.Message, text }] })));
const soundPayload = boundary('sound index is significant',
  () => [nativeRule({ commands: [['sfx0']] }), nativeRule({ commands: [['sfx1']] })],
  () => [candidateRule({ commands: [{ kind: CommandKind.Sound, index: 0 }] }), candidateRule({ commands: [{ kind: CommandKind.Sound, index: 1 }] })]);
const orderBoundaries = [
  termOrder, commandPayload, soundPayload,
  boundary('command order is significant',
    () => [nativeRule({ commands: [['win'], ['again']] }), nativeRule({ commands: [['again'], ['win']] })],
    () => [candidateRule({ commands: [{ kind: CommandKind.Win }, { kind: CommandKind.Again }] }),
      candidateRule({ commands: [{ kind: CommandKind.Again }, { kind: CommandKind.Win }] })]),
  boundary('row order is significant',
    () => [nativeRule({ lhs: [[['', 'player']], [['', 'wall']]] }), nativeRule({ lhs: [[['', 'wall']], [['', 'player']]] })],
    () => [candidateRule({ lhs: [[[term()]], [[term('wall')]]] }), candidateRule({ lhs: [[[term('wall')]], [[term()]]] })]),
  boundary('RHS term values are significant',
    () => [nativeRule({ rhs: [[['', 'crate']]] }), nativeRule({ rhs: [[['', 'wall']]] })],
    () => [candidateRule({ rhs: [[[term('crate')]]] }), candidateRule({ rhs: [[[term('wall')]]] })]),
  boundary('RHS cell order is significant',
    () => [nativeRule({ rhs: [[['', 'player'], ['', 'wall']]] }), nativeRule({ rhs: [[['', 'wall'], ['', 'player']]] })],
    () => [candidateRule({ rhs: [[[term()], [term('wall')]]] }), candidateRule({ rhs: [[[term('wall')], [term()]]] })]),
  boundary('non-ellipsis qualifiers still compare an ellipsis-spelled name',
    () => ['...', 'wall'].map(name => nativeRule({ lhs: [[['right', name]]] })),
    () => ['...', 'wall'].map(name => candidateRule({ lhs: [[[term(name, Q.Right)]]] }))),
];
for (const item of orderBoundaries) test(item.name, () => {
  assert.deepEqual(oracle.compareBoundary(item).expected.indices, [0, 1]);
});

test('concrete and aliased random precursors retain three versus four application candidates on PP', () => {
  const results = [];
  for (const name of ['Player', 'AliasPlayer']) {
    const item = fixture(`random horizontal [ ${name} no Wall | ${name} no Crate ] -> message row\n+ [ ${name} ] -> message single`,
      name === 'AliasPlayer' ? 'AliasPlayer = Player' : '');
    item.source = item.source.replace('PC.', 'PP');
    const compared = oracle.compareFixture(item);
    const { negatives, result } = compared;
    assert.equal(negatives.rules[0].lhs[0].flat().filter(value => value.qualifier === Q.No).length, name === 'Player' ? 0 : 2);
    assert.ok(result.every(rule => rule.sourceGroup === result[0].sourceGroup));
    assert.equal(result.at(-1).commands[0].text, 'single');
    assert.equal(result.at(-1).random, false);
    results.push(compared);
  }
  assert.deepEqual(results.map(value => value.result.length), [2, 3]);
  assert.deepEqual(results.map(value => value.expected.indices), [[1, 2], [0, 1, 2]]);
  // Each retained two-cell row has one placement on PP. The single-cell rule has two.
  assert.deepEqual(results.map(({ result }) => result.reduce((count, rule) => count + (rule.lhs[0].length === 2 ? 1 : 2), 0)), [3, 4]);
});

test('malformed aggregate cycles fail before duplicate normalization in bounded children', () => {
  const item = fixture('right [ Player ] -> [ Player ]', 'Pair = Player and Player\nPlayer = Pair');
  item.source = item.source.replace('P = Player\n', '');
  const programs = [
    `const {loadPuzzleScript}=require('./test/native-host.cjs'); loadPuzzleScript();
     try { compile(['loadLevel',0],${JSON.stringify(item.source)},null); process.stdout.write(JSON.stringify({name:null})); }
     catch(error) { process.stdout.write(JSON.stringify({name:error.name})); }`,
    // The candidate probe imports only the public preceding stages and the API.
    `Promise.all([import('./build/source-reader.js'),import('./build/declarations.js'),
    import('./build/rule-syntax.js'),import('./build/rule-negatives.js'),import('./build/rule-orientations.js'),
    import('./build/rule-names.js'),import('./build/rule-movements.js'),import('./build/rule-properties.js'),
    import('./build/rule-spawns.js'),import('./build/rule-duplicates.js')]).then(([reader,resolver,syntax,negatives,orientation,names,movements,properties,spawns,duplicates])=>{
      try { const {document}=reader.readSource(${JSON.stringify(item.source)});
        const {declarations}=resolver.resolveDeclarations(document);
        const before=negatives.checkEarlyNegativeTerms(syntax.recoverRuleSyntax(document,declarations).rules,declarations);
        const named=names.expandRuleNames(orientation.orientRules(before.rules),declarations);
        const moving=movements.expandRuleMovements(named.rules);
        const expanded=properties.expandRuleProperties(moving.rules,declarations);
        duplicates.normalizeRuleDuplicates(spawns.inferSpawnedStationary(expanded.rules,declarations));
        process.stdout.write(JSON.stringify({name:null}));
      } catch(error) { process.stdout.write(JSON.stringify({name:error.name,message:error.message})); }
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

// Each corruption represents a plausible shortcut the differential oracle must catch.
for (const [name, item, corrupt] of [
  ['keep-first selection', lastBoundary, rules => [rules[0]]],
  ['global group scope', contiguousBoundary, rules => [rules[2], rules[4]]],
  ['set-based term equality', termOrder, rules => [rules[1]]],
  ['always comparing direction', oneCellDirection, rules => [...rules]],
  ['never comparing direction', multiCellDirection, rules => [rules[1]]],
  ['ignored message payload', commandPayload, rules => [rules[1]]],
  ['ignored sound payload', soundPayload, rules => [rules[1]]],
  ['significant ellipsis names', ellipsisBoundary, rules => [...rules]],
  ['cloned survivor records', lastBoundary, rules => [structuredClone(rules[1])]],
]) test('oracle rejects ' + name, () => {
  assert.throws(() => oracle.compareBoundary(item, { normalizeRuleDuplicates: corrupt }),
    /complete duplicate sequence|survivor identity and provenance/);
});

test('oracle rejects mutation of frozen duplicate input', () => {
  assert.throws(() => oracle.compareFixture(fixture('right right [ Player | Wall ] -> win'), {
    normalizeRuleDuplicates: rules => { rules[0].lhs[0][0][0].name = 'wall'; return [...rules]; },
  }), TypeError);
});

test('oracle snapshots reject Map mutation reachable from source evidence', () => {
  const probe = new Map([['original', true]]);
  assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> win'), {
    readSource: source => { const read = readSource(source); read.document.probe = probe; return read; },
    normalizeRuleDuplicates: rules => { probe.clear(); return duplicates.normalizeRuleDuplicates(rules); },
  }), /duplicate inputs are unchanged/);
});

test('every native parser/compiler producer is disabled for candidate execution', () => {
  for (const name of oracle.producers) {
    assert.throws(() => oracle.compareFixture(fixture('right [ Player ] -> win'), {
      normalizeRuleDuplicates: rules => { globalThis[name](); return duplicates.normalizeRuleDuplicates(rules); },
    }), new RegExp('Candidate called native ' + name));
  }
  assert.throws(() => oracle.independently(() => runInThisContext('new codeMirrorFn().startState()')), /Candidate called native codeMirrorFn/);
  assert.throws(() => oracle.independently(() => runInThisContext('new CodeMirror.StringStream("", 4)')), /Candidate called native CodeMirror.StringStream/);
});

test('all 492 vanilla sources match every preceding sequence and ordered duplicate survivors', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 492);
  const totals = { sources: 0, syntax: 0, named: 0, movement: 0, spawned: 0, survivors: 0 };
  for (const item of fixtures) {
    const { syntax, named, movement, spawned, result } = oracle.compareFixture(item);
    totals.sources++;
    totals.syntax += syntax.rules.length;
    totals.named += named.rules.length;
    totals.movement += movement.rules.length;
    totals.spawned += spawned.length;
    totals.survivors += result.length;
  }
  t.diagnostic(JSON.stringify(totals));
  assert.deepEqual(totals, { sources: 492, syntax: 16674, named: 26093,
    movement: 30121, spawned: 106392, survivors: 99567 });
});
