/** Compatibility with vanilla PuzzleScript revision 57f9f6cb.
 * Defaults preserve current observed behavior, including storage accidents.
 * Historical bugs fixed by that revision remain explicit research opt-ins.
 * Address calculations below depend on the original layout; domain boards do not.
 * Keep this boundary explicit rather than presenting these as general rules.
 */
import { Movement, type Board, type LayerMovements } from './model.js';

/** Switches for behaviour that comes from vanilla's implementation rather than
 * from the language. vanillaQuirks reproduces the pinned revision and is the
 * default; fixed historical bugs are off. All off (noQuirks) is the clean model.
 * Each switch says what "off" does; where vanilla gives no meaning, "off" reports
 * an error rather than inventing one.
 */
export interface Quirks {
  /** Undo and restart keep some pending movements: same-size restore cleared one
   * storage word per tile. Off: restoring a board clears every pending movement. */
  readonly restoreKeepsMovements: boolean;
  /** Issue #1206: overlapping rigid writes combine group ordinals bitwise, so a
   * failed rigid move can ban a group that never matched. Off: a rigid mark keeps
   * the group that first marked that layer. */
  readonly rigidOwnerOrdinalMerge: boolean;
  /** LHS randomdir decodes as the conjunction Up AND Left. Off: compile error. */
  readonly lhsRandomDirIsUpAndLeft: boolean;
  /** Up+Down (or all four directions) on one layer is a zero-offset move that
   * collides with its own cell. Off: such a combination is a runtime error. */
  readonly combinedMovementsStayPut: boolean;
  /** A uniform draw of exactly 1 indexes one past the last choice (Action for
   * randomdir). Off: it selects the last choice. */
  readonly uniformCanReachOne: boolean;
  /** Movement resolution and player input visit cells column by column, the
   * storage order x*height+y. Off: row by row, in reading order. */
  readonly columnMajorMovementOrder: boolean;
  /** Historical movements written by late rules stay pending into the next turn.
   * Current vanilla rejects late movement syntax. Off: such runtime requests are
   * discarded when the turn ends. */
  readonly lateMovementsCarryOver: boolean;
}

export const vanillaQuirks: Quirks = Object.freeze({
  restoreKeepsMovements: true, rigidOwnerOrdinalMerge: false, lhsRandomDirIsUpAndLeft: false,
  combinedMovementsStayPut: true, uniformCanReachOne: true, columnMajorMovementOrder: true,
  lateMovementsCarryOver: false,
});

export const noQuirks: Quirks = Object.freeze(Object.fromEntries(
  Object.keys(vanillaQuirks).map(name => [name, false])) as unknown as Quirks);

export type QuirkName = keyof Quirks;
export const quirkNames = Object.keys(vanillaQuirks) as QuirkName[];

/** Games built without explicit quirks behave as vanilla. */
export interface QuirkSettings {
  readonly quirks?: Quirks;
}
export function quirksOf(game: QuirkSettings): Quirks {
  return game.quirks ?? vanillaQuirks;
}

/** Index of a uniform draw among count choices. */
export function choiceIndex(quirks: Quirks, value: number, count: number): number {
  const index = Math.floor(value * count);
  return quirks.uniformCanReachOne ? index : Math.min(index, count - 1);
}

/** null means that the historical rigid-owner combination names no source group. */
export type RigidOwner = number | null;
export interface VanillaRigidCompatibility {
  readonly rigidMerges: ReadonlyMap<number, ReadonlyMap<number, RigidOwner>>;
}
export interface VanillaRestorePolicy {
  readonly width: number;
  readonly height: number;
  readonly retain: readonly LayerMovements[];
}
export interface VanillaRestoreCompatibility {
  readonly restorePolicies?: readonly VanillaRestorePolicy[];
}
type BoardShape = Pick<Board, 'width' | 'height'>;

/** Same-size restoration cleared one word per tile across a multiword array. */
export function restorePolicyFor(width: number, height: number, layerCount: number): VanillaRestorePolicy {
  const tileCount = width * height;
  const allocatedWordsPerTile = Math.ceil(layerCount / 5);
  const movementOrder = [Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action];
  const retain: LayerMovements[] = [];
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    const tile = x * height + y;
    for (let layer = 0; layer < layerCount; layer++) {
      const movements = new Set(movementOrder.filter((_movement, slot) =>
        tile * allocatedWordsPerTile + Math.floor((layer * 5 + slot) / 32) >= tileCount));
      if (movements.size > 0) retain.push({ position: { x, y }, layer, movements });
    }
  }
  return { width, height, retain };
}

/** Preserve only the old requests named by that bug's compiled retention data. */
export function movementsSurvivingRestore(
  current: BoardShape, target: BoardShape, pending: readonly LayerMovements[],
  policies: readonly VanillaRestorePolicy[],
): LayerMovements[] {
  if (current.width !== target.width || current.height !== target.height) return [];
  const result: LayerMovements[] = [];
  for (const entry of pending) {
    const movements = new Set<Movement>();
    for (const policy of policies) {
      if (policy.width !== current.width || policy.height !== current.height) continue;
      for (const retained of policy.retain) {
        if (retained.layer !== entry.layer || retained.position.x !== entry.position.x || retained.position.y !== entry.position.y) continue;
        for (const movement of entry.movements) if (retained.movements.has(movement)) movements.add(movement);
      }
    }
    if (movements.size > 0) result.push({ position: { ...entry.position }, layer: entry.layer, movements });
  }
  return result;
}

// Issue #1206: combine one-based packed ordinals, then look up a source group.
function combineOrdinals(first: number, second: number): number {
  if (first === 0 && second === 0) return 0;
  return Math.max(first % 2, second % 2)
    + 2 * combineOrdinals(Math.floor(first / 2), Math.floor(second / 2));
}

export function rigidOwnershipTransitions(
  groups: readonly number[], quirks: Quirks = vanillaQuirks,
): VanillaRigidCompatibility['rigidMerges'] {
  return new Map(groups.map((group, first) => [group, new Map(groups.map((incoming, second) =>
    [incoming, quirks.rigidOwnerOrdinalMerge ? groups[combineOrdinals(first + 1, second + 1) - 1] ?? null : group]))]));
}

export function combineRigidOwners(
  quirks: Quirks, transitions: VanillaRigidCompatibility['rigidMerges'], previous: RigidOwner, incoming: number,
): RigidOwner {
  if (previous === null || previous === incoming || !quirks.rigidOwnerOrdinalMerge) return previous;
  const merged = transitions.get(previous)?.get(incoming);
  if (merged === undefined) throw new Error(`Missing rigid provenance transition from group ${previous} to ${incoming}`);
  return merged;
}

/** LHS randomdir was decoded as the conjunction Up AND Left. */
export const lhsRandomDirection: readonly Movement[] = [Movement.Up, Movement.Left];

/** Only these combinations have the historical zero-offset, colliding behavior. */
export function isSelfCollidingMovement(movements: ReadonlySet<Movement>): boolean {
  const vertical = movements.has(Movement.Up) && movements.has(Movement.Down);
  return (movements.size === 2 && vertical)
    || (movements.size === 4 && vertical && movements.has(Movement.Left) && movements.has(Movement.Right));
}

/** The original uniform arithmetic can round to 1, addressing the Action slot. */
export function randomDirectionOutsideCardinals(index: number): Movement {
  if (index === 4) return Movement.Action;
  throw new Error(`Random direction index ${index} is outside the historical direction slots`);
}
