'use strict';
const assert = require('assert');
const { loadSpec, DEFAULT_SPEC } = require('../../tools/gameforge/lib/spec');
const {
  parsePlayableLevels,
  cellAgreement,
  filterNearDupes,
} = require('../../tools/gameforge/lib/levels');

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

testLoadSpecDefaults();
testRejectMissingPrompt();
testDefaultBandsAreCopied();
testParseSolutionComment();
testNearDupeFilter();
console.log('run_gameforge_unit_node: ok');
