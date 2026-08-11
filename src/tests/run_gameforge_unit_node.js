'use strict';
const assert = require('assert');
const { loadSpec, DEFAULT_SPEC } = require('../../tools/gameforge/lib/spec');
const {
  parsePlayableLevels,
  cellAgreement,
  filterNearDupes,
} = require('../../tools/gameforge/lib/levels');
const { evaluatePublishGates } = require('../../tools/gameforge/lib/gates');
const { selectCandidate } = require('../../tools/gameforge/lib/select');

function testLoadSpecDefaults() {
  const spec = loadSpec({
    prompt: 'ice crates',
    seeds: ['src/demo/microban.txt'],
    candidates: ['candidates/c0.txt'],
  });
  assert.strictEqual(spec.min_solution_length, 5);
  assert.strictEqual(spec.near_dupe_threshold, 0.92);
  assert.strictEqual(spec.smoke_level_count, 1);
  assert.strictEqual(spec.min_levels_per_band, 1);
  assert.ok(spec.wall_clock_ms > 0);
  assert.deepStrictEqual(spec.bands.map((b) => b.name), ['tiny', 'small', 'medium']);
}

function testRejectMissingPrompt() {
  assert.throws(() => loadSpec({ seeds: ['a.txt'] }), /prompt/);
}

function testDefaultBandsAreCopied() {
  const beforeLength = DEFAULT_SPEC.bands.length;
  const beforeNames = DEFAULT_SPEC.bands.map((b) => b.name);
  const spec = loadSpec({
    prompt: 'ice crates',
    seeds: ['a.txt'],
    candidates: [],
  });
  assert.notStrictEqual(spec.bands, DEFAULT_SPEC.bands);
  spec.bands.push({ name: 'huge', dimensions: '10x10' });
  spec.bands[0].name = 'mutated';
  assert.strictEqual(DEFAULT_SPEC.bands.length, beforeLength);
  assert.deepStrictEqual(DEFAULT_SPEC.bands.map((b) => b.name), beforeNames);
}

function testParseSolutionComment() {
  const src = [
    '=======',
    'LEVELS',
    '',
    '(difficulty: 12)',
    '(solution: UURRDDLL)',
    '####',
    '#P.#',
    '#*C#',
    '####',
    '',
  ].join('\n');
  const levels = parsePlayableLevels(src);
  assert.strictEqual(levels.length, 1);
  assert.deepStrictEqual(levels[0].solution, ['up', 'up', 'right', 'right', 'down', 'down', 'left', 'left']);
  assert.strictEqual(levels[0].rows.length, 4);
}

function testNearDupeFilter() {
  const a = { width: 3, height: 2, rows: ['abc', 'def'] };
  const b = { width: 3, height: 2, rows: ['abc', 'def'] };
  const c = { width: 3, height: 2, rows: ['abx', 'def'] };
  assert.strictEqual(cellAgreement(a, b), 1);
  assert.ok(cellAgreement(a, c) < 1);
  const kept = filterNearDupes([a, b, c], 0.92);
  assert.strictEqual(kept.length, 2); // a kept, b dupe of a, c kept
}

function testPublishable() {
  const report = evaluatePublishGates({
    spec: loadSpec({
      prompt: 'x',
      seeds: ['s'],
      candidates: [],
      bands: [
        { name: 'tiny', dimensions: '3x2' },
        { name: 'small', dimensions: '4x3' },
      ],
      min_levels_per_band: 1,
      min_solution_length: 5,
    }),
    compileOk: true,
    theme: {
      hasTitle: true,
      hasAuthorOrPreludeOrMessage: true,
      legendCoversLevelGlyphs: true,
      spritesForAllObjects: true,
    },
    designLogPresent: true,
    levels: [
      {
        band: 'tiny',
        width: 3,
        height: 2,
        rows: ['###', '#P#'],
        solution: ['left', 'left', 'left', 'left', 'left'],
        solved: true,
        winExercised: true,
      },
      {
        band: 'small',
        width: 4,
        height: 3,
        rows: ['####', '#P.#', '####'],
        solution: ['right', 'right', 'right', 'right', 'right'],
        solved: true,
        winExercised: true,
      },
    ],
  });
  assert.strictEqual(report.status, 'publishable');
  assert.deepStrictEqual(report.failures, []);
}

function testTrivialFails() {
  const report = evaluatePublishGates({
    spec: loadSpec({ prompt: 'x', seeds: ['s'], candidates: [], min_solution_length: 5,
      bands: [{ name: 'tiny', dimensions: '3x2' }] }),
    compileOk: true,
    theme: {
      hasTitle: true,
      hasAuthorOrPreludeOrMessage: true,
      legendCoversLevelGlyphs: true,
      spritesForAllObjects: true,
    },
    designLogPresent: true,
    levels: [{
      band: 'tiny', width: 3, height: 2, rows: ['###', '#P#'],
      solution: ['left'], solved: true, winExercised: true,
    }],
  });
  assert.strictEqual(report.status, 'playable_incomplete');
  assert.ok(report.failures.some((f) => /min_solution_length/.test(f)));
}

function testSelectFirstPassing() {
  const calls = [];
  const result = selectCandidate({
    jobDir: '/tmp/job',
    spec: loadSpec({ prompt: 'x', seeds: ['seeds/a.txt'], candidates: ['candidates/bad.txt', 'candidates/good.txt'], smoke_level_count: 1 }),
    candidatePaths: ['/tmp/job/candidates/bad.txt', '/tmp/job/candidates/good.txt'],
    seedPaths: ['/tmp/job/seeds/a.txt'],
    compileFile: (p) => ({ ok: !p.endsWith('bad.txt'), errors: p.endsWith('bad.txt') ? ['boom'] : [] }),
    smokeCheck: (p) => {
      calls.push(p);
      return { ok: true, reasons: [], winExercised: true };
    },
    copyFile: () => {},
  });
  assert.strictEqual(result.status, 'selected');
  assert.ok(result.selectedPath.endsWith('good.txt'));
  assert.strictEqual(calls.length, 1);
}

function testSafeModeSeed() {
  const result = selectCandidate({
    jobDir: '/tmp/job',
    spec: loadSpec({ prompt: 'x', seeds: ['seeds/a.txt'], candidates: ['candidates/bad.txt'] }),
    candidatePaths: ['/tmp/job/candidates/bad.txt'],
    seedPaths: ['/tmp/job/seeds/a.txt'],
    compileFile: (p) => ({ ok: p.includes('seeds'), errors: [] }),
    smokeCheck: (p) => ({ ok: p.includes('seeds'), reasons: [], winExercised: true }),
    copyFile: () => {},
  });
  assert.strictEqual(result.status, 'safe_mode');
  assert.ok(result.selectedPath.includes('seeds'));
}

testLoadSpecDefaults();
testRejectMissingPrompt();
testDefaultBandsAreCopied();
testParseSolutionComment();
testNearDupeFilter();
testPublishable();
testTrivialFails();
testSelectFirstPassing();
testSafeModeSeed();
console.log('run_gameforge_unit_node: ok');
