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
  assert.equal(manifest.revision, '57f9f6cba69f6aa52ed738d5aee1d709d0037648');
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
