/** Historical exceptions for vanilla PuzzleScript revision 5a94bde1.
 * These preserve observed behavior, including storage accidents. The address
 * calculations below are genuinely layout-dependent; domain boards are not.
 * Keep this boundary explicit rather than presenting these as general rules.
 */
import { Movement, type Board, type LayerMovements } from './model.js';

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

export function rigidOwnershipTransitions(groups: readonly number[]): VanillaRigidCompatibility['rigidMerges'] {
  return new Map(groups.map((group, first) => [group, new Map(groups.map((incoming, second) =>
    [incoming, groups[combineOrdinals(first + 1, second + 1) - 1] ?? null]))]));
}

export function combineRigidOwners(
  transitions: VanillaRigidCompatibility['rigidMerges'], previous: RigidOwner, incoming: number,
): RigidOwner {
  if (previous === null || previous === incoming) return previous;
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
