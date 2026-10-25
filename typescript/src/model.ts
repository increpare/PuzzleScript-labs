export enum Direction {
  Up,
  Down,
  Left,
  Right,
  /** Rule orientation whose pattern cells share one board position. */
  InPlace,
}

export enum Movement {
  Up,
  Down,
  Left,
  Right,
  Action,
}

export interface GameObject {
  readonly name: string;
  /** Writable recovery identity left by the first, subsequently replaced assignment. */
  readonly orphanedFrom?: GameObject;
}

export interface Position {
  readonly x: number;
  readonly y: number;
}

export type CollisionLayer = readonly GameObject[];

/** Intent follows the current declaration, even for its orphaned recovery identity. */
export function getObjectIntentLayer(collisionLayers: readonly CollisionLayer[], object: GameObject): number | undefined {
  const declaration = object.orphanedFrom ?? object;
  const layer = collisionLayers.findIndex(members => members.includes(declaration));
  return layer < 0 ? undefined : layer;
}

export interface Cell {
  readonly objects: ReadonlySet<GameObject>;
}

export interface Board {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly (readonly Cell[])[];
}

export interface LayerMovements {
  readonly position: Position;
  readonly layer: number;
  readonly movements: ReadonlySet<Movement>;
}

export interface RigidMark extends LayerMovements {
  /** null is the legacy case where overlapping writes name no existing group. */
  readonly group: number | null;
}

export interface MovementSound {
  readonly objects: ReadonlySet<GameObject>;
  readonly layer: number;
  readonly movements: ReadonlySet<Movement>;
  readonly seed: string;
}

export interface MovementGame {
  readonly collisionLayers: readonly CollisionLayer[];
  readonly rigid: boolean;
  readonly movementSounds: readonly (readonly MovementSound[])[];
  readonly failureSounds: readonly MovementSound[];
}

export interface MovementState {
  readonly board: Board;
  readonly pendingMovements: readonly LayerMovements[];
  readonly rigidMarks: readonly RigidMark[];
  readonly bannedGroups: ReadonlySet<number | null>;
  readonly canMoveSounds: readonly string[];
  readonly cantMoveSounds: readonly string[];
}

export interface MovementResolution extends MovementState {
  readonly retry: boolean;
}
