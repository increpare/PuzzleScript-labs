'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function fields(value, allowed, kind) {
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), 'Unknown ' + kind + ' field: ' + key);
}

/** Encode explicit object names in convertLevelToString's historical wire order.
 * Authored boards are ordinary rows. The wire format visits columns, then wraps
 * that sequence into width-sized lines; it is not a picture of the logical board.
 */
function serializeExpectedBoard(rows, cells) {
  assert.ok(Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'string' && rows[0].length > 0,
    'Expected board must be a nonempty rectangle');
  const width = rows[0].length;
  assert.ok(rows.every(row => typeof row === 'string' && row.length === width), 'Expected board must form a rectangle');
  const seen = new Map();
  let output = '', index = 0;
  for (let x = 0; x < width; x++) for (let y = 0; y < rows.length; y++) {
    const glyph = rows[y][x];
    assert.ok(Object.hasOwn(cells, glyph), 'Undefined expected glyph: ' + glyph);
    const names = cells[glyph];
    assert.ok(Array.isArray(names) && names.every(name => typeof name === 'string' && name === name.toLowerCase()),
      'Expected object names must be explicit lowercase strings');
    assert.equal(new Set(names).size, names.length, 'Expected object names must not repeat');
    const label = [...names].sort().join(' ');
    if (!seen.has(label)) { seen.set(label, seen.size); output += label + ':'; }
    output += seen.get(label) + ',';
    if (++index % width === 0) output += '\n';
  }
  return output;
}

function loadFixtures({ directory = __dirname, filter = '' } = {}) {
  const fixtures = [], ids = new Set(), names = new Set();
  const allowedInputs = new Set([0, 1, 2, 3, 4, 'undo', 'restart', 'tick']);
  for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort()) {
    const games = JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'));
    assert.ok(Array.isArray(games), filename + ': expected an array of games');
    for (const game of games) {
      fields(game, ['id', 'sourceFile', 'explanation', 'cells', 'cases', 'expectedErrors'], 'game');
      assert.ok(typeof game.id === 'string' && game.id.length > 0 && !ids.has(game.id), 'Duplicate or missing game id: ' + game.id);
      ids.add(game.id);
      assert.ok(typeof game.explanation === 'string' && game.explanation.length > 0, game.id + ': explain the behavior');
      const expectedErrors = game.expectedErrors ?? [];
      assert.ok(Array.isArray(expectedErrors) && expectedErrors.every(message => typeof message === 'string' && message.length > 0),
        game.id + ': expectedErrors must explicitly name compiler errors');
      assert.ok(typeof game.sourceFile === 'string', game.id + ': missing sourceFile');
      const sourcePath = path.resolve(directory, game.sourceFile);
      assert.ok(sourcePath.startsWith(path.resolve(directory) + path.sep), game.id + ': sourceFile must stay inside fixture directory');
      const source = fs.readFileSync(sourcePath, 'utf8');
      assert.ok(game.cells && typeof game.cells === 'object' && !Array.isArray(game.cells), game.id + ': missing expected cells');
      assert.ok(Array.isArray(game.cases) && game.cases.length > 0, game.id + ': missing cases');
      for (const entry of game.cases) {
        fields(entry, ['name', 'inputs', 'expected', 'level', 'seed', 'expectedSounds', 'expectedPlayedSounds',
          'labsExpected', 'labsExpectedSounds'], 'case');
        assert.ok(typeof entry.name === 'string' && entry.name.length > 0, game.id + ': missing case name');
        const name = 'semantic: ' + game.id + ': ' + entry.name;
        assert.ok(!names.has(name), 'Duplicate fixture: ' + name);
        names.add(name);
        assert.ok(Array.isArray(entry.inputs), name + ': missing inputs');
        for (const input of entry.inputs) assert.ok(allowedInputs.has(input), name + ': Unsupported input ' + input);
        const level = entry.level ?? 0, seed = entry.seed ?? game.id;
        assert.ok(Number.isInteger(level) && level >= 0, name + ': invalid level');
        assert.ok(typeof seed === 'string' && seed.length > 0, name + ': seed must be a nonempty string');
        const expectedBoard = serializeExpectedBoard(entry.expected, game.cells);
        const fixture = { name, source, inputs: [...entry.inputs], expectedBoard, level, seed,
          expectedRows: [...entry.expected], explanation: game.explanation, sourceFile: game.sourceFile,
          expectedErrors: [...expectedErrors] };
        if (entry.labsExpected !== undefined) {
          fixture.labsExpectedBoard = serializeExpectedBoard(entry.labsExpected, game.cells);
          fixture.labsExpectedRows = [...entry.labsExpected];
        }
        for (const field of ['expectedSounds', 'expectedPlayedSounds', 'labsExpectedSounds']) {
          if (entry[field] === undefined) continue;
          assert.ok(Array.isArray(entry[field]) && entry[field].every(seed => typeof seed === 'string' || typeof seed === 'number'),
            name + ': ' + field + ' must be a sequence of sound seeds');
          fixture[field] = [...entry[field]];
        }
        if (name.toLowerCase().includes(filter.toLowerCase())) fixtures.push(fixture);
      }
    }
  }
  return fixtures;
}

// Ordinary expectations follow the pinned vanilla authority; Labs can override a fork difference.
function fixtureTuple(fixture, { labs = false } = {}) {
  const expectedBoard = labs ? fixture.labsExpectedBoard ?? fixture.expectedBoard : fixture.expectedBoard;
  const expectedSounds = labs ? fixture.labsExpectedSounds ?? fixture.expectedSounds : fixture.expectedSounds;
  const payload = [fixture.source, fixture.inputs, expectedBoard, fixture.level, fixture.seed];
  if (expectedSounds !== undefined) payload.push(expectedSounds);
  return [fixture.name, payload];
}

module.exports = { serializeExpectedBoard, loadFixtures, fixtureTuple };
