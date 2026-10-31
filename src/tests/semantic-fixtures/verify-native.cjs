#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { loadFixtures, fixtureTuple } = require('./fixtures.cjs');
const { loadPuzzleScript } = require('../../../typescript/test/native-host.cjs');

loadPuzzleScript({ includeTests: true });
const fixtures = loadFixtures({ filter: process.argv[2] ?? '' });
assert.ok(fixtures.length > 0, 'No matching semantic fixtures');
let failures = 0, warnings = 0;
for (const fixture of fixtures) {
  const log = console.log;
  const originalPlaySound = playSound, played = [];
  playSound = (seed, ignore) => { played.push(String(seed)); return originalPlaySound(seed, ignore); };
  let passed;
  try { console.log = () => {}; passed = runTest(fixtureTuple(fixture)[1], fixture.name); }
  finally { console.log = log; playSound = originalPlaySound; }
  const expectedErrors = fixture.expectedErrors;
  if (errorCount !== expectedErrors.length || !expectedErrors.every(message => errorStrings.some(issue => stripHTMLTags(issue).includes(message)))) passed = false;
  if (fixture.expectedPlayedSounds !== undefined
    && JSON.stringify(played) !== JSON.stringify(fixture.expectedPlayedSounds.map(String))) passed = false;
  warnings += errorStrings.length;
  if (!passed) {
    failures++;
    console.error(JSON.stringify({ name: fixture.name, sourceFile: fixture.sourceFile,
      inputs: fixture.inputs, seed: fixture.seed, authored: fixture.expectedRows,
      expected: fixture.expectedBoard, actual: convertLevelToString(), errors: errorCount,
      diagnostics: errorStrings.map(stripHTMLTags), expectedSounds: fixture.expectedSounds,
      actualSounds: [...soundHistory], expectedPlayedSounds: fixture.expectedPlayedSounds, actualPlayedSounds: played }, null, 2));
  }
}
console.log('Pinned vanilla semantic fixtures: ' + (fixtures.length - failures) + '/' + fixtures.length
  + ' passed; ' + warnings + ' diagnostic messages.');
if (failures) process.exitCode = 1;
