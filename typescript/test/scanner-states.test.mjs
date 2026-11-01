import assert from 'node:assert/strict';
import test from 'node:test';
import * as sourceTypes from '../build/source-model.js';
import * as parser from '../build/source-parser.js';
import { createSourceParserOracle } from './legacy-source-parser.cjs';

const oracle = createSourceParserOracle({ ...sourceTypes, ...parser });
const game = ({ prelude = '', objects = 'A\nred\n\nB\nblue', legend = 'x = A', sounds = '',
  collision = 'A\nB', rules = '', wins = '', levels = 'a' } = {}) =>
  [prelude, 'OBJECTS', objects, 'LEGEND', legend, 'SOUNDS', sounds, 'COLLISIONLAYERS', collision,
    'RULES', rules, 'WINCONDITIONS', wins, 'LEVELS', levels].join('\n');

const cases = [
  ['metadata values retain comment-tail warnings', { prelude: 'title Red(mid)Tail' }],
  ['metadata flag argument recovery differs from valued metadata', { prelude: 'noaction extra(mid)tail' }],
  ['legend consumes a midline heading without entering it', { legend: 'x = sounds A' }],
  ['legend heading tails reject a second heading after a comment', { legend: '(c)SOUNDS' }],
  ['legend retains its member phase across an inline comment', { legend: 'x = A (c) or B' }],
  ['legend operator recovery advances even when the operator is invalid', { legend: 'x = A ? (c) B' }],
  ['legend member recovery stays on the missing member', { legend: 'x = ? (c) A or B' }],
  ['rule direction scanning follows the last pattern separator', { rules: '] up left startloop' }],
  ['rule arrows alone keep the prelude phase', { rules: '-> up startloop' }],
  ['a rule message consumes an opening parenthesis literally', { rules: '[ A ] -> message (unclosed\n[ B ] -> [ B ]' }],
  ['a rule message still visits an unmatched close before its tail', { rules: '[ A ] -> message ) (unclosed\n[ B ] -> [ B ]' }],
  ['a level message consumes an opening parenthesis literally', { levels: 'message (unclosed\nab' }],
  ['a level message still visits an unmatched close before its tail', { levels: 'message ) (unclosed\nab' }],
  ['an incomplete sound event after a prefix comment still registers', { sounds: '(prefix)sfx0' }],
  ['a sound seed after an inline comment keeps its event phase', { sounds: 'sfx0(mid)123' }],
  ['sound direction lists keep their seed phase', { sounds: 'A move up(c) down 123' }],
  ['failed sound seed recovery preserves extra consumption in a visit', { sounds: '! 123 A move 9' }],
  ['an unmatched close at sound EOL does not finalize its event', { sounds: 'sfx0 )' }],
  ['space after an unmatched close permits a later sound EOL visit', { sounds: 'sfx0 ) ' }],
  ['an unmatched close at legend EOL does not finalize its alias', { legend: 'x = A )' }],
  ['a comment-only level line without trailing space keeps the grid', { levels: 'a\n(c)\nab' }],
  ['space after a comment-only level line separates grids', { levels: 'a\n(c) \nab' }],
  ['a pure equals separator does not become a level row', { levels: 'a\n===\na' }],
  ['an equals line with a comment is a level row', { levels: 'a\n===(c)\na' }],
  ['level glyphs cannot reopen a previous section', { levels: 'rules' }],
  ['win clauses resume with a new quantifier after an inline comment', { wins: 'all A(c)on B' }],
  ['a leading unmatched close skips win quantifier initialization', { wins: ') all A on B' }],
  ['failed win tokens advance their expected position', { wins: 'all ? (c) any B on A extra' }],
  ['object color and sprite phases follow logical body starts', { objects: 'A Alias\nred(c)blue\n00000\n00000\n00000\n00000\n00000\n\nB Other\nblue' }],
];
for (const [name, changes] of cases) {
  test('scanner phases: ' + name, () => oracle.compareFixture({ name, source: game(changes) }));
}

test('scanner characterization observes actual accepted registrations and event retention', () => {
  const alias = oracle.compareFixture({ name: 'accepted after midline heading', source: game({ legend: 'x = sounds A' }) });
  assert.deepEqual(alias.native.state.legend_synonyms.map(entry => entry.slice()), [['x', 'a']]);
  assert.ok(alias.result.document.acceptedDeclarations.registrations.some(entry => entry.name === 'x'));
  const closed = oracle.compareFixture({ name: 'event close drops native finalization', source: game({ sounds: 'sfx0 )' }) });
  assert.deepEqual(closed.native.state.sounds, []);
  assert.equal(closed.result.document.sounds[0].eventDefinition, null);
  const incomplete = oracle.compareFixture({ name: 'incomplete event registration', source: game({ sounds: '(prefix)sfx0' }) });
  assert.equal(incomplete.native.state.sounds[0][0][0], 'sfx0');
  assert.equal(incomplete.result.document.sounds[0].eventDefinition.value, 'sfx0');
});

test('returning to an earlier section requires its ever-visited predecessor', () => {
  const source = 'OBJECTS\nA\nred\nLEGEND\nSOUNDS\nCOLLISIONLAYERS\nA\nRULES\nLEGEND\nx = A\nRULES\n[ A ] -> [ A ]';
  const { native } = oracle.compareFixture({ name: 'revisited sections', source });
  assert.deepEqual(native.raw.map(issue => issue.message), [
    'cannot duplicate sections (you tried to duplicate "LEGEND").',
    'cannot duplicate sections (you tried to duplicate "RULES").',
  ]);
});

test('cross-section comment recovery preserves exact sixth-error stopping visits', () => {
  const source = Array.from({ length: 4 }, (_, index) => 'unknown' + index).join('\n') + '\n' +
    game({ sounds: 'sfx0 ) extra\nnotReached 2', legend: 'x = A', rules: '] bad another' });
  const { result } = oracle.compareFixture({ name: 'section phase at error cap', source });
  assert.equal(result.outcome.kind, parser.SourceParserOutcomeKind.Stopped);
  assert.equal(result.outcome.reason, parser.SourceParserStopReason.Errors);
});

test('comment resumption does not bypass the recorded-issue cap', () => {
  const source = ')\n'.repeat(100) + game({ prelude: 'title Red(mid)Tail', sounds: 'sfx0 1' });
  const { result } = oracle.compareFixture({ name: 'section phase at warning cap', source });
  assert.equal(result.outcome.reason, parser.SourceParserStopReason.Issues);
  assert.equal(result.diagnostics.length, 101);
});
