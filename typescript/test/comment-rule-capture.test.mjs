import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';
import { noQuirks } from '../build/compatibility.js';
import { Movement } from '../build/model.js';
import { createSession, stepSession } from '../build/session.js';
import { readSource } from '../build/source-reader.js';
import { SourceSectionKind } from '../build/source-model.js';

const prefix = 'OBJECTS\nBackground .\nblack\nPlayer P\nwhite\nCrate C\nred\nFlag F\nyellow\nLEGEND\nSOUNDS\nCOLLISIONLAYERS\nBackground\nPlayer, Crate\nFlag\nRULES\n';
const ending = '\nWINCONDITIONS\nLEVELS\nP\n';
for (const [line, captured, expected] of [
  ['( [ Player ] -> [ Crate ] (note) ) cancel  ', 'cancel', 'player'],
  ['( [ Player ] -> [ Crate ] (note) ) cancel message garden', 'cancel message garden', 'player'],
  ['( [ Player ] -> [ Flag ] ) [ Player ] -> [ Crate ]', '[ player ] -> [ crate ]', 'crate'],
  ['(İ (nested) note) [ Player ] -> [ Crate ]', '[ player ] -> [ crate ]', 'crate'],
  ['( [ Player ] -> [ Flag ]\n(note) ) [ Player ] -> [ Crate ]', '[ player ] -> [ crate ]', 'crate'],
  ['[ Player ] -> [ Crate ] (note) cancel', '[ player ] -> [ crate ]', 'crate'],
]) for (const clean of [false, true]) test('capture active rule text after comments: ' + JSON.stringify({ line, clean }), () => {
  const source = prefix + line + ending;
  const result = compileSource(source, clean ? { quirks: noQuirks } : {});
  assert.equal(result.document.rules.length, 1);
  assert.equal(result.document.rules[0].legacyCapturedText.trim(), captured);
  assert.equal(result.outcome.kind, SourceCompilationKind.Accepted);
  const game = result.outcome.game, environment = { nextLevelSeed: () => 'comment capture' };
  const initial = createSession(game, { seed: 'comment capture' }, environment).state;
  const after = stepSession(game, initial, Movement.Action, environment).state;
  const names = [...after.execution.board.rows[0][0].objects].map(object => object.name);
  assert(names.includes(expected), JSON.stringify(names));
  assert(!names.includes('flag'));
  assert.equal(names.includes('crate'), expected === 'crate');
});

for (const line of ['( all Player on Flag (note) ) all Crate on Flag', '(İ (nested)) all Crate on Flag',
  'all Crate on Flag (note) all Player on Flag']) test('capture active win condition: ' + line, () => {
  const result = compileSource(prefix + '\nWINCONDITIONS\n' + line + '\nLEVELS\nP\n');
  assert.equal(result.outcome.kind, SourceCompilationKind.Accepted);
  assert.equal(result.outcome.game.winConditions.length, 1);
  assert.deepEqual([...result.outcome.game.winConditions[0].subject.objects].map(object => object.name), ['crate']);
});

test('ignored text after a trailing comment cannot swallow the next rule', () => {
  const result = compileSource(prefix + '[ Player ] -> [ Crate ] (note) cancel (unclosed\n[ Player ] -> [ Crate ]' + ending);
  assert.equal(result.document.rules.length, 2);
  assert.equal(result.outcome.kind, SourceCompilationKind.Accepted);
  assert(!result.rawDiagnostics.some(issue => issue.code === 'unclosed-comment'));
});

for (const rules of [') [ Player ] -> [ Crate ]', ') (note) [ Player ] -> [ Crate ]']) {
  test('an unmatched leading close consumes logical rule start: ' + rules, () => {
    const result = compileSource(prefix + rules + ending);
    assert.equal(result.document.rules.length, 0);
    assert.equal(result.outcome.kind, SourceCompilationKind.Accepted);
    const game = result.outcome.game, environment = { nextLevelSeed: () => 'stray close' };
    const initial = createSession(game, { seed: 'stray close' }, environment).state;
    const after = stepSession(game, initial, Movement.Action, environment).state;
    assert.deepEqual([...after.execution.board.rows[0][0].objects].map(object => object.name).sort(), ['background', 'player']);
  });
}

test('section headings retain text after comments for diagnostics and authored evidence', () => {
  const { document, diagnostics } = readSource(prefix + 'WINCONDITIONS (note) tail\nLEVELS (note) tail\nP\n');
  for (const kind of [SourceSectionKind.WinConditions, SourceSectionKind.Levels]) {
    assert.deepEqual(document.sections.find(section => section.kind === kind).trailingWords.map(word => word.spelling), ['tail']);
  }
  assert.equal(diagnostics.filter(issue => issue.code === 'heading-trailing-text').length, 2);
});
