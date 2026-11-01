import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadPuzzleScript } from './native-host.cjs';
import { movementSource } from './scenarios.mjs';
import { createBoard } from '../build/board.js';
import { CommandKind } from '../build/commands.js';
import { Direction, Movement } from '../build/model.js';
import { createRandom, nextRandom } from '../build/random.js';
import { vanillaQuirks, noQuirks } from '../build/compatibility.js';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';
import { applyTurnRules, PlayerMatchKind } from '../build/turn-rules.js';
import { ObjectMatchKind, WinQuantifier } from '../build/win-conditions.js';
import { LevelKind, RunMode, ScreenKind, SimpleSound, SessionEffectKind, PersistenceKind } from '../build/session-model.js';
import { createSession, stepSession, undoSession, restartSession, advanceSession } from '../build/session.js';

const Player = Object.freeze({ name: 'Player' });
const Partner = Object.freeze({ name: 'Partner' });
const Crate = Object.freeze({ name: 'Crate' });
const Wall = Object.freeze({ name: 'Wall' });
const Marker = Object.freeze({ name: 'Marker' });
const Other = Object.freeze({ name: 'Other' });
const board = (...rows) => createBoard(rows.map(row => row.map(objects => new Set(objects))));
const grid = (value = board([[Player], [], []])) => ({ kind: LevelKind.Grid, board: value, sourceLine: 50 });
const message = text => ({ kind: LevelKind.Message, text, sourceLine: 60 });
const schedule = (rules = [], random = false) => ({ groups: rules.length ? [{ rules, random }] : [], loops: new Map() });
function pattern(objects = [], overrides = {}) {
  return { requiredObjects: new Set(objects), forbiddenObjects: new Set(), anyObjects: [],
    requiredMovements: [], forbiddenMovements: [], ...overrides };
}
function replacement(edits = {}) {
  return { edits: { removeObjects: new Set(), addObjects: new Set(), vacateLayers: new Set(), removeMovements: [],
    addMovements: [], resetMovementLayers: new Set(), randomObjects: [], randomDirectionLayers: new Set(), ...edits },
    rigidLayers: new Set() };
}
function rule(rows = [[pattern([Player])]], replacements = [[replacement()]], commands = [], overrides = {}) {
  return { direction: Direction.Right, rows, replacements, commands, sourceLine: 20, hasReplacements: true,
    rigidGroup: null, ...overrides };
}
const commandRule = (...commands) => rule(undefined, [], commands.map(kind => typeof kind === 'number' ? { kind } : kind), { hasReplacements: false });
function game(overrides = {}) {
  return { collisionLayers: [[Player, Crate, Wall], [Partner], [Marker, Other]], rigid: false,
    movementSounds: [[], [], []], failureSounds: [], rigidMerges: new Map(), player: { kind: PlayerMatchKind.Any, objects: new Set([Player]) },
    earlyRules: schedule(), lateRules: schedule(), levels: [grid()], winConditions: [],
    metadata: { requirePlayerMovement: false, runRulesOnLevelStart: false, noUndo: false, noRestart: false },
    sounds: { simple: new Map(Object.values(SimpleSound).filter(value => typeof value === 'number').map(value => [value, SimpleSound[value]])),
      sfx: new Map([[0, 'sfx0'], [3, 'sfx3']]), creation: [], destruction: [] }, ...overrides };
}
function environment(...seeds) {
  const calls = [];
  return { calls, nextLevelSeed() { const seed = seeds[calls.length] ?? `external ${calls.length}`; calls.push(seed); return seed; } };
}
function start(incoming = game(), options = {}, env = environment()) { return createSession(incoming, { seed: 'session tests', ...options }, env).state; }
const cell = (state, x = 0, y = 0) => state.execution.board.rows[y][x].objects;
const sounds = result => result.effects.filter(effect => effect.kind === SessionEffectKind.Sound).map(effect => effect.seed);
const hasCommand = (state, kind) => state.execution.commands.entries.some(entry => entry.command.kind === kind);
const persisted = result => result.effects.filter(effect => effect.kind === SessionEffectKind.Persistence);
const request = (x, layer, ...movements) => ({ position: { x, y: 0 }, layer, movements: new Set(movements) });

for (const [enumeration, names] of [[RunMode, ['Replay', 'Interactive']], [ScreenKind, ['Board', 'LevelMessage', 'TemporaryMessage', 'Title']],
  [LevelKind, ['Grid', 'Message']], [SimpleSound, ['TitleScreen', 'StartGame', 'EndGame', 'StartLevel', 'EndLevel', 'Undo', 'Restart', 'ShowMessage', 'CloseMessage', 'Cancel']]]) {
  test('session enums are numeric: ' + names.join(', '), () => { for (const name of names) assert.equal(typeof enumeration[name], 'number'); });
}

test('grid construction copies canonical objects, initializes viewport and asks only for a missing seed', () => {
  const incoming = game({ metadata: { ...game().metadata, flickscreen: { width: 2, height: 4 } } });
  const env = environment('first external');
  const explicit = createSession(incoming, { seed: 'initial seed' }, env);
  assert.equal(explicit.state.runMode, RunMode.Replay);
  assert.equal(explicit.state.loadedLevelSeed, 'initial seed');
  assert.deepEqual(explicit.state.execution.random, createRandom('initial seed'));
  assert.deepEqual(env.calls, []);
  assert.deepEqual(explicit.state.viewport, { left: 0, top: 0, right: 2, bottom: 1 });
  assert.equal(explicit.state.screen.kind, ScreenKind.Board);
  assert.deepEqual(explicit.state.history, []);
  assert.deepEqual(sounds(explicit), ['StartLevel']);
  assert.notEqual(explicit.state.execution.board, incoming.levels[0].board);
  assert.ok(cell(explicit.state).has(Player));
  assert.equal('random' in explicit.state.restartTarget, false);
  assert.notEqual(explicit.state.restartTarget.board, explicit.state.execution.board);
  const external = createSession(incoming, { seed: '' }, env);
  assert.equal(external.state.loadedLevelSeed, 'first external');
  assert.deepEqual(env.calls, ['first external']);
});

test('level-start rules run with suppressed wins after the original restart snapshot is captured', () => {
  const add = rule([[pattern([Player], { forbiddenObjects: new Set([Marker]) })]], [[replacement({ addObjects: new Set([Marker]) })]], [{ kind: CommandKind.Win }]);
  const incoming = game({ earlyRules: schedule([add]), metadata: { ...game().metadata, runRulesOnLevelStart: true } });
  const result = createSession(incoming, { seed: 'start rules' }, environment());
  assert.ok(cell(result.state).has(Marker));
  assert.ok(!result.state.restartTarget.board.rows[0][0].objects.has(Marker));
  assert.equal(result.state.levelStarting, false);
  assert.equal(result.state.winning, false);
  assert.equal(result.state.levelIndex, 0);
  assert.deepEqual(result.state.history, []);
  assert.deepEqual(result.effects.filter(effect => effect.kind === SessionEffectKind.Win).map(effect => effect.suppressed), [true]);
});

test('an initial message has its own screen, seeded empty execution and show-message sound', () => {
  const incoming = game({ levels: [message('Welcome'), grid()] });
  const result = createSession(incoming, {}, environment('message seed'));
  assert.deepEqual(result.state.screen, { kind: ScreenKind.LevelMessage, text: 'Welcome' });
  assert.equal(result.state.execution.board.width, 0);
  assert.equal(result.state.execution.commands.message, '');
  assert.deepEqual(sounds(result), ['ShowMessage']);
  assert.equal(result.state.loadedLevelSeed, 'message seed');
});


test('ordinary input pushes a crate, lets late rules observe the destination, and preserves the input snapshot', () => {
  const push = rule([[pattern([Player], { requiredMovements: [{ layer: 0, movement: Movement.Right }] }), pattern([Crate])]],
    [[replacement(), replacement({ addMovements: [{ layer: 0, movement: Movement.Right }] })]]);
  const mark = rule([[pattern([Crate])]], [[replacement({ addObjects: new Set([Marker]) })]]);
  const incoming = game({ levels: [grid(board([[Player], [Crate], []]))], earlyRules: schedule([push]), lateRules: schedule([mark]) });
  const before = start(incoming);
  const copy = structuredClone(before);
  const result = stepSession(incoming, before, Movement.Right, environment());
  assert.equal(result.modified, true);
  assert.deepEqual(cell(result.state), new Set());
  assert.deepEqual(cell(result.state, 1), new Set([Player]));
  assert.deepEqual(cell(result.state, 2), new Set([Crate, Marker]));
  assert.equal(result.state.history.length, 1);
  assert.deepEqual(undoSession(incoming, result.state).state.execution.board, before.execution.board);
  assert.deepEqual(before, copy);
});

test('object-neutral intent and sound commands return false while a changed null turn preserves the original undo boundary', () => {
  const incoming = game({ earlyRules: schedule([commandRule({ kind: CommandKind.Sound, index: 0 })]) });
  const before = start(incoming);
  const quiet = stepSession(incoming, before, Movement.Action, environment());
  assert.equal(quiet.modified, false);
  assert.deepEqual(quiet.state.history, []);
  assert.deepEqual(sounds(quiet), ['sfx0']);
  const moved = stepSession(incoming, before, Movement.Right, environment());
  const add = rule([[pattern([Player], { forbiddenObjects: new Set([Marker]) })]], [[replacement({ addObjects: new Set([Marker]) })]]);
  const followGame = { ...incoming, earlyRules: schedule([add]) };
  const follow = stepSession(followGame, moved.state, null, environment());
  assert.equal(follow.modified, true);
  assert.equal(follow.state.history.length, 1);
  assert.deepEqual(undoSession(followGame, follow.state).state.execution.board, before.execution.board);
  const noHistory = stepSession(followGame, before, null, environment());
  assert.deepEqual(noHistory.state.history, []);
});

test('aggregate player requirement needs a source cell with no player member; null turns bypass it', () => {
  const incoming = game({ collisionLayers: [[Player, Crate, Wall], [Partner, Other], [Marker]],
    player: { kind: PlayerMatchKind.All, objects: new Set([Player, Partner]) },
    levels: [grid(board([[Player, Partner], [Other], []]))],
    earlyRules: schedule([commandRule({ kind: CommandKind.Message, text: 'clear this' })]),
    metadata: { ...game().metadata, requirePlayerMovement: true } });
  const before = start(incoming, { runMode: RunMode.Interactive });
  const rejected = stepSession(incoming, before, Movement.Right, environment());
  assert.equal(rejected.modified, false);
  assert.deepEqual(rejected.state.execution.board, before.execution.board);
  assert.equal(rejected.state.execution.commands.message, '');
  assert.equal(rejected.state.screen.kind, ScreenKind.Board);
  assert.deepEqual(rejected.state.history, []);
  const allowed = stepSession(incoming, before, null, environment());
  assert.equal(allowed.state.screen.kind, ScreenKind.TemporaryMessage);
  const clear = { ...incoming, levels: [grid(board([[Player, Partner], [], []]))] };
  assert.equal(stepSession(clear, start(clear), Movement.Right, environment()).modified, true);
});

test('cancel returns whether extra commands exist, rolls back the board, and keeps an interactive message', () => {
  const incoming = game({ earlyRules: schedule([commandRule(CommandKind.Cancel, { kind: CommandKind.Sound, index: 3 },
    { kind: CommandKind.Message, text: 'cancelled message' })]),
    movementSounds: [[{ objects: new Set([Player]), layer: 0, movements: new Set([Movement.Right]), seed: 'ordinary move' }], [], []] });
  const before = start(incoming, { runMode: RunMode.Interactive });
  const result = stepSession(incoming, before, Movement.Right, environment());
  assert.equal(result.modified, true);
  assert.deepEqual(result.state.execution.board, before.execution.board);
  assert.deepEqual(sounds(result), ['sfx3', 'ShowMessage', 'Cancel']);
  assert.deepEqual(result.state.screen, { kind: ScreenKind.TemporaryMessage, text: 'cancelled message' });
  assert.equal(result.state.execution.commands.message, 'cancelled message');
  assert.deepEqual(result.state.history, []);
  const onlyCancel = { ...incoming, earlyRules: schedule([commandRule(CommandKind.Cancel)]) };
  assert.equal(stepSession(onlyCancel, before, Movement.Right, environment()).modified, false);
  const probe = stepSession(incoming, before, Movement.Right, environment(), { probe: true });
  assert.deepEqual(sounds(probe), ['Cancel']);
  assert.equal(probe.modified, true);
  assert.equal(probe.state.screen.kind, ScreenKind.Board);
});

test('ordinary sounds preserve failure, success, creation, destruction and output order including duplicate seeds', () => {
  const transform = rule([[pattern([Crate])]], [[replacement({ removeObjects: new Set([Crate]), addObjects: new Set([Wall]) })]],
    [{ kind: CommandKind.Sound, index: 0 }]);
  const incoming = game({ levels: [grid(board([[Player, Partner], [], [Crate]]))],
    player: { kind: PlayerMatchKind.Any, objects: new Set([Player]) }, earlyRules: schedule([transform]),
    movementSounds: [[{ objects: new Set([Player]), layer: 0, movements: new Set([Movement.Right]), seed: 'move' }], [], []],
    failureSounds: [{ objects: new Set([Partner]), layer: 1, movements: new Set([Movement.Up]), seed: 'failure' }],
    lateRules: schedule(),
    sounds: { ...game().sounds, creation: [{ objects: new Set([Wall]), seed: 'creation' }, { objects: new Set([Wall]), seed: 'creation' }],
      destruction: [{ objects: new Set([Crate]), seed: 'destruction' }] } });
  const before = start(incoming);
  // Carry a second independent request into this turn to exercise both movement sound lists.
  const withFailure = { ...before, execution: { ...before.execution, pendingMovements: [request(0, 1, Movement.Up)] } };
  const result = stepSession(incoming, withFailure, Movement.Right, environment());
  assert.deepEqual(sounds(result), ['failure', 'move', 'creation', 'creation', 'destruction', 'sfx0']);
});

test('undo skips duplicate boards on request, honours noUndo, and clears commands and rigid marks while keeping RNG and message', () => {
  const incoming = game();
  const original = start(incoming);
  const moved = stepSession(incoming, original, Movement.Right, environment()).state;
  const duplicate = { board: moved.execution.board, viewport: { left: 1, top: 0, right: 2, bottom: 1 } };
  const before = { ...moved, againing: true, history: [...moved.history, duplicate, duplicate],
    execution: { ...moved.execution, commands: { entries: [{ command: { kind: CommandKind.Win }, source: commandRule(CommandKind.Win) }], message: 'keep me' },
      pendingMovements: [request(1, 0, Movement.Down)], rigidMarks: [{ ...request(1, 0, Movement.Down), group: 3 }],
      random: nextRandom(moved.execution.random).state } };
  const blocked = { ...incoming, metadata: { ...incoming.metadata, noUndo: true } };
  assert.deepEqual(undoSession(blocked, before).state, before);
  const result = undoSession(blocked, before, { force: true, ignoreDuplicates: true });
  assert.deepEqual(result.state.execution.board, original.execution.board);
  assert.deepEqual(result.state.history, []);
  assert.equal(result.state.againing, false);
  assert.deepEqual(result.state.execution.pendingMovements, []);
  assert.deepEqual(result.state.execution.rigidMarks, []);
  assert.deepEqual(result.state.execution.commands.entries, []);
  assert.equal(result.state.execution.commands.message, 'keep me');
  assert.deepEqual(result.state.execution.random, before.execution.random);
  assert.deepEqual(sounds(result), []);
  assert.deepEqual(sounds(undoSession(incoming, moved)), ['Undo']);
});

test('explicit restore policy retains only declared movement values on a same-size restore', () => {
  const incoming = game({ restorePolicies: [{ width: 3, height: 1, retain: [request(2, 2, Movement.Up)] }] });
  const original = start(incoming);
  const moved = stepSession(incoming, original, Movement.Right, environment()).state;
  const before = { ...moved, execution: { ...moved.execution, pendingMovements: [request(2, 2, Movement.Up, Movement.Left), request(0, 0, Movement.Right)] } };
  assert.deepEqual(undoSession(incoming, before).state.execution.pendingMovements, [request(2, 2, Movement.Up)]);
  const changedShape = { ...before, history: [{ board: board([[Player], []]), viewport: null }] };
  assert.deepEqual(undoSession(incoming, changedShape).state.execution.pendingMovements, []);
});

test('checkpoint snapshots own viewport and restart preserves RNG, message and sound history without reseeding', () => {
  const checkpoint = rule([[pattern([Player], { forbiddenObjects: new Set([Marker]) })]], [[replacement({ addObjects: new Set([Marker]) })]], [{ kind: CommandKind.Checkpoint }]);
  const incoming = game({ earlyRules: schedule([checkpoint]) });
  const env = environment();
  const before = start(incoming);
  const saved = stepSession(incoming, { ...before, viewport: { left: 1, top: 0, right: 3, bottom: 1 } }, Movement.Right, env);
  assert.equal(saved.state.checkpointUsed, true);
  assert.equal(persisted(saved)[0].operation, PersistenceKind.Checkpoint);
  assert.notEqual(persisted(saved)[0].snapshot, saved.state.restartTarget);
  const moved = stepSession({ ...incoming, earlyRules: schedule() }, saved.state, Movement.Right, env).state;
  const withMessage = { ...moved, execution: { ...moved.execution, commands: { entries: [], message: 'preserved' }, random: nextRandom(moved.execution.random).state } };
  const result = restartSession(incoming, withMessage, env);
  assert.deepEqual(result.state.execution.board, saved.state.execution.board);
  assert.deepEqual(result.state.viewport, saved.state.viewport);
  assert.deepEqual(result.state.execution.random, withMessage.execution.random);
  assert.equal(result.state.execution.commands.message, 'preserved');
  assert.equal(result.state.checkpointUsed, true);
  assert.deepEqual(sounds(result), ['Restart']);
  assert.deepEqual(env.calls, []);
  assert.equal(result.state.history.length, withMessage.history.length + 1);
  assert.deepEqual(undoSession(incoming, result.state).state.execution.board, moved.execution.board);
});

test('speculative checkpoints leave restart state, checkpoint status and storage untouched', () => {
  const incoming = game({ earlyRules: schedule([commandRule(CommandKind.Checkpoint)]) });
  const before = start(incoming);
  const moved = stepSession(game(), before, Movement.Right, environment()).state;
  const result = stepSession(incoming, moved, null, environment(), { probe: true, suppressWin: true });
  assert.equal(result.modified, false);
  assert.deepEqual(result.state.restartTarget, before.restartTarget);
  assert.equal(result.state.checkpointUsed, false);
  assert.deepEqual(persisted(result), []);
});

test('restart honours noRestart, force and recursion guard; command restart returns actual post-restart difference', () => {
  const incoming = game();
  const before = start(incoming);
  const moved = stepSession(incoming, before, Movement.Right, environment()).state;
  const blocked = { ...incoming, metadata: { ...incoming.metadata, noRestart: true } };
  assert.deepEqual(restartSession(blocked, moved, environment()).state, moved);
  assert.deepEqual(restartSession(blocked, moved, environment(), true).state.execution.board, before.execution.board);
  assert.deepEqual(restartSession(incoming, { ...moved, restarting: true }, environment()).state.execution.board, moved.execution.board);
  const commandGame = { ...incoming, earlyRules: schedule([commandRule(CommandKind.Restart)]) };
  const command = stepSession(commandGame, before, Movement.Right, environment());
  assert.equal(command.modified, false);
  assert.deepEqual(command.state.execution.board, before.execution.board);
  assert.equal(command.state.history.length, 1);
  const recursive = { ...commandGame, metadata: { ...incoming.metadata, runRulesOnLevelStart: true } };
  const loaded = start(recursive);
  assert.equal(loaded.restarting, false);
  assert.equal(loaded.levelStarting, false);
  assert.ok(loaded.history.length > 0);
});

test('restart during AGAIN first skips duplicate history and undoes back to the input boundary', () => {
  const incoming = game();
  const original = start(incoming);
  const first = stepSession(incoming, original, Movement.Right, environment()).state;
  const second = stepSession(incoming, first, null, environment()).state;
  const pending = { ...second, againing: true, history: [...second.history, { board: second.execution.board, viewport: null }] };
  const result = restartSession(incoming, pending, environment());
  assert.deepEqual(result.state.execution.board, original.execution.board);
  assert.equal(result.state.history.length, 1);
  assert.deepEqual(result.state.history[0].board, original.execution.board);
  assert.deepEqual(sounds(result), ['Undo', 'Restart']);
});

const autoWalk = (commands = [CommandKind.Again]) => rule(undefined,
  [[replacement({ addMovements: [{ layer: 0, movement: Movement.Right }], resetMovementLayers: new Set([0]) })]],
  commands.map(kind => typeof kind === 'number' ? { kind } : kind));

test('AGAIN probes roll back only board work and callers explicitly take each following null turn', () => {
  const incoming = game({ earlyRules: schedule([autoWalk()]) });
  const original = start(incoming);
  const first = stepSession(incoming, original, Movement.Action, environment());
  assert.equal(first.modified, true);
  assert.deepEqual(cell(first.state, 1), new Set([Player]));
  assert.equal(first.state.againing, true);
  assert.equal(first.state.history.length, 1);
  const next = stepSession(incoming, first.state, null, environment());
  assert.deepEqual(cell(next.state, 2), new Set([Player]));
  assert.equal(next.state.againing, false);
  assert.equal(next.state.history.length, 1);
  assert.deepEqual(undoSession(incoming, next.state).state.execution.board, original.execution.board);
});

test('quiet random AGAIN probe consumes the stream, retains its execution events and restores outer message', () => {
  const outer = rule([[pattern([Player], { requiredMovements: [{ layer: 0, movement: Movement.Right }] })]], [[replacement()]],
    [{ kind: CommandKind.Again }, { kind: CommandKind.Message, text: 'outer message' }]);
  const randomMessage = commandRule({ kind: CommandKind.Message, text: 'probe message' });
  const incoming = game({ earlyRules: schedule([outer]), lateRules: schedule([randomMessage], true) });
  const before = start(incoming);
  const result = stepSession(incoming, before, Movement.Right, environment());
  assert.equal(result.state.againing, false);
  assert.equal(result.state.execution.commands.message, 'outer message');
  assert.deepEqual(result.state.execution.random, nextRandom(nextRandom(before.execution.random).state).state);
  assert.deepEqual(result.state.execution.commands.entries, []);
});

test('quiet AGAIN probes leave the committed checkpoint alone and cancelling probes emit their cancel sound', () => {
  const outer = rule([[pattern([Player], { requiredMovements: [{ layer: 0, movement: Movement.Right }] })]], [[replacement()]], [{ kind: CommandKind.Again }]);
  const quietCheckpoint = commandRule(CommandKind.Checkpoint);
  const incoming = game({ earlyRules: schedule([outer]), lateRules: schedule([quietCheckpoint]) });
  const saved = stepSession(incoming, start(incoming), Movement.Right, environment());
  assert.equal(saved.state.checkpointUsed, true);
  assert.equal(persisted(saved).length, 1);
  assert.equal(saved.state.againing, false);
  const cancelIfStationary = rule([[pattern([Player], { forbiddenMovements: [{ layer: 0, movement: Movement.Right }] })]], [],
    [{ kind: CommandKind.Cancel }, { kind: CommandKind.Sound, index: 0 }], { hasReplacements: false });
  const cancelling = { ...incoming, lateRules: schedule(), earlyRules: schedule([outer, cancelIfStationary]) };
  const result = stepSession(cancelling, start(cancelling), Movement.Right, environment());
  assert.equal(result.state.againing, true);
  assert.deepEqual(sounds(result), ['Cancel']);
  assert.ok(cell(result.state, 1).has(Player));
});

test('changed probes suppress ordinary sounds, return before wins/checkpoints, and queued restart or win alone reports true', () => {
  const incoming = game({ earlyRules: schedule([commandRule(CommandKind.Checkpoint, CommandKind.Win)]) });
  const before = start(incoming);
  const result = stepSession(incoming, before, Movement.Right, environment(), { probe: true, suppressWin: true });
  assert.equal(result.modified, true);
  assert.deepEqual(result.state.execution.board, before.execution.board);
  assert.deepEqual(result.effects, []);
  assert.equal(result.state.checkpointUsed, false);
  for (const kind of [CommandKind.Restart, CommandKind.Win]) {
    const quiet = { ...incoming, earlyRules: schedule([commandRule(kind)]) };
    const probed = stepSession(quiet, before, null, environment(), { probe: true });
    assert.equal(probed.modified, true);
    assert.equal(hasCommand(probed.state, kind), true);
    assert.deepEqual(probed.effects, []);
  }
});

const onTarget = { quantifier: WinQuantifier.All, subject: { kind: ObjectMatchKind.Any, objects: new Set([Player]) },
  target: { kind: ObjectMatchKind.Any, objects: new Set([Marker]) } };

test('Replay wins advance immediately with fresh level seeds but return only the original board modification', () => {
  const incoming = game({ levels: [grid(board([[Player], [Marker]])), grid(board([[], [], [Player]]))], winConditions: [onTarget] });
  const env = environment('next grid');
  const result = stepSession(incoming, start(incoming), Movement.Right, env);
  assert.equal(result.modified, true);
  assert.equal(result.state.levelIndex, 1);
  assert.equal(result.state.winning, false);
  assert.equal(result.state.loadedLevelSeed, 'next grid');
  assert.ok(cell(result.state, 2).has(Player));
  assert.deepEqual(result.state.history, []);
  assert.deepEqual(sounds(result), ['EndLevel', 'StartLevel']);
  assert.deepEqual(env.calls, ['next grid']);
  assert.equal(persisted(result).at(-1).operation, PersistenceKind.Progress);
  const queued = { ...incoming, earlyRules: schedule([commandRule(CommandKind.Win)]) };
  assert.equal(stepSession(queued, start(queued), null, environment()).modified, false);
});

test('Interactive wins wait for advance, clear AGAIN and refuse duplicate endlevel sounds', () => {
  const incoming = game({ levels: [grid(board([[Player], [Marker]])), message('Next')], winConditions: [onTarget] });
  const before = start(incoming, { runMode: RunMode.Interactive });
  const env = environment('message level');
  const result = stepSession(incoming, before, Movement.Right, env);
  assert.equal(result.state.levelIndex, 0);
  assert.equal(result.state.winning, true);
  assert.equal(result.state.againing, false);
  assert.deepEqual(sounds(result), ['EndLevel']);
  assert.deepEqual(env.calls, []);
  const repeated = stepSession(incoming, result.state, null, env);
  assert.deepEqual(sounds(repeated), []);
  const next = advanceSession(incoming, result.state, env);
  assert.equal(next.state.winning, false);
  assert.deepEqual(next.state.screen, { kind: ScreenKind.LevelMessage, text: 'Next' });
  assert.deepEqual(next.state.execution.board, result.state.execution.board);
  assert.deepEqual(next.state.history, result.state.history);
  assert.deepEqual(sounds(next), ['ShowMessage']);
  assert.deepEqual(env.calls, ['message level']);
});

test('Interactive temporary messages delay win checks until closed; Replay only retains text', () => {
  const incoming = game({ earlyRules: schedule([commandRule({ kind: CommandKind.Message, text: 'read this' }, CommandKind.Win)]) });
  const env = environment();
  const shown = stepSession(incoming, start(incoming, { runMode: RunMode.Interactive }), null, env);
  assert.equal(shown.state.screen.kind, ScreenKind.TemporaryMessage);
  assert.equal(shown.state.winning, false);
  assert.equal(shown.state.execution.commands.message, 'read this');
  const closed = advanceSession(incoming, shown.state, env);
  assert.equal(closed.state.screen.kind, ScreenKind.Board);
  assert.equal(closed.state.execution.commands.message, '');
  assert.equal(closed.state.winning, false, 'queued win was cleared at turn end');
  assert.deepEqual(sounds(closed), ['CloseMessage']);
  const predicate = { ...incoming, winConditions: [onTarget], levels: [grid(board([[Player, Marker]]))] };
  const delayed = stepSession(predicate, start(predicate, { runMode: RunMode.Interactive }), null, env);
  assert.equal(advanceSession(predicate, delayed.state, env).state.winning, true);
  const replay = stepSession(incoming, start(incoming), null, env);
  assert.equal(replay.state.screen.kind, ScreenKind.Title);
  assert.deepEqual(sounds(replay), ['EndLevel', 'EndGame']);
});

test('advancing level messages and final wins clears checkpoint progress and enters title, then starts a fresh new game', () => {
  const incoming = game({ levels: [message('First'), grid()], earlyRules: schedule([commandRule(CommandKind.Checkpoint)]) });
  const env = environment('grid seed', 'new message seed');
  const initial = start(incoming);
  const loaded = advanceSession(incoming, initial, env);
  assert.equal(loaded.state.levelIndex, 1);
  assert.equal(loaded.state.screen.kind, ScreenKind.Board);
  assert.deepEqual(sounds(loaded), ['StartLevel']);
  const saved = stepSession(incoming, loaded.state, null, env).state;
  const winGame = { ...incoming, earlyRules: schedule([commandRule(CommandKind.Win)]) };
  const title = stepSession(winGame, saved, null, env);
  assert.equal(title.state.screen.kind, ScreenKind.Title);
  assert.equal(title.state.levelIndex, 0);
  assert.equal(title.state.checkpointUsed, false);
  assert.equal(title.state.levelTarget, null);
  assert.equal(title.state.execution.commands.message, '');
  assert.deepEqual(sounds(title), ['EndLevel', 'EndGame']);
  assert.deepEqual(persisted(title).map(effect => effect.operation), [PersistenceKind.ClearProgress, PersistenceKind.Progress]);
  const fresh = advanceSession(incoming, title.state, env);
  assert.deepEqual(fresh.state.screen, { kind: ScreenKind.LevelMessage, text: 'First' });
  assert.deepEqual(sounds(fresh), ['StartGame', 'ShowMessage']);
  assert.equal(fresh.state.loadedLevelSeed, 'new message seed');
});

test('step clears AGAIN on every text/title early return and public operations own every mutable snapshot', () => {
  const incoming = game({ earlyRules: schedule([commandRule(CommandKind.Checkpoint)]) });
  const before = stepSession(incoming, start(incoming), Movement.Right, environment()).state;
  const copy = structuredClone(before);
  const first = stepSession(incoming, before, null, environment());
  const second = stepSession(incoming, before, null, environment());
  assert.deepEqual(first, second);
  assert.notEqual(first.state.execution.random.permutation, before.execution.random.permutation);
  assert.notEqual(first.state.restartTarget.board, before.restartTarget.board);
  assert.notEqual(first.state.history[0].board, before.history[0].board);
  assert.notEqual(first.state.history[0].board, second.state.history[0].board);
  first.state.history[0].board.rows[0][0].objects.clear();
  first.state.restartTarget.board.rows[0][1].objects.clear();
  first.state.execution.random.permutation.reverse();
  assert.deepEqual(before, copy);
  assert.ok(cell(second.state, 1).has(Player));
  assert.ok(second.state.history[0].board.rows[0][0].objects.has(Player));
  for (const screen of [{ kind: ScreenKind.Title }, { kind: ScreenKind.LevelMessage, text: 'x' }, { kind: ScreenKind.TemporaryMessage, text: 'x' }]) {
    const result = stepSession(incoming, { ...before, screen, againing: true }, Movement.Right, environment());
    assert.equal(result.modified, false);
    assert.equal(result.state.againing, false);
    assert.deepEqual(result.effects, []);
  }
});


test('a synchronous win loads a board but preserves the just-completed turn event and sound queues', () => {
  const transform = rule([[pattern([Player], { forbiddenObjects: new Set([Marker]) })]], [[replacement({ addObjects: new Set([Marker]) })]], [{ kind: CommandKind.Win }]);
  const incoming = game({ earlyRules: schedule([transform]), levels: [grid(), grid()] });
  const result = stepSession(incoming, start(incoming), Movement.Right, environment());
  assert.equal(result.state.levelIndex, 1);
  assert.deepEqual(result.state.execution.createdObjects, new Set([Marker]));
  assert.deepEqual(result.state.execution.destroyedObjects, new Set());
  assert.deepEqual(result.state.execution.commands.entries, []);
});


// This isolated test host runs the unchanged compiler and session, with audio captured
// at its output boundary. Domain fixtures above still construct the TS game independently.
loadPuzzleScript();
// Keep message completion on the original input path; these callbacks are host-only.
globalThis.HTMLCanvasElement = class {};
globalThis.document.addEventListener = () => {};
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = () => {};
vm.runInThisContext(readFileSync(new URL('./vanilla/js/inputoutput.js', import.meta.url), 'utf8'), { filename: 'unchanged-inputoutput.js' });
vm.runInThisContext('pollGamepads = () => {}; ULBS = () => {};');
function legacySession(source, inputs, interactive = false) {
  globalThis.__sessionSource = source;
  globalThis.__sessionInputs = inputs;
  globalThis.__sessionInteractive = interactive;
  return vm.runInThisContext(String.raw`(() => {
    unitTesting = !__sessionInteractive;
    lazyFunctionGeneration = false;
    seedsToPlay_CanMove = []; seedsToPlay_CantMove = []; messagetext = ''; hasUsedCheckpoint = false;
    const emitted = [];
    playSound = (seed, simple) => emitted.push([String(seed), simple === true]);
    compile(['loadLevel', 0], __sessionSource + '\n', 'session tests');
    const names = (dat, width, height) => {
      const rows = [];
      for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
          const tile = x * height + y;
          row.push(state.idDict.filter((name, id) => name !== 'background'
            && (dat[tile * STRIDE_OBJ + (id >>> 5)] & (1 << (id & 31))) !== 0).sort());
        }
        rows.push(row);
      }
      return rows;
    };
    const capture = modified => ({
      modified, board: names(level.objects, level.width, level.height),
      history: backups.map(entry => names(entry.dat, entry.width, entry.height)),
      restart: names(restartTarget.dat, restartTarget.width, restartTarget.height),
      message: messagetext, againing, winning, checkpointUsed: hasUsedCheckpoint,
      random: { i: RandomGen._state.i, j: RandomGen._state.j, permutation: [...RandomGen._state.s] },
      sounds: emitted.splice(0),
    });
    const frames = [capture(false)];
    for (const input of __sessionInputs) {
      let modified;
      if (input === 'undo') { DoUndo(false, true); modified = null; }
      else if (input === 'restart') { DoRestart(); modified = null; }
      else if (input === 'probe') modified = processInput(-1, true, true);
      else if (input === 'advance') {
        checkKey({ keyCode: 88 }, true);
        if (__sessionInteractive) { timer = 200; update(); }
        modified = null;
      }
      else modified = processInput(input === 'tick' ? -1 : input);
      frames.push(capture(modified));
    }
    return frames;
  })()`, { filename: 'isolated-legacy-session-fixture.js' });
}
function comparable(result, modified = result.modified) {
  const state = result.state;
  const names = board => board.rows.map(row => row.map(cell => [...cell.objects].map(object => object.name.toLowerCase()).sort()));
  return { modified, board: names(state.execution.board), history: state.history.map(entry => names(entry.board)),
    restart: names(state.restartTarget.board), message: state.execution.commands.message,
    againing: state.againing, winning: state.winning, checkpointUsed: state.checkpointUsed,
    random: { i: state.execution.random.i, j: state.execution.random.j, permutation: [...state.execution.random.permutation] },
    sounds: result.effects.filter(effect => effect.kind === SessionEffectKind.Sound).map(effect => [effect.seed, effect.simple]) };
}
function compareLegacySession(rules, incoming, inputs) {
  const source = movementSource({ rules, level: 'P..', sounds: 'cancel 700\nsfx0 100\nundo 300\nrestart 200' });
  const legacy = legacySession(source, inputs);
  const soundDeclarations = { ...incoming.sounds, simple: new Map([[SimpleSound.Cancel, '700'], [SimpleSound.Undo, '300'], [SimpleSound.Restart, '200']]),
    sfx: new Map([[0, '100']]) };
  const compiled = { ...incoming, sounds: soundDeclarations };
  let actual = createSession(compiled, { seed: 'session tests' }, environment());
  assert.deepEqual(comparable(actual), legacy[0], 'initial session');
  for (const [index, input] of inputs.entries()) {
    if (input === 'undo') actual = undoSession(compiled, actual.state, { ignoreDuplicates: true });
    else if (input === 'restart') actual = restartSession(compiled, actual.state, environment());
    else if (input === 'probe') actual = stepSession(compiled, actual.state, null, environment(), { probe: true, suppressWin: true });
    else actual = stepSession(compiled, actual.state, input === 'tick' ? null : [Movement.Up, Movement.Left, Movement.Down, Movement.Right, Movement.Action][input], environment());
    assert.deepEqual(comparable(actual, typeof input === 'string' && ['undo', 'restart'].includes(input) ? null : actual.modified), legacy[index + 1], `input ${index}: ${input}`);
  }
}

test('isolated JS agrees on cancel output, exact modification return and preserved random stream', () => {
  const cancelled = game({ earlyRules: schedule([commandRule(CommandKind.Cancel, { kind: CommandKind.Sound, index: 0 },
    { kind: CommandKind.Message, text: 'cancelled' })]) });
  compareLegacySession('[ Player ] -> cancel sfx0 message cancelled', cancelled, [3, 'probe', 'undo']);
});

test('isolated JS agrees on AGAIN board rollback, null undo boundary, restart and quiet probe checkpoints', () => {
  const walking = game({ earlyRules: schedule([autoWalk()]) });
  compareLegacySession('right [ Player ] -> [ > Player ] again', walking, [4, 'tick', 'undo', 'restart', 3]);
  const outer = rule([[pattern([Player], { requiredMovements: [{ layer: 0, movement: Movement.Right }] })]], [[replacement()]], [{ kind: CommandKind.Again }]);
  const checkpoint = game({ earlyRules: schedule([outer]), lateRules: schedule([commandRule(CommandKind.Checkpoint)]) });
  compareLegacySession('right [ > Player ] -> [ > Player ] again\nlate [ Player ] -> checkpoint', checkpoint, [3, 'tick', 'undo', 'restart']);
});

test('isolated JS agrees on random quiet probes consuming draws while restoring the outer message', () => {
  const outer = rule([[pattern([Player], { requiredMovements: [{ layer: 0, movement: Movement.Right }] })]], [[replacement()]],
    [{ kind: CommandKind.Again }, { kind: CommandKind.Message, text: 'outer' }]);
  const incoming = game({ earlyRules: schedule([outer]), lateRules: schedule([commandRule({ kind: CommandKind.Message, text: 'probe' })], true) });
  compareLegacySession('right [ > Player ] -> [ > Player ] again message outer\nlate random [ Player ] -> message probe', incoming, [3, 'tick', 'undo']);
});


test('legacy message input confirms Replay advances silently while Interactive plays CloseMessage', () => {
  const source = movementSource({ rules: '', level: 'message Welcome\n\nP..', sounds: 'showmessage 100\nclosemessage 200\nstartlevel 300' });
  for (const runMode of [RunMode.Replay, RunMode.Interactive]) {
    const legacy = legacySession(source, ['advance'], runMode === RunMode.Interactive);
    const incoming = game({ levels: [message('Welcome'), grid()], sounds: { ...game().sounds,
      simple: new Map([[SimpleSound.ShowMessage, '100'], [SimpleSound.CloseMessage, '200'], [SimpleSound.StartLevel, '300']]) } });
    const initial = createSession(incoming, { seed: 'session tests', runMode }, environment());
    const result = advanceSession(incoming, initial.state, environment());
    const emitted = result.effects.filter(effect => effect.kind === SessionEffectKind.Sound).map(effect => [effect.seed, effect.simple]);
    assert.deepEqual(emitted, legacy[1].sounds);
  }
});


// Reading the real rule schedule counts complete turn simulations, including probes.
function countedAgainGame(quirks = vanillaQuirks, random = false) {
  let simulations = 0;
  const earlyRules = schedule([autoWalk()]);
  const incoming = game({ quirks, levels: [grid(board(Array.from({ length: 102 }, (_, x) => x === 0 ? [Player] : [])))],
    lateRules: random ? schedule([commandRule({ kind: CommandKind.Sound, index: 0 })], true) : schedule() });
  Object.defineProperty(incoming, 'earlyRules', { configurable: true, get() { simulations++; return earlyRules; } });
  return { incoming, count: () => simulations };
}

for (const quirks of [vanillaQuirks, noQuirks]) {
  test(`AGAIN reuses deterministic preparation for 100 turns (${quirks === vanillaQuirks ? 'vanilla' : 'clean'})`, () => {
    const { incoming, count } = countedAgainGame(quirks);
    let state = start(incoming);
    for (let turn = 0; turn < 100; turn++) {
      const next = stepSession(incoming, state, turn === 0 ? Movement.Action : null, environment());
      assert.equal(next.modified, true);
      assert.equal(next.state.againing, true);
      assert.ok(cell(next.state, turn + 1).has(Player));
      state = next.state;
    }
    assert.equal(count(), 101);
  });
}

test('clean random AGAIN probes keep the stream private and commit the prepared draw once', () => {
  const { incoming, count } = countedAgainGame(noQuirks, true);
  let state = start(incoming);
  let expectedRandom = state.execution.random;
  for (let turn = 0; turn < 100; turn++) {
    const next = stepSession(incoming, state, turn === 0 ? Movement.Action : null, environment());
    expectedRandom = nextRandom(expectedRandom).state;
    assert.deepEqual(next.state.execution.random, expectedRandom);
    assert.deepEqual(sounds(next), ['sfx0']);
    assert.equal(next.state.againing, true);
    state = next.state;
  }
  assert.equal(count(), 101);
});

test('cached AGAIN results equal uncached immutable branches and can be committed repeatedly', () => {
  for (const quirks of [vanillaQuirks, noQuirks]) for (const random of [false, true]) {
    const { incoming } = countedAgainGame(quirks, random);
    let state = stepSession(incoming, start(incoming), Movement.Action, environment()).state;
    for (let turn = 0; turn < 5; turn++) {
      const original = structuredClone(state);
      const cached = stepSession(incoming, state, null, environment());
      const uncached = stepSession(incoming, { ...state }, null, environment());
      const repeated = stepSession(incoming, state, null, environment());
      assert.deepEqual(cached, uncached);
      assert.deepEqual(repeated, cached);
      assert.deepEqual(state, original);
      assert.notEqual(cached.state.execution.board, repeated.state.execution.board);
      assert.notEqual(cached.state.execution.random.permutation, repeated.state.execution.random.permutation);
      cell(cached.state, turn + 2).clear();
      cached.state.execution.random.permutation.reverse();
      assert.deepEqual(stepSession(incoming, state, null, environment()), uncached);
      state = uncached.state;
    }
  }
});

test('clean quiet and cancelling AGAIN probes keep checkpoint persistence and audio private', () => {
  const outer = rule([[pattern([Player], { requiredMovements: [{ layer: 0, movement: Movement.Right }] })]], [[replacement()]], [{ kind: CommandKind.Again }]);
  const checkpointGame = game({ quirks: noQuirks, earlyRules: schedule([outer]), lateRules: schedule([commandRule(CommandKind.Checkpoint)]) });
  const saved = stepSession(checkpointGame, start(checkpointGame), Movement.Right, environment());
  assert.equal(persisted(saved).length, 1);
  const cancelIfStationary = rule([[pattern([Player], { forbiddenMovements: [{ layer: 0, movement: Movement.Right }] })]], [],
    [{ kind: CommandKind.Cancel }, { kind: CommandKind.Sound, index: 0 }], { hasReplacements: false });
  const cancelGame = game({ quirks: noQuirks, earlyRules: schedule([outer, cancelIfStationary]) });
  const result = stepSession(cancelGame, start(cancelGame), Movement.Right, environment());
  assert.equal(result.state.againing, true);
  assert.deepEqual(sounds(result), []);
  const next = stepSession(cancelGame, result.state, null, environment());
  assert.deepEqual(sounds(next), ['sfx0', 'Cancel']);
});

for (const [name, mutate] of [
  ['board objects', state => cell(state, 5).add(Marker)],
  ['RNG permutation', state => { state.execution.random.permutation.reverse(); }],
  ['RNG i', state => { state.execution.random.i++; }],
  ['RNG j', state => { state.execution.random.j++; }],
  ['RNG seed', state => { state.execution.random.seed = 'different seed'; }],
  ['pending movements', state => { state.execution.pendingMovements.push(request(1, 0, Movement.Down)); }],
  ['rigid marks', state => { state.execution.rigidMarks.push({ ...request(1, 0, Movement.Down), group: null }); }],
  ['command message', state => { state.execution.commands.message = 'changed outside'; }],
]) {
  test('AGAIN validates exposed mutable execution input: ' + name, () => {
    const { incoming, count } = countedAgainGame(noQuirks, true);
    const state = stepSession(incoming, start(incoming), Movement.Action, environment()).state;
    mutate(state);
    const beforeCount = count();
    const actual = stepSession(incoming, state, null, environment());
    assert.equal(count() - beforeCount, 2);
    assert.deepEqual(actual, stepSession(incoming, { ...state }, null, environment()));
  });
}

for (const kind of [CommandKind.Sound, CommandKind.Message, CommandKind.Win, CommandKind.Checkpoint, CommandKind.Restart, CommandKind.Cancel]) {
  test(`clean prepared AGAIN defers command ${CommandKind[kind]} until the real turn`, () => {
    const command = kind === CommandKind.Sound ? { kind, index: 0 } : kind === CommandKind.Message ? { kind, text: 'prepared message' } : { kind };
    const onMarker = rule([[pattern([Player, Marker])]], [], kind === CommandKind.Cancel ? [command, { kind: CommandKind.Sound, index: 0 }] : [command], { hasReplacements: false });
    const incoming = game({ quirks: noQuirks, earlyRules: schedule([autoWalk()]), lateRules: schedule([onMarker]),
      levels: [grid(board([[Player], [], [Marker], []]))] });
    const first = stepSession(incoming, start(incoming, { runMode: RunMode.Interactive }), Movement.Action, environment());
    assert.equal(first.state.againing, true);
    assert.deepEqual(first.effects, []);
    assert.equal(first.state.checkpointUsed, false);
    assert.equal(first.state.winning, false);
    assert.equal(first.state.screen.kind, ScreenKind.Board);
    const next = stepSession(incoming, first.state, null, environment());
    assert.deepEqual(next, stepSession(incoming, { ...first.state }, null, environment()));
    if (kind === CommandKind.Sound) assert.deepEqual(sounds(next), ['sfx0']);
    if (kind === CommandKind.Message) assert.equal(next.state.screen.text, 'prepared message');
    if (kind === CommandKind.Win) assert.equal(next.state.winning, true);
    if (kind === CommandKind.Checkpoint) assert.equal(persisted(next).length, 1);
    if (kind === CommandKind.Restart) assert.ok(cell(next.state).has(Player));
    if (kind === CommandKind.Cancel) assert.ok(cell(next.state, 1).has(Player));
  });
}

test('clean no-op random AGAIN probes discard their draws, commands and execution events', () => {
  const outer = rule([[pattern([Player], { requiredMovements: [{ layer: 0, movement: Movement.Right }] })]], [[replacement()]],
    [{ kind: CommandKind.Again }, { kind: CommandKind.Message, text: 'outer message' }]);
  const incoming = game({ quirks: noQuirks, earlyRules: schedule([outer]),
    lateRules: schedule([commandRule({ kind: CommandKind.Message, text: 'probe message' })], true) });
  const before = start(incoming);
  const result = stepSession(incoming, before, Movement.Right, environment());
  assert.equal(result.state.againing, false);
  assert.deepEqual(result.state.execution.random, nextRandom(before.execution.random).state);
  assert.equal(result.state.execution.commands.message, 'outer message');
});

test('AGAIN preparation respects next input, game identity and public step options', () => {
  const { incoming, count } = countedAgainGame(noQuirks, true);
  const state = stepSession(incoming, start(incoming), Movement.Action, environment()).state;
  const nextGame = { ...incoming, lateRules: schedule() };
  assert.deepEqual(stepSession(nextGame, state, null, environment()), stepSession(nextGame, { ...state }, null, environment()));
  for (const input of [Movement.Action, Movement.Left, Movement.Right]) {
    assert.deepEqual(stepSession(incoming, state, input, environment()), stepSession(incoming, { ...state }, input, environment()));
  }
  for (const options of [{ probe: true }, { suppressWin: true }, { probe: true, suppressWin: true }]) {
    const beforeCount = count();
    const actual = stepSession(incoming, state, null, environment(), options);
    assert.equal(count() - beforeCount, options.probe ? 0 : 1);
    assert.deepEqual(actual, stepSession(incoming, { ...state }, null, environment(), options));
  }
});

test('undo, restart and advance do not carry a preparation into their new state', () => {
  const { incoming } = countedAgainGame(noQuirks, true);
  const state = stepSession(incoming, start(incoming), Movement.Action, environment()).state;
  for (const next of [undoSession(incoming, state).state, restartSession(incoming, state, environment()).state,
    advanceSession(incoming, state, environment()).state]) {
    assert.deepEqual(stepSession(incoming, next, null, environment()), stepSession(incoming, { ...next }, null, environment()));
  }
});

test('vanilla random probes fall back when their consumed stream differs from the prepared input', () => {
  const { incoming, count } = countedAgainGame(vanillaQuirks, true);
  let state = start(incoming);
  let random = state.execution.random;
  for (let turn = 0; turn < 100; turn++) {
    const next = stepSession(incoming, state, turn === 0 ? Movement.Action : null, environment());
    random = nextRandom(nextRandom(random).state).state;
    assert.deepEqual(next.state.execution.random, random);
    state = next.state;
  }
  assert.equal(count(), 200);
});

test('historical late-movement probes fall back when restore clears their pending requests', () => {
  const { incoming, count } = countedAgainGame({ ...vanillaQuirks, lateMovementsCarryOver: true });
  incoming.lateRules = schedule([autoWalk([])]);
  let state = start(incoming);
  for (let turn = 0; turn < 10; turn++) {
    state = stepSession(incoming, state, turn === 0 ? Movement.Action : null, environment()).state;
    assert.equal(state.againing, true);
    assert.deepEqual(state.execution.pendingMovements, []);
  }
  assert.equal(count(), 20);
});

test('clean probes publish diagnostics without exposing the private prepared diagnostic objects', () => {
  const { incoming, count } = countedAgainGame(noQuirks);
  const add = rule([[pattern([Player], { forbiddenObjects: new Set([Marker]) })]], [[replacement({ addObjects: new Set([Marker]) })]]);
  const remove = rule([[pattern([Player, Marker])]], [[replacement({ removeObjects: new Set([Marker]) })]]);
  incoming.lateRules = schedule([add, remove]);
  const first = stepSession(incoming, start(incoming), Movement.Action, environment());
  assert.equal(first.state.againing, true);
  assert.equal(first.effects.length, 2);
  assert.ok(first.effects.every(effect => effect.kind === SessionEffectKind.Diagnostic && effect.diagnostic.origin === 'rules'));
  first.effects[1].diagnostic.detail.sourceLine = 999;
  const beforeCount = count();
  const next = stepSession(incoming, first.state, null, environment());
  assert.equal(count() - beforeCount, 1);
  assert.deepEqual(next, stepSession(incoming, { ...first.state }, null, environment()));
  assert.ok(next.effects.every(effect => effect.diagnostic.detail.sourceLine === add.sourceLine));
});


test('source-compiled random AGAIN chains cache with only the probe side-effect quirk disabled', () => {
  const source = movementSource({ rules: 'right [ Player ] -> [ > Player ] again\nlate random [ Player ] -> sfx0',
    sounds: 'sfx0 123', level: 'P' + '.'.repeat(101) });
  const compiled = compileSource(source, { quirks: { ...vanillaQuirks, againProbeHasSideEffects: false } });
  assert.equal(compiled.outcome.kind, SourceCompilationKind.Accepted);
  const incoming = compiled.outcome.game;
  const earlyRules = incoming.earlyRules;
  let simulations = 0;
  Object.defineProperty(incoming, 'earlyRules', { configurable: true, get() { simulations++; return earlyRules; } });
  let state = start(incoming);
  let random = state.execution.random;
  for (let turn = 0; turn < 100; turn++) {
    const next = stepSession(incoming, state, turn === 0 ? Movement.Action : null, environment());
    random = nextRandom(random).state;
    assert.deepEqual(next.state.execution.random, random);
    assert.deepEqual(sounds(next), ['123']);
    assert.equal(next.state.againing, true);
    state = next.state;
  }
  assert.equal(simulations, 101);
});

test('clean probes share owned history until replacing it, without copying every old snapshot twice', () => {
  const { incoming } = countedAgainGame(noQuirks);
  const original = start(incoming);
  let historyCopies = 0;
  class History extends Array {
    map(callback) { historyCopies++; return super.map(callback); }
  }
  const history = new History(...Array.from({ length: 100 }, () => ({ board: original.execution.board, viewport: null })));
  const before = { ...original, history };
  const next = stepSession(incoming, before, null, environment());
  assert.equal(historyCopies, 1);
  assert.equal(next.state.history.length, 100);
  assert.equal(before.history.length, 100);
  cell(next.state, 1).clear();
  next.state.history[0].board.rows[0][0].objects.clear();
  assert.ok(cell(before).has(Player));
});

test('AGAIN rejects changed board Set order even when its object membership is unchanged', () => {
  const { incoming, count } = countedAgainGame(noQuirks);
  incoming.levels = [grid(board(Array.from({ length: 102 }, (_, x) => x === 0 ? [Player, Marker] : [Marker])))];
  const first = stepSession(incoming, start(incoming), Movement.Action, environment()).state;
  const objects = cell(first, 1);
  objects.delete(Marker);
  objects.add(Marker);
  const beforeCount = count();
  const next = stepSession(incoming, first, null, environment());
  assert.equal(count() - beforeCount, 2);
  assert.deepEqual(next, stepSession(incoming, { ...first }, null, environment()));
});


test('prepared AGAIN reuses completed rigid retries and their final failure sounds', () => {
  const { incoming } = countedAgainGame(noQuirks);
  incoming.rigid = true;
  const blocked = rule(undefined, [[{ ...replacement({ resetMovementLayers: new Set([0]),
    addMovements: [{ layer: 0, movement: Movement.Up }] }), rigidLayers: new Set([0]) }]], [], { rigidGroup: 1 });
  const earlyRules = { groups: [{ rules: [autoWalk()], random: false }, { rules: [blocked], random: false }], loops: new Map() };
  let simulations = 0;
  Object.defineProperty(incoming, 'earlyRules', { configurable: true, get() { simulations++; return earlyRules; } });
  incoming.failureSounds = [{ objects: new Set([Player]), layer: 0, movements: new Set([Movement.Up]), seed: 'blocked rigid move' }];
  const before = start(incoming);
  const proof = applyTurnRules(incoming, before.execution, null);
  assert.equal(proof.rigidRetries, 1);
  const first = stepSession(incoming, before, Movement.Action, environment());
  assert.equal(first.state.againing, true);
  assert.deepEqual(sounds(first), ['blocked rigid move']);
  const beforeCount = simulations;
  const next = stepSession(incoming, first.state, null, environment());
  assert.equal(simulations - beforeCount, 2); // Only the next probe's two rigid attempts.
  assert.deepEqual(next, stepSession(incoming, { ...first.state }, null, environment()));
  assert.deepEqual(sounds(next), ['blocked rigid move']);
  assert.deepEqual(next.state.execution.bannedGroups, new Set([1]));
});

test('prepared AGAIN checkpoints the current viewport and preserves amended history', () => {
  const { incoming, count } = countedAgainGame(noQuirks);
  incoming.earlyRules.groups[0].rules[0] = autoWalk([CommandKind.Again, CommandKind.Checkpoint]);
  const pending = stepSession(incoming, start(incoming), Movement.Action, environment()).state;
  pending.viewport = { left: 1, top: 0, right: 4, bottom: 1 };
  pending.history = [...pending.history, { board: pending.execution.board, viewport: null }];
  const history = structuredClone(pending.history);
  const beforeCount = count();
  const result = stepSession(incoming, pending, null, environment());
  assert.equal(count() - beforeCount, 1, 'Only the following lookahead calculates again');
  assert.ok(cell(result.state, 2).has(Player));
  assert.deepEqual(result.state.history, history);
  assert.deepEqual(result.state.restartTarget.viewport, pending.viewport);
  assert.equal(persisted(result).length, 1);
  assert.deepEqual(persisted(result)[0].snapshot.viewport, pending.viewport);
  assert.notEqual(persisted(result)[0].snapshot.viewport, pending.viewport);
  assert.deepEqual(pending.history, history);
  assert.deepEqual(result, stepSession(incoming, { ...pending }, null, environment()));
});

test('prepared AGAIN executes restart against the current restart target', () => {
  const onMarker = rule([[pattern([Player, Marker])]], [], [{ kind: CommandKind.Restart }], { hasReplacements: false });
  const incoming = game({ quirks: noQuirks, earlyRules: schedule([autoWalk()]), lateRules: schedule([onMarker]),
    levels: [grid(board([[Player], [], [Marker], []]))] });
  const early = incoming.earlyRules;
  let simulations = 0;
  Object.defineProperty(incoming, 'earlyRules', { get() { simulations++; return early; } });
  const pending = stepSession(incoming, start(incoming), Movement.Action, environment()).state;
  assert.equal(pending.againing, true);
  pending.restartTarget = { board: board([[], [], [Marker], [Player]]), viewport: null };
  const beforeCount = simulations;
  const result = stepSession(incoming, pending, null, environment());
  assert.equal(simulations - beforeCount, 0, 'Commit the existing calculation without rerunning its rules');
  assert.ok(cell(result.state, 3).has(Player));
  assert.deepEqual(sounds(result), ['Restart']);
  assert.equal(result.modified, true);
  assert.equal(result.state.againing, false);
  assert.equal(result.state.history.length, 2);
  assert.ok(result.state.history[1].board.rows[0][1].objects.has(Player));
  assert.deepEqual(result, stepSession(incoming, { ...pending }, null, environment()));
});

for (const runMode of [RunMode.Replay, RunMode.Interactive]) for (const suppressWin of [false, true]) {
  test(`prepared AGAIN reads current win context: ${RunMode[runMode]}, suppress=${suppressWin}`, () => {
    const incoming = game({ quirks: noQuirks, earlyRules: schedule([autoWalk()]), winConditions: [onTarget],
      levels: [grid(board([[Player], [], [Marker], []])), grid()] });
    const early = incoming.earlyRules;
    let simulations = 0;
    Object.defineProperty(incoming, 'earlyRules', { get() { simulations++; return early; } });
    const pending = stepSession(incoming, start(incoming), Movement.Action, environment()).state;
    assert.equal(pending.againing, true);
    pending.runMode = runMode;
    const env = environment('next level');
    const beforeCount = simulations;
    const result = stepSession(incoming, pending, null, env, { suppressWin });
    assert.equal(simulations - beforeCount, suppressWin ? 1 : 0);
    const advances = !suppressWin && runMode === RunMode.Replay;
    assert.deepEqual(env.calls, advances ? ['next level'] : []);
    assert.equal(result.state.levelIndex, advances ? 1 : 0);
    assert.equal(result.state.winning, !suppressWin && runMode === RunMode.Interactive);
    assert.equal(result.state.againing, suppressWin);
    assert.deepEqual(result.effects.filter(effect => effect.kind === SessionEffectKind.Win),
      [{ kind: SessionEffectKind.Win, levelIndex: 0, suppressed: suppressWin }]);
    assert.deepEqual(result, stepSession(incoming, { ...pending }, null, environment('next level'), { suppressWin }));
  });
}

test('a public non-null probe enforces required player movement before its commands', () => {
  const incoming = game({ levels: [grid(board([[Player], [Wall]]))],
    metadata: { ...game().metadata, requirePlayerMovement: true },
    earlyRules: schedule([commandRule(CommandKind.Checkpoint)]) });
  const before = start(incoming);
  before.execution.commands.message = 'previous message';
  const result = stepSession(incoming, before, Movement.Right, environment(), { probe: true });
  assert.equal(result.modified, false);
  assert.deepEqual(result.state.execution.board, before.execution.board);
  assert.deepEqual(result.state.execution.random, before.execution.random);
  assert.deepEqual(result.state.history, []);
  assert.equal(result.state.execution.commands.message, '');
  assert.equal(result.state.screen.kind, ScreenKind.Board);
  assert.equal(result.state.checkpointUsed, false);
  assert.deepEqual(result.effects, []);
});

for (const suppressWin of [false, true]) {
  test(`a quiet public probe retains natural victory handling, suppress=${suppressWin}`, () => {
    const incoming = game({ levels: [grid(board([[Player, Marker]])), grid()], winConditions: [onTarget],
      earlyRules: schedule([commandRule(CommandKind.Checkpoint)]) });
    const env = environment('probe victory');
    const result = stepSession(incoming, start(incoming), null, env, { probe: true, suppressWin });
    assert.equal(result.modified, false);
    assert.equal(result.state.levelIndex, suppressWin ? 0 : 1);
    assert.deepEqual(env.calls, suppressWin ? [] : ['probe victory']);
    assert.equal(result.state.checkpointUsed, false);
    assert.deepEqual(persisted(result).map(effect => effect.operation), suppressWin ? [] : [PersistenceKind.Progress]);
    assert.deepEqual(result.effects.filter(effect => effect.kind === SessionEffectKind.Win),
      [{ kind: SessionEffectKind.Win, levelIndex: 0, suppressed: suppressWin }]);
  });
}

for (const probe of [false, true]) {
  test(`cancel takes priority over simultaneous restart, probe=${probe}`, () => {
    const incoming = game({ earlyRules: schedule([commandRule(CommandKind.Cancel, CommandKind.Restart,
      { kind: CommandKind.Sound, index: 0 }, { kind: CommandKind.Message, text: 'both' })]) });
    const before = start(incoming, { runMode: RunMode.Interactive });
    const result = stepSession(incoming, before, Movement.Right, environment(), { probe });
    assert.equal(result.modified, true);
    assert.deepEqual(result.state.execution.board, before.execution.board);
    assert.deepEqual(result.state.history, []);
    assert.equal(result.state.execution.commands.message, 'both');
    assert.deepEqual(sounds(result), probe ? ['Cancel'] : ['sfx0', 'ShowMessage', 'Cancel']);
    assert.deepEqual(result.state.screen, probe ? { kind: ScreenKind.Board }
      : { kind: ScreenKind.TemporaryMessage, text: 'both' });
  });
}
