import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { vanillaQuirks } from '../build/compatibility.js';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';
import { createSession, stepSession } from '../build/session.js';
import { Movement } from '../build/model.js';
import { movementSource } from './scenarios.mjs';

test('the default reference targets the reviewed vanilla sync checkpoint', () => {
  const manifest = JSON.parse(readFileSync(new URL('../oracle-source.json', import.meta.url), 'utf8'));
  assert.equal(manifest.revision, '7417d78a75b5a07402071e21e0c171a76ef8871d');
  assert.equal(vanillaQuirks.rigidOwnerOrdinalMerge, false);
  assert.equal(vanillaQuirks.lhsRandomDirIsUpAndLeft, false);
  assert.equal(vanillaQuirks.lateMovementsCarryOver, false);
});

test('the former two-Action crash source reports the late-movement error and recovers safely', () => {
  const source = readFileSync(new URL('../../src/tests/semantic-fixtures/repros/late-player-randomdir.ps', import.meta.url), 'utf8');
  const compilation = compileSource(source);
  assert.equal(compilation.outcome.kind, SourceCompilationKind.Accepted, 'Vanilla may install a game with reported errors');
  assert.equal(compilation.errorCount, 1);
  assert.ok(compilation.diagnostics.some(issue => issue.message === 'Movements cannot appear in late rules.'));
  const game = compilation.outcome.game;
  const environment = { nextLevelSeed() { throw new Error('Unexpected level transition'); } };
  let result = createSession(game, { seed: 'late-restore' }, environment);
  for (const input of [Movement.Action, Movement.Action]) result = stepSession(game, result.state, input, environment);
  assert.deepEqual(result.state.execution.pendingMovements, []);
});

for (const qualifier of ['random', 'randomdir']) {
  test('an illegal LHS ' + qualifier + ' removes its whole rule and preserves the following one', () => {
    const compilation = compileSource(movementSource({ rules:
      'right [ ' + qualifier + ' Player ] -> [ Crate ]\nright [ Player ] -> [ Player ] sfx0', sounds: 'sfx0 12345', level: 'P.' }));
    assert.equal(compilation.errorCount, 1);
    assert.equal(compilation.outcome.game.earlyRules.groups.flatMap(group => group.rules).length, 1);
    assert.ok(compilation.diagnostics.some(issue => issue.message === qualifier.toUpperCase()
      + ' cannot be matched on the left-hand side; it can only appear on the right'));
  });
}

for (const [sounds, expected] of [
  ['move 123', 'Sound verb "MOVE" needs an entity before it, e.g. "Player MOVE 12345".'],
  ['left 123', 'Sound direction "LEFT" needs an entity and MOVE or CANTMOVE before it, e.g. "Player MOVE LEFT 12345".'],
  ['Player 123', 'Was expecting a sound verb here (e.g. MOVE, DESTROY, CANTMOVE, or the like), but found something else. Try "PLAYER MOVE 12345" or "PLAYER ACTION 12345".'],
]) test('current sound recovery provides an actionable hint: ' + sounds, () => {
  const result = compileSource(movementSource({ sounds, rules: '' }));
  assert.ok(result.rawDiagnostics.some(issue => issue.message === expected));
});

for (const name of ['constructor', '__proto__']) {
  test('prototype names remain ordinary objects, properties and palette inputs: ' + name, () => {
    const object = compileSource(movementSource({ rules: 'right [ Crate ] -> [ Crate ]' }).replaceAll('Crate', name));
    assert.equal(object.outcome.kind, SourceCompilationKind.Accepted);
    assert.equal(object.errorCount, 0);
    assert.ok(object.outcome.declarations.objects.some(object => object.name === name));
    const palette = compileSource(movementSource({ metadata: 'color_palette ' + name, rules: '' }));
    assert.equal(palette.outcome.palette.name, 'arnecolors');
    assert.ok(palette.rawDiagnostics.some(issue => issue.message === `Palette "${name}" not found, defaulting to arnecolors.`));
  });
}

test('a closing forward synonym link is rejected before registration', () => {
  const result = compileSource(movementSource({ rules: '' }).replace('C = Crate', 'C = Crate\nOne = Two\nTwo = One'));
  assert.ok(result.rawDiagnostics.some(issue => issue.message === "You can't define object TWO in terms of itself!"));
  assert.equal(result.document.acceptedDeclarations.registrations.some(declaration => declaration.name === 'two'), false);
});

test('ordinary prelude diagnostics retain source text for a rendering host to escape', () => {
  const result = compileSource('<bad&>\n' + movementSource({ rules: '' }));
  assert.equal(result.rawDiagnostics[0].message, 'Unrecognised stuff "<bad&>" in the prelude.');
});
