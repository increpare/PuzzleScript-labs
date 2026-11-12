#!/usr/bin/env node
'use strict';
// Explicit candidate recovery where the pinned source compiler crashes before
// producing a result. Faults remain failures in the separate diagnostic audit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadPuzzleScript, ORACLE_SOURCE } = require('../../typescript/test/native-host.cjs');
assert.deepEqual(ORACLE_SOURCE, require('../oracle-source.json'));
loadPuzzleScript();
unitTesting = true;
let installed = null;
setGameState = game => { installed = game; };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const directory = path.join(__dirname, 'results');
fs.mkdirSync(directory, { recursive: true });
const runDirectory = fs.mkdtempSync(path.join(directory, 'source-faults-'));
const bytes = fs.readFileSync(path.join(__dirname, '../_build/default/cli/main.exe'));
const binarySha256 = digest(bytes);
const binary = path.join(runDirectory, 'candidate-' + binarySha256 + '.exe');
fs.writeFileSync(binary, bytes, { flag: 'wx', mode: 0o755 });
const base = fs.readFileSync(path.join(__dirname, '../examples/push.ps'), 'utf8');
const fixtures = [
  { sound: 'Player move rules(ignored) 12345', accepted: true, errors: [
    'Ah I was expecting direction or a sound seed here after MOVE, but I don\'t know what to make of "".',
  ] },
  { sound: 'sfx0 12345 rules(', accepted: false, errors: [
    'I wasn\'t expecting anything after the sound declaration 12345 on this line, so I don\'t know what to do with "" here.',
    'No collision layers defined.  All objects need to be in collision layers.',
  ] },
];
const report = { revision: ORACLE_SOURCE.revision, binarySha256, binary,
  environment: { node: process.version, unicode: process.versions.unicode },
  constructionSha256: digest(fs.readFileSync(__filename)), startedAt: new Date().toISOString(),
  contract: 'An empty sound fallback after a consumed heading emits a structured error. Comment recovery preserves later sections or diagnoses their absence; it does not throw a host-language null exception.',
  fixtures: fixtures.length, passed: 0, compileObservations: 0, runtimeObservations: 0,
  referenceCompilerFaults: [], failures: [] };
for (const [index, fixture] of fixtures.entries()) {
  const name = 'sound raw ownership: ' + fixture.sound;
  const source = base.replace('\nsounds\n', '\nsounds\n' + fixture.sound + '\n');
  const sourceFile = path.join(runDirectory, 'source-' + index + '.ps');
  fs.writeFileSync(sourceFile, source);
  try {
    const result = spawnSync(binary, ['--compile-only', sourceFile],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, fixture.accepted ? 0 : 2, result.stderr);
    const compilation = JSON.parse(result.stdout.trim());
    assert.equal(compilation.accepted, fixture.accepted);
    assert.equal(compilation.errorCount, fixture.errors.length);
    assert.deepEqual(compilation.diagnostics.map(({ severity, message }) => ({ severity, message })),
      fixture.errors.map(message => ({ severity: 'error', message })));
    report.compileObservations++;
    if (fixture.accepted) {
      const replay = spawnSync(binary, ['--seed', 'ocaml/source-fault', sourceFile, 'right', 'undo', 'right'],
        { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(replay.status, 0, replay.stderr);
      const trace = replay.stdout.trim().split('\n').map(JSON.parse).slice(1);
      const initial = [[['background', 'player'], ['background', 'crate'], ['background'], ['background', 'wall']]];
      const pushed = [[['background'], ['background', 'player'], ['background', 'crate'], ['background', 'wall']]];
      assert.equal(trace.length, 4);
      for (const [n, observation] of trace.entries()) {
        assert.deepEqual(observation.rows, n % 2 ? pushed : initial);
        assert.equal(observation.history, n % 2);
        assert.deepEqual(observation.rng, trace[0].rng);
        assert.deepEqual(observation.playedSounds, []);
        report.runtimeObservations++;
      }
    }
    installed = null;
    let fault;
    const log = console.log, error = console.error;
    console.log = console.error = () => {};
    try { compile(['restart'], source, 'ocaml/source-fault'); } catch (error) { fault = error; }
    finally { console.log = log; console.error = error; }
    assert.ok(fault instanceof TypeError);
    assert.equal(fault.message, "Cannot read properties of null (reading '0')");
    assert.equal(installed, null);
    assert.equal(errorCount, 0, 'The reference fault precedes its attempted diagnostic');
    assert.equal(errorStrings.length, 0);
    report.referenceCompilerFaults.push({ name, sourceFile, sourceSha256: digest(source), error: fault.message });
    report.passed++;
  } catch (error) {
    report.failures.push({ name, sourceFile, error: error.stack });
  }
}
assert.equal(digest(fs.readFileSync(binary)), binarySha256);
report.finishedAt = new Date().toISOString();
const json = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(path.join(runDirectory, 'report.json'), json);
fs.writeFileSync(path.join(directory, 'source-faults.json'), json);
console.log(JSON.stringify({ fixtures: report.fixtures, passed: report.passed,
  compileObservations: report.compileObservations, runtimeObservations: report.runtimeObservations,
  referenceCompilerFaults: report.referenceCompilerFaults.length, failures: report.failures.length,
  report: path.relative(process.cwd(), path.join(runDirectory, 'report.json')) }, null, 2));
if (report.failures.length) process.exitCode = 1;
