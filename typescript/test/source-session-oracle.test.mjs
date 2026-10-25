import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { ExecutionDiagnosticKind } from '../build/execution-model.js';
import { compileSource, SourceCompilationKind, SourceCompilationStopReason } from '../build/source-compiler.js';
import * as sourceTypes from '../build/source-model.js';
import * as model from '../build/model.js';
import * as sessionModel from '../build/session-model.js';
import * as session from '../build/session.js';
import * as turnRules from '../build/turn-rules.js';
import * as winConditions from '../build/win-conditions.js';
import * as commands from '../build/commands.js';
import * as ruleModel from '../build/rule-model.js';
import * as assets from '../build/source-assets.js';
import * as declarationModel from '../build/declaration-model.js';
import { createSessionOracle } from './legacy-session-oracle.cjs';
import { movementSource } from './scenarios.mjs';

const types = { ExecutionDiagnosticKind, compileSource, SourceCompilationKind, SourceCompilationStopReason, ...sourceTypes,
  ...model, ...sessionModel, ...session, ...turnRules, ...winConditions, ...commands,
  ...ruleModel, ...assets, ...declarationModel };
const oracle = createSessionOracle(types);

test('default session executes the exact independently source-compiled game', () => {
  const compilations = [], games = [];
  const fixture = { name: 'source session ownership', source: movementSource({ rules: '', level: 'P...' }),
    inputs: [3, 'undo', 'restart'], seed: 'source-session' };
  oracle.compareFixture(fixture, {
    compileSource: source => { const result = compileSource(source); compilations.push(result); return result; },
    createSession: (...args) => { games.push(args[0]); return session.createSession(...args); },
  });
  assert.equal(compilations.length, 1);
  assert.equal(compilations[0].document.source, fixture.source + '\n');
  assert.equal(compilations[0].outcome.kind, SourceCompilationKind.Accepted);
  assert.equal(games.length, 1);
  assert.equal(games[0], compilations[0].outcome.game);
});

const fixture = overrides => ({ name: 'source session adversarial boundary',
  source: movementSource({ rules: 'right [ Player ] -> [ Player ] message Waiting', level: 'P..' }),
  inputs: [], seed: 'source-session-validation', ...overrides });
const corruptCompiler = mutate => source => { const result = compileSource(source); mutate(result); return result; };

for (const [name, mutate, rejection] of [
  ['missing player member', result => result.outcome.game.player.objects.clear(), /complete declarations/],
  ['changed predicate', result => result.outcome.game.earlyRules.groups[0].rules[0].rows[0][0].requiredObjects.clear(), /every executable rule/],
  ['changed edit', result => result.outcome.game.earlyRules.groups[0].rules[0].replacements[0][0].edits.addObjects.add(result.outcome.declarations.objects.find(object => object.name === 'crate')), /every executable rule/],
  ['missing source entry', result => result.outcome.ruleSources.delete(result.outcome.ruleSources.keys().next().value), /one source per final rule/],
  ['changed source identity', result => {
    const [rule, authored] = result.outcome.ruleSources.entries().next().value;
    result.outcome.ruleSources.set(rule, { ...authored });
  }, /canonical source-map identity/],
  ['stale source entry', result => {
    const [rule, authored] = result.outcome.ruleSources.entries().next().value;
    result.outcome.ruleSources.set({ ...rule }, authored);
  }, /one source per final rule/],
  ['unknown game field', result => { result.outcome.game.unknownField = true; }, /complete public compiler fields/],
]) {
  test('source session rejects compiler corruption before any inputs: ' + name, () => {
    assert.throws(() => oracle.compareFixture(fixture(), { compileSource: corruptCompiler(mutate) }), rejection);
  });
}

for (const expression of [
  'compile()', 'loadFile()', 'generateExtraMembers()', 'rulesToArray()', 'rulesToMask()',
  'codeMirrorFn()', 'CodeMirror.StringStream("")', 'processInput(3)', 'setGameState(state)',
  'loadLevelFromState(state, 0)', 'state.resolveMovements(level, [])',
  'RandomGen.uniform()', 'RandomGen._state.next()', 'new RNG(() => 0)', 'new RC4("")',
  '"seed".getBytes()',
  'new Level(0, 1, 1, 1, []).getCell(0)',
  'state.rules[0][0].cellRowMatches[0](state.rules[0][0].patterns[0], 0, level.height, level.objects, level.movements)',
]) {
  test('source compilation cannot call native producer: ' + expression, () => {
    assert.throws(() => oracle.compareFixture(fixture(), { compileSource: source => {
      runInThisContext(expression);
      return compileSource(source);
    } }), /TS session called JS producer/);
  });
}

for (const [name, mutate] of [
  ['native initial board', () => runInThisContext('level.objects[0] = 0')],
  ['native RNG', () => runInThisContext('RandomGen._state.i++')],
  ['saved progress and effects', () => localStorage.setItem(document.URL, '123')],
]) {
  test('source compilation preserves ' + name, () => {
    assert.throws(() => oracle.compareFixture(fixture(), { compileSource: source => {
      const result = compileSource(source); mutate(); return result;
    } }), /candidate compilation changed native initial session/);
  });
}

for (const [name, mutate, rejection] of [
  ['result field', result => { result.unknownField = true; }, /session result fields/],
  ['state field', result => { result.state.unknownField = true; }, /session state fields/],
  ['frame field', result => { result.state.execution.unknownField = true; }, /session frame fields/],
  ['screen field', result => { result.state.screen.unknownField = true; }, /session screen fields/],
  ['screen tag', result => { result.state.screen.kind = 999; }, /unsupported session screen kind/],
  ['run mode', result => { result.state.runMode = 999; }, /unsupported session run mode/],
  ['board field', result => { result.state.execution.board.unknownField = true; }, /session board fields/],
  ['cell field', result => { result.state.execution.board.rows[0][0].unknownField = true; }, /session cell fields/],
  ['RNG field', result => { result.state.execution.random.unknownField = true; }, /session random fields/],
  ['snapshot field', result => { result.state.restartTarget.unknownField = true; }, /session snapshot fields/],
  ['command state field', result => { result.state.execution.commands.unknownField = true; }, /session commands fields/],
  ['effect tag', result => { result.effects.push({ kind: 999 }); }, /unsupported session effect kind/],
  ['sound effect field', result => { result.effects.push({ kind: sessionModel.SessionEffectKind.Sound,
    seed: '123', simple: true, unknownField: true }); }, /session sound effect fields/],
  ['persistence tag', result => { result.effects.push({ kind: sessionModel.SessionEffectKind.Persistence,
    operation: 999, levelIndex: 0 }); }, /unsupported session persistence operation/],
  ['win effect field', result => { result.effects.push({ kind: sessionModel.SessionEffectKind.Win,
    levelIndex: 0, suppressed: false, unknownField: true }); }, /session win effect fields/],
  ['diagnostic origin', result => { result.effects.push({ kind: sessionModel.SessionEffectKind.Diagnostic,
    diagnostic: { origin: 'unknown' } }); }, /unsupported session diagnostic origin/],
  ['diagnostic tag', result => { result.effects.push({ kind: sessionModel.SessionEffectKind.Diagnostic,
    diagnostic: { origin: 'session', kind: 999 } }); }, /unsupported session diagnostic kind/],
]) {
  test('candidate initial projection rejects unknown or unsupported ' + name, () => {
    assert.throws(() => oracle.compareFixture(fixture(), { createSession: (...args) => {
      const result = session.createSession(...args); mutate(result); return result;
    } }), rejection);
  });
}

for (const [name, mutate, rejection] of [
  ['queued entry field', entry => { entry.unknownField = true; }, /session queued command fields/],
  ['command field', entry => { entry.command.unknownField = true; }, /session command fields/],
  ['command tag', entry => { entry.command = { kind: 999 }; }, /unsupported session command kind/],
]) {
  test('candidate command projection rejects ' + name, () => {
    assert.throws(() => oracle.compareFixture(fixture(), { createSession: (...args) => {
      const result = session.createSession(...args);
      const rule = args[0].earlyRules.groups[0].rules[0];
      const entry = { command: { ...rule.commands[0] }, source: rule };
      mutate(entry);
      result.state.execution.commands.entries.push(entry); return result;
    } }), rejection);
  });
}

test('accepted source compilation may retain native error diagnostics', () => {
  const source = movementSource({ rules: '[ Crate ] -> [ random Player ]', level: 'C.' })
    .replace('Player, Crate, Wall', 'Background\nCrate, Wall');
  let compilation;
  oracle.compareFixture(fixture({ source, inputs: ['tick', 'undo', 'restart'] }), {
    compileSource: source => { compilation = compileSource(source); return compilation; },
  });
  assert.equal(compilation.outcome.kind, SourceCompilationKind.Accepted);
  assert.ok(compilation.errorCount > 0);
  const orphan = compilation.outcome.declarations.orphanedObject;
  assert.ok(orphan);
  assert.notEqual(orphan, compilation.outcome.declarations.objects.find(object => object.name === orphan.name));
});

test('an unknown per-input effect is rejected with an otherwise correct board and session', () => {
  assert.throws(() => oracle.compareFixture(fixture({ inputs: [3] }), { stepSession: (...args) => {
    const result = session.stepSession(...args);
    return { ...result, effects: [...result.effects, { kind: 999 }] };
  } }), /unsupported session effect kind/);
});

test('canonical unassigned declarations cannot hide inside executable predicates', () => {
  const source = movementSource({ rules: 'right [ Crate ] -> [ random Player ]', level: 'C' })
    .replace('Player, Crate, Wall', 'Background\nCrate, Wall');
  assert.throws(() => oracle.compareFixture(fixture({ source }), { compileSource: corruptCompiler(result => {
    const player = result.outcome.declarations.objects.find(object => object.name === 'player');
    result.outcome.game.earlyRules.groups[0].rules[0].rows[0][0].requiredObjects.add(player);
  }) }), /canonical writable runtime object/);
});

test('source compilation cannot corrupt an inactive native sound and its candidate counterpart together', () => {
  const source = movementSource({ rules: '', level: 'P..', sounds: 'restart 100' });
  assert.throws(() => oracle.compareFixture(fixture({ source, inputs: ['restart'] }), {
    compileSource: source => {
      const result = compileSource(source);
      runInThisContext('state.sfx_Events.restart = 999');
      result.outcome.game.sounds.simple.set(sessionModel.SimpleSound.Restart, '999');
      return result;
    },
  }), /candidate compilation changed native compiled data/);
});
