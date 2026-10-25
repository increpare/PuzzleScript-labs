import type { Board, GameObject } from './model.js';

export enum ObjectMatchKind { Any, All, Never }

export interface ObjectCondition {
  readonly kind: ObjectMatchKind;
  readonly objects: ReadonlySet<GameObject>;
}

export enum WinQuantifier { No, Some, All }

export interface WinCondition {
  readonly quantifier: WinQuantifier;
  readonly subject: ObjectCondition;
  readonly target: ObjectCondition;
}

/** Match declarations by identity within one cell. */
export function matchesObjects(condition: ObjectCondition, objects: ReadonlySet<GameObject>): boolean {
  switch (condition.kind) {
    case ObjectMatchKind.Never:
      return false;
    case ObjectMatchKind.Any:
      for (const object of condition.objects) {
        if (objects.has(object)) return true;
      }
      return false;
    case ObjectMatchKind.All:
      for (const object of condition.objects) {
        if (!objects.has(object)) return false;
      }
      return true;
  }
}

function satisfiesCondition(board: Board, condition: WinCondition): boolean {
  for (const row of board.rows) {
    for (const cell of row) {
      if (!matchesObjects(condition.subject, cell.objects)) continue;
      const matchesTarget = matchesObjects(condition.target, cell.objects);
      switch (condition.quantifier) {
        case WinQuantifier.No:
          if (matchesTarget) return false;
          break;
        case WinQuantifier.Some:
          if (matchesTarget) return true;
          break;
        case WinQuantifier.All:
          if (!matchesTarget) return false;
          break;
      }
    }
  }
  return condition.quantifier !== WinQuantifier.Some;
}

/** Test declared automatic conditions; session commands and transitions are separate. */
export function hasWon(board: Board, conditions: readonly WinCondition[]): boolean {
  if (conditions.length === 0) return false;
  return conditions.every(condition => satisfiesCondition(board, condition));
}
