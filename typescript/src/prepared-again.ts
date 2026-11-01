import type { RuleExecutionState } from './execution-model.js';
import { TurnInput, type Board, type LayerMovements } from './model.js';
import { cloneExecutionState } from './rules.js';
import type { SessionGame, SessionState } from './session-model.js';
import type { CalculatedTurn } from './turn-rules.js';

/** Full rule/movement work, before session commands, history or persistence. */
export interface PreparedAgainTurn {
  readonly game: SessionGame;
  readonly before: RuleExecutionState;
  readonly turn: CalculatedTurn;
}

// Public sessions remain ordinary immutable values. Only their API boundary
// associates private work with an exact returned value; copies simply miss.
const preparedTurns = new WeakMap<SessionState, PreparedAgainTurn>();

export function pendingAgainTurn(state: SessionState): PreparedAgainTurn | undefined {
  return state.againing ? preparedTurns.get(state) : undefined;
}

/** A vanilla probe can schedule AGAIN while changing its own rule inputs. */
export function retainAgainTurn(state: SessionState, prepared: PreparedAgainTurn | undefined): void {
  if (state.againing && prepared !== undefined && prepared.turn.input === TurnInput.None
    && sameRuleInput(prepared.before, state.execution)) {
    preparedTurns.set(state, prepared);
  }
}

/** Each use owns a copy, so immutable branches can reuse the same preparation. */
export function reusableAgainTurn(
  game: SessionGame, before: RuleExecutionState, input: TurnInput,
  prepared: PreparedAgainTurn | undefined,
): CalculatedTurn | undefined {
  if (input !== TurnInput.None || prepared === undefined || prepared.game !== game
    || prepared.turn.input !== TurnInput.None || !sameRuleInput(prepared.before, before)) return undefined;
  return copyCalculatedTurn(prepared.turn);
}

export function copyCalculatedTurn(turn: CalculatedTurn): CalculatedTurn {
  return { ...turn, state: cloneExecutionState(turn.state),
    playerPositions: turn.playerPositions.map(position => ({ ...position })),
    diagnostics: turn.diagnostics.map(detail => ({ ...detail })) };
}

/** Compare everything calculation reads before resetting turn bookkeeping. */
function sameRuleInput(left: RuleExecutionState, right: RuleExecutionState): boolean {
  if (!sameRuleBoard(left.board, right.board) || left.commands.message !== right.commands.message) return false;
  const a = left.random;
  const b = right.random;
  if (a.seed !== b.seed || a.i !== b.i || a.j !== b.j || a.permutation.length !== b.permutation.length
    || a.permutation.some((value, index) => value !== b.permutation[index])) return false;
  if (!sameMovements(left.pendingMovements, right.pendingMovements)
    || !sameMovements(left.rigidMarks, right.rigidMarks)) return false;
  return left.rigidMarks.every((mark, index) => mark.group === right.rigidMarks[index]!.group);
}

function sameMovements(left: readonly LayerMovements[], right: readonly LayerMovements[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index]!;
    return entry.position.x === other.position.x && entry.position.y === other.position.y && entry.layer === other.layer
      && sameSetOrder(entry.movements, other.movements);
  });
}

/** Set order is observable in the returned containers even with equal members. */
function sameSetOrder<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
  if (left.size !== right.size) return false;
  const other = right.values();
  for (const value of left) if (value !== other.next().value) return false;
  return true;
}

function sameRuleBoard(left: Board, right: Board): boolean {
  if (left.width !== right.width || left.height !== right.height) return false;
  return left.rows.every((row, y) => row.every((cell, x) => sameSetOrder(cell.objects, right.rows[y]![x]!.objects)));
}
