#!/usr/bin/env node
'use strict';
// Explicit component contract where the pinned reference accepts a source but
// cannot execute it. These cases are never counted as differential parity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadPuzzleScript, ORACLE_SOURCE } = require('../../typescript/test/native-host.cjs');
assert.deepEqual(ORACLE_SOURCE, require('../oracle-source.json'));
loadPuzzleScript();
const { captureTraceSnapshot } = require('../../typescript/test/support/trace.cjs');
unitTesting = true;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const directory = path.join(__dirname, 'results');
fs.mkdirSync(directory, { recursive: true });
const runDirectory = fs.mkdtempSync(path.join(directory, 'gaps-'));
const bytes = fs.readFileSync(path.join(__dirname, '../_build/default/cli/main.exe'));
const binarySha256 = digest(bytes);
const binary = path.join(runDirectory, 'candidate-' + binarySha256 + '.exe');
fs.writeFileSync(binary, bytes, { flag: 'wx', mode: 0o755 });
const base = fs.readFileSync(path.join(__dirname, '../examples/push.ps'), 'utf8');
const makeSource = (direction, gaps, rows, random) => base
  .replace('[ > Player | Crate ] -> [ > Player | > Crate ]',
    `${random ? 'random ' : ''}${direction} [ Player | ${gaps} | Wall ] -> [ Player | ${gaps} | Crate ]`)
  .replace('levels\nPC.#', 'levels\n' + rows.join('\n'));
const namedRows = rows => rows.map(row => [...row].map(glyph =>
  ['background', ...({ P: ['player'], '#': ['wall'], C: ['crate'], '.': [] }[glyph])].sort()));
const referenceRows = () => Array.from({ length: level.height }, (_, y) =>
  Array.from({ length: level.width }, (_, x) => {
    const cell = level.getCell(x + y * level.width), names = [];
    for (let id = 0; id < state.objectCount; id++) if (cell.get(id)) names.push(state.idDict[id]);
    return names.sort();
  }));
function referenceSnapshot() {
  const trace = captureTraceSnapshot('contract', 0, 4, 0, 0);
  return { rows: referenceRows(), history: backups.length,
    rng: { i: trace.random_state_i, j: trace.random_state_j,
      preview: trace.random_state_preview_bytes, permutation: [...RandomGen._state.s] } };
}
function loadReference(source, seed) {
  level = new Level(0, 0, 0, 0, new Int32Array(0));
  backups = []; restartTarget = undefined; restartTargetIsCheckpoint = false;
  restarting = false; runrulesonlevelstart_phase = false; oldflickscreendat = [];
  seedsToPlay_CanMove = []; seedsToPlay_CantMove = [];
  localStorage.removeItem(document.URL); localStorage.removeItem(document.URL + '_checkpoint');
  soundHistory = []; errorStrings = []; errorCount = 0;
  titleScreen = false; textMode = false; messagetext = ''; againing = false; winning = false;
  compile(['loadLevel', 0], source, seed);
  assert.equal(errorCount, 0, 'The pinned compiler accepts the gap source');
}
const cases = [];
for (const random of [false, true]) for (const direction of ['right', 'left', 'down', 'up']) {
  for (const horizontal of ['P#', 'P.#', 'P...#', 'P.#.#']) {
    const line = ['left', 'up'].includes(direction) ? [...horizontal].reverse().join('') : horizontal;
    const rows = ['down', 'up'].includes(direction) ? [...line] : [line];
    cases.push({ name: (random ? 'random ' : '') + direction + ' ' + horizontal, direction, rows, random });
  }
}
const report = { revision: ORACLE_SOURCE.revision, binarySha256, binary,
  environment: { node: process.version, unicode: process.versions.unicode },
  constructionSha256: digest(fs.readFileSync(__filename)), startedAt: new Date().toISOString(),
  contract: 'Adjacent gaps match as a single zero-or-more-cell span, including random candidate weights, random-stream consumption, fixed-cell edits and persistent undo.',
  fixtures: cases.length, passed: 0, nativeObservations: 0, referenceSingleGapObservations: 0,
  referenceRuntimeFaults: [], failures: [] };
for (const [index, fixture] of cases.entries()) {
  const seed = 'ocaml/gaps/' + index;
  const source = makeSource(fixture.direction, '... | ...', fixture.rows, fixture.random);
  const sourceFile = path.join(runDirectory, 'source-' + index + '.ps');
  const singleFile = path.join(runDirectory, 'single-' + index + '.ps');
  const single = makeSource(fixture.direction, '...', fixture.rows, fixture.random);
  fs.writeFileSync(sourceFile, source); fs.writeFileSync(singleFile, single);
  try {
    const before = namedRows(fixture.rows), after = namedRows(fixture.rows.map(row => row.replaceAll('#', 'C')));
    // Check a valid single-gap program against an independently authored fixed
    // edit expectation, then use its RNG/undo trace for the explicit equivalence
    // contract. Adjacent-gap reference execution is still checked separately.
    loadReference(single, seed);
    const expected = [referenceSnapshot()];
    processInput(4); expected.push(referenceSnapshot());
    DoUndo(false, true); expected.push(referenceSnapshot());
    processInput(4); expected.push(referenceSnapshot());
    for (const [n, snapshot] of expected.entries()) {
      if (!fixture.random || n % 2 === 0) assert.deepEqual(snapshot.rows, n % 2 ? after : before);
      else {
        const cells = snapshot.rows.flat();
        assert.equal(cells.filter(cell => cell.includes('crate')).length, 1);
        assert.equal(cells.filter(cell => cell.includes('wall')).length, fixture.rows.join('').split('#').length - 2);
        assert.equal(cells.filter(cell => cell.includes('player')).length, 1);
      }
      report.referenceSingleGapObservations++;
    }
    const result = spawnSync(binary, ['--seed', seed, sourceFile, 'action', 'undo', 'action'],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const actual = result.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(actual.shift().accepted, true);
    assert.equal(actual.length, expected.length);
    for (const [n, snapshot] of expected.entries()) {
      assert.deepEqual({ rows: actual[n].rows, history: actual[n].history, rng: actual[n].rng }, snapshot,
        'Single-gap equivalence contract at observation ' + n);
      report.nativeObservations++;
    }
    loadReference(source, seed);
    let fault;
    try { processInput(4); } catch (error) { fault = error; }
    assert.ok(fault instanceof TypeError, 'The neighboring-gap reference fault remains visible');
    assert.match(fault.message, /cellRow\[2\]\.matches is not a function/);
    report.referenceRuntimeFaults.push({ name: fixture.name, sourceFile, error: fault.message });
    report.passed++;
  } catch (error) {
    report.failures.push({ name: fixture.name, sourceFile, error: error.stack });
  }
}
assert.equal(digest(fs.readFileSync(binary)), binarySha256);
report.finishedAt = new Date().toISOString();
const json = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(path.join(runDirectory, 'report.json'), json);
fs.writeFileSync(path.join(directory, 'gap-runtime.json'), json);
console.log(JSON.stringify({ fixtures: report.fixtures, passed: report.passed,
  nativeObservations: report.nativeObservations, referenceSingleGapObservations: report.referenceSingleGapObservations,
  referenceRuntimeFaults: report.referenceRuntimeFaults.length, failures: report.failures.length,
  report: path.relative(process.cwd(), path.join(runDirectory, 'report.json')) }, null, 2));
if (report.failures.length) process.exitCode = 1;
