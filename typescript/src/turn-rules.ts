import type { ExecutionDiagnostic, RuleExecutionState, RuleGame, RuleSchedule } from './execution-model.js';
import { getObjectIntentLayer, Movement, TurnInput, type GameObject, type LayerMovements, type MovementGame, type Position } from './model.js';
import { cloneExecutionState } from './rules.js';
import { resolveMovements } from './movement.js';
import { applyRules } from './scheduling.js';
import { movementPositions } from './scan-order.js';
import { quirksOf } from './compatibility.js';
import { movementInput } from './turn-input.js';

export enum PlayerMatchKind { Any, All, Never }
export interface PlayerDefinition {
  readonly kind: PlayerMatchKind;
  readonly objects: ReadonlySet<GameObject>;
}
export interface TurnRulesGame extends RuleGame, MovementGame {
  readonly player: PlayerDefinition;
  readonly earlyRules: RuleSchedule;
  readonly lateRules: RuleSchedule;
}
export interface PlayerMovementResult {
  readonly state: RuleExecutionState;
  readonly playerPositions: readonly Position[];
}
export interface TurnRulesResult extends PlayerMovementResult {
  readonly attempts: number;
  readonly rigidRetries: number;
  readonly rigidLimitReached: boolean;
  readonly diagnostics: readonly ExecutionDiagnostic[];
}
export interface CalculatedTurn extends TurnRulesResult {
  readonly input: TurnInput;
}

/** Preserve the public movement-or-null component boundary. */
export function startPlayerMovement(
  game: Pick<TurnRulesGame, 'collisionLayers' | 'player' | 'quirks'>,
  before: RuleExecutionState, input: Movement | null,
): PlayerMovementResult {
  return startTurnMovement(game, before, movementInput(input));
}

function playerMovement(input: TurnInput): Movement {
  switch (input) {
    case TurnInput.None: throw new Error('No-input turns do not add player movement');
    case TurnInput.Up: return Movement.Up;
    case TurnInput.Down: return Movement.Down;
    case TurnInput.Left: return Movement.Left;
    case TurnInput.Right: return Movement.Right;
    case TurnInput.Action: return Movement.Action;
  }
}

/** Add input only to actual player objects, in the engine's column-first order. */
function startTurnMovement(
  game: Pick<TurnRulesGame, 'collisionLayers' | 'player' | 'quirks'>,
  before: RuleExecutionState, input: TurnInput,
): PlayerMovementResult {
  const state = cloneExecutionState(before);
  const playerPositions: Position[] = [];
  if (input === TurnInput.None || game.player.kind === PlayerMatchKind.Never) return { state, playerPositions };
  const movement = playerMovement(input);

  const pendingMovements: LayerMovements[] = [...state.pendingMovements];
  for (const { x, y } of movementPositions(state.board, quirksOf(game).columnMajorMovementOrder)) {
    const cell = state.board.rows[y]?.[x];
    if (cell === undefined) throw new Error('Board cells must form a rectangle');
    let selected = game.player.kind === PlayerMatchKind.All;
    for (const object of game.player.objects) {
      if (game.player.kind === PlayerMatchKind.Any && cell.objects.has(object)) selected = true;
      if (game.player.kind === PlayerMatchKind.All && !cell.objects.has(object)) selected = false;
    }
    if (!selected) continue;
    playerPositions.push({ x, y });

    const playerLayers = new Set<number>();
    for (const object of game.player.objects) {
      if (!cell.objects.has(object)) continue;
      const layer = getObjectIntentLayer(game.collisionLayers, object);
      if (layer !== undefined) playerLayers.add(layer);
    }
    for (const layer of [...playerLayers].sort((a, b) => a - b)) {
      const index = pendingMovements.findIndex(entry =>
        entry.position.x === x && entry.position.y === y && entry.layer === layer);
      const movements = new Set(index < 0 ? [] : pendingMovements[index]!.movements);
      movements.add(movement);
      const request = { position: { x, y }, layer, movements };
      if (index < 0) pendingMovements.push(request);
      else pendingMovements[index] = request;
    }
  }
  return { state: { ...state, pendingMovements }, playerPositions };
}
const MAX_ATTEMPTS = 50;

/** Run rules and movement with explicit rigid rollback; session effects are separate. */
export function calculateTurn(
  game: TurnRulesGame, before: RuleExecutionState, input: TurnInput,
): CalculatedTurn {
  const started = startTurnMovement(game, {
    ...before, bannedGroups: new Set(), commands: { entries: [], message: before.commands.message },
    createdObjects: new Set(), destroyedObjects: new Set(), canMoveSounds: [], cantMoveSounds: [],
  }, input);
  const retrySnapshot = cloneExecutionState(started.state);
  let state = started.state;
  let attempts = 0;
  let rigidRetries = 0;
  const diagnostics: ExecutionDiagnostic[] = [];

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const early = applyRules(game, game.earlyRules, state);
    diagnostics.push(...early.diagnostics);
    const { retry, ...movement } = resolveMovements(game, early.state);
    state = { ...early.state, ...movement };
    if (retry) {
      rigidRetries++;
      state = {
        ...cloneExecutionState(retrySnapshot),
        bannedGroups: state.bannedGroups, cantMoveSounds: state.cantMoveSounds,
        random: state.random, commands: { entries: [], message: state.commands.message },
      };
    } else {
      // JS late scheduling receives no early ban list. Keep the list only for tracing.
      const bannedGroups = state.bannedGroups;
      const late = applyRules(game, game.lateRules, { ...state, bannedGroups: new Set() });
      state = { ...late.state, bannedGroups };
      // Current source syntax rejects late movement. Historical runtime research
      // can still write requests here, after this turn's movement has resolved.
      if (!quirksOf(game).lateMovementsCarryOver) state = { ...state, pendingMovements: [] };
      diagnostics.push(...late.diagnostics);
      break;
    }
  }
  return {
    input, state, playerPositions: started.playerPositions, attempts, rigidRetries,
    rigidLimitReached: attempts >= MAX_ATTEMPTS, diagnostics,
  };
}

/** Preserve the public component result without exposing the recorded input. */
export function applyTurnRules(
  game: TurnRulesGame, before: RuleExecutionState, input: Movement | null,
): TurnRulesResult {
  const { input: _input, ...result } = calculateTurn(game, before, movementInput(input));
  return result;
}
