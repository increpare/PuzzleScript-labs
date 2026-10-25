import { Movement, type CollisionLayer, type GameObject } from './model.js';
import { nextRandom, type RandomState } from './random.js';
import type { LayerMovement } from './rule-model.js';

export interface CellEdits {
  readonly removeObjects: ReadonlySet<GameObject>;
  readonly addObjects: ReadonlySet<GameObject>;
  readonly vacateLayers: ReadonlySet<number>;
  readonly removeMovements: readonly LayerMovement[];
  readonly addMovements: readonly LayerMovement[];
  readonly resetMovementLayers: ReadonlySet<number>;
  /** Distinct candidates in canonical object order, supplied by the caller. */
  readonly randomObjects: readonly { readonly object: GameObject; readonly layer: number }[];
  readonly randomDirectionLayers: ReadonlySet<number>;
}

export interface CellState {
  readonly objects: ReadonlySet<GameObject>;
  readonly movements: readonly LayerMovement[];
}

/** Apply one cell transaction. Rigid provenance and commands belong to the caller. */
export function applyCellEdits(
  layers: readonly CollisionLayer[], edits: CellEdits, before: CellState, random: RandomState,
): {
  readonly cell: CellState;
  readonly random: RandomState;
  readonly created: ReadonlySet<GameObject>;
  readonly destroyed: ReadonlySet<GameObject>;
  readonly changed: boolean;
} {
  const addObjects = new Set(edits.addObjects);
  const vacateLayers = new Set(edits.vacateLayers);
  const resetMovementLayers = new Set(edits.resetMovementLayers);
  const addMovements = [...edits.addMovements];
  let afterRandom = random;

  // Entity choice precedes direction choices, including single-candidate draws.
  if (edits.randomObjects.length > 0) {
    const draw = nextRandom(afterRandom);
    afterRandom = draw.state;
    const chosen = edits.randomObjects[Math.floor(draw.value * edits.randomObjects.length)]!;
    addObjects.add(chosen.object);
    vacateLayers.add(chosen.layer);
    resetMovementLayers.add(chosen.layer);
  }
  const directions = [Movement.Up, Movement.Down, Movement.Left, Movement.Right];
  for (const layer of [...edits.randomDirectionLayers].sort((a, b) => a - b)) {
    const draw = nextRandom(afterRandom);
    afterRandom = draw.state;
    const directionIndex = Math.floor(draw.value * 4);
    let movement: Movement;
    // Legacy uniform can round to 1; index 4 then addresses the Action slot.
    if (directionIndex === 4) {
      movement = Movement.Action;
    } else {
      movement = directions[directionIndex]!;
    }
    addMovements.push({ layer, movement });
  }

  const objects = new Set(before.objects);
  for (const object of edits.removeObjects) objects.delete(object);
  for (const layer of vacateLayers) {
    for (const object of layers[layer] ?? []) objects.delete(object);
  }
  // Additions win all removals and vacancies, including other writes on the
  // same collision layer. The legacy cell can contain those conflicting writes.
  for (const object of addObjects) objects.add(object);

  const movements: LayerMovement[] = [];
  const hasMovement = (entries: readonly LayerMovement[], wanted: LayerMovement): boolean =>
    entries.some(entry => entry.layer === wanted.layer && entry.movement === wanted.movement);
  const addMovement = (entry: LayerMovement): void => {
    if (!hasMovement(movements, entry)) movements.push({ layer: entry.layer, movement: entry.movement });
  };
  for (const entry of before.movements) {
    if (!resetMovementLayers.has(entry.layer) && !hasMovement(edits.removeMovements, entry)) addMovement(entry);
  }
  for (const entry of addMovements) addMovement(entry);
  movements.sort((a, b) => a.layer - b.layer || a.movement - b.movement);

  const created = new Set([...objects].filter(object => !before.objects.has(object)));
  const destroyed = new Set([...before.objects].filter(object => !objects.has(object)));
  const movementsChanged = before.movements.some(entry => !hasMovement(movements, entry)) ||
    movements.some(entry => !hasMovement(before.movements, entry));
  return {
    cell: { objects, movements },
    random: afterRandom,
    created,
    destroyed,
    changed: created.size > 0 || destroyed.size > 0 || movementsChanged,
  };
}
