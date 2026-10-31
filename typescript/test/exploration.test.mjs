import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';

const optional = async path => import(path).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const { renderProgram, sourceIdentity } = await optional('./exploration/program.mjs');
const { generateProgram, families } = await optional('./exploration/generate.mjs');
const { simplifyPrograms, minimizeProgram, complexity } = await optional('./exploration/shrink.mjs');

export const example = () => ({
  version: 1, name: 'A tiny model', family: 'unit', seed: 'unit-seed',
  objects: [{ name: 'Background', color: 'black' }, { name: 'Player', color: 'white' },
    { name: 'Crate', color: 'red' }], properties: [],
  layers: [['Background'], ['Player', 'Crate']],
  board: [[['Background', 'Player'], ['Background', 'Crate'], ['Background']]],
  rules: ['right [ > Player | Crate ] -> [ > Player | > Crate ]'], inputs: [3, 'undo', 4],
});

test('a named-object model renders a complete error-free game without mutation', () => {
  assert.equal(typeof renderProgram, 'function');
  const program = example(), before = structuredClone(program);
  const source = renderProgram(program), compiled = compileSource(source);
  assert.equal(compiled.outcome.kind, SourceCompilationKind.Accepted);
  assert.equal(compiled.errorCount, 0);
  assert.match(source, /Background and Player/);
  assert.match(source, /Background and Crate/);
  assert.deepEqual(program, before);
});

test('glyph allocation distinguishes actual object sets and ignores occupant ordering', () => {
  assert.equal(typeof renderProgram, 'function');
  const program = example();
  program.board = [[['Background', 'Player'], ['Player', 'Background'], ['Background', 'Crate']]];
  const rows = renderProgram(program).split('\nlevels\n')[1].trim().split('\n');
  assert.equal(rows[0][0], rows[0][1]);
  assert.notEqual(rows[0][1], rows[0][2]);
});

test('the source model rejects undefined occupants, ragged boards and duplicate layer assignments', () => {
  assert.equal(typeof renderProgram, 'function');
  const unknown = example(); unknown.board[0][0].push('Missing');
  assert.throws(() => renderProgram(unknown), /undefined object/i);
  const ragged = example(); ragged.board.push([['Background']]);
  assert.throws(() => renderProgram(ragged), /rectangle/i);
  const layered = example(); layered.layers.push(['Player']);
  assert.throws(() => renderProgram(layered), /one layer|once/i);
});

test('source-game tapes and execution seeds must be explicit and supported', () => {
  const invalid = example(); invalid.inputs = ['right'];
  assert.throws(() => renderProgram(invalid), /input/i);
  const unseeded = example(); unseeded.seed = '';
  assert.throws(() => renderProgram(unseeded), /seed/i);
});

test('case construction depends only on the seed and index, never scheduling order', () => {
  assert.equal(typeof generateProgram, 'function');
  const originals = Array.from({ length: 20 }, (_, index) => generateProgram('order', index));
  for (const index of [19, 2, 8, 0, 7, 13, 1]) assert.deepEqual(generateProgram('order', index), originals[index]);
  assert.notDeepEqual(generateProgram('another-seed', 2), originals[2]);
  assert.deepEqual(new Set(originals.map(program => program.family)), new Set(families));
});

test('construction varies real rules and boards rather than titles or engine seeds', () => {
  assert.equal(typeof sourceIdentity, 'function');
  const programs = Array.from({ length: 64 }, (_, index) => generateProgram('variety', index));
  assert.ok(new Set(programs.map(sourceIdentity)).size >= 48);
  const changedLabel = { ...programs[0], name: 'Other title', seed: 'other runtime seed', inputs: [] };
  assert.equal(sourceIdentity(changedLabel), sourceIdentity(programs[0]));
  assert.ok(new Set(programs.map(program => JSON.stringify(program.rules))).size >= 12);
});

test('every generated family initially produces accepted, error-free source', () => {
  assert.equal(typeof generateProgram, 'function');
  for (let index = 0; index < 64; index++) {
    const program = generateProgram('validity', index), before = structuredClone(program);
    const result = compileSource(renderProgram(program));
    assert.equal(result.outcome.kind, SourceCompilationKind.Accepted, program.name);
    assert.equal(result.errorCount, 0, program.name + ': ' + result.diagnostics.map(issue => issue.message).join('; '));
    assert.deepEqual(program, before);
  }
});

test('the multirow family also explores two ellipses in a single row', () => {
  const programs = Array.from({ length: 64 }, (_, index) => generateProgram('ellipses', index));
  assert.ok(programs.some(program => program.rules.some(rule => (rule.split('->')[0].match(/\.\.\./g) ?? []).length === 2)));
});

test('generated rules exercise legal early random directions as well as random objects', () => {
  const rules = Array.from({ length: 64 }, (_, index) => generateProgram('random-directions', index)).flatMap(program => program.rules);
  assert.ok(rules.some(rule => /randomdir/.test(rule)));
  assert.ok(rules.some(rule => /random Color/.test(rule)));
  assert.ok(rules.filter(rule => /randomdir/.test(rule)).every(rule => !rule.startsWith('late')));
});

test('simplifications strictly decrease complexity and retain the execution seed', () => {
  assert.equal(typeof simplifyPrograms, 'function');
  const original = generateProgram('simplifications', 2), before = structuredClone(original);
  const candidates = [...simplifyPrograms(original)];
  assert.ok(candidates.length > 10);
  for (const candidate of candidates) {
    assert.equal(candidate.seed, original.seed);
    assert.ok(complexity(candidate).some((value, index) => {
      const earlier = complexity(candidate).slice(0, index);
      return earlier.every((item, position) => item === complexity(original)[position]) && value < complexity(original)[index];
    }));
    assert.doesNotThrow(() => renderProgram(candidate));
  }
  assert.deepEqual(original, before);
});

test('reduction preserves an actual injected oracle failure and rejects a different category', async () => {
  assert.equal(typeof minimizeProgram, 'function');
  const { createProgramChecker } = await import('./exploration/check.mjs');
  const { stepSession } = await import('../build/session.js');
  const check = await createProgramChecker({ stepSession: (...args) => {
    const result = stepSession(...args);
    return { ...result, modified: !result.modified };
  } });
  const original = example(), before = structuredClone(original);
  const failure = check(original);
  assert.equal(failure.status, 'failed');
  const reduced = await minimizeProgram(original, async candidate => {
    const result = check(candidate);
    return result.status === 'failed' && result.signature === failure.signature;
  }, { maxChecks: 200 });
  assert.equal(reduced.fixedPoint, true);
  assert.ok(reduced.checks > 0);
  assert.equal(reduced.program.inputs.length, 1);
  assert.equal(reduced.program.rules.length, 0);
  assert.equal(reduced.program.board.length, 1);
  assert.equal(reduced.program.board[0].length, 1);
  assert.deepEqual(reduced.program.objects.map(object => object.name), ['Background', 'Player']);
  assert.equal(check(reduced.program).signature, failure.signature);
  assert.equal(check({ ...reduced.program, inputs: [] }).status, 'passed');
  assert.equal(reduced.program.seed, original.seed);
  assert.deepEqual(original, before);
});

test('a reduction budget never claims a fixed point, and a non-reproducer is rejected', async () => {
  assert.equal(typeof minimizeProgram, 'function');
  let calls = 0;
  const limited = await minimizeProgram(example(), async () => { calls++; return true; }, { maxChecks: 1 });
  assert.equal(limited.fixedPoint, false);
  assert.equal(limited.checks, 1);
  assert.equal(calls, limited.checks, 'The original validation is part of the check budget');
  await assert.rejects(() => minimizeProgram(example(), async () => false), /does not reproduce/);
});
