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
  assert.equal(errorCount, 0);
  assert.deepEqual(errorStrings, []);
  processInput(4);
  const pending = level.getMovements(0).getshiftor(31, 5);
  assert.equal(pending, 8, 'The late rule leaves Right pending on Player');
  let nativeError;
  try { processInput(4); } catch (error) { nativeError = error; }
  assert.ok(nativeError instanceof TypeError, 'Second Action must expose the documented native failure');

  // Control: early randomdir replaces the input intent before movement resolves.
  compile(['loadLevel', 0], source.replace('late [', '['), 'late-restore');
  assert.equal(errorCount, 0);
  assert.doesNotThrow(() => { processInput(4); processInput(4); });

  const build = name => import(pathToFileURL(path.join(root, 'typescript/build', name + '.js')).href);
  const { compileSource } = await build('source-compiler');
  const { createSession, stepSession } = await build('session');
  const { Movement } = await build('model');
  const compiled = compileSource(source);
  assert.equal(compiled.errorCount, 0);
  assert.deepEqual(compiled.diagnostics, []);
  const game = compiled.outcome.game;
  const environment = { nextLevelSeed() { throw new Error('Unexpected level load'); } };
  let result = createSession(game, { seed: 'late-restore' }, environment);
  result = stepSession(game, result.state, Movement.Action, environment);
  let candidateError;
  try { stepSession(game, result.state, Movement.Action, environment); } catch (error) { candidateError = error; }
  assert.match(candidateError?.message ?? '', /Unsupported movement combination: Right, Action/);
  console.log(JSON.stringify({ revision: oracle.revision, diagnostics: [], inputs: [4, 4],
    pendingAfterFirstAction: 'Right', native: nativeError.name + ': ' + nativeError.message,
    typescript: candidateError.name + ': ' + candidateError.message, earlyRuleControl: 'two Actions succeed' }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
