'use strict';

const assert = require('node:assert/strict');
const { loadPuzzleScript } = require('./native-host.cjs');
const { nativeSourceObjects, candidateObjectLabels, orphanLabel } = require('./legacy-source-objects.cjs');
const { assertVanillaFields } = require('./vanilla-fields.cjs');

// Reuse requires an earlier oracle to have loaded and verified this pinned host
// with tests. It does not change the independent candidate checks below.
function createGameDataOracle(types, { nativeAlreadyLoaded = false } = {}) {
  if (!nativeAlreadyLoaded) loadPuzzleScript({ includeTests: true });
  const { LevelKind, PlayerMatchKind, ObjectMatchKind, WinQuantifier, SimpleSound, Movement } = types;
  const movementSlots = [[1, Movement.Up], [2, Movement.Down], [4, Movement.Left], [8, Movement.Right], [16, Movement.Action]];
  const simpleKinds = [['titlescreen', SimpleSound.TitleScreen], ['startgame', SimpleSound.StartGame],
    ['endgame', SimpleSound.EndGame], ['startlevel', SimpleSound.StartLevel], ['endlevel', SimpleSound.EndLevel],
    ['undo', SimpleSound.Undo], ['restart', SimpleSound.Restart], ['showmessage', SimpleSound.ShowMessage],
    ['closemessage', SimpleSound.CloseMessage], ['cancel', SimpleSound.Cancel]];
  const byKey = entries => [...entries].sort(([a], [b]) => String(a).localeCompare(String(b)));

  function nativeWins(game) {
    const previous = { game: state, board: level, scratch: _o10, win: DoWin };
    const results = [];
    try {
      state = game;
      _o10 = new BitVec(game.STRIDE_OBJ);
      for (const board of game.levels) {
        if (board.message !== undefined) { results.push(null); continue; }
        level = board;
        let won = false;
        DoWin = () => { won = true; };
        // Exercise actual native predicates before projecting writable identities.
        checkWin(false);
        results.push(won);
      }
    } finally {
      state = previous.game;
      level = previous.board;
      _o10 = previous.scratch;
      DoWin = previous.win;
    }
    return results;
  }

  function nativeData(source) {
    resetParserErrorState();
    const processor = new codeMirrorFn();
    const parsed = processor.startState();
    for (const line of source.split('\n')) {
      const stream = new CodeMirror.StringStream(line, 4);
      do { processor.token(stream, parsed); } while (!stream.eol());
    }
    const levelLines = parsed.levels.filter(level => level.length > 0).map(level => level[0] === '\n' ? level[2] : level[0]);
    generateExtraMembers(parsed);
    generateMasks(parsed);
    levelsToArray(parsed);
    processWinConditions(parsed);
    twiddleMetaData(parsed);
    generateSoundData(parsed);
    formatHomePage(parsed);
    return { levelWins: nativeWins(parsed), ...nativeView(parsed, levelLines) };
  }

  /** Project an already compiled native game without invoking native compilation. */
  function nativeView(parsed, levelLines) {
    // Level's constructor and levelsToArray's message branch define these two
    // distinct own-field schemas in the pinned native producers.
    for (const level of parsed.levels) {
      const message = level.message !== undefined;
      assert.deepEqual(Object.keys(level).sort(), message ? ['message']
        : ['commandQueue', 'commandQueueSourceRules', 'height', 'layerCount', 'lineNumber', 'n_tiles', 'objects', 'width'],
      message ? 'native message level fields' : 'native grid level fields');
    }
    // generateSoundData stores only events accepted by reg_soundevents, whose
    // complete namespace is the simple events plus SFX0 through SFX10.
    assertVanillaFields('sound events', parsed.sfx_Events, [...simpleKinds.map(([name]) => name),
      ...Array.from({ length: 11 }, (_unused, index) => 'sfx' + index)]);
    const projection = nativeSourceObjects(parsed);
    const ordered = projection.assigned;
    const members = mask => projection.members(mask).sort();
    const movements = value => movementSlots.filter(([bit]) => value & bit).map(([, movement]) => movement).sort((a, b) => a - b);
    const board = level => ({ width: level.width, height: level.height,
      rows: Array.from({ length: level.height }, (_unused, y) => Array.from({ length: level.width }, (_unused, x) =>
        members(level.getCell(x * level.height + y)))) });
    const levels = parsed.levels.map((level, index) => level.message !== undefined
      ? { kind: 'message', text: level.message, sourceLine: levelLines[index] }
      : { kind: 'grid', board: board(level), sourceLine: levelLines[index] });
    const restorePolicies = [];
    for (const level of levels) {
      if (level.kind !== 'grid') continue;
      const { width, height } = level.board;
      if (restorePolicies.some(policy => policy.width === width && policy.height === height)) continue;
      const retain = [];
      for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
        const tile = x * height + y;
        for (let layer = 0; layer < parsed.collisionLayers.length; layer++) {
          const kept = movementSlots.filter((_entry, slot) => tile * parsed.STRIDE_MOV
            + Math.floor((layer * 5 + slot) / 32) >= width * height).map(([, movement]) => movement);
          if (kept.length > 0) retain.push({ position: { x, y }, layer, movements: kept });
        }
      }
      restorePolicies.push({ width, height, retain });
    }
    const sound = value => ({ objects: members(value.objectMask), layer: value.layer,
      movements: movements(value.directionMask.getshiftor(31, value.layer * 5)), seed: String(value.seed) });
    const objectSound = value => ({ objects: members(value.objectMask), seed: String(value.seed) });
    const condition = (mask, all) => ({ kind: all ? 'all' : 'any', objects: members(mask) });
    const dimensions = value => value === undefined ? undefined : { width: value[0], height: value[1] };
    const metadata = Object.entries(parsed.metadata).map(([name, value]) => [name,
      name === 'flickscreen' || name === 'zoomscreen' ? dimensions(value) : value]);
    const namedObjects = Object.entries(parsed.objectMasks).filter(([name]) => name !== '\nall\n')
      .map(([name, mask]) => [name, members(mask)]);
    const namedAggregates = Object.entries(parsed.aggregateMasks).map(([name, mask]) => [name, members(mask)]);
    function soundTargets(name) {
      const targets = [name];
      const prior = new Set();
      let modified = true;
      while (modified) {
        const key = JSON.stringify(targets);
        assert.ok(!prior.has(key), 'Native sound target expansion must terminate for this fixture: ' + name);
        prior.add(key);
        modified = false;
        for (let index = 0; index < targets.length; index++) {
          const name = targets[index];
          if (name in parsed.synonymsDict) { targets[index] = parsed.synonymsDict[name]; modified = true; }
          else if (name in parsed.propertiesDict) {
            targets.splice(index--, 1);
            targets.push(...parsed.propertiesDict[name]);
            modified = true;
          }
        }
      }
      return targets.filter(name => parsed.objects[name] !== undefined);
    }
    return {
      namedObjects: byKey(namedObjects), namedAggregates: byKey(namedAggregates),
      orphanedObject: projection.orphanedName === null ? null : orphanLabel(projection.orphanedName),
      soundTargets: byKey(namedObjects.map(([name]) => [name, soundTargets(name)])),
      metadata: byKey(metadata),
      data: {
        collisionLayers: parsed.collisionLayers.map((_layer, index) => ordered.filter(name => parsed.objects[name].layer === index)),
        player: condition(parsed.playerMask[1], parsed.playerMask[0]),
        levels, restorePolicies,
        winConditions: parsed.winconditions.map(value => ({
          quantifier: value[0] === -1 ? WinQuantifier.No : value[0] === 0 ? WinQuantifier.Some : WinQuantifier.All,
          subject: condition(value[1], value[4]), target: condition(value[2], value[5]),
        })),
        metadata: {
          requirePlayerMovement: 'require_player_movement' in parsed.metadata,
          runRulesOnLevelStart: 'run_rules_on_level_start' in parsed.metadata,
          noUndo: 'noundo' in parsed.metadata, noRestart: 'norestart' in parsed.metadata,
          flickscreen: dimensions(parsed.metadata.flickscreen), zoomscreen: dimensions(parsed.metadata.zoomscreen),
        },
        sounds: {
          simple: byKey(simpleKinds.filter(([name]) => parsed.sfx_Events[name] !== undefined).map(([name, kind]) => [kind, String(parsed.sfx_Events[name])])),
          sfx: byKey(Array.from({ length: 11 }, (_unused, index) => index).filter(index => parsed.sfx_Events['sfx' + index] !== undefined)
            .map(index => [index, String(parsed.sfx_Events['sfx' + index])])),
          creation: parsed.sfx_CreationMasks.map(objectSound), destruction: parsed.sfx_DestructionMasks.map(objectSound),
        },
        movementSounds: parsed.sfx_MovementMasks.map(layer => layer.map(sound)),
        failureSounds: parsed.sfx_MovementFailureMasks.map(sound),
      },
    };
  }

  function freezeSource(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freezeSource(child);
    Object.freeze(value);
  }
  function rememberInput(root) {
    const seen = new Set();
    const records = [];
    const entries = value => value instanceof Map ? [...value]
      : value instanceof Set ? [...value].map(member => [member, member]) : Object.entries(value);
    function visit(value) {
      if (value === null || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const contents = entries(value);
      records.push({ value, contents });
      for (const [key, child] of contents) { visit(key); visit(child); }
    }
    visit(root);
    return () => {
      for (const { value, contents } of records) {
        const after = entries(value);
        assert.equal(after.length, contents.length, 'Game data compilation mutated declaration input');
        contents.forEach(([key, child], index) => {
          assert.equal(after[index][0], key, 'Game data compilation mutated declaration input keys');
          assert.equal(after[index][1], child, 'Game data compilation mutated declaration input values/identities');
        });
      }
    };
  }
  function candidateDataView(fixture, declarations, result) {
    const name = candidateObjectLabels(declarations, fixture.name);
    const members = objects => [...objects].map(name).sort();
    const board = value => ({ width: value.width, height: value.height, rows: value.rows.map(row => row.map(cell => members(cell.objects))) });
    const condition = value => {
      switch (value.kind) {
        case ObjectMatchKind.Any: return { kind: 'any', objects: members(value.objects) };
        case ObjectMatchKind.All: return { kind: 'all', objects: members(value.objects) };
        case ObjectMatchKind.Never: return { kind: 'never', objects: members(value.objects) };
        default: assert.fail('unsupported object match kind: ' + value.kind);
      }
    };
    const sound = value => ({ ...value, objects: members(value.objects), movements: [...value.movements].sort((a, b) => a - b) });
    const objectSound = value => ({ objects: members(value.objects), seed: value.seed });
    const { data } = result;
    return {
      namedObjects: byKey([...declarations.namedObjects].map(([name, objects]) => [name, members(objects)])),
      namedAggregates: byKey([...declarations.namedAggregates].map(([name, objects]) => [name, members(objects)])),
      orphanedObject: declarations.orphanedObject === null ? null : name(declarations.orphanedObject),
      soundTargets: byKey([...declarations.soundTargets].map(([key, objects]) => [key, objects.map(name)])),
      metadata: byKey(result.metadata),
      data: {
        collisionLayers: data.collisionLayers.map(layer => layer.map(name)),
        player: { kind: data.player.kind === PlayerMatchKind.Never ? 'never'
          : data.player.kind === PlayerMatchKind.All ? 'all' : 'any', objects: members(data.player.objects) },
        levels: data.levels.map(level => {
          switch (level.kind) {
            case LevelKind.Message: return { kind: 'message', text: level.text, sourceLine: level.sourceLine };
            case LevelKind.Grid: return { kind: 'grid', board: board(level.board), sourceLine: level.sourceLine };
            default: assert.fail('unsupported level kind: ' + level.kind);
          }
        }),
        restorePolicies: (data.restorePolicies ?? []).map(policy => ({ ...policy, retain: policy.retain.map(entry =>
          ({ ...entry, movements: [...entry.movements].sort((a, b) => a - b) })) })),
        winConditions: data.winConditions.map(value => ({ quantifier: value.quantifier,
          subject: condition(value.subject), target: condition(value.target) })),
        metadata: { ...data.metadata, flickscreen: data.metadata.flickscreen, zoomscreen: data.metadata.zoomscreen },
        sounds: { simple: byKey(data.sounds.simple), sfx: byKey(data.sounds.sfx),
          creation: data.sounds.creation.map(objectSound), destruction: data.sounds.destruction.map(objectSound) },
        movementSounds: data.movementSounds.map(layer => layer.map(sound)), failureSounds: data.failureSounds.map(sound),
      },
    };
  }
  function candidateView(fixture, declarations, result) {
    return { levelWins: result.data.levels.map(level => level.kind === LevelKind.Message ? null
      : types.hasWon(level.board, result.data.winConditions)), ...candidateDataView(fixture, declarations, result) };
  }
  function compareFixture(fixture, options = {}) {
    const expected = nativeData(fixture.source);
    const producers = ['compile', 'loadFile', 'generateExtraMembers', 'generateMasks', 'levelsToArray',
      'levelFromString', 'processWinConditions', 'twiddleMetaData', 'generateSoundData', 'formatHomePage', 'checkWin'];
    const originals = new Map(producers.map(name => [name, globalThis[name]]));
    const originalParser = codeMirrorFn;
    let declarations;
    let result;
    try {
      for (const name of producers) globalThis[name] = () => { throw new Error('TS game data called JS producer ' + name); };
      codeMirrorFn = function() { throw new Error('TS game data called JS producer codeMirrorFn'); };
      const { document } = types.readSource(fixture.source);
      freezeSource(document);
      ({ declarations } = (options.resolveDeclarations ?? types.resolveDeclarations)(document));
      const unchanged = rememberInput(declarations);
      result = (options.compileGameData ?? types.compileGameData)(document, declarations);
      unchanged();
    } finally {
      codeMirrorFn = originalParser;
      for (const [name, original] of originals) globalThis[name] = original;
    }
    assert.deepEqual(candidateView(fixture, declarations, result), expected, fixture.name + ': compiled game data');
    return { levels: result.data.levels.length, winConditions: result.data.winConditions.length,
      sounds: result.data.movementSounds.flat().length + result.data.failureSounds.length
        + result.data.sounds.creation.length + result.data.sounds.destruction.length };
  }
  const corpusFixtures = () => testdata.map(([name, data]) => ({ name, source: data[0] }));
  return { compareFixture, corpusFixtures, nativeView, candidateDataView };
}

module.exports = { createGameDataOracle };
