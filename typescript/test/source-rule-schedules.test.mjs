import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { queueCommands } from '../build/commands.js';
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
import { lowerRules } from '../build/rule-lowering.js';
import * as sourceTypes from '../build/source-model.js';
import { CommandKind } from '../build/commands.js';
import { Ellipsis } from '../build/rule-model.js';
import { Direction } from '../build/model.js';
import { movementSource } from './scenarios.mjs';
import { createSourceSchedulesOracle } from './legacy-source-schedules.cjs';
const schedules = await import('../build/source-rule-schedules.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const oracle = createSourceSchedulesOracle({ readSource, resolveDeclarations, recoverRuleSyntax, checkEarlyNegativeTerms,
  orientRules, expandRuleNames, expandRuleMovements, expandRuleProperties, inferSpawnedStationary,
  normalizeRuleDuplicates, lowerRules, ...sourceTypes, CommandKind, Ellipsis, ...schedules });
const fixture = (rules, layers = 'Player, Crate, Wall') => ({ name: rules,
  source: movementSource({ rules }).replace('Player, Crate, Wall', layers) });
const base = fixture('right [ Player ] -> [ Player ] win');
test('source schedules preserve native grouped executable rules', () => {
  oracle.compareFixture(base);
});

const boundaryFixture = (name, rules = base.name) => ({ ...fixture(rules), name: 'stage-boundary: ' + name });
const patchHeaders = headers => ({
  native: rules => rules.forEach((rule, index) => Object.assign(rule, headers[index])),
  candidate: rules => rules.map((rule, index) => {
    const { groupNumber, randomRule, ...flags } = headers[index];
    return { ...rule, namedRule: { ...rule.namedRule, ...flags,
      ...(groupNumber === undefined ? {} : { sourceGroup: groupNumber }),
      ...(randomRule === undefined ? {} : { random: randomRule }) } };
  }),
});
const six = Array.from({ length: 6 }, (_, i) => `right [ Player ] -> message ${i}`).join('\n');
test('numeric source group order survives interleaved early and late flags', () => {
  const { schedule, inputs } = oracle.compareFixture(boundaryFixture('numeric group ordering', six), { boundary: patchHeaders([
    { groupNumber: 100 }, { groupNumber: 2, late: true }, { groupNumber: 11 },
    { groupNumber: 2 }, { groupNumber: 100, late: true }, { groupNumber: 11 },
  ]) });
  assert.deepEqual(schedule.early.groups.map(group => group.rules.map(rule => rule.sourceLine)),
    [[inputs[3].executable.sourceLine], [inputs[2].executable.sourceLine, inputs[5].executable.sourceLine], [inputs[0].executable.sourceLine]]);
});
test('empty groups disappear and the first surviving member sets random policy', () => {
  const headers = patchHeaders(Array.from({ length: 6 }, (_, i) => ({ groupNumber: i < 3 ? 10 : i < 5 ? 20 : 30,
    randomRule: i === 0 || i === 3, rigid: i === 0 || i === 4 })));
  const { schedule } = oracle.compareFixture(boundaryFixture('first surviving random and empty groups', six), { boundary: {
    native: rules => { headers.native(rules); for (const i of [0, 3, 4]) rules[i].discard = ['CRATE', 'PLAYER']; },
    candidate: rules => headers.candidate(rules).map((rule, i) => ({ ...rule, overlap: [0, 3, 4].includes(i) ? ['CRATE', 'PLAYER'] : null })),
  } });
  assert.equal(schedule.early.groups.length, 2);
  assert.equal(schedule.early.groups[0].random, false);
  assert.equal(schedule.rigid, false);
});
const pairBoundary = (pairs, lines) => ({
  native: rules => {
    const sourceLines = rules.map(rule => rule.lineNumber);
    rules.forEach((rule, i) => { rule.groupNumber = 1; if (pairs[i]) rule.discard = pairs[i];
      if (lines) rule.lineNumber = sourceLines[lines[i]]; });
  },
  candidate: rules => rules.map((rule, i) => ({ ...rule, overlap: pairs[i] ?? null,
    namedRule: { ...rule.namedRule, sourceGroup: 1, ...(lines ? { source: rules[lines[i]].namedRule.source } : {}) },
    executable: { ...rule.executable, ...(lines ? { sourceLine: rules[lines[i]].executable.sourceLine } : {}) } })),
});
for (const [name, pairs] of [
  ['unique pairs accumulate across lines with repeated example', [['A', 'B'], ['C', 'D'], ['A', 'B'], ['E', 'F'], ['G', 'H'], ['I', 'J']]],
  ['four pair comma and final and formatting', [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], null, null]],
  ['duplicate pair retains original example', [['A', 'B'], ['A', 'B'], null, null, null, null]],
]) test(name, () => oracle.compareFixture(boundaryFixture(name, six), { boundary: pairBoundary(pairs) }));
test('forward conflict deletion diagnoses only after the last current same-line variant disappears', () => {
  const { schedule } = oracle.compareFixture(boundaryFixture('same-line forward deletion', six), {
    boundary: pairBoundary([['A', 'B'], ['C', 'D'], null, ['E', 'F'], ['G', 'H'], ['I', 'J']], [0, 0, 0, 3, 3, 3]),
  });
  assert.equal(schedule.diagnostics.length, 1);
  assert.match(schedule.diagnostics[0].message, /^A and B.*C\/D, E\/F, G\/H etc\./);
});
for (const rules of [
  'right [ Player | ... | ... | Crate ] -> win',
  'right [ Player | ... | ... | ... | ... | Crate ] -> win',
  'late right [ Player | ... | ... | ... | Crate ] -> message Late',
  'right [ Player Crate | ... | ... | ... | Wall ] -> win\nlate right [ Player | ... | ... | Crate ] -> win',
  'right [ Player | ... | ... | Crate ] -> win\nlate right [ Player Crate ] -> win\nright [ Crate Wall ] -> win',
]) test('post-conflict ellipses: ' + rules, () => oracle.compareFixture(fixture(rules)));
test('rigid ownership applies individually across early and late source-group members', () => {
  const { schedule } = oracle.compareFixture(boundaryFixture('mixed rigid membership', six), { boundary: patchHeaders([
    { groupNumber: 1, rigid: false }, { groupNumber: 1, rigid: true }, { groupNumber: 1, rigid: true, late: true },
    { groupNumber: 3 }, { groupNumber: 4, rigid: true, late: true }, { groupNumber: 5, rigid: true },
  ]) });
  assert.deepEqual(schedule.early.groups.map(group => group.rules.map(rule => rule.rigidGroup)), [[null, 0], [null], [2]]);
  assert.deepEqual(schedule.late.groups.map(group => group.rules.map(rule => rule.rigidGroup)), [[0], [null]]);
  assert.equal(schedule.rigidMerges.get(0).get(2), null);
});
test('the 31st rigid group reports at its first rule and retains the complete maps', () => {
  const { schedule, inputs } = oracle.compareFixture(fixture(Array.from({ length: 31 }, (_, i) => `rigid right [ Player ] -> message ${i}`).join('\n')));
  assert.equal(schedule.rigidMerges.size, 31);
  assert.equal(schedule.diagnostics.length, 1);
  assert.equal(schedule.diagnostics[0].span.start.line, inputs[30].executable.sourceLine);
});
for (const rules of [
  'startloop\nright [ Player ] -> win\nendloop',
  'startloop\nendloop\nright [ Player ] -> win',
  'startloop\nright [ Player ] -> win\nendloop\nstartloop\nlate right [ Crate ] -> win\nendloop',
  'startloop\nright [ Player ] -> win\nlate right [ Crate ] -> win\nright [ Wall ] -> win\nendloop',
  'right [ Player ] -> win\nstartloop\n+ right [ Crate ] -> win\nendloop',
  'startloop\nright [ Player ] -> win\nendloop\n+ right [ Crate ] -> win',
  'right [ Player ] -> win\nstartloop\n+ right [ Crate ] -> win\nendloop\n+ right [ Wall ] -> win',
  'endloop\nright [ Player ] -> win',
  'startloop\nright [ Player ] -> win',
  'startloop\nright [ Player ] -> win\nstartloop\nright [ Crate ] -> win\nendloop',
  'endloop\nright [ Player ] -> win\nstartloop\nright [ Crate ] -> win\nendloop\nendloop',
  'startloop\nright [ Player Crate ] -> win\nendloop\n+ right [ Wall ] -> win',
]) test('loop construction/recovery: ' + rules, () => oracle.compareFixture(fixture(rules)));
test('empty schedules are fresh and preserve frozen inputs', () => {
  const input = Object.freeze([]), loops = Object.freeze([]);
  const result = schedules.compileRuleSchedules(input, loops);
  assert.deepEqual(result, { early: { groups: [], loops: new Map() }, late: { groups: [], loops: new Map() },
    rigid: false, rigidMerges: new Map(), diagnostics: [] });
  assert.notEqual(result.early.groups, result.late.groups);
  assert.notEqual(result.early.loops, result.late.loops);
});


test('every rigid transition for 1 through 30 owners matches actual native replacement behavior', t => {
  let transitions = 0;
  for (let count = 1; count <= 30; count++) {
    const rules = Array.from({ length: count }, (_, i) =>
      `right [ Wall ] -> message hole${i}\nrigid right [ Player ] -> message rigid${i}`).join('\n');
    const { schedule, expectedSchedules } = oracle.compareFixture(fixture(rules, 'Player\nCrate\nWall'));
    const actual = oracle.actualRigidTransitions(expectedSchedules.parsed);
    assert.deepEqual(schedule.rigidMerges, actual, 'actual native owners for ' + count + ' groups');
    transitions += count * count;
  }
  assert.equal(transitions, 9455);
  t.diagnostic('9455 actual native replacement transitions, including holes, null and third-group owners');
});

test('the issue 1206 source repro preserves the unmatched third-group owner', () => {
  const source = readFileSync(new URL('./repros/rigid-owner.puzzlescript', import.meta.url), 'utf8');
  const { schedule, expectedSchedules } = oracle.compareFixture({ name: 'issue 1206 source repro', source });
  assert.deepEqual(schedule.rigidMerges, oracle.actualRigidTransitions(expectedSchedules.parsed));
  assert.equal(schedule.rigidMerges.get(0).get(1), 2);
});

test('queued commands retain the schedule executable as their canonical source', () => {
  const { schedule } = oracle.compareFixture(base);
  const rule = schedule.early.groups[0].rules[0];
  const queued = queueCommands({ entries: [], message: '' }, rule, rule.commands);
  assert.equal(queued.entries[0].source, rule);
  assert.equal(queued.entries[0].command, rule.commands[0]);
});

const changeEarly = (result, transform) => ({ ...result, early: transform(result.early) });
const changeFirstGroup = (result, transform) => changeEarly(result, early => ({ ...early,
  groups: early.groups.map((group, index) => index === 0 ? transform(group) : group) }));
for (const [name, item, corrupt] of [
  ['group sequence', fixture('right [ Player ] -> win\nright [ Crate ] -> win'),
    result => changeEarly(result, early => ({ ...early, groups: [...early.groups].reverse() }))],
  ['first surviving random', fixture('random right [ Player ] -> win'),
    result => changeFirstGroup(result, group => ({ ...group, random: false }))],
  ['removed conflict variant', fixture('right [ Player Crate ] -> win'),
    (result, rules) => changeEarly(result, early => ({ ...early, groups: [{ random: false, rules: [{ ...rules[0].executable }] }] }))],
  ['rigid membership', fixture('rigid right [ Player ] -> win'),
    result => changeFirstGroup(result, group => ({ ...group, rules: group.rules.map(rule => ({ ...rule, rigidGroup: null })) }))],
  ['rigid merge transition', fixture('rigid right [ Player ] -> win\nrigid right [ Crate ] -> win'),
    result => ({ ...result, rigidMerges: new Map([...result.rigidMerges].map(([from, entries]) =>
      [from, new Map([...entries].map(([to, owner]) => [to, from === 0 && to === 1 ? 0 : owner]))])) })],
  ['loop target', fixture('startloop\nright [ Player ] -> win\nright [ Crate ] -> win\nendloop'),
    result => changeEarly(result, early => ({ ...early, loops: new Map([[1, 1]]) }))],
  ['diagnostic sequence', fixture('right [ Player | ... | ... | ... | Crate ] -> win'),
    result => ({ ...result, diagnostics: [...result.diagnostics].reverse() })],
  ['warning error accounting', fixture('right [ Player | ... | ... | Crate ] -> win'),
    result => ({ ...result, diagnostics: result.diagnostics.map(issue => ({ ...issue, countsAsError: true })) })],
  ['command identity', base,
    result => changeFirstGroup(result, group => ({ ...group, rules: group.rules.map(rule => ({ ...rule, commands: [...rule.commands] })) }))],
]) test('schedule oracle rejects corruption of ' + name, () => {
  assert.throws(() => oracle.compareFixture(item, { compileRuleSchedules: (rules, loops) =>
    corrupt(schedules.compileRuleSchedules(rules, loops), rules) }), /exact schedules|exact ordered schedule diagnostics|preserve executable commands/);
});

test('candidate cannot call any native parser or compiler producer', () => {
  for (const name of oracle.producers) assert.throws(() => oracle.compareFixture(base, {
    compileRuleSchedules: () => { globalThis[name](); },
  }), new RegExp('Candidate called native ' + name));
  assert.throws(() => oracle.independently(() => runInThisContext('new codeMirrorFn().startState()')), /Candidate called native codeMirrorFn/);
  assert.throws(() => oracle.independently(() => runInThisContext('new CodeMirror.StringStream("",4)')), /Candidate called native CodeMirror.StringStream/);
});
test('candidate cannot mutate frozen rules or their reachable sets', () => {
  assert.throws(() => oracle.compareFixture(base, { compileRuleSchedules: rules => { rules[0].executable.sourceLine = 1; } }), TypeError);
  assert.throws(() => oracle.compareFixture(base, { compileRuleSchedules: (rules, loops) => {
    rules[0].executable.rows[0][0].requiredObjects.clear();
    return schedules.compileRuleSchedules(rules, loops);
  } }), /schedule inputs are unchanged/);
});
test('candidate cannot mutate frozen authored loop evidence', () => {
  assert.throws(() => oracle.compareFixture(fixture('startloop\nright [ Player ] -> win\nendloop'), {
    compileRuleSchedules: (rules, loops) => { loops.push(loops[0]); },
  }), TypeError);
});
test('native scheduled rule decoder retains its unknown-field check', () => {
  assert.throws(() => oracle.compareFixture(base, { afterNative: parsed => { parsed.rules[0][0].unsupportedField = true; } }),
    /Unsupported vanilla scheduled rule field: unsupportedField/);
});

test('all 478 native sources match final schedules, rigid transitions and raw schedule diagnostics', t => {
  const fixtures = oracle.corpusFixtures();
  assert.equal(fixtures.length, 478);
  const totals = { sources: 0, lowered: 0, final: 0, earlyGroups: 0, lateGroups: 0, rigidGroups: 0, transitions: 0, loops: 0, diagnostics: 0 };
  for (const item of fixtures) {
    const { schedule, inputs } = oracle.compareFixture(item);
    totals.sources++; totals.lowered += inputs.length;
    totals.final += [...schedule.early.groups, ...schedule.late.groups].reduce((sum, group) => sum + group.rules.length, 0);
    totals.earlyGroups += schedule.early.groups.length; totals.lateGroups += schedule.late.groups.length;
    totals.rigidGroups += schedule.rigidMerges.size;
    for (const entries of schedule.rigidMerges.values()) totals.transitions += entries.size;
    totals.loops += schedule.early.loops.size + schedule.late.loops.size;
    totals.diagnostics += schedule.diagnostics.length;
  }
  t.diagnostic(JSON.stringify(totals));
  assert.equal(totals.sources, 478); assert.equal(totals.lowered, 99327); assert.equal(totals.final, 99076);
});


test('recovered InPlace variants retain commands and executable patterns', () => {
  const { schedule } = oracle.compareFixture(fixture('moving [ Player | Crate ] -> win'));
  assert.ok(schedule.early.groups[0].rules.some(rule => rule.direction === Direction.InPlace));
});
test('stage-boundary: overlapping recovered loop pairs preserve existing-map overwrites', () => {
  const item = boundaryFixture('loop-pair overwrite',
    'startloop\nright [ Player ] -> win\nendloop\nstartloop\nright [ Crate ] -> win\nendloop');
  const { schedule } = oracle.compareFixture(item, { boundary: {
    native: (rules, parsed) => { const markers = parsed.loops; parsed.loops = [markers[0], markers[3], markers[0], markers[1]]; },
    loops: markers => [markers[0], markers[3], markers[0], markers[1]],
  } });
  assert.deepEqual(schedule.early.loops, new Map([[1, 0], [0, 0]]));
});
test('late group crossing both boundaries reports once per pair at the start marker', () => {
  const { schedule } = oracle.compareFixture(fixture(
    'late right [ Player ] -> win\nstartloop\n+ late right [ Crate ] -> win\nendloop\n+ late right [ Wall ] -> win'));
  assert.equal(schedule.diagnostics.length, 1);
  assert.equal(schedule.diagnostics[0].code, 'loop-inside-rule-group');
});
