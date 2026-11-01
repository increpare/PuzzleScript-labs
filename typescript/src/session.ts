import { cloneBoard, createBoard } from './board.js';
import { CommandKind } from './commands.js';
import * as vanilla from './compatibility.js';
import type { RuleExecutionState } from './execution-model.js';
import { TurnInput, type Board, type Movement } from './model.js';
import { createRandom } from './random.js';
import { cloneExecutionState } from './rules.js';
import {
  LevelKind, PersistenceKind, RunMode, ScreenKind, SessionDiagnosticKind, SessionEffectKind, SimpleSound,
  type BoardSnapshot, type CreateSessionOptions, type SessionEffect, type SessionEnvironment,
  type SessionGame, type SessionResult, type SessionState, type StepSessionOptions, type UndoSessionOptions, type Viewport,
} from './session-model.js';
import { calculateTurn, type CalculatedTurn } from './turn-rules.js';
import { movementInput } from './turn-input.js';
import { copyCalculatedTurn, pendingAgainTurn, retainAgainTurn, reusableAgainTurn,
  type PreparedAgainTurn } from './prepared-again.js';
import { hasWon } from './win-conditions.js';

enum WinHandling { Apply, ReportOnly }
enum AgainDecision { Stop, Schedule }

type WorkingState = { -readonly [Key in keyof SessionState]: SessionState[Key] };
/** Only this local machine changes during a public operation, including nested probes. */
interface Machine {
  readonly game: SessionGame;
  readonly environment: SessionEnvironment;
  readonly effects: SessionEffect[];
  readonly state: WorkingState;
  preparedAgain: PreparedAgainTurn | undefined;
}

function copyViewport(viewport: Viewport | null): Viewport | null {
  return viewport === null ? null : { ...viewport };
}
function copySnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return { board: cloneBoard(snapshot.board), viewport: copyViewport(snapshot.viewport) };
}
function snapshot(state: SessionState): BoardSnapshot {
  return { board: cloneBoard(state.execution.board), viewport: copyViewport(state.viewport) };
}
function copyState(before: SessionState): WorkingState {
  return {
    ...before, execution: cloneExecutionState(before.execution),
    levelTarget: before.levelTarget === null ? null : copySnapshot(before.levelTarget),
    restartTarget: copySnapshot(before.restartTarget), history: before.history.map(copySnapshot),
    viewport: copyViewport(before.viewport), screen: { ...before.screen },
  };
}
function machine(game: SessionGame, before: SessionState, environment: SessionEnvironment): Machine {
  return { game, state: copyState(before), environment, effects: [], preparedAgain: undefined };
}
/** The outer operation already owns these containers. Probe helpers replace state
 * properties and copy snapshots/history before writes; this machine never escapes. */
function probeMachine(work: Machine): Machine {
  return { ...work, state: { ...work.state }, effects: [], preparedAgain: undefined };
}
function result(work: Machine, modified: boolean): SessionResult {
  retainAgainTurn(work.state, work.preparedAgain);
  return { state: work.state, modified, effects: work.effects };
}
function sameBoard(left: Board, right: Board): boolean {
  if (left.width !== right.width || left.height !== right.height) return false;
  for (let y = 0; y < left.height; y++) {
    for (let x = 0; x < left.width; x++) {
      const a = left.rows[y]![x]!.objects;
      const b = right.rows[y]![x]!.objects;
      if (a.size !== b.size) return false;
      for (const object of a) if (!b.has(object)) return false;
    }
  }
  return true;
}
function sound(work: Machine, seed: string | undefined, simple: boolean): void {
  if (seed !== undefined) work.effects.push({ kind: SessionEffectKind.Sound, seed, simple });
}
function simpleSound(work: Machine, event: SimpleSound): void {
  sound(work, work.game.sounds.simple.get(event), true);
}
function clearCommands(work: Machine): void {
  const execution = work.state.execution;
  work.state.execution = { ...execution, commands: { entries: [], message: execution.commands.message } };
}
function setMessage(work: Machine, message: string): void {
  const execution = work.state.execution;
  work.state.execution = { ...execution, commands: { ...execution.commands, message } };
}
function queued(work: Machine, kind: CommandKind): boolean {
  return work.state.execution.commands.entries.some(entry => entry.command.kind === kind);
}
function addHistory(work: Machine, before: BoardSnapshot): void {
  work.state.history = [...work.state.history, copySnapshot(before)];
}

/** Restore the board, reset turn bookkeeping and apply the explicit vanilla exception. */
function restore(work: Machine, target: BoardSnapshot): void {
  const current = work.state.execution;
  const pendingMovements = vanilla.quirksOf(work.game).restoreKeepsMovements ? vanilla.movementsSurvivingRestore(
    current.board, target.board, current.pendingMovements, work.game.restorePolicies ?? [],
  ) : [];
  work.state.viewport = copyViewport(target.viewport);
  work.state.execution = {
    ...current, board: cloneBoard(target.board), pendingMovements, rigidMarks: [],
    commands: { entries: [], message: current.commands.message },
  };
  work.state.againing = false;
}
function undo(work: Machine, options: UndoSessionOptions): boolean {
  if (work.game.metadata.noUndo && options.force !== true) return false;
  let history = [...work.state.history];
  if (options.ignoreDuplicates === true) {
    while (history.length > 0 && sameBoard(work.state.execution.board, history[history.length - 1]!.board)) history.pop();
  }
  const target = history.pop();
  work.state.history = history;
  if (target === undefined) return false;
  restore(work, target);
  if (options.force !== true) simpleSound(work, SimpleSound.Undo);
  return true;
}
function restart(work: Machine, force: boolean): boolean {
  if (work.state.restarting || (work.game.metadata.noRestart && !force)) return false;
  if (work.state.againing) undo(work, { force, ignoreDuplicates: true });
  work.state.restarting = true;
  if (!force) addHistory(work, snapshot(work.state));
  restore(work, work.state.restartTarget);
  simpleSound(work, SimpleSound.Restart);
  if (work.game.metadata.runRulesOnLevelStart) step(work, TurnInput.None, WinHandling.ReportOnly);
  clearCommands(work);
  work.state.restarting = false;
  return true;
}
function outputCommands(work: Machine): void {
  for (const entry of work.state.execution.commands.entries) {
    const command = entry.command;
    if (command.kind === CommandKind.Sound) sound(work, work.game.sounds.sfx.get(command.index), true);
    if (command.kind === CommandKind.Message && work.state.runMode === RunMode.Interactive) {
      work.state.screen = { kind: ScreenKind.TemporaryMessage, text: work.state.execution.commands.message };
      simpleSound(work, SimpleSound.ShowMessage);
    }
  }
}
function ordinarySounds(work: Machine): void {
  const execution = work.state.execution;
  for (const seed of execution.cantMoveSounds) sound(work, seed, false);
  for (const seed of execution.canMoveSounds) sound(work, seed, false);
  for (const declaration of work.game.sounds.creation) {
    if ([...declaration.objects].some(object => execution.createdObjects.has(object))) sound(work, declaration.seed, false);
  }
  for (const declaration of work.game.sounds.destruction) {
    if ([...declaration.objects].some(object => execution.destroyedObjects.has(object))) sound(work, declaration.seed, false);
  }
}
function initializeViewport(work: Machine, board: Board): void {
  const size = work.game.metadata.flickscreen ?? work.game.metadata.zoomscreen;
  if (size !== undefined) {
    work.state.viewport = { left: 0, top: 0, right: Math.min(size.width, board.width), bottom: Math.min(size.height, board.height) };
  }
}
function emptyExecution(board: Board, seed: string): RuleExecutionState {
  return {
    board: cloneBoard(board), random: createRandom(seed), pendingMovements: [], rigidMarks: [], bannedGroups: new Set(),
    canMoveSounds: [], cantMoveSounds: [], commands: { entries: [], message: '' }, createdObjects: new Set(), destroyedObjects: new Set(),
  };
}
function load(work: Machine, levelIndex: number, seed?: string): void {
  const level = work.game.levels[levelIndex];
  if (level?.kind === LevelKind.Grid) simpleSound(work, SimpleSound.StartLevel);
  const actualSeed = seed || work.environment.nextLevelSeed();
  work.state.loadedLevelSeed = actualSeed;
  work.state.execution = { ...work.state.execution, random: createRandom(actualSeed) };
  work.state.levelIndex = levelIndex;
  work.state.levelTarget = null;
  work.state.againing = false;
  if (level === undefined) {
    work.effects.push({ kind: SessionEffectKind.Diagnostic, diagnostic: { origin: 'session', kind: SessionDiagnosticKind.MissingLevel } });
    work.state.screen = { kind: ScreenKind.Title };
    setMessage(work, '');
    return;
  }
  if (level.kind === LevelKind.Message) {
    work.state.screen = { kind: ScreenKind.LevelMessage, text: level.text };
    simpleSound(work, SimpleSound.ShowMessage);
    return;
  }
  work.state.screen = { kind: ScreenKind.Board };
  const execution = work.state.execution;
  work.state.execution = { ...execution, board: cloneBoard(level.board), pendingMovements: [], rigidMarks: [],
    commands: { entries: [], message: execution.commands.message } };
  initializeViewport(work, level.board);
  work.state.history = [];
  work.state.restartTarget = snapshot(work.state);
  if (work.game.metadata.runRulesOnLevelStart) {
    work.state.levelStarting = true;
    step(work, TurnInput.None, WinHandling.ReportOnly);
    work.state.levelStarting = false;
  }
}
function progress(work: Machine): void {
  work.effects.push({ kind: SessionEffectKind.Persistence, operation: PersistenceKind.Progress, levelIndex: work.state.levelIndex });
}
function nextLevel(work: Machine): void {
  work.state.againing = false;
  setMessage(work, '');
  if (work.state.screen.kind === ScreenKind.Title) {
    work.state.levelIndex = 0;
    work.state.levelTarget = null;
    load(work, 0);
  } else {
    work.state.checkpointUsed = false;
    work.state.levelTarget = null;
    if (work.state.levelIndex < work.game.levels.length - 1) {
      load(work, work.state.levelIndex + 1);
    } else {
      work.effects.push({ kind: SessionEffectKind.Persistence, operation: PersistenceKind.ClearProgress, levelIndex: work.state.levelIndex });
      work.state.levelIndex = 0;
      work.state.screen = { kind: ScreenKind.Title };
      simpleSound(work, SimpleSound.EndGame);
    }
  }
  progress(work);
  // The legacy transition resets flickscreen after loading, including after start rules.
  if (work.game.metadata.flickscreen !== undefined) initializeViewport(work, work.state.execution.board);
}
function checkWin(work: Machine, handling: WinHandling): void {
  if (!queued(work, CommandKind.Win) && !hasWon(work.state.execution.board, work.game.winConditions)) return;
  const suppress = handling === WinHandling.ReportOnly;
  work.effects.push({ kind: SessionEffectKind.Win, levelIndex: work.state.levelIndex, suppressed: suppress });
  if (suppress || work.state.winning) return;
  work.state.againing = false;
  simpleSound(work, SimpleSound.EndLevel);
  if (work.state.runMode === RunMode.Replay) nextLevel(work);
  else work.state.winning = true;
}
function checkpoint(work: Machine): void {
  work.state.restartTarget = snapshot(work.state);
  work.state.checkpointUsed = true;
  work.effects.push({ kind: SessionEffectKind.Persistence, operation: PersistenceKind.Checkpoint,
    levelIndex: work.state.levelIndex, snapshot: copySnapshot(work.state.restartTarget) });
}
/** Choose complete rules/movement work; the incoming execution is still intact. */
function beginTurn(work: Machine, input: TurnInput): CalculatedTurn | undefined {
  const prepared = work.preparedAgain;
  work.preparedAgain = undefined;
  work.state.againing = false;
  if (work.state.screen.kind !== ScreenKind.Board) return undefined;
  return reusableAgainTurn(work.game, work.state.execution, input, prepared)
    ?? calculateTurn(work.game, work.state.execution, input);
}

/** Save the current board, then install the calculation and report diagnostics. */
function installCalculation(work: Machine, turn: CalculatedTurn): BoardSnapshot {
  const before = snapshot(work.state);
  work.state.execution = turn.state;
  for (const detail of turn.diagnostics) {
    work.effects.push({ kind: SessionEffectKind.Diagnostic, diagnostic: { origin: 'rules', detail } });
  }
  if (turn.rigidLimitReached) {
    work.effects.push({ kind: SessionEffectKind.Diagnostic, diagnostic: { origin: 'session', kind: SessionDiagnosticKind.RigidIterationLimit } });
  }
  return before;
}

/** Both real turns and public probes enforce this before handling commands. */
function cancelUnmovedPlayer(work: Machine, before: BoardSnapshot, turn: CalculatedTurn): boolean {
  if (work.game.metadata.requirePlayerMovement && turn.playerPositions.length > 0) {
    const moved = turn.playerPositions.some(position => {
      const objects = work.state.execution.board.rows[position.y]![position.x]!.objects;
      return ![...work.game.player.objects].some(object => objects.has(object));
    });
    if (!moved) {
      addHistory(work, before);
      undo(work, { force: true });
      setMessage(work, '');
      work.state.screen = { kind: ScreenKind.Board };
      return true;
    }
  }
  return false;
}

function cancelTurn(work: Machine, before: BoardSnapshot): boolean {
  const commandsLeft = work.state.execution.commands.entries.length > 1;
  addHistory(work, before);
  undo(work, { force: true });
  simpleSound(work, SimpleSound.Cancel);
  return commandsLeft;
}

/** Apply actual session consequences, in source-observable command order. */
function finishTurn(work: Machine, before: BoardSnapshot, turn: CalculatedTurn, wins: WinHandling): boolean {
  if (cancelUnmovedPlayer(work, before, turn)) return false;
  if (queued(work, CommandKind.Cancel)) {
    outputCommands(work);
    return cancelTurn(work, before);
  }
  if (queued(work, CommandKind.Restart)) {
    outputCommands(work);
    addHistory(work, before);
    restart(work, true);
  }
  const modified = !sameBoard(work.state.execution.board, before.board);
  // Automatic turns leave history at the original input boundary.
  if (modified && turn.input !== TurnInput.None) addHistory(work, before);
  ordinarySounds(work);
  outputCommands(work);
  if (work.state.screen.kind === ScreenKind.Board) checkWin(work, wins);
  if (!work.state.winning) {
    if (queued(work, CommandKind.Checkpoint)) checkpoint(work);
    if (queued(work, CommandKind.Again) && modified) prepareAgain(work);
  }
  clearCommands(work);
  if (work.state.winning) work.state.againing = false;
  return modified;
}

/** Probe observation restores changed boards, not a whole execution transaction.
 * Vanilla can retain RNG/events, restart history and Cancel audio along this path.
 * Private lookahead applies the same operations to its own workspace instead. */
function observeProbe(work: Machine, before: BoardSnapshot, turn: CalculatedTurn, wins: WinHandling): AgainDecision {
  if (cancelUnmovedPlayer(work, before, turn)) return AgainDecision.Stop;
  if (queued(work, CommandKind.Cancel)) {
    return cancelTurn(work, before) ? AgainDecision.Schedule : AgainDecision.Stop;
  }
  if (queued(work, CommandKind.Restart)) addHistory(work, before);
  if (!sameBoard(work.state.execution.board, before.board)) {
    addHistory(work, before);
    undo(work, { force: true });
    return AgainDecision.Schedule;
  }
  if (queued(work, CommandKind.Win) || queued(work, CommandKind.Restart)) return AgainDecision.Schedule;

  // Quiet public probes can check natural victory. Automatic AGAIN probes report
  // it with suppression; neither path writes a checkpoint or ordinary outputs.
  if (work.state.screen.kind === ScreenKind.Board) checkWin(work, wins);
  clearCommands(work);
  if (work.state.winning) work.state.againing = false;
  return AgainDecision.Stop;
}

/** Calculate the continuation once and keep its pre-session result for later use. */
function prepareAgain(work: Machine): void {
  const message = work.state.execution.commands.message;
  const probe = vanilla.quirksOf(work.game).againProbeHasSideEffects ? work : probeMachine(work);
  const turn = beginTurn(probe, TurnInput.None);
  if (turn !== undefined) {
    const prepared: PreparedAgainTurn = {
      game: work.game, before: cloneExecutionState(probe.state.execution), turn: copyCalculatedTurn(turn),
    };
    const before = installCalculation(probe, turn);
    if (observeProbe(probe, before, turn, WinHandling.ReportOnly) === AgainDecision.Schedule) {
      work.state.againing = true;
      work.preparedAgain = prepared;
    }
  }
  if (probe !== work) {
    for (const effect of probe.effects) if (effect.kind === SessionEffectKind.Diagnostic) work.effects.push(effect);
  }
  setMessage(work, message);
}

function step(work: Machine, input: TurnInput, wins: WinHandling): boolean {
  const turn = beginTurn(work, input);
  if (turn === undefined) return false;
  const before = installCalculation(work, turn);
  return finishTurn(work, before, turn, wins);
}

/** Start directly on a compiled level; the host supplies all fresh level seeds. */
export function createSession(game: SessionGame, options: CreateSessionOptions, environment: SessionEnvironment): SessionResult {
  const seed = options.seed || environment.nextLevelSeed();
  const execution = emptyExecution(createBoard([]), seed);
  const state: SessionState = {
    execution, levelIndex: options.level ?? 0, levelTarget: null,
    restartTarget: { board: createBoard([]), viewport: null }, history: [], viewport: null,
    screen: { kind: ScreenKind.Board }, winning: false, againing: false, restarting: false, levelStarting: false,
    checkpointUsed: false, loadedLevelSeed: seed, runMode: options.runMode ?? RunMode.Replay,
  };
  const work = machine(game, state, environment);
  load(work, state.levelIndex, seed);
  return result(work, false);
}
export function stepSession(game: SessionGame, before: SessionState, input: Movement | null,
  environment: SessionEnvironment, options: StepSessionOptions = {}): SessionResult {
  const work = machine(game, before, environment);
  work.preparedAgain = pendingAgainTurn(before);
  const wins = options.suppressWin === true ? WinHandling.ReportOnly : WinHandling.Apply;
  const requestedInput = movementInput(input);
  if (options.probe === true) {
    const turn = beginTurn(work, requestedInput);
    if (turn === undefined) return result(work, false);
    const beforeTurn = installCalculation(work, turn);
    return result(work, observeProbe(work, beforeTurn, turn, wins) === AgainDecision.Schedule);
  }
  return result(work, step(work, requestedInput, wins));
}
export function undoSession(game: SessionGame, before: SessionState, options: UndoSessionOptions = {}): SessionResult {
  // Undo never loads a level or consumes an external seed.
  const work = machine(game, before, { nextLevelSeed() { throw new Error('Undo cannot load a level'); } });
  return result(work, undo(work, options));
}
export function restartSession(game: SessionGame, before: SessionState, environment: SessionEnvironment, force = false): SessionResult {
  const work = machine(game, before, environment);
  return result(work, restart(work, force));
}
export function advanceSession(game: SessionGame, before: SessionState, environment: SessionEnvironment): SessionResult {
  const work = machine(game, before, environment);
  if (work.state.winning) {
    work.state.winning = false;
    nextLevel(work);
  } else if (work.state.screen.kind === ScreenKind.TemporaryMessage) {
    simpleSound(work, SimpleSound.CloseMessage);
    setMessage(work, '');
    work.state.screen = { kind: ScreenKind.Board };
    checkWin(work, WinHandling.Apply);
  } else if (work.state.screen.kind === ScreenKind.LevelMessage) {
    if (work.state.runMode === RunMode.Interactive) simpleSound(work, SimpleSound.CloseMessage);
    nextLevel(work);
  } else if (work.state.screen.kind === ScreenKind.Title) {
    simpleSound(work, SimpleSound.StartGame);
    nextLevel(work);
  } else return result(work, false);
  return result(work, true);
}
