'use strict';
const assert = require('assert');
const path = require('path');
const { loadSpec, DEFAULT_SPEC } = require('../../tools/gameforge/lib/spec');

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

testLoadSpecDefaults();
testRejectMissingPrompt();
console.log('run_gameforge_unit_node: ok');
