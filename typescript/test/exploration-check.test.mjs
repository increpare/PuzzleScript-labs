import assert from 'node:assert/strict';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { compileSource } from '../build/source-compiler.js';
import { SourceDiagnosticPhase, SourceDiagnosticSeverity } from '../build/source-model.js';
import { stepSession } from '../build/session.js';

const simpleProgram = overrides => ({
  version: 1, name: 'generated checker control', family: 'checker-control', seed: 'checker-control',
  objects: [{ name: 'Background', color: 'black' }, { name: 'Player', color: 'white' }],
  properties: [], layers: [['Background'], ['Player']],
  board: [[['Background', 'Player'], ['Background'], ['Background']]],
  rules: [], inputs: [3, 'undo', 'restart', 'tick'], ...overrides,
});
const checker = async overrides => {
  const { createProgramChecker } = await import('./exploration/check.mjs');
  return createProgramChecker(overrides);
};

test('generated checker compares the independently compiled complete session', async () => {
  const check = await checker();
  const result = check(simpleProgram());
  assert.equal(result.status, 'passed');
  assert.equal(result.nativeErrorFree, true);
  assert.equal(result.report.snapshots, 5);
  assert.ok(result.report.candidateOperations >= 5);
  assert.equal(result.report.levelLoads, 1);
});

test('generated checker excludes shared compiler errors only after compiler agreement', async () => {
  const check = await checker();
  const result = check(simpleProgram({ rules: ['[ Missing ] -> [ Player ]'] }));
  assert.equal(result.status, 'excluded');
  assert.equal(result.nativeErrorFree, false);
  assert.match(result.reason, /compiler|compilation|diagnostic/i);
});

test('a candidate-only compiler diagnostic fails rather than becoming excluded', async () => {
  const check = await checker({ compileSource: source => {
    const result = compileSource(source);
    const issue = { code: 'test-only', message: 'candidate-only compiler diagnostic',
      severity: SourceDiagnosticSeverity.Error, countsAsError: true, span: null,
      phase: SourceDiagnosticPhase.Rules };
    return { ...result, errorCount: result.errorCount + 1,
      rawDiagnostics: [...result.rawDiagnostics, issue], diagnostics: [...result.diagnostics, issue] };
  } });
  const result = check(simpleProgram());
  assert.equal(result.status, 'failed');
  assert.equal(result.phase, 'compiler');
  assert.equal(result.failureType, 'comparison');
  assert.equal(result.nativeErrorFree, true);
  assert.match(result.error.message, /exact raw diagnostics/);
  assert.match(result.error.actual, /candidate-only compiler diagnostic/);
  assert.equal(typeof result.error.expected, 'string');
});

test('returned-flag failures keep a stable field path as inputs and names shrink', async () => {
  const check = await checker({ stepSession: (...args) => {
    const result = stepSession(...args);
    return { ...result, modified: !result.modified };
  } });
  const original = check(simpleProgram({ name: 'long generated name', inputs: ['undo', 'restart', 3] }));
  const smaller = check(simpleProgram({ name: 'small', inputs: [3] }));
  assert.equal(original.status, 'failed');
  assert.equal(original.phase, 'session');
  assert.equal(original.failureType, 'comparison');
  assert.equal(original.nativeErrorFree, true);
  assert.equal(smaller.nativeErrorFree, true);
  assert.match(original.signature, /returned/);
  assert.equal(original.signature, smaller.signature);
  assert.match(original.error.actual, /returned: false/);
  assert.match(original.error.expected, /returned: true/);
  assert.doesNotThrow(() => JSON.stringify(original));
});

test('session failure signatures distinguish flags, board, RNG and history', async () => {
  const signatures = [];
  for (const mutate of [
    result => ({ ...result, modified: !result.modified }),
    result => ({ ...result, state: { ...result.state, execution: { ...result.state.execution,
      board: { ...result.state.execution.board, rows: result.state.execution.board.rows.map(row =>
        row.map(cell => ({ objects: new Set([...cell.objects].filter(object => object.name !== 'player')) }))) } } } }),
    result => ({ ...result, state: { ...result.state, execution: { ...result.state.execution,
      random: { ...result.state.execution.random, i: result.state.execution.random.i + 1 } } } }),
    result => ({ ...result, state: { ...result.state, history: [] } }),
  ]) {
    const check = await checker({ stepSession: (...args) => mutate(stepSession(...args)) });
    const result = check(simpleProgram({ inputs: [3] }));
    assert.equal(result.status, 'failed');
    assert.equal(result.failureType, 'comparison');
    assert.equal(result.nativeErrorFree, true);
    signatures.push(result.signature);
  }
  assert.equal(new Set(signatures).size, 4);
  assert.match(signatures[1], /board/);
  assert.match(signatures[2], /random/);
  assert.match(signatures[3], /history/);
  assert.doesNotMatch(signatures.join('\n'), /\[\d+\]/);
});

test('generated checker preserves the native session producer guard', async () => {
  const check = await checker({ stepSession: () => runInThisContext('processInput(3)') });
  const result = check(simpleProgram({ inputs: [3] }));
  assert.equal(result.status, 'failed');
  assert.equal(result.phase, 'session');
  assert.equal(result.failureType, 'exception');
  assert.equal(result.nativeErrorFree, true);
  assert.match(result.error.message, /TS session called JS producer processInput/);
});

test('generated checker preserves the compiler producer guard', async () => {
  const check = await checker({ compileSource: source => {
    runInThisContext('loadFile("")');
    return compileSource(source);
  } });
  const result = check(simpleProgram());
  assert.equal(result.status, 'failed');
  assert.equal(result.phase, 'compiler');
  assert.equal(result.failureType, 'exception');
  assert.equal(result.nativeErrorFree, true);
  assert.match(result.error.message, /Candidate called native loadFile/);
});

test('an execution TypeError is recorded as an exception with its original evidence', async () => {
  const check = await checker({ stepSession: () => { throw new TypeError('native undefined value'); } });
  const result = check(simpleProgram({ inputs: [3] }));
  assert.equal(result.status, 'failed');
  assert.equal(result.failureType, 'exception');
  assert.equal(result.nativeErrorFree, true);
  assert.equal(result.error.name, 'TypeError');
  assert.equal(result.error.message, 'native undefined value');
  assert.match(result.error.stack, /TypeError: native undefined value/);
});

test('checker factories reuse the verified host while keeping overrides isolated', async () => {
  const ordinary = await checker();
  const guarded = await checker({ stepSession: () => runInThisContext('processInput(3)') });
  const laterOrdinary = await checker();
  assert.equal(ordinary(simpleProgram()).status, 'passed');
  assert.match(guarded(simpleProgram()).error.message, /TS session called JS producer processInput/);
  assert.equal(laterOrdinary(simpleProgram()).status, 'passed');
  assert.equal(ordinary(simpleProgram()).status, 'passed');
});

test('renderer rejection is recorded in the model phase before native compilation', async () => {
  const check = await checker({ compileSource: () => { throw new Error('must not compile'); } });
  const result = check(simpleProgram({ version: 999 }));
  assert.equal(result.status, 'failed');
  assert.equal(result.phase, 'model');
  assert.equal(result.failureType, 'comparison');
  assert.equal(result.nativeErrorFree, false);
  assert.match(result.error.message, /Unsupported program version/);
});

test('native error freedom is observed before optional hooks or candidate compilation', async () => {
  const observations = [];
  const check = await checker({
    afterNative: formed => {
      assert.ok(formed);
      observations.push('native');
      runInThisContext('errorCount = 99');
    },
    compileSource: () => {
      observations.push('candidate');
      throw new TypeError('candidate compiler control');
    },
  });
  const result = check(simpleProgram());
  assert.deepEqual(observations, ['native', 'candidate']);
  assert.equal(result.status, 'failed');
  assert.equal(result.phase, 'compiler');
  assert.equal(result.failureType, 'exception');
  assert.equal(result.nativeErrorFree, true);
  assert.equal(result.error.message, 'candidate compiler control');
});
