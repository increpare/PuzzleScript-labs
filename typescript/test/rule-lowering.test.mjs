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
import { normalizeRuleDuplicates } from '../build/rule-duplicates.js';
import * as sourceTypes from '../build/source-model.js';
import { CommandKind } from '../build/commands.js';
import { Ellipsis } from '../build/rule-model.js';
import { compileGameData } from '../build/source-game-data.js';
import { applyTurnRules, startPlayerMovement } from '../build/turn-rules.js';
import { hasWon } from '../build/win-conditions.js';
import { createRandom } from '../build/random.js';
import { Movement } from '../build/model.js';
import { RuleQualifier as Q } from '../build/source-rule-model.js';
import { movementSource } from './scenarios.mjs';
import { createRuleLoweringOracle } from './legacy-rule-lowering.cjs';

const lowering = await import('../build/rule-lowering.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const oracle = createRuleLoweringOracle({ readSource, resolveDeclarations, recoverRuleSyntax, checkEarlyNegativeTerms,
  orientRules, expandRuleNames, expandRuleMovements, expandRuleProperties, inferSpawnedStationary,
  normalizeRuleDuplicates, ...sourceTypes, CommandKind, Ellipsis, ...lowering });
const fixture = (rules, legend = '', layers = 'Player, Crate, Wall') => ({ name: rules + '; ' + legend,
  source: movementSource({ rules }).replace('C = Crate', 'C = Crate\n' + legend)
    .replace('Player, Crate, Wall', layers) });
const orphanFixture = (rules, legend = '') => {
  const item = fixture(rules, legend);
  item.name = 'constructed orphan recovery: ' + item.name;
  item.source = item.source.replace('Background\nPlayer, Crate, Wall', 'Background\nBackground\nCrate, Wall');
  return item;
};

for (const [rules, legend] of [
  ['right [ Player ] -> [ Player ]', ''],
  ['right [ no Player ] -> [ Crate ]', ''],
  ['right [ Crate ] -> [ Player ]', ''],
  ['right [ Crate ] -> [ no Player ]', ''],
  ['right [ Crate ] -> [ random Player ]', ''],
  ['right [ Crate ] -> [ random Choice ]', 'Choice = Background or Player or Wall or Player'],
  ['right [ Crate ] -> [ Background random Player ]', ''],
  ['right [ Player no Background ] -> [ Player ]', ''],
]) test('lowering retains the writable same-name orphan: ' + rules, () => {
  oracle.compareFixture(orphanFixture(rules, legend));
});

test('orphan random writes follow the current declaration layer; concrete writes keep recovery layer zero', () => {
  const random = oracle.compareFixture(orphanFixture('right [ Crate ] -> [ random Player ]'));
  const literal = oracle.compareFixture(orphanFixture('right [ Crate ] -> [ Player ]'));
  const randomEdit = random.result.rules[0].executable.replacements[0][0].edits;
  const literalEdit = literal.result.rules[0].executable.replacements[0][0].edits;
  assert.deepEqual(randomEdit.randomObjects, [{ object: random.declarations.orphanedObject, layer: 1 }]);
  assert.deepEqual(literalEdit.vacateLayers, new Set([0, 2]));
  assert.deepEqual(literalEdit.addObjects, new Set([literal.declarations.orphanedObject]));
});

// These application fixtures supply explicit schedules. Only the
// original source is shared with native; no compiled native predicate/edit or
// schedule supplies any candidate data.
function compareOrphanApplication(item, seed, inputs, groups = [[0]], expectedErrors = 1) {
  const observed = oracle.nativeApplication(item.source, seed, inputs);
  const compiled = oracle.candidateStages(item.source);
  return oracle.independently(() => {
    const { data } = compileGameData(compiled.document, compiled.declarations);
    assert.equal(compiled.result.rules.length, groups.flat().length);
    const game = { ...data, rigid: false, rigidMerges: new Map(),
      earlyRules: { groups: groups.map(group => ({ rules: group.map(index => compiled.result.rules[index].executable), random: false })), loops: new Map() },
      lateRules: { groups: [], loops: new Map() } };
    const label = object => object === compiled.declarations.orphanedObject ? object.name + ' (orphaned)' : object.name;
    let current = { board: data.levels[0].board, pendingMovements: [], rigidMarks: [], bannedGroups: new Set(),
      canMoveSounds: [], cantMoveSounds: [], random: createRandom(seed), commands: { entries: [], message: '' },
      createdObjects: new Set(), destroyedObjects: new Set() };
    const snapshot = (won = false) => {
      const started = startPlayerMovement(game, current, Movement.Right);
      const { seed: _seed, ...random } = current.random;
      return { cells: current.board.rows.map(row => row.map(cell => compiled.declarations.objectChoiceOrder
        .filter(object => cell.objects.has(object)).map(label))), won, playerPositions: started.playerPositions,
        intent: started.state.pendingMovements.map(entry => ({ ...entry, movements: [...entry.movements] })), random };
    };
    const frames = [snapshot()];
    for (const input of inputs) {
      current = applyTurnRules(game, current, input === -1 ? null : input === 3 ? Movement.Right : Movement.Action).state;
      frames.push(snapshot(hasWon(current.board, data.winConditions)));
    }
    assert.deepEqual(frames, observed.frames, item.name + ': actual lowered application/RNG/player/win');
    assert.equal(observed.errorCount, expectedErrors, 'native diagnostics for the constructed invalid source');
    return { compiled, current, frames };
  });
}

for (const random of [false, true]) test('source-lowered orphan writes apply with native RNG, player, movement and win: ' + random, () => {
  const item = orphanFixture(`right [ Crate ] -> [ ${random ? 'random ' : ''}Player ]`);
  item.source = item.source.replace('PC.', 'C.').replace('winconditions\n', 'winconditions\nsome Player\n');
  const { frames } = compareOrphanApplication(item, 'orphan-lowering-apply', [-1, 3]);
  assert.equal(frames[1].won, true);
  assert.deepEqual(frames[1].playerPositions, [{ x: 0, y: 0 }]);
  assert.deepEqual(frames[1].intent[0], { position: { x: 0, y: 0 }, layer: 1, movements: [Movement.Right] });
  assert.deepEqual(frames[2].cells[0][0], random ? ['background (orphaned)'] : ['background (orphaned)', 'background']);
  assert.deepEqual(frames[2].cells[0][1], ['background']);
});

test('source-lowered orphan reads remove a target and player intent moves only its current declaration', () => {
  const item = orphanFixture('right [ Crate ] -> [ Player ]\nright [ Player | Background ] -> [ Player | ]');
  item.source = item.source.replace('PC.', 'C.');
  const { frames } = compareOrphanApplication(item, 'orphan-lowering-movement', [-1, 3], [[0], [1]]);
  assert.deepEqual(frames[2].cells[0], [['background (orphaned)'], ['background']]);
  assert.deepEqual(frames[2].playerPositions, [{ x: 0, y: 0 }]);
});

test('source-lowered mixed random candidates distinguish orphan and current same-name objects across draws', () => {
  const outcomes = new Set();
  for (const seed of ['orphan-check', 'orphan-1', 'orphan-2', 'orphan-3', 'orphan-4']) {
    const item = orphanFixture('right [ Crate ] -> [ random Choice ]', 'Choice = Background or Player or Background');
    item.source = item.source.replace('PC.', 'C').replace('winconditions\n', 'winconditions\nsome Player\n');
    const { frames } = compareOrphanApplication(item, seed, [-1]);
    outcomes.add(frames[1].cells[0][0].join(','));
  }
  assert.deepEqual(outcomes, new Set(['background (orphaned)', 'background']));
});

test('source-lowered orphan writes satisfy aggregate player and win tests only with both identities', () => {
  for (const random of [false, true]) {
    const item = orphanFixture(`right [ Crate ] -> [ ${random ? 'random ' : ''}Player ]`);
    item.source = item.source.replace('PC.', 'C').replaceAll('Player', 'Avatar')
      .replace('C = Crate', 'C = Crate\nPlayer = Avatar and Background\nPair = Avatar and Background')
      .replace('winconditions\n', 'winconditions\nsome Pair\n');
    const { frames } = compareOrphanApplication(item, 'orphan-lowering-aggregate', [-1], [[0]], 3);
    assert.equal(frames[1].won, !random);
    assert.deepEqual(frames[1].playerPositions, random ? [] : [{ x: 0, y: 0 }]);
  }
});

test('native concrete edits require the independent lowering API', () => {
  const item = fixture('right [ Player ] -> [ Crate ]');
  const { parsed } = oracle.parseNative(item.source);
  const native = oracle.nativeLower(parsed);
  assert.deepEqual(native.after[0].rows[0][0].requiredObjects, ['player']);
  assert.deepEqual(native.after[0].replacements[0][0].addObjects, ['crate']);
  assert.equal(typeof lowering.lowerRules, 'function', 'native-backed lowerRules API must exist');
  oracle.compareFixture(item);
});

test('illegal LHS random qualifiers remove entire consecutive rules and retain subsequent valid rules', () => {
  const { result, document } = oracle.compareFixture(fixture([
    'right [ Player ] -> [ Player ]',
    'right [ random Player ] -> [ random Player ]',
    'right [ randomdir Player ] -> [ random Player ]',
    'right [ Crate ] -> [ Crate ]',
  ].join('\n')));
  assert.deepEqual(result.rules.map(rule => rule.namedRule.source), [document.rules[0], document.rules[3]]);
  assert.deepEqual(result.diagnostics.map(issue => [issue.code, issue.message, issue.span.start.line]), [
    ['random-object-on-left', 'RANDOM cannot be matched on the left-hand side; it can only appear on the right', document.rules[1].originalLine.span.start.line],
    ['random-direction-on-left', 'RANDOMDIR cannot be matched on the left-hand side; it can only appear on the right', document.rules[2].originalLine.span.start.line],
  ]);
});

for (const rules of [
  'right [ ] -> [ Player ]', 'right [ Player ] -> [ ]',
  'right [ Player ] -> [ no Crate Player ]', 'right [ Player ] -> [ no Player Player ]',
  'right [ no Player ] -> [ Crate ]', 'right [ Player ] -> win',
  'right [ ] -> [ ] message Empty', 'rigid right [ Player ] -> [ stationary Player ] sfx0 again',
  'right [ up Player ] -> [ Player ]', 'right [ up Player ] -> [ right Player ]',
  'right [ stationary Player ] -> [ action Player ]', 'right [ action Player ] -> [ stationary Player ]',
  'right [ Player ] -> [ randomdir Player ]', 'right [ randomdir Player ] -> [ Player ]',
  'right [ Player Player Crate Wall ] -> [ Player Crate ]',
  'right [ Player ] -> [ Crate Wall Player ]',
  'right [ Player ] -> [ random Things ]', 'right [ ] -> [ random Player ]',
  'right [ ] -> [ random Things random Player ]',
  'right [ Player ] -> [ Crate random Things ]', 'right [ Player ] -> [ random Things Crate ]',
  'right [ Player | ... | Crate ] -> [ Player | ... | Crate ]',
  'right [ ... | Player ] -> [ ... | Player ]',
  'right [ Player | ... ] -> [ Player | Crate ]',
  'right [ Player | Crate ] -> [ Player | ... ]',
]) test('source lowering matches native: ' + rules, () => {
  oracle.compareFixture(fixture(rules, 'Things = Wall or Player or Crate or Player'));
});

for (const [rules, legend, layers] of [
  ['right [ Things ] -> [ Things ]', 'Things = Player or Crate', 'Player, Crate, Wall'],
  ['right [ up Things ] -> [ Things ]', 'Things = Player or Crate', 'Player, Crate, Wall'],
  ['right [ Player ] -> [ Things ]', 'Things = Player or Crate', 'Player, Crate, Wall'],
  ['right [ Player Wall ] -> [ Things ]', 'Things = Player or Crate', 'Player, Crate\nWall'],
  ['right [ Player Crate ] -> [ Player ]', '', 'Player\nCrate\nWall'],
  ['right [ up Player left Crate ] -> [ up Player Crate ]', '', 'Player\nCrate\nWall'],
  ['right [ Player ] -> [ Player ]', 'Player = Crate', 'Player, Crate, Wall'],
  ['right [ Player ] -> [ no Player ]', 'Player = Crate', 'Player, Crate, Wall'],
  ['right [ Player ] -> [ Player ]', '', 'Crate, Wall'],
  ['right [ ] -> [ random Things ]', 'Things = Player or Player', 'Player, Crate, Wall'],
  ['right [ ] -> [ random Things ]', 'Things = Player', 'Player, Crate, Wall'],
  ['right [ ] -> [ random Things ]', 'Things = Wall or Player or Crate', 'Wall\nCrate\nPlayer'],
]) test('declaration-sensitive lowering: ' + rules + '; ' + legend + '; ' + layers, () => {
  oracle.compareFixture(fixture(rules, legend, layers));
});

const base = fixture('right [ Player ] -> [ Player ]', 'Things = Player or Crate');
const term = (name, qualifier = Q.Unspecified) => ({ name, qualifier,
  origin: readSource(base.source).document.rules[0].originalLine.span });
const boundary = (name, nativePatch, candidatePatch, source = base.source) => ({
  name: 'stage-boundary: ' + name, source,
  native: rules => [{ ...rules[0], ...structuredClone(nativePatch) }],
  candidate: rules => [{ ...rules[0], ...candidatePatch }],
});

const cases = [
  boundary('orphan and current contradiction names occupy distinct ordered entries',
    { lhs: [[['', 'player', '', 'background', 'no', 'player', 'no', 'background']]] },
    { lhs: [[[term('player'), term('background'), term('player', Q.No), term('background', Q.No)]]] },
    orphanFixture('right [ Player ] -> [ Player ]').source),
  boundary('orphan contradiction names retain native source spelling',
    { lhs: [[['', 'player', 'no', 'player']]] },
    { lhs: [[[term('player'), term('player', Q.No)]]] },
    orphanFixture('right [ Player ] -> [ Player ]').source),
  boundary('raw concrete LHS uses final named lookup while RHS uses raw concrete lookup',
    { lhs: [[['', 'player']]], rhs: [[['', 'player']]] },
    { lhs: [[[term('player')]]], rhs: [[[term('player')]]] },
    fixture('right [ Player ] -> [ Player ]', 'Player = Crate', 'Player\nCrate\nWall').source),
  boundary('negative terms do not occupy layers',
    { lhs: [[['no', 'crate', '', 'player']]] },
    { lhs: [[[term('crate', Q.No), term('player')]]] }),
  boundary('repeated retained properties still conflict',
    { lhs: [[['', 'things', '', 'things']]], rhs: [[['', 'things']]] },
    { lhs: [[[term('things'), term('things')]]], rhs: [[[term('things')]]] }),
  boundary('earlier RHS errors are not suppressed by future LHS overlap',
    { lhs: [[['', 'player'], ['', 'player', '', 'player']]], rhs: [[['', 'crate', '', 'wall'], ['', 'player']]] },
    { lhs: [[[term('player')], [term('player'), term('player')]]], rhs: [[[term('crate'), term('wall')], [term('player')]]] }),
  boundary('unspecified writes preserve earlier explicit intent reset',
    { rhs: [[['up', 'player', '', 'player']]] }, { rhs: [[[term('player', Q.Up), term('player')]]] }),
  boundary('adjacent and more than two inner ellipses await schedule validation',
    { lhs: [[['', 'player'], ['...', '...'], ['...', '...'], ['...', '...'], ['', 'crate']]],
      rhs: [[['', 'player'], ['...', '...'], ['...', '...'], ['...', '...'], ['', 'crate']]] },
    { lhs: [[[term('player')], [term('...', Q.Ellipsis)], [term('...', Q.Ellipsis)], [term('...', Q.Ellipsis)], [term('crate')]]],
      rhs: [[[term('player')], [term('...', Q.Ellipsis)], [term('...', Q.Ellipsis)], [term('...', Q.Ellipsis)], [term('crate')]]] }),
  boundary('retained property reads anyObjects and preserves objects',
    { lhs: [[['', 'things']]], rhs: [[['', 'things']]] },
    { lhs: [[[term('things')]]], rhs: [[[term('things')]]] }),
  boundary('concrete LHS to retained property RHS resets concrete layer',
    { rhs: [[['', 'things']]] }, { rhs: [[[term('things')]]] }),
  boundary('unqualified retained property keeps movement intent',
    { lhs: [[['up', 'things']]], rhs: [[['', 'things']]] },
    { lhs: [[[term('things', Q.Up)]]], rhs: [[[term('things')]]] }),
  boundary('explicit retained property resets movement intent',
    { lhs: [[['up', 'things']]], rhs: [[['right', 'things']]] },
    { lhs: [[[term('things', Q.Up)]]], rhs: [[[term('things', Q.Right)]]] }),
  boundary('whole required object set is cleared on partial retention',
    { lhs: [[['', 'background', '', 'player']]], rhs: [[['', 'background']]] },
    { lhs: [[[term('background'), term('player')]]], rhs: [[[term('background')]]] }),
  boundary('whole required movement set is cleared on partial retention',
    { lhs: [[['up', 'background', 'left', 'player']]], rhs: [[['up', 'background', '', 'player']]] },
    { lhs: [[[term('background', Q.Up), term('player', Q.Left)]]], rhs: [[[term('background', Q.Up), term('player')]]] }),
  boundary('same object positives still record the last conflict',
    { lhs: [[['', 'player', '', 'crate', '', 'player', '', 'wall']]] },
    { lhs: [[[term('player'), term('crate'), term('player'), term('wall')]]] }),
  boundary('last overlap persists and suppresses later RHS errors',
    { lhs: [[['', 'player', '', 'player'], ['', 'crate']]], rhs: [[['', 'player'], ['', 'crate', '', 'wall']]] },
    { lhs: [[[term('player'), term('player')], [term('crate')]]], rhs: [[[term('player')], [term('crate'), term('wall')]]] }),
  boundary('LHS random removes the whole invalid rule',
    { lhs: [[['random', 'player']]] }, { lhs: [[[term('player', Q.RandomObject)]]] }),
  boundary('LHS randomdir removes the whole invalid rule',
    { lhs: [[['randomdir', 'player']]] }, { lhs: [[[term('player', Q.RandomDirection)]]] }),
  boundary('contradiction removes immediately before RHS and later cells',
    { lhs: [[['', 'player', 'no', 'player'], ['random', 'wall']]], rhs: [[['random', 'unknown'], ['', 'wall']]] },
    { lhs: [[[term('player'), term('player', Q.No)], [term('wall', Q.RandomObject)]]],
      rhs: [[[term('unknown', Q.RandomObject)], [term('wall')]]] }),
  boundary('contradiction names follow object choice order',
    { lhs: [[['', 'wall', '', 'player', '', 'crate', 'no', 'crate', 'no', 'wall', 'no', 'player']]] },
    { lhs: [[[term('wall'), term('player'), term('crate'), term('crate', Q.No), term('wall', Q.No), term('player', Q.No)]]] }),
  boundary('missing layers diagnose and skip both positive and negative terms',
    { lhs: [[['', 'unknown', 'no', 'other']]], rhs: [[['', 'missing', 'no', 'absent']]] },
    { lhs: [[[term('unknown'), term('other', Q.No)]]], rhs: [[[term('missing'), term('absent', Q.No)]]] }),
  boundary('unknown random RHS diagnoses and preserves removal',
    { rhs: [[['random', 'unknown']]] }, { rhs: [[[term('unknown', Q.RandomObject)]]] }),
  boundary('mixed LHS ellipsis immediately removes rule',
    { lhs: [[['...', '...', 'random', 'player'], ['random', 'wall']]], rhs: [[[], []]] },
    { lhs: [[[term('...', Q.Ellipsis), term('player', Q.RandomObject)], [term('wall', Q.RandomObject)]]], rhs: [[[], []]] }),
  boundary('mixed LHS ellipsis after another term preserves earlier diagnostic',
    { lhs: [[['random', 'player', '...', '...']]] },
    { lhs: [[[term('player', Q.RandomObject), term('...', Q.Ellipsis)]]] }),
  boundary('edge ellipsis removes only after later cell diagnostics',
    { lhs: [[['...', '...'], ['random', 'player']]], rhs: [[['', 'crate'], ['random', 'unknown']]] },
    { lhs: [[[term('...', Q.Ellipsis)], [term('player', Q.RandomObject)]]], rhs: [[[term('crate')], [term('unknown', Q.RandomObject)]]] }),
  boundary('inner LHS ellipsis skips corresponding invalid RHS terms',
    { lhs: [[['', 'player'], ['...', '...'], ['', 'crate']]], rhs: [[['', 'player'], ['random', 'unknown'], ['', 'crate']]] },
    { lhs: [[[term('player')], [term('...', Q.Ellipsis)], [term('crate')]]],
      rhs: [[[term('player')], [term('unknown', Q.RandomObject)], [term('crate')]]] }),
  boundary('RHS validates every mixed ellipsis then stops at first',
    { rhs: [[['...', '...', '...', '...', 'random', 'unknown']]] },
    { rhs: [[[term('...', Q.Ellipsis), term('...', Q.Ellipsis), term('unknown', Q.RandomObject)]]] }),
  boundary('RHS terms before mixed ellipsis still contribute',
    { rhs: [[['', 'crate', '...', '...', 'random', 'unknown']]] },
    { rhs: [[[term('crate'), term('...', Q.Ellipsis), term('unknown', Q.RandomObject)]]] }),
  boundary('ellipsis qualifier wins over recovered name',
    { lhs: [[['', 'player'], ['...', 'wall'], ['', 'crate']]], rhs: [[['', 'player'], ['...', 'player'], ['', 'crate']]] },
    { lhs: [[[term('player')], [term('wall', Q.Ellipsis)], [term('crate')]]],
      rhs: [[[term('player')], [term('player', Q.Ellipsis)], [term('crate')]]] }),
];
for (const item of cases) test(item.name, () => { oracle.compareFixture(item); });

test('command-only rules and empty RHS cells retain original hasReplacements', () => {
  const command = oracle.compareFixture(fixture('right [ ] -> win')).result.rules[0].executable;
  const empty = oracle.compareFixture(fixture('right [ ] -> [ ] win')).result.rules[0].executable;
  assert.equal(command.hasReplacements, false);
  assert.equal(empty.hasReplacements, true);
  assert.deepEqual(command.replacements, [[null]]);
  assert.deepEqual(empty.replacements, [[null]]);
});

test('whole layer operations stay explicit and random layers do not extend static rigid responsibilities', () => {
  const { result } = oracle.compareFixture(fixture('right [ Player ] -> [ random Things ]',
    'Things = Wall or Background or Crate'));
  const replacement = result.rules[0].executable.replacements[0][0];
  assert.deepEqual(replacement.edits.vacateLayers, new Set([1]));
  assert.deepEqual(replacement.rigidLayers, new Set([1]));
  assert.equal(replacement.edits.removeObjects.has(result.rules[0].executable.rows[0][0].requiredObjects.values().next().value), true);
});

test('random singleton draws remain present and duplicate property members avoid singleton warning', () => {
  const singleton = oracle.compareFixture(fixture('right [ ] -> [ random Player ]'));
  const duplicate = oracle.compareFixture(fixture('right [ ] -> [ random Things ]', 'Things = Player or Player'));
  assert.equal(singleton.result.rules[0].executable.replacements[0][0].edits.randomObjects.length, 1);
  assert.equal(duplicate.result.rules[0].executable.replacements[0][0].edits.randomObjects.length, 1);
  assert.equal(singleton.result.diagnostics.length, 1);
  assert.equal(duplicate.result.diagnostics.length, 0);
});

test('empty lowering input returns fresh collections', () => {
  const { declarations } = resolveDeclarations(readSource(base.source).document);
  const input = Object.freeze([]);
  const result = lowering.lowerRules(input, declarations);
  assert.deepEqual(result, { rules: [], diagnostics: [] });
  assert.notEqual(result.rules, input);
});

test('last conflict pair and conflicting writes remain observable before grouping', () => {
  const item = cases.find(item => item.name.endsWith('same object positives still record the last conflict'));
  assert.deepEqual(oracle.compareFixture(item).result.rules[0].overlap, ['WALL', 'PLAYER']);
  const conflicting = oracle.compareFixture(fixture('right [ ] -> [ Player Crate ]'));
  assert.deepEqual([...conflicting.result.rules[0].executable.replacements[0][0].edits.addObjects].map(object => object.name), ['player', 'crate']);
});

const changeFirst = (result, transform) => ({ ...result,
  rules: result.rules.map((rule, index) => index === 0 ? transform(rule) : rule) });
const changeEdits = (result, transform) => changeFirst(result, rule => ({ ...rule, executable: { ...rule.executable,
  replacements: rule.executable.replacements.map((row, ri) => row.map((replacement, ci) => ri === 0 && ci === 0
    ? { ...replacement, edits: transform(replacement.edits) } : replacement)) } }));
for (const [name, item, corrupt] of [
  ['omitted layer vacancy', fixture('right [ Player ] -> [ Crate ]'),
    result => changeEdits(result, edits => ({ ...edits, vacateLayers: new Set() }))],
  ['lost whole-set clearing', cases.find(item => item.name.endsWith('raw concrete LHS uses final named lookup while RHS uses raw concrete lookup')),
    result => changeEdits(result, edits => ({ ...edits, removeObjects: new Set() }))],
  ['random candidates in authored order', fixture('right [ ] -> [ random Things ]', 'Things = Wall or Crate or Player'),
    result => changeEdits(result, edits => ({ ...edits, randomObjects: [...edits.randomObjects].reverse() }))],
  ['discarding singleton random draws', fixture('right [ ] -> [ random Player ]'),
    result => changeEdits(result, edits => ({ ...edits, randomObjects: [] }))],
  ['lost last overlap', cases.find(item => item.name.endsWith('same object positives still record the last conflict')),
    result => changeFirst(result, rule => ({ ...rule, overlap: null }))],
  ['pruned conflicting writes', fixture('right [ ] -> [ Player Crate ]'),
    result => changeEdits(result, edits => ({ ...edits, addObjects: new Set([...edits.addObjects].slice(0, 1)) }))],
  ['lost original command identity', fixture('right [ Player ] -> win'),
    result => changeFirst(result, rule => ({ ...rule, executable: { ...rule.executable, commands: [...rule.executable.commands] } }))],
  ['lost diagnostic error accounting', fixture('right [ ] -> [ random Player ]'),
    result => ({ ...result, diagnostics: result.diagnostics.map(issue => ({ ...issue, countsAsError: true })) })],
  ['orphan random intent assigned to fallback layer zero', orphanFixture('right [ Crate ] -> [ random Player ]'),
    result => changeEdits(result, edits => ({ ...edits, randomObjects: edits.randomObjects.map(entry => ({ ...entry, layer: 0 })) }))],
]) test('oracle rejects ' + name, () => {
  assert.throws(() => oracle.compareFixture(item, {
    lowerRules: (rules, declarations) => corrupt(lowering.lowerRules(rules, declarations)),
  }), /exact lowered sequence|original command identity|exact ordered diagnostics/);
});

test('oracle rejects conflating a written orphan with its same-name current object', () => {
  assert.throws(() => oracle.compareFixture(orphanFixture('right [ Crate ] -> [ Player ]'), {
    lowerRules: (rules, declarations) => changeEdits(lowering.lowerRules(rules, declarations), edits => ({ ...edits,
      addObjects: new Set([declarations.orphanedObject.orphanedFrom]) })),
  }), /exact lowered sequence/);
});

test('oracle rejects mutation of frozen rules and reachable declaration maps', () => {
  assert.throws(() => oracle.compareFixture(base, {
    lowerRules: rules => { rules[0].lhs[0][0][0].name = 'crate'; return { rules: [], diagnostics: [] }; },
  }), TypeError);
  assert.throws(() => oracle.compareFixture(base, {
    lowerRules: (rules, declarations) => { declarations.objectLayers.clear(); return { rules: [], diagnostics: [] }; },
  }), /lowering inputs are unchanged/);
});

test('all native parser/compiler producers stay disabled during the candidate pipeline', () => {
  for (const name of oracle.producers) assert.throws(() => oracle.compareFixture(base, {
    lowerRules: () => { globalThis[name](); },
  }), new RegExp('Candidate called native ' + name));
  assert.throws(() => oracle.independently(() => runInThisContext('new codeMirrorFn().startState()')), /Candidate called native codeMirrorFn/);
  assert.throws(() => oracle.independently(() => runInThisContext('new CodeMirror.StringStream("",4)')), /Candidate called native CodeMirror.StringStream/);
});

for (const [name, corrupt] of [
  ['named rule', parsed => { parsed.rules[0].unsupportedField = true; }],
  ['cell predicate', parsed => { parsed.rules[0].lhs[0][0].unsupportedField = true; }],
  ['replacement', parsed => { parsed.rules[0].lhs[0][0].replacement.unsupportedField = true; }],
]) test('native decoder rejects an unknown ' + name + ' field', () => {
  const { parsed } = oracle.parseNative(base.source);
  assert.throws(() => oracle.nativeLower(parsed, corrupt), /Unsupported vanilla.*unsupportedField/);
});

test('cyclic malformed declarations fail before lowering in fixed-timeout children', () => {
  const source = fixture('right [ Player ] -> [ Player ]', 'Pair = Player and Player\nPlayer = Pair').source.replace('P = Player\n', '');
  const programs = [
    `const {loadPuzzleScript}=require('./test/native-host.cjs'); loadPuzzleScript();
     try { compile(['loadLevel',0],${JSON.stringify(source)},null); process.stdout.write(JSON.stringify({name:null})); }
     catch(error) { process.stdout.write(JSON.stringify({name:error.name})); }`,
    `Promise.all(['source-reader','declarations','rule-syntax','rule-negatives','rule-orientations','rule-names',
      'rule-movements','rule-properties','rule-spawns','rule-duplicates','rule-lowering'].map(name=>import('./build/'+name+'.js')))
      .then(([reader,resolver,syntax,negatives,orientation,names,movements,properties,spawns,duplicates,lowering])=>{
      try { const {document}=reader.readSource(${JSON.stringify(source)});
        const {declarations}=resolver.resolveDeclarations(document);
        const before=negatives.checkEarlyNegativeTerms(syntax.recoverRuleSyntax(document,declarations).rules,declarations);
        const named=names.expandRuleNames(orientation.orientRules(before.rules),declarations);
        const moving=movements.expandRuleMovements(named.rules);
        const expanded=properties.expandRuleProperties(moving.rules,declarations);
        lowering.lowerRules(duplicates.normalizeRuleDuplicates(spawns.inferSpawnedStationary(expanded.rules,declarations)),declarations);
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

test('all 492 vanilla sources match exact lowered order, fields and diagnostics', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 492);
  const totals = { sources: 0, syntax: 0, named: 0, movement: 0, spawned: 0, duplicates: 0, lowered: 0, overlaps: 0, diagnostics: 0 };
  for (const item of fixtures) {
    const compared = oracle.compareFixture(item);
    totals.sources++;
    for (const key of ['syntax', 'named', 'movement', 'spawned', 'duplicates']) totals[key] += compared.counts[key];
    totals.lowered += compared.result.rules.length;
    totals.overlaps += compared.result.rules.filter(rule => rule.overlap !== null).length;
    totals.diagnostics += compared.result.diagnostics.length;
  }
  t.diagnostic(JSON.stringify(totals));
  assert.deepEqual(totals, { sources: 492, syntax: 16674, named: 26093, movement: 30121, spawned: 106392,
    duplicates: 99567, lowered: 99443, overlaps: 251, diagnostics: 146 });
});
