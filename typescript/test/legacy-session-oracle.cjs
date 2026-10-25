'use strict';

const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');
const { decodeSessionGame } = require('./legacy-session-data.cjs');
const { compareCompiledGame } = require('./legacy-source-compiler.cjs');
const { createSessionValidator } = require('./source-session-data.cjs');
const fs = require('node:fs');
const path = require('node:path');

// structuredClone rejects the explicit Ellipsis symbol. Copy mutable data while
// retaining primitive symbols, and preserve shared references within the copy.
function copyData(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const copy = ArrayBuffer.isView(value) ? new value.constructor(value)
    : Array.isArray(value) ? Array(value.length) : value instanceof Map ? new Map()
    : value instanceof Set ? new Set() : {};
  seen.set(value, copy);
  if (value instanceof Map) {
    for (const [key, entry] of value) copy.set(copyData(key, seen), copyData(entry, seen));
  } else if (value instanceof Set) {
    for (const entry of value) copy.add(copyData(entry, seen));
  } else {
    for (const [key, entry] of Object.entries(value)) copy[key] = copyData(entry, seen);
  }
  return copy;
}

function createSessionOracle(types) {
  loadPuzzleScript({ includeTests: true });
  const { Movement, ScreenKind, RunMode, SessionEffectKind, PersistenceKind } = types;
  const validate = createSessionValidator(types);
  const inputMovements = [Movement.Up, Movement.Left, Movement.Down, Movement.Right, Movement.Action];
  const nativeProducers = [...new Set(['parser.js', 'compiler.js', 'engine.js', 'rng.js', 'level.js', 'bitvec.js'].flatMap(file =>
    [...fs.readFileSync(path.join(__dirname, './vanilla/js', file), 'utf8').matchAll(/^function (\w+)\s*\(/gm)]
      .map(match => match[1])))];
  let levelSeeds = [];
  let playedSounds = [];
  let storageEvents = [];
  let observedEvents = [];
  const originalSetItem = localStorage.setItem;
  const originalRemoveItem = localStorage.removeItem;
  const storageKey = key => key === document.URL ? 'progress'
    : key === document.URL + '_checkpoint' ? 'checkpoint' : null;
  localStorage.setItem = function(key, value) {
    if (storageKey(key) !== null) {
      const event = { operation: 'set', key: storageKey(key), value: String(value) };
      storageEvents.push(event);
      observedEvents.push({ kind: 'persistence', ...event });
    }
    return originalSetItem.call(this, key, value);
  };
  localStorage.removeItem = function(key) {
    if (storageKey(key) !== null) {
      const event = { operation: 'remove', key: storageKey(key) };
      storageEvents.push(event);
      observedEvents.push({ kind: 'persistence', ...event });
    }
    return originalRemoveItem.call(this, key);
  };
  const originalPlaySound = playSound;
  playSound = function(seed, ignore) {
    const event = { seed: String(seed), simple: ignore === true };
    playedSounds.push(event);
    observedEvents.push({ kind: 'sound', ...event });
    return originalPlaySound(seed, ignore);
  };
  const originalLoad = loadLevelFromLevelDat;
  loadLevelFromLevelDat = function(game, board, requested, clearHistory) {
    const seed = requested || (Math.random() + Date.now()).toString();
    levelSeeds.push(seed);
    return originalLoad(game, board, seed, clearHistory);
  };

  function canonical(decoder, value, saved, sounds, played, persistence, events) {
    validate.state(value);
    return {
      execution: decoder.canonicalFrame(value.execution), levelIndex: value.levelIndex,
      levelTarget: decoder.canonicalSnapshot(value.levelTarget),
      restartTarget: decoder.canonicalSnapshot(value.restartTarget),
      history: value.history.map(decoder.canonicalSnapshot),
      viewport: value.viewport === null ? null : { ...value.viewport },
      screen: { ...value.screen }, winning: value.winning, againing: value.againing,
      restarting: value.restarting, levelStarting: value.levelStarting,
      checkpointUsed: value.checkpointUsed, loadedLevelSeed: value.loadedLevelSeed, runMode: value.runMode,
      savedProgress: saved.progress, savedCheckpoint: decoder.canonicalSnapshot(saved.checkpoint),
      sounds: [...sounds], playedSounds: played.map(event => ({ ...event })),
      persistence: persistence.map(event => ({ ...event })),
      events: events.map(event => ({ ...event })),
    };
  }
  function nativeState(decoder) {
    let after = { dat: [...level.objects], width: level.width, height: level.height,
      oldflickscreendat: [...oldflickscreendat] };
    const history = Array(backups.length);
    for (let index = backups.length - 1; index >= 0; index--) {
      after = unconsolidateDiff(backups[index], after);
      history[index] = decoder.snapshot(after);
    }
    const screen = titleScreen ? { kind: ScreenKind.Title }
      : !textMode ? { kind: ScreenKind.Board }
        : messagetext !== '' ? { kind: ScreenKind.TemporaryMessage, text: messagetext }
          : { kind: ScreenKind.LevelMessage, text: state.levels[curlevel]?.message ?? '' };
    return {
      execution: decoder.frame({ level, random: RandomGen, message: messagetext,
        canMoveSounds: seedsToPlay_CanMove, cantMoveSounds: seedsToPlay_CantMove,
        created: sfxCreateMask, destroyed: sfxDestroyMask }),
      levelIndex: curlevel, levelTarget: curlevelTarget === null ? null : decoder.snapshot(curlevelTarget),
      restartTarget: decoder.snapshot(restartTarget), history, viewport: decoder.viewport(oldflickscreendat),
      screen, winning, againing, restarting, levelStarting: runrulesonlevelstart_phase,
      checkpointUsed: hasUsedCheckpoint, loadedLevelSeed: String(loadedLevelSeed), runMode: RunMode.Replay,
    };
  }
  function nativeSaved(decoder) {
    const checkpoint = localStorage.getItem(document.URL + '_checkpoint');
    return {
      progress: localStorage.getItem(document.URL),
      checkpoint: checkpoint === null ? null : decoder.snapshot(JSON.parse(checkpoint)),
    };
  }
  function nativeSnapshot(decoder) {
    const canonicalEvent = event => event.key === 'checkpoint' && event.operation === 'set'
      ? { ...event, value: decoder.canonicalSnapshot(decoder.snapshot(JSON.parse(event.value))) } : event;
    return canonical(decoder, nativeState(decoder), nativeSaved(decoder),
      soundHistory.map(String), playedSounds, storageEvents.map(canonicalEvent), observedEvents.map(canonicalEvent));
  }
  function freshHost() {
    // Define a fresh session rather than inheriting the preceding fixture's
    // message, board, history, sounds or saved progress from this shared VM.
    level = new Level(0, 0, 0, 0, new Int32Array(0));
    backups = [];
    restartTarget = undefined;
    oldflickscreendat = [];
    messagetext = '';
    seedsToPlay_CanMove = [];
    seedsToPlay_CantMove = [];
    hasUsedCheckpoint = false;
    restarting = false;
    runrulesonlevelstart_phase = false;
    localStorage.removeItem(document.URL);
    localStorage.removeItem(document.URL + '_checkpoint');
  }
  function replayPaired(fixture, decoder, options) {
    const game = decoder.game;
    const gameBefore = copyData(game);
    const sounds = [];
    const played = [];
    const persistence = [];
    const events = [];
    const saved = { progress: null, checkpoint: null };
    let seedIndex = 1;
    const environment = { nextLevelSeed() {
      assert.ok(seedIndex < levelSeeds.length, fixture.name + ': unexpected TS level seed request');
      return levelSeeds[seedIndex++];
    } };
    const functions = { ...types, ...options };
    let operations = 1;
    let result;
    const effects = (values, recording) => {
      for (const effect of values) {
        if (effect.kind === SessionEffectKind.Sound) {
          played.push({ seed: String(effect.seed), simple: effect.simple });
          events.push({ kind: 'sound', seed: String(effect.seed), simple: effect.simple });
          // Legacy simple sounds (including sfx commands) are audible but
          // deliberately excluded from the editor's recorded sound history.
          if (recording && !effect.simple) sounds.push(String(effect.seed));
        } else if (effect.kind === SessionEffectKind.Persistence) {
          const firstWrite = persistence.length;
          if (effect.operation === PersistenceKind.Checkpoint) {
            saved.progress = String(effect.levelIndex);
            saved.checkpoint = effect.snapshot;
            persistence.push({ operation: 'set', key: 'checkpoint', value: decoder.canonicalSnapshot(effect.snapshot) },
              { operation: 'set', key: 'progress', value: saved.progress });
          } else if (effect.operation === PersistenceKind.Progress) {
            saved.progress = String(effect.levelIndex);
            saved.checkpoint = null;
            persistence.push({ operation: 'set', key: 'progress', value: saved.progress },
              { operation: 'remove', key: 'checkpoint' });
          } else {
            saved.progress = null;
            saved.checkpoint = null;
            persistence.push({ operation: 'remove', key: 'progress' }, { operation: 'remove', key: 'checkpoint' });
          }
          for (const event of persistence.slice(firstWrite)) events.push({ kind: 'persistence', ...event });
        }
      }
    };
    let current;
    let snapshotIndex = 0;
    const capture = (expected, returned, actualReturned, label) => {
      assert.deepEqual({ returned: actualReturned,
        state: canonical(decoder, current, saved, sounds, played, persistence, events) },
      { returned, state: expected }, fixture.name + ': session snapshot ' + snapshotIndex + ' (' + label + ')');
      assert.equal(seedIndex, levelSeeds.length, fixture.name + ': complete level seed consumption');
      snapshotIndex++;
    };
    const apply = (operation, ...args) => {
      const before = canonical(decoder, current, saved, sounds, played, persistence, events);
      result = withProducerGuards(decoder, () => operation(game, current, ...args));
      assert.deepEqual(canonical(decoder, current, saved, sounds, played, persistence, events), before, fixture.name + ': session input mutated');
      validate.result(result);
      current = result.state;
      effects(result.effects, true);
      operations++;
      return result.modified;
    };
    const drain = (inputIndex, input) => {
      let substep = 0;
      while (againing) {
        assert.ok(substep < 10000, fixture.name + ': JS AGAIN did not terminate');
        againing = false;
        const returned = Boolean(processInput(-1));
        const expected = nativeSnapshot(decoder);
        capture(expected, returned, apply(functions.stepSession, null, environment),
          'input ' + inputIndex + ': ' + input + ', again ' + ++substep);
      }
    };
    const initial = nativeSnapshot(decoder);
    result = withProducerGuards(decoder, () => functions.createSession(game, {
      level: fixture.level ?? 0, seed: levelSeeds[0], runMode: RunMode.Replay,
    }, environment));
    // compile clears debug sound recording AFTER initial level-start work.
    // Keep runtime effects intact; discard only their initial recording here.
    validate.result(result);
    effects(result.effects, false);
    current = result.state;
    capture(initial, null, null, 'initial');
    drain(null, null);
    for (let index = 0; index < fixture.inputs.length; index++) {
      const input = fixture.inputs[index];
      let returned = null;
      if (input === 'undo') DoUndo(false, true);
      else if (input === 'restart') DoRestart();
      else returned = Boolean(processInput(input === 'tick' ? -1 : input));
      const expected = nativeSnapshot(decoder);
      let actualReturned = null;
      if (input === 'undo') apply(functions.undoSession, { force: false, ignoreDuplicates: true });
      else if (input === 'restart') apply(functions.restartSession, environment);
      else actualReturned = apply(functions.stepSession, input === 'tick' ? null : inputMovements[input], environment);
      capture(expected, returned, actualReturned, 'input ' + index + ': ' + input);
      drain(index, input);
    }
    if (fixture.expectedBoard !== undefined) {
      assert.equal(convertLevelToString(), fixture.expectedBoard, fixture.name + ': JS corpus final board');
    }
    if (fixture.expectedSounds != null) {
      assert.equal(soundHistory.join(';'), fixture.expectedSounds.join(';'), fixture.name + ': JS corpus sounds');
    }
    assert.deepEqual(game, gameBefore, fixture.name + ': session game mutated');
    return { snapshots: snapshotIndex, candidateOperations: operations, levelLoads: seedIndex };
  }
  function withProducerGuards(decoder, operation) {
    // Protect the independent compiler and runtime from every native producer,
    // including installed/generated methods and nested RNG helpers.
    const producers = ['compile', 'processInput', 'DoUndo', 'DoRestart', 'loadLevelFromLevelDat',
      'loadLevelFromState', 'loadLevelFromStateTarget', 'setGameState', 'restoreLevel',
      'backupLevel', 'level4Serialization', 'addUndoState', 'getPlayerPositions',
      'applyRules', 'applyRuleGroup', 'applyRuleGroupUnconditional', 'applyRandomRuleGroup',
      'applyTwoRowTuples', 'generateTuples', 'checkWin', 'DoWin', 'startMovement',
      'repositionEntitiesOnLayer', 'processCommandQueue', 'processOutputCommands',
      'playSounds', 'nextLevel', 'goToTitleScreen'];
    const originals = [];
    function guard(owner, name, label) {
      const original = owner[name];
      if (typeof original !== 'function') return;
      originals.push({ owner, name, original });
      owner[name] = function() { throw new Error('TS session called JS producer ' + label); };
    }
    function guardOwnFunctions(owner, label) {
      for (const name of Object.getOwnPropertyNames(owner)) {
        if (name !== 'constructor') guard(owner, name, label + '.' + name);
      }
    }
    guardOwnFunctions(state, 'state');
    guardOwnFunctions(Rule.prototype, 'Rule.prototype');
    guardOwnFunctions(CellPattern.prototype, 'CellPattern.prototype');
    guardOwnFunctions(CellReplacement.prototype, 'CellReplacement.prototype');
    guardOwnFunctions(Level.prototype, 'Level.prototype');
    guardOwnFunctions(RNG.prototype, 'RNG.prototype');
    guardOwnFunctions(RNG, 'RNG');
    guardOwnFunctions(RC4.prototype, 'RC4.prototype');
    guardOwnFunctions(BitVec.prototype, 'BitVec.prototype');
    guard(String.prototype, 'getBytes', 'String.prototype.getBytes');
    guardOwnFunctions(Object.getPrototypeOf(RandomGen), 'RandomGen.prototype');
    guardOwnFunctions(RandomGen, 'RandomGen');
    guardOwnFunctions(Object.getPrototypeOf(RandomGen._state), 'RandomGen._state.prototype');
    guardOwnFunctions(RandomGen._state, 'RandomGen._state');
    for (const rule of decoder.execution.rules.keys()) {
      guardOwnFunctions(rule, 'rule');
      guardOwnFunctions(rule.cellRowMatches, 'rule.cellRowMatches');
      for (const row of rule.patterns) for (const cell of row) {
        if (cell !== ellipsisPattern) guardOwnFunctions(cell, 'cell');
      }
    }
    for (const name of new Set([...producers, ...nativeProducers])) guard(globalThis, name, name);
    const parser = codeMirrorFn;
    codeMirrorFn = () => { throw new Error('TS session called JS producer codeMirrorFn'); };
    guard(CodeMirror, 'StringStream', 'CodeMirror.StringStream');
    try {
      return operation();
    } finally {
      codeMirrorFn = parser;
      for (const { owner, name, original } of originals.reverse()) owner[name] = original;
    }
  }
  function compareFixture(fixture, options = {}) {
    freshHost();
    levelSeeds = [];
    playedSounds = [];
    storageEvents = [];
    observedEvents = [];
    resetParserErrorState();
    const previousTesting = unitTesting;
    const previousLazy = lazyFunctionGeneration;
    unitTesting = true;
    lazyFunctionGeneration = false;
    try {
      const source = fixture.source + '\n';
      compile(['loadLevel', fixture.level ?? 0], source, fixture.seed ?? null);
      const decoder = decodeSessionGame(state, types);
      const initial = copyData(nativeSnapshot(decoder));
      const initialSeeds = [...levelSeeds];
      const savedData = () => [localStorage.getItem(document.URL), localStorage.getItem(document.URL + '_checkpoint')];
      const initialSaved = savedData();
      const host = { state, level, random: RandomGen, storage: localStorage, document };
      const compiledBefore = copyData(state);
      const result = withProducerGuards(decoder, () => (options.compileSource ?? types.compileSource)(source));
      // Check the entire installed compiler graph before trusting it as the
      // semantic reference, including data inactive in the initial session.
      assert.deepEqual(copyData(state), compiledBefore, fixture.name + ': candidate compilation changed native compiled data');
      assert.equal(result.document.source, source, fixture.name + ': exact source compilation');
      assert.equal(result.outcome.kind, types.SourceCompilationKind.Accepted, fixture.name + ': source installation outcome');
      const correspondence = compareCompiledGame(types, { ...fixture, source }, state, result);
      assert.deepEqual(nativeSnapshot(decoder), initial, fixture.name + ': candidate compilation changed native initial session');
      assert.deepEqual(levelSeeds, initialSeeds, fixture.name + ': candidate compilation consumed native level seeds');
      assert.deepEqual(savedData(), initialSaved, fixture.name + ': candidate compilation changed raw saved data');
      for (const [key, value] of Object.entries({ state, level, random: RandomGen, storage: localStorage, document })) {
        assert.equal(value, host[key], fixture.name + ': candidate compilation replaced native ' + key);
      }
      const game = result.outcome.game;
      assert.notEqual(game, decoder.game, 'Source game must be independent of the native decoder');
      for (const [object, id] of correspondence.objectIds) {
        assert.notEqual(object, decoder.objects[id], 'Source object must be independent of the native decoder');
        decoder.objectIds.set(object, id);
      }
      for (const [rule, nativeRule] of correspondence.nativeRules) {
        const decodedRule = decoder.execution.rules.get(nativeRule);
        assert.ok(decodedRule, 'Source rule must correspond to a decoded native rule');
        assert.notEqual(rule, decodedRule, 'Source rule must be independent of the native decoder');
        assert.ok(decoder.ruleIds.has(decodedRule));
        decoder.ruleIds.set(rule, decoder.ruleIds.get(decodedRule));
      }
      // Only observation identity maps are extended. The session receives the
      // exact independent compiler graph, never any native-decoded game data.
      return replayPaired(fixture, { ...decoder, game }, options);
    } finally {
      unitTesting = previousTesting;
      lazyFunctionGeneration = previousLazy;
    }
  }
  const corpusFixtures = () => global.testdata.map(([name, payload]) => ({
    name, source: payload[0], inputs: payload[1], expectedBoard: payload[2],
    level: payload[3] ?? 0, seed: payload[4] ?? null, expectedSounds: payload[5] ?? null,
  }));
  return { compareFixture, corpusFixtures };
}

module.exports = { createSessionOracle };
