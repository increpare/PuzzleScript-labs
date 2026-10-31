import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as model from '../build/model.js';
import * as ruleModel from '../build/rule-model.js';
import * as commands from '../build/commands.js';
import * as turns from '../build/turn-rules.js';
import * as wins from '../build/win-conditions.js';
import * as sessions from '../build/session-model.js';
import * as session from '../build/session.js';
import * as compiler from '../build/source-compiler.js';
import * as source from '../build/source-model.js';
import * as assets from '../build/source-assets.js';
import * as declarations from '../build/declaration-model.js';
import * as execution from '../build/execution-model.js';
import corpus from '../../src/tests/semantic-fixtures/fixtures.cjs';
import exporter from '../../src/tests/semantic-fixtures/export.cjs';
import { createSessionOracle } from './legacy-session-oracle.cjs';

const oracle = createSessionOracle({ ...model, ...ruleModel, ...commands, ...turns, ...wins,
  ...sessions, ...session, ...compiler, ...source, ...assets, ...declarations, ...execution });
const fixtures = corpus.loadFixtures();
assert.ok(fixtures.length > 0, 'The authored semantic corpus must not be empty');
const totals = { fixtures: 0, snapshots: 0, candidateOperations: 0, levelLoads: 0 };

function compareAuthoredFixture(fixture) {
  const played = [], options = {};
  if (fixture.expectedPlayedSounds !== undefined) {
    for (const name of ['createSession', 'stepSession', 'undoSession', 'restartSession']) {
      options[name] = (...args) => {
        const result = session[name](...args);
        played.push(...result.effects.filter(effect => effect.kind === sessions.SessionEffectKind.Sound).map(effect => String(effect.seed)));
        return result;
      };
    }
  }
  const report = oracle.compareFixture(fixture, options);
  if (fixture.expectedPlayedSounds !== undefined) assert.deepEqual(played, fixture.expectedPlayedSounds.map(String), 'authored played sounds');
  return report;
}

for (const fixture of fixtures) {
  test(fixture.name, () => {
    const compilation = compiler.compileSource(fixture.source);
    assert.equal(compilation.outcome.kind, compiler.SourceCompilationKind.Accepted);
    assert.equal(compilation.errorCount, fixture.expectedErrors.length, 'Each compile error must be explicitly authored');
    for (const message of fixture.expectedErrors) assert.ok(compilation.diagnostics.some(issue => issue.message === message));
    const report = compareAuthoredFixture(fixture);
    assert.ok(report.snapshots >= fixture.inputs.length + 1);
    totals.fixtures++;
    for (const key of ['snapshots', 'candidateOperations', 'levelLoads']) totals[key] += report[key];
  });
}

test('portable testdata entries exactly match the authored semantic fixtures', () => {
  const original = readFileSync(new URL('../../src/tests/resources/testdata.js', import.meta.url), 'utf8');
  assert.ok(exporter.replaceGeneratedSection(original, exporter.renderSection(fixtures)) === original,
    'Run node src/tests/semantic-fixtures/export.cjs after editing fixtures');
});

test('semantic oracle rejects a wrong hand-authored final board even when the engines agree', () => {
  const fixture = fixtures[0];
  assert.throws(() => oracle.compareFixture({ ...fixture, expectedBoard: 'wrong expected board\n' }), /JS corpus final board/);
});

test('semantic oracle rejects an incorrect expected sound history', () => {
  const fixture = fixtures.find(fixture => fixture.expectedSounds?.length > 0);
  assert.ok(fixture, 'Include an audible semantic example');
  assert.throws(() => oracle.compareFixture({ ...fixture, expectedSounds: ['wrong sound'] }), /JS corpus sounds/);
});

test('authored simple-sound expectations are checked beyond JS/TS agreement', () => {
  const fixture = fixtures.find(fixture => fixture.expectedPlayedSounds?.length > 0);
  assert.ok(fixture, 'Include a command-sound example');
  assert.throws(() => compareAuthoredFixture({ ...fixture, expectedPlayedSounds: ['wrong audible sound'] }), /authored played sounds/);
});

test('fixed issue 1206 bans actual contributors and never the absent Wall group', () => {
  const fixture = fixtures.find(fixture => fixture.name.startsWith('semantic: movement/rigid-owner-1206:'));
  assert.ok(fixture);
  unitTesting = true;
  compile(['loadLevel', 0], fixture.source, fixture.seed);
  const nativeGame = state, resolve = nativeGame.resolveMovements, attempts = [];
  try {
    nativeGame.resolveMovements = function(board, bans) {
      const retry = resolve.apply(this, arguments);
      attempts.push({ retry, bans: Object.keys(bans).filter(group => bans[group]).map(Number) });
      return retry;
    };
    processInput(4);
  } finally { nativeGame.resolveMovements = resolve; unitTesting = false; }
  assert.deepEqual(attempts, [{ retry: true, bans: [0] }, { retry: true, bans: [0, 1] }, { retry: false, bans: [0, 1] }]);
  const game = compiler.compileSource(fixture.source).outcome.game;
  const environment = { nextLevelSeed() { throw new Error('Unexpected level load'); } };
  const initial = session.createSession(game, { seed: fixture.seed }, environment).state;
  const actual = session.stepSession(game, initial, model.Movement.Action, environment).state;
  assert.deepEqual(actual.execution.bannedGroups, new Set([0, 1]));
});

test('semantic corpus compares every authored case', context => {
  assert.equal(totals.fixtures, fixtures.length);
  context.diagnostic(JSON.stringify(totals));
});
