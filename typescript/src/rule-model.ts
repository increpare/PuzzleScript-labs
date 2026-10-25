import type { Direction, GameObject, Movement, MovementState, Position } from './model.js';

export const Ellipsis = Symbol('ellipsis');

export interface LayerMovement {
  readonly layer: number;
  readonly movement: Movement;
}

/** All fields are conjoined; each anyObjects group requires a present member. */
export interface CellPattern {
  readonly requiredObjects: ReadonlySet<GameObject>;
  readonly forbiddenObjects: ReadonlySet<GameObject>;
  readonly anyObjects: readonly ReadonlySet<GameObject>[];
  readonly requiredMovements: readonly LayerMovement[];
  readonly forbiddenMovements: readonly LayerMovement[];
}

export type PatternCell = CellPattern | typeof Ellipsis;

export interface RulePattern {
  readonly direction: Direction;
  readonly rows: readonly (readonly PatternCell[])[];
}

export interface RowMatch {
  readonly start: Position;
  readonly gaps: readonly number[];
}

export type MatchingState = Pick<MovementState, 'board' | 'pendingMovements'>;
