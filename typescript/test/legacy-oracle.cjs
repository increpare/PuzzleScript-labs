'use strict';

const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');
const { captureTraceSnapshot } = require('./support/trace.cjs');
const { decodeRulePattern, decodeMatches, encodeMatches } = require('./legacy-patterns.cjs');
const { decodeExecution } = require('./legacy-execution.cjs');
const { instrumentTurnInput } = require('./legacy-turn-hook.cjs');
const { decodeNativeObjects } = require('./legacy-source-objects.cjs');

// All decoding/encoding of the legacy representation belongs to this test
// bridge. The TypeScript runtime never imports the JS engine or these helpers.
function createRuntimeOracle({ Direction, Movement, Ellipsis, resolveMovements, findMatches, matchesRow,
  createRandom, nextRandom, CommandKind, applyRules: applyRuleSchedule,
  applyTurnRules, PlayerMatchKind }, hostOptions = {}) {
  loadPuzzleScript({ includeTests: true, ...hostOptions });

  const legacyMovements = [
    [1, Movement.Up], [2, Movement.Down], [4, Movement.Left],
    [8, Movement.Right], [16, Movement.Action],
  ];
  const compiledGames = new WeakMap();
  let mode = 'baseline';
  let fixtureName = '';
  let inputDescription = 'initialization';
  let baselinePhases = [];
  let phaseIndex = 0;
  let levelSeeds = [];
  let seedIndex = 0;
  let candidateResolver = resolveMovements;
  let candidateMatcher = findMatches;
  let candidateRowCheck = matchesRow;
  let matchSearches = 0;
  let matchRechecks = 0;
  let candidateCreateRandom = createRandom;
  let candidateNextRandom = nextRandom;
  let randomDraws = [];
  let randomIndex = 0;
  let randomSeeds = [];
  let randomSeedIndex = 0;
  const streamSeeds = new WeakMap();
  let rulePhases = [];
  let rulePhaseIndex = 0;
  let candidateSchedule = applyRuleSchedule;
  let candidateTurn = applyTurnRules;
  let turnPhases = [];
  let turnPhaseIndex = 0;

  function randomState() {
    if (!RandomGen) return null;
    return {
      seed: RandomGen.seed,
      normal: RandomGen._normal,
      state: RandomGen._state ? {
        i: RandomGen._state.i,
        j: RandomGen._state.j,
        permutation: RandomGen._state.s.slice(),
      } : null,
    };
  }

  function decodeMovements(value) {
    return new Set(legacyMovements
      .filter(([bit]) => (value & bit) !== 0)
      .map(([, movement]) => movement));
  }

  function decodeGame(legacy) {
    if (compiledGames.has(legacy)) return compiledGames.get(legacy);
    const objects = decodeNativeObjects(legacy);
    const objectIds = new Map(objects.map((object, index) => [object, index]));
    const members = (mask) => new Set(objects.filter((_object, id) => mask.get(id)));
    const decodeSound = (sound) => ({
      objects: members(sound.objectMask),
      layer: sound.layer,
      movements: decodeMovements(sound.directionMask.getshiftor(31, sound.layer * 5)),
      seed: String(sound.seed),
    });
    const game = {
      collisionLayers: legacy.layerMasks.map((mask) => [...members(mask)]),
      rigid: Boolean(legacy.rigid),
      movementSounds: legacy.sfx_MovementMasks.map((sounds) => sounds.map(decodeSound)),
      failureSounds: legacy.sfx_MovementFailureMasks.map(decodeSound),
    };
    const decoded = { objects, objectIds, game };
    if (applyRuleSchedule || applyTurnRules) {
      decoded.execution = decodeExecution(legacy, {
        Direction, Movement, Ellipsis, CommandKind,
        legacyEllipsis: ellipsisPattern, objects,
        layerCount: game.collisionLayers.length, collisionLayers: game.collisionLayers,
      });
    }
    if (applyTurnRules) {
      decoded.turnGame = {
        ...decoded.execution.game, ...game,
        player: {
          kind: legacy.playerMask[0] ? PlayerMatchKind.All : PlayerMatchKind.Any,
          objects: members(legacy.playerMask[1]),
        },
        earlyRules: decoded.execution.early, lateRules: decoded.execution.late,
      };
    }
    compiledGames.set(legacy, decoded);
    return decoded;
  }

  function decodeFrame(legacy, board, banned) {
    const { objects, game } = decodeGame(legacy);
    const rows = [];
    const pendingMovements = [];
    const rigidMarks = [];
    for (let y = 0; y < board.height; y++) {
      const row = [];
      for (let x = 0; x < board.width; x++) {
        const tile = x * board.height + y;
        const occupants = board.getCell(tile);
        row.push({ objects: new Set(objects.filter((_object, id) => occupants.get(id))) });
        const movements = board.getMovements(tile);
        for (let layer = 0; layer < game.collisionLayers.length; layer++) {
          const pending = decodeMovements(movements.getshiftor(31, layer * 5));
          if (pending.size > 0) {
            pendingMovements.push({ position: { x, y }, layer, movements: pending });
          }
          if (game.rigid) {
            const applied = board.rigidMovementAppliedMask[tile];
            const affected = applied
              ? decodeMovements(applied.getshiftor(31, layer * 5)) : new Set();
            if (affected.size > 0) {
              const encoded = board.rigidGroupIndexMask[tile].getshiftor(31, layer * 5);
              const group = legacy.rigidGroupIndex_to_GroupIndex[encoded - 1] ?? null;
              rigidMarks.push({ position: { x, y }, layer, group, movements: affected });
            }
          }
        }
      }
      rows.push(row);
    }
    return {
      board: { width: board.width, height: board.height, rows },
      pendingMovements,
      rigidMarks,
      bannedGroups: new Set(Object.keys(banned || {}).filter((key) => banned[key])
        .map(key => key === 'undefined' ? null : Number(key))),
      canMoveSounds: seedsToPlay_CanMove.map(String),
      cantMoveSounds: seedsToPlay_CantMove.map(String),
    };
  }

  function canonicalFrame(legacy, frame) {
    const { objectIds } = decodeGame(legacy);
    const order = (a, b) => a.position.x - b.position.x
      || a.position.y - b.position.y || a.layer - b.layer;
    const describeMovements = (entries) => entries.slice().sort(order).map((entry) => ({
      position: { x: entry.position.x, y: entry.position.y },
      layer: entry.layer,
      ...(entry.group === undefined ? {} : { group: entry.group }),
      movements: [...entry.movements].sort((a, b) => a - b).map((move) => Movement[move]),
    }));
    return {
      width: frame.board.width,
      height: frame.board.height,
      rows: frame.board.rows.map((row) => row.map((cell) =>
        [...cell.objects].map((object) => {
          assert.ok(objectIds.has(object), 'A cell must contain canonical declared objects');
          return { declaration: objectIds.get(object), name: object.name };
        }).sort((a, b) => a.declaration - b.declaration))),
      pendingMovements: describeMovements(frame.pendingMovements),
      rigidMarks: describeMovements(frame.rigidMarks),
      bannedGroups: [...frame.bannedGroups].sort((a, b) => a === null ? 1 : b === null ? -1 : a - b),
      canMoveSounds: [...frame.canMoveSounds],
      cantMoveSounds: [...frame.cantMoveSounds],
    };
  }

  function writeFrame(legacy, board, banned, frame) {
    const { objectIds } = decodeGame(legacy);
    board.movements.fill(0);
    for (let x = 0; x < board.width; x++) {
      for (let y = 0; y < board.height; y++) {
        const tile = x * board.height + y;
        const occupants = board.getCell(tile);
        occupants.setZero();
        for (const object of frame.board.rows[y][x].objects) {
          occupants.ibitset(objectIds.get(object));
        }
        board.setCell(tile, occupants);
        // Preserve conservative host summaries: a rigid rollback restores the
        // earlier board without rebuilding them. Clearing summaries here would
        // wrongly skip rules on the restored cells during the retry.
        board.rowCellContents[y].ior(occupants);
        board.colCellContents[x].ior(occupants);
        board.mapCellContents.ior(occupants);
        if (legacy.rigid) {
          board.rigidMovementAppliedMask[tile].setZero();
          board.rigidGroupIndexMask[tile].setZero();
        }
      }
    }
    for (const entry of frame.pendingMovements) {
      const tile = entry.position.x * board.height + entry.position.y;
      const movements = board.getMovements(tile);
      for (const [bit, movement] of legacyMovements) {
        if (entry.movements.has(movement)) movements.ishiftor(bit, entry.layer * 5);
      }
      board.setMovements(tile, movements);
    }
    for (const entry of frame.rigidMarks) {
      const tile = entry.position.x * board.height + entry.position.y;
      const code = entry.group === null ? legacy.rigidGroupIndex_to_GroupIndex.length + 1
        : legacy.groupIndex_to_RigidGroupIndex[entry.group] + 1;
      board.rigidGroupIndexMask[tile].ishiftor(code, entry.layer * 5);
      for (const [bit, movement] of legacyMovements) {
        if (entry.movements.has(movement)) board.rigidMovementAppliedMask[tile].ishiftor(bit, entry.layer * 5);
      }
    }
    if (banned) for (const group of frame.bannedGroups) banned[group === null ? 'undefined' : group] = true;
    seedsToPlay_CanMove = [...frame.canMoveSounds];
    seedsToPlay_CantMove = [...frame.cantMoveSounds];
  }

  function decodeExecutionFrame(legacy, board, banned) {
    const { execution, objects } = decodeGame(legacy);
    const members = mask => new Set(objects.filter((_object, id) => mask.get(id)));
    return {
      ...decodeFrame(legacy, board, banned),
      random: streamState(RandomGen),
      commands: {
        entries: board.commandQueue.map((name, index) => ({
          command: execution.command([name, messagetext]),
          source: execution.rules.get(board.commandQueueSourceRules[index]),
        })),
        message: messagetext,
      },
      createdObjects: members(sfxCreateMask),
      destroyedObjects: members(sfxDestroyMask),
    };
  }

  function canonicalExecution(legacy, frame) {
    const { execution, objectIds } = decodeGame(legacy);
    const sourceIds = new Map([...execution.rules.values()].map((rule, index) => [rule, index]));
    const objectNames = values => [...values].map(object => {
      assert.ok(objectIds.has(object), 'Execution sets must contain canonical declared objects');
      return objectIds.get(object);
    }).sort((a, b) => a - b);
    return {
      ...canonicalFrame(legacy, frame),
      random: { ...frame.random, permutation: [...frame.random.permutation] },
      commands: frame.commands.entries.map(({ command, source }) => {
        assert.ok(sourceIds.has(source), 'Queued command must retain a declared source rule');
        return { command: { ...command }, source: sourceIds.get(source) };
      }),
      message: frame.commands.message,
      createdObjects: objectNames(frame.createdObjects),
      destroyedObjects: objectNames(frame.destroyedObjects),
    };
  }

  function writeExecutionFrame(legacy, board, banned, frame) {
    writeFrame(legacy, board, banned, frame);
    const { execution, objectIds } = decodeGame(legacy);
    const name = command => {
      if (command.kind === CommandKind.Sound) return 'sfx' + command.index;
      return CommandKind[command.kind].toLowerCase();
    };
    board.commandQueue = frame.commands.entries.map(entry => name(entry.command));
    board.commandQueueSourceRules = frame.commands.entries.map(entry => {
      assert.ok(execution.legacyRules.has(entry.source), 'Queued command must retain a declared source rule');
      return execution.legacyRules.get(entry.source);
    });
    messagetext = frame.commands.message;
    writeStream(RandomGen, frame.random);
    sfxCreateMask.setZero();
    sfxDestroyMask.setZero();
    for (const object of frame.createdObjects) sfxCreateMask.ibitset(objectIds.get(object));
    for (const object of frame.destroyedObjects) sfxDestroyMask.ibitset(objectIds.get(object));
  }

  if (applyRuleSchedule || applyTurnRules) {
    const originalApply = applyRules;
    const originalGroup = applyRuleGroup;
    let observedGroups = null;
    applyRuleGroup = function(...args) {
      const changed = originalGroup(...args);
      if (observedGroups !== null) observedGroups.changed ||= changed;
      return changed;
    };
    applyRules = function(rules, loops, banned) {
      const { execution } = decodeGame(state);
      const schedule = rules === state.rules ? execution.early : execution.late;
      assert.ok(rules === state.rules || rules === state.lateRules, 'Unknown legacy rule schedule');
      const context = fixtureName + ', ' + inputDescription + ', rule phase ' + rulePhaseIndex;
      const before = decodeExecutionFrame(state, level, banned);
      const snapshot = canonicalExecution(state, before);
      if (mode === 'baseline') {
        const randomStart = randomDraws.length;
        // Vanilla applyRules returns void. Its group calls expose the actual
        // change decisions, including changes later undone within this phase.
        const previous = observedGroups;
        const observed = { changed: false };
        observedGroups = observed;
        try { originalApply(rules, loops, banned); }
        finally { observedGroups = previous; }
        const changed = observed.changed;
        rulePhases.push({
          before: snapshot,
          after: canonicalExecution(state, decodeExecutionFrame(state, level, banned)),
          changed, randomStart, randomEnd: randomDraws.length,
        });
        rulePhaseIndex++;
        return changed;
      }
      const expected = rulePhases[rulePhaseIndex];
      assert.ok(expected, context + ': unexpected rule phase');
      assert.deepEqual(snapshot, expected.before, context + ': incoming rule state');
      assert.equal(randomIndex, expected.randomStart, context + ': incoming random draw count');
      const result = candidateSchedule(execution.game, schedule, before);
      assert.deepEqual(canonicalExecution(state, before), snapshot, context + ': rule input mutated');
      assert.deepEqual(canonicalExecution(state, result.state), expected.after, context + ': resulting rule state');
      assert.equal(result.changed, expected.changed, context + ': rule changed flag');
      writeExecutionFrame(state, level, banned, result.state);
      assert.deepEqual(canonicalExecution(state, decodeExecutionFrame(state, level, banned)),
        expected.after, context + ': rule bridge write-back');
      // Draws inside the independent schedule no longer call the host RNG.
      // Its complete stream is checked at this phase boundary instead.
      randomIndex = expected.randomEnd;
      rulePhaseIndex++;
      return result.changed;
    };
  }

  function installMatching(legacy) {
    if (!findMatches) return;
    const { objects, game } = decodeGame(legacy);
    const rules = new Set([...legacy.rules.flat(), ...legacy.lateRules.flat()]);
    for (const rule of rules) {
      const pattern = decodeRulePattern(rule, {
        Direction, Movement, Ellipsis, legacyEllipsis: ellipsisPattern,
        objects, layerCount: game.collisionLayers.length,
      });
      const originalFind = rule.findMatches;
      const originalRows = [...rule.cellRowMatches];
      rule.findMatches = function(board) {
        if (mode === 'baseline') return originalFind.call(this, board);
        const context = fixtureName + ', ' + inputDescription + ', rule line ' + rule.lineNumber;
        // The comparator must keep the original row predicates, even though
        // the candidate's later rechecks also use TypeScript.
        const expected = originalFind.call({ ...this, cellRowMatches: originalRows }, board);
        const before = decodeFrame(legacy, board, {});
        const actual = candidateMatcher(pattern, before);
        assert.deepEqual(actual, decodeMatches(expected, board.height), context + ': ordered rule matches');
        matchSearches++;
        return encodeMatches(actual, board.height);
      };
      rule.cellRowMatches = originalRows.map((originalCheck, row) => function(...args) {
        if (mode === 'baseline') return originalCheck(...args);
        const ellipses = rule.ellipsisCount[row];
        const gaps = ellipses === 0 ? [] : ellipses === 1 ? [args[3]] : [args[5], args[7]];
        if (ellipses === 1) assert.equal(args[2], args[3] + 1, 'Expected a fixed-gap recheck');
        if (ellipses === 2) {
          assert.equal(args[2], args[5] + args[7] + 1, 'Expected a fixed-gap recheck');
          assert.equal(args[4], args[5] + 1, 'Expected a fixed first gap');
          assert.equal(args[6], args[7] + 1, 'Expected a fixed second gap');
        }
        const tile = args[1];
        const match = { start: { x: Math.floor(tile / level.height), y: tile % level.height }, gaps };
        const before = decodeFrame(legacy, level, {});
        const expected = originalCheck(...args);
        const actual = candidateRowCheck(pattern, row, before, match);
        assert.equal(actual, ellipses === 0 ? Boolean(expected) : expected.length > 0,
          fixtureName + ', ' + inputDescription + ', rule line ' + rule.lineNumber + ': row recheck');
        matchRechecks++;
        return ellipses === 0 ? actual : actual ? [[tile, ...gaps]] : [];
      });
    }
  }

  const originalSpecialize = addSpecializedFunctions;
  addSpecializedFunctions = function(legacy) {
    originalSpecialize(legacy);
    installMatching(legacy);
    const originalResolve = legacy.resolveMovements;
    legacy.resolveMovements = function(board, banned) {
      const context = fixtureName + ', ' + inputDescription + ', movement ' + phaseIndex;
      const before = decodeFrame(legacy, board, banned);
      const beforeSnapshot = canonicalFrame(legacy, before);
      const rngBefore = randomState();

      if (mode === 'baseline') {
        const retry = originalResolve(board, banned);
        baselinePhases.push({
          before: beforeSnapshot,
          after: canonicalFrame(legacy, decodeFrame(legacy, board, banned)),
          rngBefore,
          rngAfter: randomState(),
          retry,
        });
        phaseIndex++;
        return retry;
      }

      const expected = baselinePhases[phaseIndex];
      assert.ok(expected, context + ': candidate made an extra movement-resolution call');
      assert.deepEqual(beforeSnapshot, expected.before, context + ': incoming state');
      assert.deepEqual(rngBefore, expected.rngBefore, context + ': incoming RNG state');
      const result = candidateResolver(decodeGame(legacy).game, before);
      assert.deepEqual(canonicalFrame(legacy, before), beforeSnapshot,
        context + ': candidate mutated its incoming snapshot');
      assert.deepEqual(canonicalFrame(legacy, result), expected.after, context + ': resulting state');
      assert.equal(result.retry, expected.retry, context + ': rigid retry');
      assert.deepEqual(randomState(), rngBefore, context + ': movement consumed randomness');
      writeFrame(legacy, board, banned, result);
      assert.deepEqual(canonicalFrame(legacy, decodeFrame(legacy, board, banned)),
        expected.after, context + ': legacy bridge write-back');
      assert.deepEqual(randomState(), expected.rngAfter, context + ': resulting RNG state');
      phaseIndex++;
      return result.retry;
    };
  };

  function streamState(generator) {
    return {
      seed: streamSeeds.get(generator),
      i: generator._state.i,
      j: generator._state.j,
      permutation: generator._state.s.slice(),
    };
  }

  function writeStream(generator, stream) {
    generator._state.i = stream.i;
    generator._state.j = stream.j;
    generator._state.s = [...stream.permutation];
  }

  if (nextRandom) {
    const OriginalRandom = RNG;
    const originalUniform = OriginalRandom.prototype.uniform;
    OriginalRandom.prototype.uniform = function() {
      const before = streamState(this);
      if (mode === 'baseline') {
        const value = originalUniform.call(this);
        randomDraws.push({ before, value, after: streamState(this) });
        return value;
      }
      const context = fixtureName + ', ' + inputDescription + ', random draw ' + randomIndex;
      const expected = randomDraws[randomIndex];
      assert.ok(expected, context + ': unexpected random draw');
      assert.deepEqual(before, expected.before, context + ': incoming random stream');
      const snapshot = { ...before, permutation: [...before.permutation] };
      const draw = candidateNextRandom(before);
      assert.deepEqual(before, snapshot, context + ': random input mutated');
      assert.equal(draw.value, expected.value, context + ': random draw value');
      assert.deepEqual(draw.state, expected.after, context + ': resulting random stream');
      writeStream(this, draw.state);
      randomIndex++;
      return draw.value;
    };
    RNG = function(seed) {
      // Keep a legacy host shell for the JS phases. Its actual stream is
      // independently initialized and advanced by TypeScript in candidate mode.
      let streamSeed;
      if (mode === 'baseline') {
        streamSeed = seed == null ? (Math.random() + Date.now()).toString()
          : typeof seed === 'string' ? seed : JSON.stringify(seed);
        randomSeeds.push({ requested: seed, stream: streamSeed });
      } else {
        const expected = randomSeeds[randomSeedIndex++];
        assert.ok(expected, fixtureName + ': unexpected random initialization');
        assert.deepEqual(seed, expected.requested, fixtureName + ': requested random seed');
        streamSeed = expected.stream;
      }
      const generator = new OriginalRandom(streamSeed);
      generator.seed = seed;
      streamSeeds.set(generator, streamSeed);
      if (mode === 'candidate' && generator._state) {
        const initial = candidateCreateRandom(streamSeed);
        assert.deepEqual(initial, streamState(generator), fixtureName + ': seeded random state');
        writeStream(generator, initial);
      }
      return generator;
    };
    RNG.prototype = OriginalRandom.prototype;
  }

  if (applyTurnRules) {
    const inputMovements = [Movement.Up, Movement.Left, Movement.Down, Movement.Right, Movement.Action];
    const cursors = () => ({ movement: phaseIndex, rules: rulePhaseIndex,
      random: mode === 'baseline' ? randomDraws.length : randomIndex });
    const hooks = instrumentTurnInput(processInput.toString(), {
      before(dir) {
        const record = {
          input: dir, before: canonicalExecution(state, decodeExecutionFrame(state, level, {})),
          rngBefore: randomState(), start: cursors(),
        };
        turnPhases.push(record);
        turnPhaseIndex++;
        return record;
      },
      after(record, { playerPositions, attempts, bannedGroup }) {
        Object.assign(record, {
          after: canonicalExecution(state, decodeExecutionFrame(state, level, bannedGroup)),
          rngAfter: randomState(), end: cursors(),
          playerPositions: playerPositions.map(tile => ({ x: Math.floor(tile / level.height), y: tile % level.height })),
          attempts, rigidLimitReached: attempts >= 50,
          rigidRetries: baselinePhases.slice(record.start.movement, phaseIndex).filter(phase => phase.retry).length,
        });
      },
      candidate(dir) {
        const context = fixtureName + ', ' + inputDescription + ', turn phase ' + turnPhaseIndex;
        const expected = turnPhases[turnPhaseIndex];
        assert.ok(expected, context + ': unexpected turn phase');
        const before = decodeExecutionFrame(state, level, {});
        const snapshot = canonicalExecution(state, before);
        assert.equal(dir, expected.input, context + ': incoming input');
        assert.deepEqual(snapshot, expected.before, context + ': incoming turn state');
        assert.deepEqual(randomState(), expected.rngBefore, context + ': incoming full RNG state');
        assert.deepEqual(cursors(), expected.start, context + ': incoming phase cursors');
        const result = candidateTurn(decodeGame(state).turnGame, before, dir < 0 ? null : inputMovements[dir]);
        assert.deepEqual(canonicalExecution(state, before), snapshot, context + ': turn input mutated');
        assert.deepEqual(canonicalExecution(state, result.state), expected.after, context + ': resulting turn state');
        assert.deepEqual(result.playerPositions, expected.playerPositions, context + ': source player positions');
        assert.equal(result.attempts, expected.attempts, context + ': turn attempts');
        assert.equal(result.rigidRetries, expected.rigidRetries, context + ': rigid retries');
        assert.equal(result.rigidLimitReached, expected.rigidLimitReached, context + ': rigid attempt cap');
        writeExecutionFrame(state, level, {}, result.state);
        assert.deepEqual(canonicalExecution(state, decodeExecutionFrame(state, level,
          Object.fromEntries([...result.state.bannedGroups].map(group => [group === null ? 'undefined' : group, true])))),
        expected.after, context + ': turn bridge write-back');
        assert.deepEqual(randomState(), expected.rngAfter, context + ': resulting full RNG state');
        // Internal pieces were checked in earlier modes. Whole-turn mode checks
        // their complete boundary state, then skips their baseline cursors.
        phaseIndex = expected.end.movement;
        rulePhaseIndex = expected.end.rules;
        randomIndex = expected.end.random;
        turnPhaseIndex++;
        return result.playerPositions.map(({ x, y }) => x * level.height + y);
      },
    });
    processInput = function(...args) {
      return (mode === 'baseline' ? hooks.baseline : hooks.candidate)(...args);
    };
  }

  // Fresh levels can receive wall-clock/random seeds even in a seeded session.
  // Record those external inputs in baseline order and replay them explicitly.
  const originalLoadLevel = loadLevelFromLevelDat;
  loadLevelFromLevelDat = function(legacy, board, requestedSeed, clearHistory) {
    let seed;
    if (mode === 'baseline') {
      seed = requestedSeed || (Math.random() + Date.now()).toString();
      levelSeeds.push(seed);
    } else {
      assert.ok(seedIndex < levelSeeds.length, fixtureName + ': unexpected level load');
      seed = levelSeeds[seedIndex++];
      if (requestedSeed) {
        assert.equal(requestedSeed, seed, fixtureName + ': level seed');
      }
    }
    return originalLoadLevel(legacy, board, seed, clearHistory);
  };

  function snapshot(phase, inputIndex, input, substep, previousSoundCount) {
    const result = captureTraceSnapshot(phase, inputIndex, input, substep, previousSoundCount);
    return {
      ...result,
      command_queue_source_rules: result.command_queue_source_rules.map((rule) => rule.lineNumber),
      full_random_state: randomState(),
      undo_depth: backups.length,
      restart_target: restartTarget ? JSON.parse(JSON.stringify(restartTarget)) : null,
    };
  }

  function run(fixture, runMode, options, initialHost) {
    mode = runMode;
    phaseIndex = 0;
    seedIndex = 0;
    randomIndex = 0;
    randomSeedIndex = 0;
    rulePhaseIndex = 0;
    turnPhaseIndex = 0;
    inputDescription = 'initialization';
    resetParserErrorState();
    unitTesting = true;
    lazyFunctionGeneration = false;
    const snapshots = [];
    let previousSoundCount = 0;
    const capture = (phase, index, input, substep) => {
      const current = snapshot(phase, index, input, substep, previousSoundCount);
      previousSoundCount = current.sound_history_length;
      snapshots.push(current);
    };
    const drainAgain = (index, input) => {
      let substep = 0;
      while (againing) {
        assert.ok(substep < 10000, fixtureName + ': again replay did not terminate');
        againing = false;
        substep++;
        inputDescription = 'input ' + index + ', again ' + substep;
        processInput(-1);
        capture('again', index, input, substep);
      }
    };
    try {
      if (initialHost) {
        // The old level loader leaves these transient host globals intact.
        // Give independent replays the same incoming values, including before
        // level-start rules, rather than inheriting the preceding replay's tail.
        seedsToPlay_CanMove = [...initialHost.canMoveSounds];
        seedsToPlay_CantMove = [...initialHost.cantMoveSounds];
        messagetext = initialHost.message;
      }
      compile(['loadLevel', fixture.level ?? 0], fixture.source + '\n', fixture.seed ?? null);
      capture('initial', null, null, 0);
      drainAgain(null, null);
      for (let index = 0; index < fixture.inputs.length; index++) {
        const input = fixture.inputs[index];
        inputDescription = 'input ' + index + ' (' + input + ')';
        if (input === 'undo') DoUndo(false, true);
        else if (input === 'restart') DoRestart();
        else if (input === 'tick') processInput(-1);
        else processInput(input);
        capture('input', index, input, 0);
        drainAgain(index, input);
      }
      return { snapshots, sounds: soundHistory.slice(), finalBoard: convertLevelToString() };
    } finally {
      unitTesting = false;
      lazyFunctionGeneration = true;
    }
  }

  function compareFixture(fixture, options = {}) {
    fixtureName = fixture.name;
    baselinePhases = [];
    levelSeeds = [];
    candidateResolver = options.resolveMovements || resolveMovements;
    candidateMatcher = options.findMatches || findMatches;
    candidateRowCheck = options.matchesRow || matchesRow;
    candidateCreateRandom = options.createRandom || createRandom;
    candidateNextRandom = options.nextRandom || nextRandom;
    candidateSchedule = options.applyRules || applyRuleSchedule;
    candidateTurn = options.applyTurnRules || applyTurnRules;
    matchSearches = 0;
    matchRechecks = 0;
    randomDraws = [];
    randomSeeds = [];
    rulePhases = [];
    turnPhases = [];
    const initialHost = applyRuleSchedule || applyTurnRules ? {
      canMoveSounds: [...seedsToPlay_CanMove], cantMoveSounds: [...seedsToPlay_CantMove], message: messagetext,
    } : null;
    const baseline = run(fixture, 'baseline', options, initialHost);
    if (fixture.expectedBoard !== undefined) {
      assert.equal(baseline.finalBoard, fixture.expectedBoard, fixtureName + ': JS corpus expectation');
    }
    if (fixture.expectedSounds !== undefined && fixture.expectedSounds !== null) {
      assert.equal(baseline.sounds.join(';'), fixture.expectedSounds.join(';'),
        fixtureName + ': JS sound expectation');
    }
    const candidate = run(fixture, 'candidate', options, initialHost);
    assert.equal(phaseIndex, baselinePhases.length, fixtureName + ': movement call count');
    assert.equal(seedIndex, levelSeeds.length, fixtureName + ': level load count');
    if (nextRandom) assert.equal(randomIndex, randomDraws.length, fixtureName + ': random draw count');
    if (nextRandom) assert.equal(randomSeedIndex, randomSeeds.length, fixtureName + ': random initialization count');
    if (applyRuleSchedule || applyTurnRules) assert.equal(rulePhaseIndex, rulePhases.length, fixtureName + ': rule phase count');
    if (applyTurnRules) assert.equal(turnPhaseIndex, turnPhases.length, fixtureName + ': turn phase count');
    assert.equal(candidate.snapshots.length, baseline.snapshots.length, fixtureName + ': snapshot count');
    for (let index = 0; index < baseline.snapshots.length; index++) {
      assert.deepEqual(candidate.snapshots[index], baseline.snapshots[index],
        fixtureName + ': per-input snapshot ' + index);
    }
    assert.equal(candidate.finalBoard, baseline.finalBoard, fixtureName + ': final board');
    assert.deepEqual(candidate.sounds, baseline.sounds, fixtureName + ': complete sound history');
    return {
      movementCalls: baselinePhases.length,
      snapshots: baseline.snapshots.length,
      rigidRetries: baselinePhases.filter((phase) => phase.retry).length,
      levelLoads: levelSeeds.length,
      matchSearches,
      matchRechecks,
      randomDraws: randomDraws.length,
      randomInitializations: randomSeeds.length,
      rulePhases: rulePhases.length,
      turnPhases: turnPhases.length,
    };
  }

  function corpusFixtures() {
    return global.testdata.map(([name, payload]) => ({
      name,
      source: payload[0],
      inputs: payload[1],
      expectedBoard: payload[2],
      level: payload[3] ?? 0,
      seed: payload[4] ?? null,
      expectedSounds: payload[5] ?? null,
    }));
  }

  return { compareFixture, corpusFixtures };
}

module.exports = { createRuntimeOracle };
