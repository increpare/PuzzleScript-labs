import { Direction, Movement } from './model.js';
import * as vanilla from './compatibility.js';
import { movementPositions } from './scan-order.js';
import type {
  CollisionLayer, GameObject, LayerMovements, MovementGame, MovementResolution,
  MovementSound, MovementState, Position,
} from './model.js';

interface Step {
  readonly dx: number;
  readonly dy: number;
  readonly bypassCollision: boolean;
}

function directionStep(direction: Exclude<Direction, Direction.InPlace>): Step {
  switch (direction) {
    case Direction.Up: return { dx: 0, dy: -1, bypassCollision: false };
    case Direction.Down: return { dx: 0, dy: 1, bypassCollision: false };
    case Direction.Left: return { dx: -1, dy: 0, bypassCollision: false };
    case Direction.Right: return { dx: 1, dy: 0, bypassCollision: false };
  }
}

function movementStep(movements: ReadonlySet<Movement>, quirks: vanilla.Quirks): Step {
  if (movements.size === 1) {
    for (const movement of movements) {
      switch (movement) {
        case Movement.Up: return directionStep(Direction.Up);
        case Movement.Down: return directionStep(Direction.Down);
        case Movement.Left: return directionStep(Direction.Left);
        case Movement.Right: return directionStep(Direction.Right);
        case Movement.Action: return { dx: 0, dy: 0, bypassCollision: true };
      }
    }
  }

  if (vanilla.isSelfCollidingMovement(movements) && quirks.combinedMovementsStayPut) {
    return { dx: 0, dy: 0, bypassCollision: false };
  }
  throw new Error(`Unsupported movement combination: ${[...movements].map(movement => Movement[movement]).join(', ')}`);
}

function atPosition<T extends LayerMovements>(entries: readonly T[], position: Position): T[] {
  const matching: T[] = [];
  for (const entry of entries) {
    if (entry.position.x === position.x && entry.position.y === position.y) {
      matching.push(entry);
    }
  }
  return matching;
}

function movementsInLayer(entries: readonly LayerMovements[], layer: number): Set<Movement> {
  const movements = new Set<Movement>();
  for (const entry of entries) {
    if (entry.layer === layer) {
      for (const movement of entry.movements) movements.add(movement);
    }
  }
  return movements;
}

function intersects<T>(first: ReadonlySet<T>, second: ReadonlySet<T>): boolean {
  for (const value of first) {
    if (second.has(value)) return true;
  }
  return false;
}

function occupiesLayer(objects: ReadonlySet<GameObject>, layer: CollisionLayer): boolean {
  for (const object of layer) {
    if (objects.has(object)) return true;
  }
  return false;
}

function addSounds(
  sounds: readonly MovementSound[], objects: ReadonlySet<GameObject>,
  movements: readonly LayerMovements[], seeds: string[],
): void {
  for (const sound of sounds) {
    if (intersects(sound.objects, objects)
      && intersects(sound.movements, movementsInLayer(movements, sound.layer))
      && !seeds.includes(sound.seed)) {
      seeds.push(sound.seed);
    }
  }
}

export function resolveMovements(game: MovementGame, before: MovementState): MovementResolution {
  const quirks = vanilla.quirksOf(game);
  const rows = before.board.rows.map(row => row.map(cell => ({ objects: new Set(cell.objects) })));
  const board = { width: before.board.width, height: before.board.height, rows };
  const pending = before.pendingMovements.map(entry => ({
    position: { ...entry.position }, layer: entry.layer, movements: new Set(entry.movements),
  }));
  const bannedGroups = new Set(before.bannedGroups);
  const canMoveSounds = [...before.canMoveSounds];
  const cantMoveSounds = [...before.cantMoveSounds];

  let succeeded = true;
  while (succeeded) {
    succeeded = false;
    for (const position of movementPositions(board, quirks.columnMajorMovementOrder)) {
      const { x, y } = position;
      const requests = atPosition(pending, position);
      // JS writes consumed intents back after processing all layers at a cell.
      const soundMovements = requests.map(entry => ({ ...entry, movements: new Set(entry.movements) }));
      for (let layerIndex = 0; layerIndex < game.collisionLayers.length; layerIndex++) {
        const movements = movementsInLayer(requests, layerIndex);
        if (movements.size === 0) continue;
        const step = movementStep(movements, quirks);
        const target = { x: x + step.dx, y: y + step.dy };
        if (target.x < 0 || target.x >= board.width || target.y < 0 || target.y >= board.height) continue;
        const sourceCell = rows[y]?.[x];
        const targetCell = rows[target.y]?.[target.x];
        const layer = game.collisionLayers[layerIndex];
        if (!sourceCell || !targetCell || !layer) throw new Error('Board cells must form a rectangle');
        if (!step.bypassCollision && occupiesLayer(targetCell.objects, layer)) continue;

        addSounds(game.movementSounds[layerIndex] ?? [], sourceCell.objects, soundMovements, canMoveSounds);
        for (const object of layer) {
          if (sourceCell.objects.has(object)) {
            sourceCell.objects.delete(object);
            targetCell.objects.add(object);
          }
        }
        for (const request of requests) {
          if (request.layer === layerIndex) request.movements.clear();
        }
        succeeded = true;
      }
    }
  }

  let retry = false;
  for (const position of movementPositions(board, quirks.columnMajorMovementOrder)) {
    const { x, y } = position;
    let remaining: readonly LayerMovements[] = atPosition(pending, position);
    if (!remaining.some(request => request.movements.size > 0)) continue;
    const marks = atPosition(before.rigidMarks, position);
    if (game.rigid && marks.some(mark => mark.movements.size > 0)) {
      // This intersection also filters failure sounds in the original engine.
      remaining = remaining.map(request => {
        const marked = movementsInLayer(marks, request.layer);
        const movements = new Set<Movement>();
        for (const movement of request.movements) {
          if (marked.has(movement)) movements.add(movement);
        }
        return { ...request, movements };
      });
      for (let layer = 0; layer < game.collisionLayers.length; layer++) {
        const movements = movementsInLayer(remaining, layer);
        if (movements.size === 0) continue;
        for (const mark of marks) {
          if (mark.layer === layer && intersects(mark.movements, movements)) {
            if (!bannedGroups.has(mark.group)) {
              bannedGroups.add(mark.group);
              retry = true;
            }
            break;
          }
        }
        // Even an already banned first layer prevents later layers being banned.
        break;
      }
    }
    const cell = rows[y]?.[x];
    if (!cell) throw new Error('Board cells must form a rectangle');
    addSounds(game.failureSounds, cell.objects, remaining, cantMoveSounds);
  }

  return { board, pendingMovements: [], rigidMarks: [], bannedGroups, canMoveSounds, cantMoveSounds, retry };
}
