#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../../..');
const source = fs.readFileSync(path.join(__dirname, 'late-player-randomdir.ps'), 'utf8');
const { oracle } = require(path.join(root, 'typescript/test/native-host.cjs')).loadPuzzleScript({ includeTests: false });

async function main() {
  unitTesting = true;
  compile(['loadLevel', 0], source, 'late-restore');
  const diagnostic = 'Movements cannot appear in late rules.';
  assert.equal(errorCount, 1);
  assert.ok(errorStrings.some(message => stripHTMLTags(message).includes(diagnostic)));
  assert.doesNotThrow(() => { processInput(4); processInput(4); });
  assert.ok(level.getMovements(0).iszero(), 'Recovery leaves no late movement pending');

  // Control: early randomdir replaces the input intent before movement resolves.
  compile(['loadLevel', 0], source.replace('late [', '['), 'late-restore');
  assert.equal(errorCount, 0);
  assert.doesNotThrow(() => { processInput(4); processInput(4); });

  const build = name => import(pathToFileURL(path.join(root, 'typescript/build', name + '.js')).href);
  const { compileSource } = await build('source-compiler');
  const { createSession, stepSession } = await build('session');
  const { Movement } = await build('model');
  const compiled = compileSource(source);
  assert.equal(compiled.errorCount, 1);
  assert.ok(compiled.diagnostics.some(issue => issue.message === diagnostic));
  const game = compiled.outcome.game;
  const environment = { nextLevelSeed() { throw new Error('Unexpected level load'); } };
  let result = createSession(game, { seed: 'late-restore' }, environment);
  for (const input of [Movement.Action, Movement.Action]) result = stepSession(game, result.state, input, environment);
  assert.deepEqual(result.state.execution.pendingMovements, []);
  console.log(JSON.stringify({ revision: oracle.revision, diagnostics: [diagnostic], inputs: [4, 4],
    pendingMovements: [], native: 'two Actions succeed', typescript: 'two Actions succeed',
    earlyRuleControl: 'two Actions succeed' }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
