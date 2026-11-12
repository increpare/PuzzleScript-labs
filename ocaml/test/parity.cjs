#!/usr/bin/env node
'use strict';
// JavaScript is a development-time oracle only. Candidate compilation and all
// gameplay happen in the OCaml executable, starting from authored source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const { loadFixtures } = require('../../src/tests/semantic-fixtures/fixtures.cjs');
const { loadPuzzleScript, ORACLE_SOURCE } = require('../../typescript/test/native-host.cjs');
assert.deepEqual(ORACLE_SOURCE, require('../oracle-source.json'), 'Refresh the OCaml reference manifest deliberately when changing authority');
const { captureTraceSnapshot } = require('../../typescript/test/support/trace.cjs');
const { observe: observeCompilation } = require('./compile-observation.cjs');
const builtBinary = path.join(root, 'ocaml/_build/default/cli/main.exe');
const binaryBytes = fs.readFileSync(builtBinary);
const binarySha256 = crypto.createHash('sha256').update(binaryBytes).digest('hex');
const directory = path.join(__dirname, 'results');
fs.mkdirSync(directory, { recursive: true });
// Pin executable bytes for the entire run, allowing later development builds
// without silently mixing different candidates in one corpus result.
const runDirectory = fs.mkdtempSync(path.join(directory, 'run-'));
const binary = path.join(runDirectory, 'candidate-' + binarySha256 + '.exe');
fs.writeFileSync(binary, binaryBytes, { flag: 'wx', mode: 0o755 });
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), binarySha256);
const corpus = process.argv.includes('--corpus');
const generatedOption = process.argv.find(argument => argument === '--generated' || argument.startsWith('--generated='));
const frontendOption = process.argv.find(argument => argument === '--generated-frontend' || argument.startsWith('--generated-frontend='));
const rulesOption = process.argv.find(argument => argument === '--generated-rules' || argument.startsWith('--generated-rules='));
const bindingsOption = process.argv.find(argument => argument === '--generated-bindings' || argument.startsWith('--generated-bindings='));
const recoveryOption = process.argv.find(argument => argument.startsWith('--generated-recovery='));
const generated = generatedOption !== undefined || frontendOption !== undefined || rulesOption !== undefined || bindingsOption !== undefined || recoveryOption !== undefined;
assert.ok([generatedOption, frontendOption, rulesOption, bindingsOption, recoveryOption].filter(value => value !== undefined).length <= 1, 'Select one generated campaign');
assert.ok(!(corpus && generated), 'Select corpus or generated exploration');
const campaignSeed = process.argv.find(argument => argument.startsWith('--campaign-seed='))?.slice('--campaign-seed='.length) ?? 'ocaml-exploration-2026-11-06';
const caseCount = Number((generatedOption ?? frontendOption ?? rulesOption ?? bindingsOption ?? recoveryOption)?.split('=')[1] ?? 256);
const start = Number(process.argv.find(argument => argument.startsWith('--start='))?.slice('--start='.length) ?? 0);
assert.ok(Number.isSafeInteger(caseCount) && caseCount > 0 && Number.isSafeInteger(start) && start >= 0);
const filter = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? '';
loadPuzzleScript({ includeTests: corpus });
let campaign = null;
let generatedFixtures;
if (rulesOption || bindingsOption || recoveryOption) {
  const constructionFile = recoveryOption ? 'recovery-generation.cjs' : bindingsOption ? 'binding-generation.cjs' : 'rule-generation.cjs';
  const { construct } = require('./' + constructionFile);
  const constructed = Array.from({ length: caseCount }, (_, index) => construct(campaignSeed, start + index));
  campaign = { seed: campaignSeed, start, count: caseCount, [recoveryOption ? 'recovery' : bindingsOption ? 'bindings' : 'rules']: true,
    distinctSources: new Set(constructed.map(value => value.identity)).size,
    families: Object.fromEntries([...new Set(constructed.map(value => value.family))].map(family =>
      [family, constructed.filter(value => value.family === family).length])),
    constructionHashes: Object.fromEntries([
      [constructionFile, path.join(__dirname, constructionFile)],
      ...(bindingsOption || recoveryOption ? [] : [['program.mjs', path.join(root, 'typescript/test/exploration/program.mjs')]]),
    ].map(([name, file]) => [name, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) };
  generatedFixtures = constructed.map((value, index) => ({ name: 'generated: ' + value.name, source: value.source,
    inputs: value.inputs, seed: value.seed, level: 0, expectedBoard: null, expectedSounds: null, expectedErrors: recoveryOption ? null : [],
    sourceFile: 'generated-' + (start + index) + '.ps' })).filter(fixture => fixture.name.toLowerCase().includes(filter.toLowerCase()));
} else if (generated) {
  const { generateProgram } = require('../../typescript/test/exploration/generate.mjs');
  const { renderProgram, sourceIdentity } = require('../../typescript/test/exploration/program.mjs');
  const programs = Array.from({ length: caseCount }, (_, index) => generateProgram(campaignSeed, start + index));
  const constructed = frontendOption ? programs.map((program, index) => require('./frontend-generation.cjs').construct(program, campaignSeed, start + index)) : null;
  campaign = { seed: campaignSeed, start, count: caseCount, distinctSources: new Set(programs.map(sourceIdentity)).size,
    constructionHashes: Object.fromEntries(['generate.mjs', 'program.mjs'].map(filename => [filename,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'typescript/test/exploration', filename))).digest('hex')])) };
  if (constructed) {
    campaign.frontend = true;
    campaign.distinctSources = new Set(constructed.map(value => value.identity)).size;
    campaign.constructionHashes['frontend-generation.cjs'] = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'frontend-generation.cjs'))).digest('hex');
  }
  generatedFixtures = programs.map((program, index) => ({ name: 'generated: ' + program.name, source: constructed?.[index].source ?? renderProgram(program),
    inputs: program.inputs, seed: constructed?.[index].seed ?? program.seed, level: 0, expectedBoard: null, expectedSounds: null, expectedErrors: [],
    sourceFile: 'generated-' + (start + index) + '.ps' })).filter(fixture => fixture.name.toLowerCase().includes(filter.toLowerCase()));
}
const fixtures = generated ? generatedFixtures : corpus ? global.testdata.map(([name, payload], index) => ({
  name, source: payload[0], inputs: payload[1], expectedBoard: payload[2], level: payload[3] ?? 0,
  seed: payload[4] || 'ocaml-corpus', expectedSounds: payload[5], expectedErrors: null,
  sourceFile: `legacy-${index}.ps`,
})).filter(fixture => fixture.name.toLowerCase().includes(filter.toLowerCase())) : [
  ...loadFixtures({ filter }), ...loadFixtures({ directory: path.join(__dirname, 'fixtures'), filter }),
  ...require('./wire-fixtures.cjs').filter(fixture => fixture.name.toLowerCase().includes(filter.toLowerCase())),
];
assert.ok(fixtures.length > 0, 'No matching fixtures');
unitTesting = true;
const originalSound = playSound;
let played = [];
let activeSeed = '';
let events = [], savedProgress = null, savedCheckpoint = null, recording = false;
let referenceCompileErrors = 0;
let runtimeDiagnostics = [];
const originalRuntimeError = logErrorCacheable;
logErrorCacheable = function(message, ...rest) {
  if (message.includes('looping lots in a rule group')) runtimeDiagnostics.push('Rule-group iteration limit');
  if (message.includes('endless startloop...endloop vortex')) runtimeDiagnostics.push('Rule-loop iteration limit');
  return originalRuntimeError.call(this, message, ...rest);
};
const originalLoad = loadLevelFromLevelDat;
loadLevelFromLevelDat = function(game, board, seed, ...rest) {
  return originalLoad.call(this, game, board, seed || `${activeSeed}:level:${curlevel}`, ...rest);
};
playSound = (seed, ignore) => {
  played.push(String(seed));
  if (recording) events.push({ kind: 'sound', seed: String(seed), simple: ignore === true });
  return originalSound(seed, ignore);
};

function serializeData(width, height, data) {
  const seen = new Map();
  let out = '';
  for (let tile = 0; tile < width * height; tile++) {
    const names = [];
    for (let id = 0; id < state.objectCount; id++) if (data[tile * STRIDE_OBJ + (id >>> 5)] & (1 << (id & 31))) names.push(state.idDict[id]);
    const label = names.sort().join(' ');
    if (!seen.has(label)) { seen.set(label, seen.size); out += label + ':'; }
    out += seen.get(label) + ',';
    if ((tile + 1) % width === 0) out += '\n';
  }
  return out;
}
const viewport = values => values?.length === 4 ? { left: values[0], top: values[1], right: values[2], bottom: values[3] } : null;
const hash = text => crypto.createHash('blake2b512').update(text).digest('hex');
let snapshotDigestCache = new WeakMap();
function snapshotDigest(value) {
  if (snapshotDigestCache.has(value)) return snapshotDigestCache.get(value);
  const view = value.viewport === null ? 'none' : [value.viewport.left, value.viewport.top, value.viewport.right, value.viewport.bottom].join(',');
  const digest = hash(`${value.width}x${value.height}\n${view}\n${value.board}`);
  snapshotDigestCache.set(value, digest);
  return digest;
}
let savedBoardCache = new WeakMap();
function savedBoard(value) {
  if (value && savedBoardCache.has(value)) return savedBoardCache.get(value);
  const width = value?.width ?? 0, height = value?.height ?? 0;
  const snapshot = { width, height, board: serializeData(width, height, value?.dat ?? []), viewport: viewport(value?.oldflickscreendat) };
  if (value) savedBoardCache.set(value, snapshot);
  return snapshot;
}
function canonicalSnapshot(value) {
  const saved = savedBoard(value);
  return corpus ? { width: saved.width, height: saved.height, viewport: saved.viewport, boardDigest: snapshotDigest(saved) } : saved;
}
const originalSetItem = localStorage.setItem, originalRemoveItem = localStorage.removeItem;
const storageKey = key => key === document.URL ? 'progress' : key === document.URL + '_checkpoint' ? 'checkpoint' : null;
localStorage.setItem = function(key, value) {
  if (recording && storageKey(key)) {
    const logicalKey = storageKey(key), logicalValue = logicalKey === 'progress' ? String(value) : canonicalSnapshot(JSON.parse(value));
    if (logicalKey === 'progress') savedProgress = logicalValue;
    else savedCheckpoint = logicalValue;
    events.push({ kind: 'persistence', operation: 'set', key: logicalKey, value: logicalValue });
  }
  return originalSetItem.call(this, key, value);
};
localStorage.removeItem = function(key) {
  if (recording && storageKey(key)) {
    const logicalKey = storageKey(key);
    if (logicalKey === 'progress') savedProgress = null; else savedCheckpoint = null;
    events.push({ kind: 'persistence', operation: 'remove', key: logicalKey });
  }
  return originalRemoveItem.call(this, key);
};
let savedHistoryCache = new WeakMap();
function historyBoards() {
  let after = { dat: [...level.objects], width: level.width, height: level.height, oldflickscreendat: [...oldflickscreendat] };
  const boards = Array(backups.length);
  for (let i = backups.length - 1; i >= 0; i--) {
    const cached = savedHistoryCache.get(backups[i]);
    if (cached) { after = cached.raw; boards[i] = cached.board; }
    else {
      after = unconsolidateDiff(backups[i], after);
      boards[i] = savedBoard(after);
      savedHistoryCache.set(backups[i], { raw: after, board: boards[i] });
    }
  }
  return boards;
}

function snapshot(phase) {
  const trace = captureTraceSnapshot(phase, null, null, 0, 0);
  const diagnostics = runtimeDiagnostics;
  runtimeDiagnostics = [];
  const history = historyBoards();
  const saved = savedBoard(restartTarget);
  const historyState = corpus ? { historyDigest: history.reduce((digest, board) => hash(snapshotDigest(board) + ':' + digest), hash('puzzlescript-history-v1')) }
    : { historyBoards: history };
  const restartState = corpus ? { width: saved.width, height: saved.height, viewport: saved.viewport, boardDigest: snapshotDigest(saved) } : saved;
  return { phase, board: trace.serialized_level, level: Number(curlevel), diagnostics,
    recordingStartLevel: Number(recordingStartsFromLevel),
    history: backups.length, again: trace.againing,
    ...historyState, restartTarget: restartState, restartIsCheckpoint: restartTargetIsCheckpoint,
    viewport: viewport(oldflickscreendat), loadedSeed: String(loadedLevelSeed), message: messagetext,
    commands: [...level.commandQueue],
    screen: titleScreen ? 'title' : textMode ? 'message' : 'board',
    rng: { i: trace.random_state_i, j: trace.random_state_j, preview: trace.random_state_preview_bytes, permutation: [...RandomGen._state.s] },
    sounds: soundHistory.map(String), playedSounds: [...played], savedProgress, savedCheckpoint, events: [...events] };
}
function oracle(fixture) {
  recording = false;
  activeSeed = fixture.seed;
  savedHistoryCache = new WeakMap();
  savedBoardCache = new WeakMap();
  snapshotDigestCache = new WeakMap();
  runtimeDiagnostics = [];
  level = new Level(0, 0, 0, 0, new Int32Array(0));
  backups = [];
  restartTarget = undefined;
  oldflickscreendat = [];
  seedsToPlay_CanMove = [];
  seedsToPlay_CantMove = [];
  restartTargetIsCheckpoint = false;
  restarting = false;
  runrulesonlevelstart_phase = false;
  localStorage.removeItem(document.URL);
  localStorage.removeItem(document.URL + '_checkpoint');
  played = [];
  soundHistory = [];
  errorStrings = [];
  errorCount = 0;
  titleScreen = false;
  textMode = false;
  messagetext = '';
  againing = false;
  winning = false;
  savedProgress = null; savedCheckpoint = null; events = []; recording = true;
  compile(['loadLevel', fixture.level], fixture.source, fixture.seed);
  referenceCompileErrors = errorCount;
  const expected = [snapshot('initial')];
  for (const input of fixture.inputs) {
    if (input === 'undo') DoUndo(false, true);
    else if (input === 'restart') DoRestart();
    else processInput(input === 'tick' ? -1 : input);
    expected.push(snapshot('input'));
    let count = 0;
    while (againing) {
      if (++count > 1000) throw new Error('Oracle AGAIN limit');
      againing = false;
      processInput(-1);
      expected.push(snapshot('again'));
    }
  }
  return expected;
}

const startedAt = new Date().toISOString();
const report = { revision: ORACLE_SOURCE.revision, environment: { node: process.version, unicode: process.versions.unicode }, binarySha256, binary, filter, campaign, startedAt, fixtures: fixtures.length, passed: 0, referenceMatched: 0, rejected: [], failures: [], oracleFailures: [] };
if (recoveryOption) { report.compilerMatched = 0; report.checkedRejections = []; }
const reportStem = (recoveryOption ? 'recovery-parity' : bindingsOption ? 'bindings-parity' : rulesOption ? 'rules-parity' : frontendOption ? 'frontend-parity' : generated ? 'generated-parity' : corpus ? 'corpus-parity' : 'semantic-parity') + (filter ? '-' + crypto.createHash('sha256').update(filter).digest('hex').slice(0, 10) : '');
const runReport = path.join(runDirectory, 'report.json');
const activePath = path.join(directory, reportStem + '-active.json');
let caseIndex = 0;
function progress(state, currentCase = null) {
  const status = JSON.stringify({ state, pid: process.pid, startedAt, updatedAt: new Date().toISOString(),
    binarySha256, runDirectory, report: runReport, currentCase, caseIndex, fixtures: fixtures.length,
    referenceMatched: report.referenceMatched, rejected: report.rejected.length, failures: report.failures.length });
  const temporary = path.join(runDirectory, 'status.tmp');
  fs.writeFileSync(temporary, status + '\n');
  fs.renameSync(temporary, path.join(runDirectory, 'status.json'));
  fs.writeFileSync(activePath, status + '\n');
}
let observations = 0;
for (const fixture of fixtures) {
  progress('running', fixture.name);
  caseIndex++;
  const sourcePath = corpus || generated ? path.join(runDirectory, fixture.sourceFile) : path.join(runDirectory, 'authored-' + crypto.createHash('sha256').update(fixture.source).digest('hex') + '.ps');
  fs.writeFileSync(sourcePath, fixture.source);
  const result = spawnSync(binary, ['--compact', ...(corpus ? ['--state-digests'] : []), '--seed', fixture.seed, '--level', String(fixture.level),
    sourcePath, ...fixture.inputs.map(String)],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (recoveryOption && (result.status === 0 || result.status === 2)) {
    const { exception, ...expected } = observeCompilation(fixture.source);
    if (exception !== null) {
      report.oracleFailures.push({ name: fixture.name, message: exception, partialReference: expected });
      continue;
    }
    let actual;
    try {
      const compilation = JSON.parse(result.stdout.trim().split('\n')[0]);
      assert.equal(compilation.phase, 'compile');
      actual = { accepted: compilation.accepted, errorCount: compilation.errorCount,
        diagnostics: compilation.diagnostics.map(({ line, severity, message }) => ({ line, severity, message })) };
      assert.deepEqual(actual, expected, 'Ordered compiler observation');
      assert.equal(result.status, expected.accepted ? 0 : 2, 'Compilation exit status');
      report.compilerMatched++;
      if (!expected.accepted) {
        report.checkedRejections.push({ name: fixture.name, sourcePath,
          sourceSha256: crypto.createHash('sha256').update(fixture.source).digest('hex'), actual, expected });
        continue;
      }
    } catch (error) {
      report.failures.push({ name: fixture.name, message: error.message, actual, expected });
      continue;
    }
  }
  if (result.status !== 0) {
    report.rejected.push({ name: fixture.name, status: result.status, stdout: result.stdout.slice(0, 5000), stderr: result.stderr, error: result.error?.message });
    continue;
  }
  const records = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  const compilation = records.shift();
  const actual = records;
  const log = console.log;
  let expected;
  try { console.log = () => {}; expected = oracle(fixture); }
  catch (error) { report.oracleFailures.push({ name: fixture.name, message: error.message }); continue; }
  finally { console.log = log; }
  let baselineVerified = true;
  try {
    if (fixture.expectedErrors !== null) assert.equal(referenceCompileErrors, fixture.expectedErrors.length, 'Each authored reference compile error must be explicit');
    if (fixture.expectedBoard !== null) assert.equal(expected.at(-1).board, fixture.expectedBoard, 'Pinned oracle must match authored expected board');
    if (fixture.expectedSounds) assert.deepEqual(expected.at(-1).sounds, fixture.expectedSounds.map(String));
    if (fixture.expectedPlayedSounds) assert.deepEqual(expected.at(-1).playedSounds, fixture.expectedPlayedSounds.map(String));
  } catch (error) {
    baselineVerified = false;
    report.oracleFailures.push({ name: fixture.name, message: error.message });
  }
  try {
    assert.equal(compilation.phase, 'compile');
    assert.equal(compilation.accepted, true);
    assert.equal(compilation.unicodeVersion.split('.').slice(0, 2).join('.'), process.versions.unicode, 'Reference and candidate Unicode data versions');
    if (fixture.expectedErrors !== null) assert.deepEqual(compilation.diagnostics.filter(d => d.severity === 'error').map(d => d.message), fixture.expectedErrors, 'Authored compiler diagnostics');
    for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
      const { rows, ...candidate } = actual[i];
      assert.deepEqual(candidate, expected[i], `Observation ${i}`);
      observations++;
    }
    assert.equal(actual.length, expected.length, 'Observation count');
    report.referenceMatched++;
    if (baselineVerified) report.passed++;
  } catch (error) {
    report.failures.push({ name: fixture.name, message: error.message, actual, expected });
  }
}
const reportName = reportStem + '.json';
report.matchedObservations = observations;
report.finishedAt = new Date().toISOString();
const reportJson = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(runReport, reportJson);
fs.writeFileSync(path.join(directory, reportName), reportJson);
progress('finished');
console.log(JSON.stringify({ revision: report.revision, fixtures: fixtures.length, passed: report.passed,
  referenceMatched: report.referenceMatched,
  ...(recoveryOption ? { compilerMatched: report.compilerMatched, checkedRejections: report.checkedRejections.length } : {}),
  rejected: report.rejected.length, failed: report.failures.length, oracleFailures: report.oracleFailures.length, matchedObservations: observations,
  report: path.relative(root, runReport), latestReport: 'ocaml/test/results/' + reportName }, null, 2));
for (const failure of report.failures) console.log('FAIL ' + failure.name + '\n' + failure.message.slice(0, 1300));
for (const rejected of report.rejected) console.log('REJECT ' + rejected.name + ': ' + (rejected.stdout || rejected.stderr || rejected.error || '').trim().slice(0, 450));
for (const failure of report.oracleFailures) console.log('ORACLE ' + failure.name + ': ' + failure.message.slice(0, 500));
if (report.failures.length || report.rejected.length || report.oracleFailures.length) process.exitCode = 1;
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), binarySha256, 'Candidate binary changed during verification');
