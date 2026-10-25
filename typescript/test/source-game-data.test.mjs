import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../build/source-reader.js';
import { parseSource } from '../build/source-parser.js';
import { resolveDeclarations } from '../build/declarations.js';
import { compileGameData } from '../build/source-game-data.js';
import { LevelKind, SimpleSound } from '../build/session-model.js';
import { Movement } from '../build/model.js';
import { ObjectMatchKind, WinQuantifier, hasWon } from '../build/win-conditions.js';
import { SourceDiagnosticPhase } from '../build/source-model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';

const defaultObjects = 'Background .\nBlack\n\nPlayer P\nWhite\n\nCrate C\nRed\n\nWall W\nBlue';
function compile({ objects = defaultObjects, legend = '', layers = 'Background\nPlayer, Crate, Wall', metadata = '', sounds = '', wins = '', levels = 'P.' } = {}) {
  const { document } = readSource(`${metadata}\nOBJECTS\n${objects}\nLEGEND\n${legend}\nSOUNDS\n${sounds}\nCOLLISIONLAYERS\n${layers}\nRULES\nWINCONDITIONS\n${wins}\nLEVELS\n${levels}`);
  const { declarations } = resolveDeclarations(document);
  return { ...compileGameData(document, declarations), declarations, document };
}
const names = objects => [...objects].map(object => object.name);
const cells = board => board.rows.map(row => row.map(cell => names(cell.objects)));

test('grid levels fill background with canonical objects and preserve message text and source lines', () => {
  const { data, declarations, document, diagnostics } = compile({ levels: 'P.\n.C\n\nMessage MiXeD text!\n\nmessage' });
  assert.deepEqual(cells(data.levels[0].board), [[['player', 'background'], ['background']], [['background'], ['crate', 'background']]]);
  assert.equal(data.levels[0].kind, LevelKind.Grid);
  assert.equal(data.levels[0].sourceLine, document.levels[0].rows[0].span.start.line);
  assert.equal(data.levels[1].text, 'MiXeD text!');
  assert.equal(data.levels[1].sourceLine, document.levels[1].keyword.span.start.line);
  assert.equal(data.levels[2].text, '');
  assert.equal(data.collisionLayers, declarations.collisionLayers);
  assert.equal(data.player, declarations.player);
  assert.equal([...data.levels[0].board.rows[0][0].objects][0], declarations.objects[1]);
  assert.deepEqual(diagnostics, []);
});

test('ragged rows use the first normalized width, truncate long rows and repeat short final glyphs', () => {
  const { data, diagnostics, document } = compile({ levels: 'P.C\nW\nCP.W' });
  assert.deepEqual(cells(data.levels[0].board), [
    [['player', 'background'], ['background'], ['crate', 'background']],
    [['wall', 'background'], ['wall', 'background'], ['wall', 'background']],
    [['crate', 'background'], ['player', 'background'], ['background']],
  ]);
  assert.deepEqual(diagnostics, []);
  assert.equal(parseSource(document.source).diagnostics.filter(item => item.message.startsWith('Maps must be rectangular')).length, 2);
});

test('whole-row lowercase precedes UTF-16 indexing and original spans remain intact', () => {
  const objects = `${defaultObjects}\n\nI I\nGreen\n\nDot ̇\nBlue\n\nSigma Σ ς σ\nRed`;
  const { data, document } = compile({ objects, layers: 'Background\nPlayer, Crate, Wall, I, Dot, Sigma', levels: 'İΟΣ\nP' });
  assert.equal(data.levels[0].board.width, 4);
  // The unknown omicron ends column-first initialization after columns 0 and 1.
  assert.deepEqual(cells(data.levels[0].board), [[['i'], ['dot'], [], []], [['player'], ['player'], [], []]]);
  assert.equal(document.levels[0].rows[0].text, 'İΟΣ');
  const contextual = compile({ objects, layers: 'Background\nPlayer, Crate, Wall, I, Dot, Sigma', levels: 'ΣΣ' });
  assert.deepEqual(cells(contextual.data.levels[0].board), [[['sigma', 'background'], ['sigma', 'background']]]);
});

test('background fill selects the first existing background-layer intersection in column order', () => {
  const { data } = compile({ objects: 'Grass .\nGreen\n\nWater ~\nBlue\n\nPlayer P\nWhite', legend: 'Background = Grass or Water', layers: 'Background\nPlayer', levels: 'P.\n~P' });
  assert.deepEqual(cells(data.levels[0].board), [[['player', 'water'], ['grass']], [['water'], ['player', 'water']]]);
});

test('unknown and property glyphs return an unfilled partially initialized board in column order', () => {
  for (const [levels, code] of [['P?\nC.', 'unknown-level-glyph'], ['PX\nC.', 'ambiguous-level-glyph']]) {
    const { data, diagnostics, document } = compile({ legend: 'X = Player or Crate', levels });
    assert.deepEqual(cells(data.levels[0].board), [[['player'], []], [['crate'], []]]);
    const problem = diagnostics.find(item => item.code === code);
    assert.equal(problem.phase, SourceDiagnosticPhase.GameData);
    assert.equal(problem.span.start.line, document.levels[0].rows[0].span.start.line);
    assert.equal(problem.countsAsError, true);
  }
});

test('forward synonyms promoted to properties still diagnose ambiguous level glyphs', () => {
  const { data, declarations, diagnostics } = compile({ legend: 'X = Later\nLater = Player or Crate', levels: 'X' });
  assert.equal(declarations.namedObjects.has('x'), false);
  assert.deepEqual(cells(data.levels[0].board), [[[]]]);
  assert.equal(diagnostics[0].code, 'ambiguous-level-glyph');
});

test('unlayered glyphs compile as empty cells and their lookup recovery supplies object sounds and wins', () => {
  const { data, declarations, diagnostics } = compile({ layers: 'Background\nPlayer, Crate', levels: 'PW.',
    sounds: 'Wall create 123\nWall move 456', wins: 'Some Wall' });
  assert.deepEqual(cells(data.levels[0].board), [[['player', 'background'], ['background'], ['background']]]);
  assert.deepEqual([...data.sounds.creation[0].objects], [declarations.objects[0]]);
  assert.deepEqual([...data.winConditions[0].subject.objects], [declarations.objects[0]]);
  assert.equal(data.movementSounds.flat().length, 0);
  assert.deepEqual(diagnostics, []);
});

test('missing background still gives a useful grid and frozen source inputs remain untouched', () => {
  const { document } = readSource('OBJECTS\nPlayer P\nWhite\nLEGEND\nBackground = Missing\nCOLLISIONLAYERS\nPlayer\nLEVELS\nPP');
  const { declarations } = resolveDeclarations(document);
  const before = structuredClone(document);
  function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } }
  freeze(document);
  const result = compileGameData(document, declarations);
  assert.deepEqual(cells(result.data.levels[0].board), [[['player'], ['player']]]);
  assert.ok(result.diagnostics.some(item => item.code === 'missing-level-background'));
  assert.deepEqual(document, before);
});

test('win operands distinguish property Any from aggregate All and omitted targets use layered objects', () => {
  const { data, declarations } = compile({ legend: 'Things = Player or Crate\nPair = Player and Wall\nX = Pair', layers: 'Background\nPlayer, Crate\nWall', wins: 'No Things\nSome Pair on Things\nAll Things on X', levels: 'P.' });
  assert.deepEqual(data.winConditions.map(condition => condition.quantifier), [WinQuantifier.No, WinQuantifier.Some, WinQuantifier.All]);
  assert.equal(data.winConditions[0].subject.kind, ObjectMatchKind.Any);
  assert.equal(data.winConditions[1].subject.kind, ObjectMatchKind.All);
  assert.equal(data.winConditions[2].target.kind, ObjectMatchKind.All);
  assert.deepEqual(new Set(data.winConditions[0].target.objects), new Set(declarations.objects));
  assert.equal(data.winConditions[0].target.kind, ObjectMatchKind.Any);
  assert.equal(hasWon(data.levels[0].board, [data.winConditions[0]]), false);
  assert.equal(hasWon(data.levels[0].board, [{ ...data.winConditions[0], quantifier: WinQuantifier.Some }]), true);
});

test('win lookup prefers namedObjects on namespace overlap and omits both unknown-operand conditions', () => {
  const { data, diagnostics } = compile({ legend: 'Pair = Player and Wall\nCrate = Pair', layers: 'Background\nPlayer\nCrate\nWall', wins: 'Some Crate\nSome Missing on Absent\nSome Player on Missing' });
  assert.equal(data.winConditions.length, 1);
  assert.equal(data.winConditions[0].subject.kind, ObjectMatchKind.Any);
  assert.deepEqual(names(data.winConditions[0].subject.objects), ['crate']);
  assert.equal(diagnostics.filter(item => item.code === 'unknown-win-operand').length, 3);
});

test('aggregate aliases retain the writable orphan and require its actual identity', () => {
  const { data, declarations } = compile({ legend: 'Pair = Wall and Crate\nAlias = Pair', layers: 'Background\nPlayer, Crate\nBackground', wins: 'Some Pair on Crate\nSome Alias on Crate', levels: 'C' });
  const orphan = declarations.orphanedObject;
  const crate = declarations.objects.find(object => object.name === 'crate');
  for (const condition of data.winConditions) {
    assert.equal(condition.subject.kind, ObjectMatchKind.All);
    assert.deepEqual([...condition.subject.objects], [orphan, crate]);
  }
  assert.equal(hasWon(data.levels[0].board, data.winConditions), false);
  const board = { width: 1, height: 1, rows: [[{ objects: new Set([orphan, crate]) }]] };
  assert.equal(hasWon(board, data.winConditions), true);
  assert.equal(hasWon({ ...board, rows: [[{ objects: new Set([orphan.orphanedFrom, crate]) }]] }, data.winConditions), false);
});

test('orphan aggregate membership propagates through properties and clears on a later lookup replacement', () => {
  for (const [extra, expected] of [['', true], ['\nCrate = Player', false]]) {
    const { declarations } = compile({ legend: 'Choices = Wall or Player\nCrate = Choices\nPair = Crate and Player' + extra, layers: 'Background\nPlayer, Crate\nBackground', levels: 'P' });
    assert.equal(declarations.namedAggregates.get('pair').has(declarations.orphanedObject), expected);
    assert.deepEqual(names(declarations.namedAggregates.get('pair')), expected ? ['background', 'player'] : ['player']);
  }
});

test('aggregate and property players retain the orphan alongside the known alternative', () => {
  for (const [operator, expected] of [['and', PlayerMatchKind.All], ['or', PlayerMatchKind.Any]]) {
    const { declarations } = compile({ objects: defaultObjects.replace('Player P', 'Actor P'), legend: `Player = Wall ${operator} Crate`, layers: 'Background\nActor, Crate\nBackground', levels: 'C' });
    assert.equal(declarations.player.kind, expected, operator);
    assert.deepEqual([...declarations.player.objects], [declarations.orphanedObject, declarations.objects.find(object => object.name === 'crate')], operator);
  }
});

test('zero raw collision assignments leave empty aggregate requirements satisfiable', () => {
  const { declarations, data } = compile({ legend: 'Pair = Wall and Crate', layers: 'Unknown', wins: 'Some Pair on Pair', levels: 'C' });
  assert.equal(declarations.objectChoiceOrder.length, 0);
  assert.equal(declarations.orphanedObject, null);
  assert.equal(data.winConditions[0].subject.kind, ObjectMatchKind.All);
  assert.equal(data.winConditions[0].subject.objects.size, 0);
  assert.equal(hasWon(data.levels[0].board, data.winConditions), true);
});

test('zero raw collision assignments leave an aggregate player as empty All rather than Never', () => {
  const { declarations } = compile({ legend: 'Player = Wall and Crate', layers: 'Unknown', levels: 'C' });
  assert.equal(declarations.player.kind, PlayerMatchKind.All);
  assert.equal(declarations.player.objects.size, 0);
});

test('malformed win rows retain native word-count recovery and default quantifiers', () => {
  const { data, diagnostics } = compile({ wins: 'all\nweird Player\nall Player nonsense Crate\nno Crate on\nsome Player on Crate extra' });
  assert.equal(data.winConditions.length, 4);
  assert.equal(data.winConditions[0].quantifier, WinQuantifier.Some);
  assert.deepEqual(names(data.winConditions[1].target.objects), ['crate']);
  assert.equal(data.winConditions[2].target.objects.size, 4);
  assert.equal(data.winConditions[3].target.objects.size, 4);
  assert.ok(diagnostics.some(item => item.code === 'malformed-win-condition'));
});

test('recognized metadata preserves source order, last values, raw graphics values and session flags', () => {
  const { metadata, data, diagnostics, document } = compile({ metadata: 'title First\nauthor MiXeD\nrequire_player_movement false\nrun_rules_on_level_start\nnoundo\nnorestart\nbackground_color NotAColor\nkey_repeat_interval 0.25\ntitle Last\nunknown_option ignored' });
  assert.deepEqual([...metadata.keys()], ['title', 'author', 'require_player_movement', 'run_rules_on_level_start', 'noundo', 'norestart', 'background_color', 'key_repeat_interval']);
  assert.equal(metadata.get('title'), 'Last');
  assert.equal(metadata.get('author'), 'MiXeD');
  assert.equal(metadata.get('background_color'), 'notacolor');
  assert.equal(metadata.get('key_repeat_interval'), '0.25');
  assert.equal(metadata.get('require_player_movement'), 'true');
  assert.deepEqual(data.metadata, { requirePlayerMovement: true, runRulesOnLevelStart: true, noUndo: true, noRestart: true });
  assert.equal(diagnostics.filter(item => item.code === 'unknown-metadata').length, 0);
  assert.equal(diagnostics.some(item => item.code === 'duplicate-metadata'), false);
  assert.ok(parseSource(document.source).diagnostics.some(item => item.message.startsWith("You've already defined a TITLE")));
});

test('screen dimensions follow finite signed-32 integer validation then native parseInt quirks', () => {
  for (const [value, expected] of [
    ['3X4', { width: 3, height: 4 }], ['1e2x2.0', { width: 1, height: 2 }],
    ['0x10x2', undefined], ['-2x0', { width: -2, height: 0 }], ['+3x4', { width: 3, height: 4 }],
    ['2147483648x2', undefined], ['-2147483648x2', { width: -2147483648, height: 2 }],
    ['.0x2', undefined], ['Infinityx2', undefined], ['2.5x2', undefined], ['2x3x4', undefined],
  ]) {
    const { metadata, data, diagnostics } = compile({ metadata: `flickscreen ${value}\nzoomscreen ${value}` });
    assert.deepEqual(metadata.get('flickscreen'), expected, value);
    assert.deepEqual(data.metadata.flickscreen, expected, value);
    assert.deepEqual(data.metadata.zoomscreen, expected, value);
    if (expected === undefined || expected.width <= 0 || expected.height <= 0) {
      assert.ok(diagnostics.length > 0, value);
      assert.ok(diagnostics.every(item => !item.countsAsError), value);
    }
  }
});

test('only the final metadata dimensions are converted and missing valued entries are omitted', () => {
  const { metadata, data, diagnostics } = compile({ metadata: 'flickscreen bad\nflickscreen 4x5\nzoomscreen\ntitle' });
  assert.deepEqual(data.metadata.flickscreen, { width: 4, height: 5 });
  assert.equal(metadata.has('zoomscreen'), false);
  assert.equal(metadata.has('title'), false);
  assert.equal(diagnostics.some(item => item.code === 'invalid-dimensions'), false);
});

test('vanilla nohack metadata is retained as a recognized flag', () => {
  const { metadata } = compile({ metadata: 'nohack false' });
  assert.equal(metadata.get('nohack'), 'true');
});

test('homepage metadata removes the first HTTP scheme then the first HTTPS scheme anywhere in the value', () => {
  for (const [value, expected] of [
    ['https://Example.org/Path', 'Example.org/Path'],
    ['http://http://Example.org/https://https://', 'http://Example.org/https://'],
    ['prefixhttps://midhttp://suffix', 'prefixmidsuffix'],
    ['HTTP://Example.org', 'HTTP://Example.org'],
  ]) assert.equal(compile({ metadata: `homepage ${value}` }).metadata.get('homepage'), expected, value);
});

const movementSounds = data => data.movementSounds.map(layer => layer.map(sound => ({
  objects: names(sound.objects), layer: sound.layer, movements: [...sound.movements], seed: sound.seed,
})));

test('simple sound events take precedence over target names, keep seed digits and overwrite duplicates', () => {
  const { data, diagnostics } = compile({ objects: `${defaultObjects}\n\nUndo U\nBlue`, layers: 'Background\nPlayer, Crate, Wall, Undo',
    sounds: 'undo 000123\nundo 456\nsfx0 00001\nsfx10 01010\nUndo move 99\ntitlescreen 44\ncancel 55' });
  assert.equal(data.sounds.simple.get(SimpleSound.Undo), '456');
  assert.equal(data.sounds.simple.get(SimpleSound.TitleScreen), '44');
  assert.equal(data.sounds.simple.get(SimpleSound.Cancel), '55');
  assert.deepEqual([...data.sounds.sfx], [[0, '00001'], [10, '01010']]);
  assert.equal(data.movementSounds.flat().length, 0);
  assert.ok(diagnostics.some(item => item.code === 'duplicate-sound-event'));
});

test('movement and failure sounds preserve declaration and final property target order including duplicates', () => {
  const { data } = compile({ legend: 'Actors = Crate or Player or Crate\nAlias = Actors', layers: 'Background\nPlayer, Crate\nWall',
    sounds: 'Actors move horizontal 001\nAlias cantmove vertical 002\nWall move 003\nPlayer action 004\nActors move up right 005' });
  assert.deepEqual(movementSounds(data), [[], [
    { objects: ['crate'], layer: 1, movements: [Movement.Left, Movement.Right], seed: '001' },
    { objects: ['player'], layer: 1, movements: [Movement.Left, Movement.Right], seed: '001' },
    { objects: ['crate'], layer: 1, movements: [Movement.Left, Movement.Right], seed: '001' },
    { objects: ['player'], layer: 1, movements: [Movement.Action], seed: '004' },
    { objects: ['crate'], layer: 1, movements: [Movement.Up, Movement.Right], seed: '005' },
    { objects: ['player'], layer: 1, movements: [Movement.Up, Movement.Right], seed: '005' },
    { objects: ['crate'], layer: 1, movements: [Movement.Up, Movement.Right], seed: '005' },
  ], [{ objects: ['wall'], layer: 2, movements: [Movement.Up, Movement.Down, Movement.Left, Movement.Right], seed: '003' }]]);
  assert.deepEqual(data.failureSounds.map(sound => ({ objects: names(sound.objects), moves: [...sound.movements], seed: sound.seed })), [
    { objects: ['crate'], moves: [Movement.Up, Movement.Down], seed: '002' },
    { objects: ['player'], moves: [Movement.Up, Movement.Down], seed: '002' },
    { objects: ['crate'], moves: [Movement.Up, Movement.Down], seed: '002' },
  ]);
});

test('creation/destruction use source-ordered named objects while aggregate namespaces reject independently', () => {
  const { data, diagnostics } = compile({ legend: 'Things = Player or Crate\nCrate = Player\nPair = Player and Wall\nWall = Pair', layers: 'Background\nPlayer\nCrate\nWall',
    sounds: 'Things create 11\nThings destroy 12\nCrate create 13\nWall move 14\nPair destroy 15\nMissing create 16' });
  assert.deepEqual(data.sounds.creation.map(sound => [names(sound.objects), sound.seed]), [[['player', 'crate'], '11'], [['player'], '13']]);
  assert.deepEqual(data.sounds.destruction.map(sound => [names(sound.objects), sound.seed]), [[['player', 'crate'], '12']]);
  assert.equal(data.movementSounds.flat().length, 0);
  assert.equal(diagnostics.filter(item => item.code === 'aggregate-sound-target').length, 2);
  assert.ok(diagnostics.some(item => item.code === 'unknown-sound-target'));
});

test('incomplete accepted sound rows retain native compiler recovery while parser-rejected rows produce no sound', () => {
  const { data, diagnostics } = compile({ sounds: 'Player move\nCrate move up\nPlayer cantmove up down\nPlayer action\nPlayer create\nPlayer\nundo\nPlayer create up 3\nPlayer move 12 extra\nundo 12 extra\nPlayer nonsense 44' });
  assert.deepEqual(data.movementSounds[1].map(sound => [names(sound.objects), [...sound.movements], sound.seed]), [
    [['player'], [Movement.Up, Movement.Down, Movement.Left, Movement.Right], 'move'],
    [['crate'], [Movement.Up, Movement.Down, Movement.Left, Movement.Right], 'up'],
    [['player'], [Movement.Action], 'action'],
  ]);
  assert.deepEqual(data.failureSounds.map(sound => [[...sound.movements], sound.seed]), [[[Movement.Up], 'down']]);
  assert.deepEqual(data.sounds.creation.map(sound => [names(sound.objects), sound.seed]), [[['player'], 'create']]);
  assert.equal(data.sounds.simple.size, 0);
  assert.ok(diagnostics.some(item => item.code === 'missing-sound-seed'));
});

test('sound targets must have an accepted declaration at their authored source point', () => {
  for (const [earlier, sounds, later, expected] of [
    ['', 'Later move 123', 'Later = Player', []],
    ['Earlier = Player', 'Earlier move 123', 'Earlier = Crate', [[['crate'], '123']]],
  ]) {
    const { document } = readSource(`OBJECTS\n${defaultObjects}\nLEGEND\n${earlier}\nSOUNDS\n${sounds}\nLEGEND\n${later}\nCOLLISIONLAYERS\nBackground\nPlayer, Crate, Wall\nLEVELS\nP.`);
    const { declarations } = resolveDeclarations(document);
    const { data } = compileGameData(document, declarations);
    assert.deepEqual(data.movementSounds.flat().map(sound => [names(sound.objects), sound.seed]), expected);
  }
});

test('sound target names require Unicode word syntax while event prefixes keep native ASCII word boundaries', () => {
  const { data } = compile({ objects: defaultObjects.replace('Wall W', 'Wall W #'), legend: 'undoé = Player\nsfx10é = Player\nstartlevelΣ = Player\nundoA = Player\nundo_ = Player\n綠 = Player\né = Player',
    sounds: '. create 1\n# move 2\nundoé move 3\nsfx10é move 4\nstartlevelΣ move 5\nundoA move 6\nundo_ move 7\n綠 move 8\né move 9' });
  assert.deepEqual(data.movementSounds.flat().map(sound => [names(sound.objects), sound.seed]), [
    [['player'], '6'], [['player'], '7'], [['player'], '8'], [['player'], '9'],
  ]);
  assert.deepEqual(data.sounds.creation, []);
  assert.equal(data.sounds.simple.size, 0);
  assert.equal(data.sounds.sfx.size, 0);
});

test('restore policies explicitly describe old retained movement slots for each distinct grid size', () => {
  const objects = `${defaultObjects}\n\nFifth\nRed\n\nSixth\nBlue\n\nSeventh\nWhite\n\nEighth\nGreen`;
  const { data } = compile({ objects, layers: 'Background\nPlayer\nCrate\nWall\nFifth\nSixth\nSeventh\nEighth', levels: 'P\n\nmessage next\n\nPP\n\nP' });
  assert.deepEqual(data.restorePolicies.map(({ width, height }) => [width, height]), [[1, 1], [2, 1]]);
  assert.deepEqual(data.restorePolicies[0].retain.map(value => ({ ...value, movements: [...value.movements] })), [
    { position: { x: 0, y: 0 }, layer: 6, movements: [Movement.Left, Movement.Right, Movement.Action] },
    { position: { x: 0, y: 0 }, layer: 7, movements: [Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action] },
  ]);
  assert.deepEqual(data.restorePolicies[1].retain.map(value => [value.position, value.layer, [...value.movements]]),
    Array.from({ length: 8 }, (_, layer) => [{ x: 1, y: 0 }, layer, [Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action]]));
  const basic = compile().data.restorePolicies;
  assert.deepEqual(basic, [{ width: 2, height: 1, retain: [] }]);
});
