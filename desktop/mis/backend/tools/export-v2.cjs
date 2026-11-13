'use strict';
// Compiled definitions and PRISTINE level data only. No CPU gameplay executes.
const fs = require('node:fs');
const oracle = require('./oracle.cjs');
const effects = require('./effects.cjs');

function layout(game, soundCapacity = 1) {
  const cells = game[1] * game[2], ow = game[23], mw = game[24];
  const result = { cells, objectWords: ow, movementWords: mw, rng: 128, board: 384 };
  const objectSize = cells * ow, movementSize = cells * mw;
  result.movements = result.board + objectSize;
  result.before = result.movements + movementSize;
  result.parentBefore = result.before + objectSize;
  result.retryBoard = result.parentBefore + objectSize;
  result.restart = result.retryBoard + objectSize;
  result.retryMovements = result.restart + objectSize;
  result.rigidOwners = result.retryMovements + movementSize;
  result.rigidApplied = result.rigidOwners + movementSize;
  result.players = result.rigidApplied + movementSize;
  result.bans = result.players + cells;
  result.banWords = Math.ceil(game[7] / 32);
  result.created = result.bans + result.banWords;
  result.destroyed = result.created + ow;
  result.globalObjects = result.destroyed + ow;
  result.history = result.globalObjects + ow;
  result.matches = result.history + game[25] * objectSize;
  result.queue = result.matches + game[27] * game[26] * 3;
  result.soundCan = result.queue + 32;
  result.soundCant = result.soundCan + soundCapacity;
  result.events = result.soundCant + soundCapacity;
  result.words = result.events + game[30] * 2;
  return result;
}

function upload(source, operations, options = {}) {
  return uploadCompiled(oracle.compileProgram(source, options.seed || 'gpu'), operations, options);
}
function uploadCompiled(compiled, operations, { name = 'source', seed = 'gpu', level: index = 0,
  historyCapacity = Math.max(64, operations.length * 2 + 4), matchCapacity, effectCapacity } = {}) {
  const reject = reason => { throw Error('Unsupported v2: ' + reason); };
  const selected = compiled.levels[index];
  if (!selected || selected.message !== undefined) reject('selected level is not playable');
  const groups = [], rules = [], rows = [], cells = [], masks = [], cached = new Map();
  const symbols = [''], symbolIds = new Map([['', 0]]), ruleCommands = [];
  const symbol = value => {
    const text = String(value);
    if (!symbolIds.has(text)) { symbolIds.set(text, symbols.length); symbols.push(text); }
    return symbolIds.get(text);
  };
  const ow = compiled.STRIDE_OBJ, mw = compiled.STRIDE_MOV;
  const mask = (value, size) => {
    const data = Array.from({ length: size }, (_, i) => (value?.data?.[i] || 0) >>> 0);
    const key = data.length + ':' + data.join(',');
    if (!cached.has(key)) { cached.set(key, masks.length); masks.push(...data); }
    return cached.get(key);
  };
  const commands = effects.commands;
  const allGroups = [...compiled.rules, ...compiled.lateRules];
  for (let gi = 0; gi < allGroups.length; gi++) {
    const group = allGroups[gi], late = gi >= compiled.rules.length;
    const local = late ? gi - compiled.rules.length : gi;
    const loops = late ? compiled.lateLoopPoint : compiled.loopPoint;
    groups.push([rules.length, group.length, Number(group[0].isRandom),
      loops[local] === undefined ? 0xffffffff : loops[local] + (late ? compiled.rules.length : 0)]);
    for (const rule of group) {
      let commandMask = 0;
      const queue = [];
      for (const command of rule.commands) {
        const bit = commands.indexOf(command[0]);
        if (bit < 0) reject('command ' + command[0]);
        commandMask |= 1 << bit;
        queue.push([bit, bit === 5 ? symbol(command[1]) : 0]);
      }
      ruleCommands.push(queue);
      const ordinal = rule.rigid ? compiled.groupNumber_to_RigidGroupIndex[rule.groupNumber] + 1 : 0;
      if (ordinal > 31) reject('rigid ordinal capacity');
      rules.push([rule.direction, rows.length, rule.patterns.length, commandMask, ordinal,
        Number(rule.hasReplacements), rule.lineNumber, 0]);
      for (const row of rule.patterns) {
        const ellipses = row.filter(Array.isArray).length;
        if (ellipses > 2) reject('ellipsis capacity');
        if (row.length > 64) reject('pattern row capacity');
        const required = Array(ow).fill(0);
        for (const cell of row) if (!Array.isArray(cell)) for (let w = 0; w < ow; w++) required[w] |= cell.objectsPresent.data[w];
        rows.push([cells.length, row.length, ellipses, mask({ data: required }, ow)]);
        for (const cell of row) {
          if (Array.isArray(cell)) { cells.push([...Array(17).fill(0), 1]); continue; }
          if (cell.anyObjectsPresent.length > 4) reject('property predicate capacity');
          const properties = cell.anyObjectsPresent.map(value => mask(value, ow));
          while (properties.length < 4) properties.push(mask(null, ow));
          const r = cell.replacement;
          cells.push([mask(cell.objectsPresent, ow), mask(cell.objectsMissing, ow),
            mask(cell.movementsPresent, mw), mask(cell.movementsMissing, mw), cell.anyObjectsPresent.length,
            ...properties, Number(r !== null), mask(r?.objectsClear, ow), mask(r?.objectsSet, ow),
            mask(r?.movementsClear, mw), mask(r?.movementsSet, mw), mask(r?.movementsLayerMask, mw),
            mask(r?.randomEntityMask, ow), mask(r?.randomDirMask, mw), 0]);
        }
      }
    }
  }
  const rowCapacity = Math.max(1, ...rules.map(rule => rule[2]));
  if (rowCapacity > 16) reject('bracket row capacity');
  const count = selected.width * selected.height;
  const matches = matchCapacity ?? Math.max(256, count * 2);
  const game = Array(32).fill(0);
  Object.assign(game, { 0: 2, 1: selected.width, 2: selected.height, 3: compiled.collisionLayers.length,
    4: compiled.objectCount, 5: mask(compiled.playerMask[1], ow), 6: Number(compiled.playerMask[0]),
    7: allGroups.length, 8: compiled.rules.length, 9: rules.length, 10: cells.length,
    11: ('noundo' in compiled.metadata ? 1 : 0) | ('norestart' in compiled.metadata ? 2 : 0) |
      ('require_player_movement' in compiled.metadata ? 4 : 0) | ('run_rules_on_level_start' in compiled.metadata ? 8 : 0) |
      ('noaction' in compiled.metadata ? 16 : 0),
    18: compiled.loopPoint[compiled.rules.length] ?? 0xffffffff,
    19: compiled.lateLoopPoint[compiled.lateRules.length] === undefined ? 0xffffffff :
      compiled.lateLoopPoint[compiled.lateRules.length] + compiled.rules.length,
    20: rows.length, 22: compiled.winconditions.length, 23: ow, 24: mw,
    25: historyCapacity, 26: matches, 27: rowCapacity });
  const wins = compiled.winconditions.map(win => [win[0] + 1, mask(win[1], ow), mask(win[2], ow), Number(win[4]), Number(win[5])]);
  const audio = effects.encode(compiled, mask, symbol);
  const outputs = audio.rows.length || audio.simple.some(seed => seed !== 0xffffffff) || ruleCommands.some(list => list.some(command => command[0] === 5));
  game[30] = effectCapacity ?? (outputs ? 4096 : 1);
  const section = (slot, data) => { game[slot] = game.length; for (const row of data) game.push(...row); };
  section(12, compiled.layerMasks.map(value => Array.from(value.data, n => n >>> 0)));
  section(13, groups); section(14, rules); section(15, rows); section(16, cells);
  section(17, [Array.from({ length: 32 }, (_, ord) => compiled.rigidGroupIndex_to_GroupIndex[ord - 1] ?? 0xffffffff)]);
  section(21, wins);
  for (let r = 0; r < rules.length; r++) {
    game[game[14] + r * 8 + 7] = game.length;
    game.push(ruleCommands[r].length);
    for (const command of ruleCommands[r]) game.push(...command);
  }
  game[28] = game.length; game[29] = audio.rows.length;
  for (const row of audio.rows) game.push(...row);
  game.push(...audio.simple);
  game[31] = game.length;
  // Convert arena-relative references to absolute game-buffer addresses.
  game[5] += game[31];
  for (let c = 0; c < cells.length; c++) if (!cells[c][17]) {
    for (const k of [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]) game[game[16] + c * 18 + k] += game[31];
  }
  for (let w = 0; w < wins.length; w++) for (const k of [1, 2]) game[game[21] + w * 5 + k] += game[31];
  for (let r = 0; r < rows.length; r++) game[game[15] + r * 4 + 3] += game[31];
  for (let i = 0; i < audio.rows.length; i++) for (const k of [2, 3]) game[game[28] + i * 5 + k] += game[31];
  for (const word of masks) game.push(word);
  const storage = layout(game, symbols.length);
  if (storage.words * 4 > 128 * 1024 * 1024) reject('single-state storage binding exceeds 128 MiB');
  const initial = Array(storage.words).fill(0), rng = new RNG(seed);
  for (let i = 0; i < 256; i++) initial[storage.rng + i] = rng._state.s[i];
  for (let i = 0; i < selected.objects.length; i++) initial[storage.board + i] = initial[storage.restart + i] = selected.objects[i] >>> 0;
  const convert = op => typeof op === 'number' ? op : ({ up: 0, left: 1, down: 2, right: 3, action: 4, tick: 5, undo: 6, restart: 7 })[op];
  const ops = operations.map(convert);
  if (ops.some(op => !Number.isInteger(op) || op < 0 || op > 7)) reject('operations');
  return { format: 'puzzlescript-gpu-v2', authority: oracle.REVISION, name, symbols, game, initial, operations: [8, ...ops] };
}

if (require.main === module) {
  try {
    const [source, output, level = '0', ...operations] = process.argv.slice(2);
    if (!source || !output) throw Error('Usage: node gpu/tools/export-v2.cjs source.ps upload.json levelIndex [right tick ...]');
    oracle.initialize();
    const result = upload(fs.readFileSync(source, 'utf8'), operations, { name: source, level: Number(level) });
    fs.writeFileSync(output, JSON.stringify(result));
    console.log(JSON.stringify({ output, format: result.format, stateWords: result.initial.length, level: Number(level) }));
  } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { upload, uploadCompiled, layout };
