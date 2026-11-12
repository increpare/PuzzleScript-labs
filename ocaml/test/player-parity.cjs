#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadPuzzleScript, ORACLE_SOURCE } = require('../../typescript/test/native-host.cjs');
assert.deepEqual(ORACLE_SOURCE, require('../oracle-source.json'));
const { srcDir } = loadPuzzleScript();
const { captureTraceSnapshot } = require('../../typescript/test/support/trace.cjs');
document.addEventListener = window.addEventListener = window.requestAnimationFrame = () => {};
global.HTMLCanvasElement = function HTMLCanvasElement() {};
vm.runInThisContext(fs.readFileSync(path.join(srcDir, 'js/inputoutput.js'), 'utf8'), { filename: 'pinned_inputoutput.js' });
// Host-only boundaries: rendering, device polling and audio initialization.
ULBS = pollGamepads = () => {};
const corpus = false;
const directory = path.join(__dirname, 'results');
fs.mkdirSync(directory, { recursive: true });
const runDirectory = fs.mkdtempSync(path.join(directory, 'player-'));
const binaryBytes = fs.readFileSync(path.join(__dirname, '../_build/default/cli/main.exe'));
const binarySha256 = crypto.createHash('sha256').update(binaryBytes).digest('hex');
const binary = path.join(runDirectory, 'candidate-' + binarySha256 + '.exe');
fs.writeFileSync(binary, binaryBytes, { mode: 0o755, flag: 'wx' });
let played = [], events = [], savedProgress = null, savedCheckpoint = null, recording = false, runtimeDiagnostics = [];
const originalRuntimeError = logErrorCacheable;
logErrorCacheable = function(message, ...rest) {
  if (message.includes('looping lots in a rule group')) runtimeDiagnostics.push('Rule-group iteration limit');
  if (message.includes('endless startloop...endloop vortex')) runtimeDiagnostics.push('Rule-loop iteration limit');
  return originalRuntimeError.call(this, message, ...rest);
};
const originalSound = playSound;
playSound = (seed, simple) => {
  played.push(String(seed));
  if (recording) events.push({ kind: 'sound', seed: String(seed), simple: simple === true });
  return originalSound(seed, simple);
};
const originalLoad = loadLevelFromLevelDat;
let activeSeed = '';
loadLevelFromLevelDat = (game, board, seed, ...rest) => originalLoad(game, board, seed || activeSeed + ':level:' + curlevel, ...rest);
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
  return saved;
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
    winning, timerMs: timer, autotickMs: autotick, ignoreHeldAction: ignoreNotJustPressedAction, messageSelected: messageselected,
    inputThrottleMs: input_throttle_timer, lastDirection: ({ 0: 'up', 1: 'left', 2: 'down', 3: 'right' })[lastinput] ?? null,
    choice: titleScreen ? (titleSelection === 0 ? 'new' : 'continue') : 'none',
    transition: quittingTitleScreen ? 'title' : quittingMessageScreen ? 'message' : 'idle',
    titlePending: quittingTitleScreen, messagePending: quittingMessageScreen,
    canContinue: showContinueOptionOnTitleScreen(),
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
  savedHistoryCache = new WeakMap(); savedBoardCache = new WeakMap(); snapshotDigestCache = new WeakMap();
  level = new Level(0, 0, 0, 0, new Int32Array(0));
  level.commandQueue = []; level.commandQueueSourceRules = [];
  backups = []; restartTarget = undefined; oldflickscreendat = [];
  seedsToPlay_CanMove = []; seedsToPlay_CantMove = []; restartTargetIsCheckpoint = false;
  restarting = false; runrulesonlevelstart_phase = false; winning = false; againing = false;
  textMode = false; titleScreen = false; messagetext = ''; titleSelected = false;
  titleSelection = 0; quittingTitleScreen = false; quittingMessageScreen = false; messageselected = false;
  timer = 0; keybuffer = []; keyRepeatTimer = 0; input_throttle_timer = 0; lastinput = -100;
  ignoreNotJustPressedAction = true; autotick = 0; curlevel = fixture.title && !fixture.resume ? 0 : fixture.level; curlevelTarget = null;
  localStorage.removeItem(document.URL); localStorage.removeItem(document.URL + '_checkpoint');
  runtimeDiagnostics = []; played = []; soundHistory = []; savedProgress = null; savedCheckpoint = null; events = [];
  errorStrings = []; errorCount = 0; unitTesting = false;
  const originalInstall = setGameState;
  // Source compilation is observed before installation, so externally supplied
  // checkpoints can be installed through the actual target-loading boundary.
  setGameState = game => { state = game; };
  try { compile(['restart'], fixture.source, fixture.seed); } finally { setGameState = originalInstall; }
  assert.equal(errorCount, 0);
  RandomGen = new RNG(fixture.seed); loadedLevelSeed = fixture.seed;
  let checkpoint = null;
  if (fixture.checkpoint) {
    const dat = levelFromString(state, [0, ...fixture.checkpoint.toLowerCase().split('/')]);
    checkpoint = { dat: [...dat.objects], width: dat.width, height: dat.height, oldflickscreendat: [] };
    curlevelTarget = checkpoint;
  }
  if (fixture.resume) {
    savedProgress = String(fixture.level); savedCheckpoint = checkpoint ? savedBoard(checkpoint) : null;
    localStorage.setItem(document.URL, savedProgress);
    if (checkpoint) localStorage.setItem(document.URL + '_checkpoint', JSON.stringify(checkpoint));
  }
  recording = true;
  if (fixture.title) originalInstall(state, ['restart'], fixture.seed);
  else {
    originalInstall(state, ['rebuild'], fixture.seed);
    if (checkpoint) loadLevelFromStateTarget(state, fixture.level, checkpoint, fixture.seed);
    else loadLevelFromState(state, fixture.level, fixture.seed);
  }
  tick_lazy_function_generation(false);
  soundHistory = [];
  const observations = [snapshot('initial')];
  const keys = { up: 38, left: 37, down: 40, right: 39, action: 88, undo: 90, restart: 82, menu: 27 };
  for (let token of fixture.inputs) {
    if (token.startsWith('storage:')) {
      const spec = token.slice(8), split = spec.indexOf(':');
      const next = spec === 'none' ? null : { level: Number(split < 0 ? spec : spec.slice(0, split)),
        rows: split < 0 ? null : spec.slice(split + 1).toLowerCase().split('/') };
      const dat = next?.rows ? levelFromString(state, [0, ...next.rows]) : null;
      const checkpoint = dat ? { dat: [...dat.objects], width: dat.width, height: dat.height, oldflickscreendat: [] } : null;
      savedProgress = next ? String(next.level) : null; savedCheckpoint = checkpoint ? savedBoard(checkpoint) : null;
      // This is a host observation, rather than a game persistence effect.
      recording = false;
      if (next) localStorage.setItem(document.URL, String(next.level)); else localStorage.removeItem(document.URL);
      if (checkpoint) localStorage.setItem(document.URL + '_checkpoint', JSON.stringify(checkpoint));
      else localStorage.removeItem(document.URL + '_checkpoint');
      recording = true;
    } else if (token.startsWith('wait:')) { deltatime = Number(token.slice(5)); update(); }
    else {
      const repeated = token.startsWith('repeat:'); if (repeated) token = token.slice(7);
      assert.ok(Object.hasOwn(keys, token));
      checkKey({ keyCode: keys[token], preventDefault() {} }, !repeated);
    }
    observations.push(snapshot('input'));
  }
  return observations;
}
const generated = process.argv.find(argument => argument.startsWith('--generated='));
const metadata = process.argv.find(argument => argument.startsWith('--metadata='));
assert.ok(!generated || !metadata, 'Choose one interactive campaign');
const construction = metadata ? 'player-metadata-generation.cjs' : 'player-generation.cjs';
const seed = process.argv.find(argument => argument.startsWith('--campaign-seed='))?.slice(16) ?? (metadata ? 'ocaml-player-metadata-2026-11-07' : 'ocaml-player-2026-11-06');
const count = Number((generated ?? metadata)?.split('=')[1] ?? 0);
assert.ok(!generated && !metadata || Number.isSafeInteger(count) && count > 0);
const filter = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? '';
const construct = metadata ? require('./' + construction).construct : require('./' + construction);
const fixtures = (generated || metadata ? Array.from({ length: count }, (_, index) => construct(seed, index))
  : require('./player-fixtures.cjs')).filter(f => f.name.includes(filter));
assert.ok(fixtures.length);
const report = { revision: ORACLE_SOURCE.revision, binarySha256, binary,
  environment: { node: process.version, unicode: process.versions.unicode },
  fixtureConstructionSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'player-fixtures.cjs'))).digest('hex'), startedAt: new Date().toISOString(),
  campaign: generated || metadata ? { seed, count, distinctSources: new Set(fixtures.map(f => f.source)).size,
    ...(metadata ? { kind: 'metadata', flags: require('./' + construction).flags,
      profiles: require('./' + construction).profiles, families: require('./' + construction).families } : {}),
    constructionSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, construction))).digest('hex') } : null,
  fixtures: fixtures.length, matched: 0, matchedObservations: 0, failureDetails: 'per-case-files',
  failures: [], processFailures: [], oracleExceptions: [] };
const reportStem = metadata ? 'player-metadata-parity' : generated ? 'player-generated-parity' : 'player-parity';
const detail = (index, value) => {
  const failureFile = path.join(runDirectory, 'failure-' + index + '.json');
  const json = JSON.stringify(value) + '\n';
  fs.writeFileSync(failureFile, json, { flag: 'wx' });
  return { failureFile, failureSha256: crypto.createHash('sha256').update(json).digest('hex') };
};
function progress(state, index, currentCase = null) {
  const json = JSON.stringify({ state, pid: process.pid, startedAt: report.startedAt, updatedAt: new Date().toISOString(),
    binarySha256, runDirectory, report: path.join(runDirectory, 'report.json'), currentCase, caseIndex: index,
    fixtures: fixtures.length, matched: report.matched, failures: report.failures.length,
    processFailures: report.processFailures.length, oracleExceptions: report.oracleExceptions.length }) + '\n';
  const temporary = path.join(runDirectory, 'status.tmp');
  fs.writeFileSync(temporary, json); fs.renameSync(temporary, path.join(runDirectory, 'status.json'));
  fs.writeFileSync(path.join(directory, reportStem + '-active.json'), json);
}
for (const [index, original] of fixtures.entries()) {
  const fixture = { seed: 'ocaml/player/' + index, level: 0, ...original };
  progress('running', index, fixture.name);
  const sourceFile = path.join(runDirectory, 'source-' + index + '.ps'); fs.writeFileSync(sourceFile, fixture.source);
  const args = ['--compact', '--interactive', '--seed', fixture.seed, '--level', String(fixture.level)];
  if (fixture.title) args.push('--title'); if (fixture.resume) args.push('--resume');
  if (fixture.checkpoint) args.push('--resume-grid', fixture.checkpoint);
  const result = spawnSync(binary, [...args, sourceFile, ...fixture.inputs], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  let actual;
  try {
    assert.equal(result.status, 0); actual = result.stdout.trim().split('\n').map(JSON.parse);
    const compilation = actual.shift(); assert.equal(compilation.accepted, true);
    assert.equal(compilation.unicodeVersion.split('.').slice(0, 2).join('.'), process.versions.unicode);
  } catch (error) {
    report.processFailures.push({ name: fixture.name, sourceFile, status: result.status,
      ...detail(index, { name: fixture.name, error: error.message, status: result.status, stdout: result.stdout, stderr: result.stderr }) });
    continue;
  }
  let expected; const log = console.log;
  try { console.log = () => {}; expected = oracle(fixture); }
  catch (error) {
    report.oracleExceptions.push({ name: fixture.name, sourceFile,
      ...detail(index, { name: fixture.name, error: error.stack, actual }) });
    continue;
  }
  finally { console.log = log; }
  let observation = 0;
  try {
    for (; observation < Math.min(actual.length, expected.length); observation++) {
      assert.deepEqual(actual[observation], expected[observation], 'Observation ' + observation); report.matchedObservations++;
    }
    assert.equal(actual.length, expected.length); report.matched++;
  } catch (error) {
    report.failures.push({ name: fixture.name, sourceFile, observation,
      ...detail(index, { name: fixture.name, message: error.message, actual, expected }) });
  }
}
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), binarySha256);
report.finishedAt = new Date().toISOString();
progress('finished', fixtures.length);
const json = JSON.stringify(report, null, 2) + '\n'; fs.writeFileSync(path.join(runDirectory, 'report.json'), json);
fs.writeFileSync(path.join(directory, reportStem + '.json'), json);
console.log(JSON.stringify({ fixtures: report.fixtures, matched: report.matched, observations: report.matchedObservations,
  failures: report.failures.length, processFailures: report.processFailures.length, oracleExceptions: report.oracleExceptions.length,
  report: path.relative(process.cwd(), path.join(runDirectory, 'report.json')) }, null, 2));
if (report.failures.length || report.processFailures.length || report.oracleExceptions.length) process.exitCode = 1;
