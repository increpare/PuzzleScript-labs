'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeDefaultSokobanGenSpec } = require('./curriculum_gen');
const { DEFAULT_SPEC } = require('./spec');

const outPath = path.join(os.tmpdir(), `curriculum-gen-test-${process.pid}.gen`);
writeDefaultSokobanGenSpec(DEFAULT_SPEC, outPath);
const text = fs.readFileSync(outPath, 'utf8');
fs.unlinkSync(outPath);

assert(text.includes('dimensions:'), 'expected dimensions header');
for (const band of DEFAULT_SPEC.bands) {
  assert(text.includes(`name: ${band.name}`), `expected band name ${band.name}`);
}
assert(text.includes('choose 1 [ no wall no player no crate ] [ no wall no player no target ] -> [ crate ] [ target ]'), 'tiny band uses choose 1');
assert(text.includes('choose 1-2 [ no wall no player no crate ] [ no wall no player no target ] -> [ crate ] [ target ]'), 'larger bands use choose 1-2');

console.log('ok - writeDefaultSokobanGenSpec emits band blocks');
