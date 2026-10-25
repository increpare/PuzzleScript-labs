'use strict';

const assert = require('node:assert/strict');
const { decodeExecution } = require('./legacy-execution.cjs');
const { decodeNativeObjects } = require('./legacy-source-objects.cjs');

// Decode native storage into domain observations. The candidate computes its
// own restore compatibility data in its versioned module; this adapter remains
// independent and supplies actual objects, boards, commands and predicates.
function decodeSessionGame(legacy, types) {
  const { Direction, Movement, Ellipsis, CommandKind,
    PlayerMatchKind, ObjectMatchKind, WinQuantifier, LevelKind, SimpleSound } = types;
  const objects = decodeNativeObjects(legacy);
  const objectIds = new Map(objects.map((object, index) => [object, index]));
  const members = mask => new Set(objects.filter((_object, id) => mask.get(id)));
  const movementBits = [[1, Movement.Up], [2, Movement.Down], [4, Movement.Left],
    [8, Movement.Right], [16, Movement.Action]];
  const movements = value => new Set(movementBits.filter(([bit]) => value & bit).map(([, move]) => move));
  const collisionLayers = legacy.layerMasks.map(mask => [...members(mask)]);
  const execution = decodeExecution(legacy, {
    Direction, Movement, Ellipsis, CommandKind,
    legacyEllipsis: ellipsisPattern, objects, layerCount: collisionLayers.length, collisionLayers,
  });
  const ruleIds = new Map([...execution.rules.values()].map((rule, index) => [rule, index]));
  function board(width, height, data) {
    const rows = Array.from({ length: height }, () => []);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const tile = x * height + y;
        rows[y].push({ objects: new Set(objects.filter((_object, id) =>
          (data[tile * legacy.STRIDE_OBJ + Math.floor(id / 32)] & (1 << (id % 32))) !== 0)) });
      }
    }
    return { width, height, rows };
  }
  const viewport = values => values && values.length === 4
    ? { left: values[0], top: values[1], right: values[2], bottom: values[3] } : null;
  const snapshot = value => value ? {
    board: board(value.width, value.height, value.dat),
    viewport: viewport(value.oldflickscreendat),
  } : { board: board(0, 0, []), viewport: null };
  const sound = source => ({
    objects: members(source.objectMask), layer: source.layer,
    movements: movements(source.directionMask.getshiftor(31, source.layer * 5)),
    seed: String(source.seed),
  });
  const simpleNames = [
    ['titlescreen', SimpleSound.TitleScreen], ['startgame', SimpleSound.StartGame],
    ['endgame', SimpleSound.EndGame], ['startlevel', SimpleSound.StartLevel],
    ['endlevel', SimpleSound.EndLevel], ['undo', SimpleSound.Undo],
    ['restart', SimpleSound.Restart], ['showmessage', SimpleSound.ShowMessage],
    ['closemessage', SimpleSound.CloseMessage], ['cancel', SimpleSound.Cancel],
  ];
  const simple = new Map(simpleNames.filter(([name]) => legacy.sfx_Events[name] !== undefined)
    .map(([name, kind]) => [kind, String(legacy.sfx_Events[name])]));
  const sfx = new Map();
  for (let index = 0; index <= 10; index++) {
    if (legacy.sfx_Events['sfx' + index] !== undefined) sfx.set(index, String(legacy.sfx_Events['sfx' + index]));
  }
  const objectSound = value => ({ objects: members(value.objectMask), seed: String(value.seed) });
  const levels = legacy.levels.map(value => value.message !== undefined
    ? { kind: LevelKind.Message, text: value.message, sourceLine: value.lineNumber ?? 0 }
    : { kind: LevelKind.Grid, board: board(value.width, value.height, value.objects), sourceLine: value.lineNumber });
  const restorePolicies = [];
  for (const level of levels) {
    if (level.kind !== LevelKind.Grid) continue;
    const { width, height } = level.board;
    if (restorePolicies.some(policy => policy.width === width && policy.height === height)) continue;
    const retain = [];
    // Same-shape restore clears n_tiles old movement WORDS, not the whole array.
    // Describe the resulting retained movement addresses explicitly.
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const tile = x * height + y;
      for (let layer = 0; layer < collisionLayers.length; layer++) {
        const kept = new Set(movementBits.filter((_entry, slot) =>
          tile * legacy.STRIDE_MOV + Math.floor((layer * 5 + slot) / 32) >= width * height)
          .map(([, move]) => move));
        if (kept.size > 0) retain.push({ position: { x, y }, layer, movements: kept });
      }
    }
    restorePolicies.push({ width, height, retain });
  }
  const condition = (mask, all) => ({ kind: all ? ObjectMatchKind.All : ObjectMatchKind.Any, objects: members(mask) });
  const dimensions = values => values === undefined ? undefined : { width: values[0], height: values[1] };
  const game = {
    ...execution.game, rigid: Boolean(legacy.rigid),
    movementSounds: legacy.sfx_MovementMasks.map(values => values.map(sound)),
    failureSounds: legacy.sfx_MovementFailureMasks.map(sound),
    player: { kind: legacy.playerMask[0] ? PlayerMatchKind.All : PlayerMatchKind.Any, objects: members(legacy.playerMask[1]) },
    earlyRules: execution.early, lateRules: execution.late, levels, restorePolicies,
    winConditions: legacy.winconditions.map(value => ({
      quantifier: value[0] === -1 ? WinQuantifier.No : value[0] === 0 ? WinQuantifier.Some : WinQuantifier.All,
      subject: condition(value[1], value[4]), target: condition(value[2], value[5]),
    })),
    metadata: {
      requirePlayerMovement: 'require_player_movement' in legacy.metadata,
      runRulesOnLevelStart: 'run_rules_on_level_start' in legacy.metadata,
      noUndo: 'noundo' in legacy.metadata, noRestart: 'norestart' in legacy.metadata,
      flickscreen: dimensions(legacy.metadata.flickscreen), zoomscreen: dimensions(legacy.metadata.zoomscreen),
    },
    sounds: { simple, sfx, creation: legacy.sfx_CreationMasks.map(objectSound),
      destruction: legacy.sfx_DestructionMasks.map(objectSound) },
  };
  function frame(native) {
    const pendingMovements = [];
    const rigidMarks = [];
    const current = native.level;
    for (let x = 0; x < current.width; x++) for (let y = 0; y < current.height; y++) {
      const tile = x * current.height + y;
      const pending = current.getMovements(tile);
      for (let layer = 0; layer < collisionLayers.length; layer++) {
        const intent = movements(pending.getshiftor(31, layer * 5));
        if (intent.size > 0) pendingMovements.push({ position: { x, y }, layer, movements: intent });
        if (legacy.rigid && current.rigidMovementAppliedMask[tile]) {
          const marked = movements(current.rigidMovementAppliedMask[tile].getshiftor(31, layer * 5));
          if (marked.size > 0) {
            const code = current.rigidGroupIndexMask[tile].getshiftor(31, layer * 5);
            rigidMarks.push({ position: { x, y }, layer, movements: marked,
              group: legacy.rigidGroupIndex_to_GroupIndex[code - 1] ?? null });
          }
        }
      }
    }
    return {
      board: board(current.width, current.height, current.objects), pendingMovements, rigidMarks,
      bannedGroups: new Set(), canMoveSounds: native.canMoveSounds.map(String), cantMoveSounds: native.cantMoveSounds.map(String),
      commands: { entries: current.commandQueue.map((name, index) => ({
        command: execution.command([name, native.message]),
        source: execution.rules.get(current.commandQueueSourceRules[index]),
      })), message: native.message },
      createdObjects: members(native.created), destroyedObjects: members(native.destroyed),
      random: { seed: String(native.random.seed), i: native.random._state.i, j: native.random._state.j,
        permutation: [...native.random._state.s] },
    };
  }
  const ids = values => [...values].map(object => {
    assert.ok(objectIds.has(object), 'Session state must use canonical object declarations');
    return objectIds.get(object);
  }).sort((a, b) => a - b);
  const canonicalBoard = value => ({ width: value.width, height: value.height,
    rows: value.rows.map(row => row.map(cell => ids(cell.objects))) });
  const canonicalSnapshot = value => value === null ? null : ({ board: canonicalBoard(value.board),
    viewport: value.viewport === null ? null : { ...value.viewport } });
  const addresses = values => values.map(value => ({ ...value, position: { ...value.position },
    movements: [...value.movements].sort((a, b) => a - b) }))
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y || a.layer - b.layer);
  function canonicalFrame(value) {
    return {
      board: canonicalBoard(value.board), pendingMovements: addresses(value.pendingMovements), rigidMarks: addresses(value.rigidMarks),
      // Bans are local to processInput, not persistent JS session state. Their
      // complete semantics are checked by the separate turn-pipeline oracle.
      canMoveSounds: [...value.canMoveSounds], cantMoveSounds: [...value.cantMoveSounds],
      commands: { message: value.commands.message, entries: value.commands.entries.map(entry => {
        assert.ok(ruleIds.has(entry.source), 'Queued session commands must retain canonical rule identity');
        return { command: { ...entry.command }, source: ruleIds.get(entry.source) };
      }) },
      createdObjects: ids(value.createdObjects), destroyedObjects: ids(value.destroyedObjects),
      random: { ...value.random, permutation: [...value.random.permutation] },
    };
  }
  return { game, objects, objectIds, ruleIds, execution, board, viewport, snapshot, frame,
    canonicalBoard, canonicalSnapshot, canonicalFrame };
}

module.exports = { decodeSessionGame };
