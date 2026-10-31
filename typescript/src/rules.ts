import { cloneBoard } from './board.js';
import { queueCommands } from './commands.js';
import * as vanilla from './compatibility.js';
import type { ExecutableRule, RuleExecutionResult, RuleExecutionState, RuleGame } from './execution-model.js';
import { findMatches, matchesRow, matchTuples } from './matching.js';
import { Direction, Movement, type Cell, type LayerMovements, type Position, type RigidMark } from './model.js';
import { applyCellEdits } from './replacement.js';
import { Ellipsis, type LayerMovement, type RowMatch } from './rule-model.js';

/** Copy state containers while keeping the immutable object and rule identities. */
export function cloneExecutionState(before: RuleExecutionState): RuleExecutionState {
  const pendingMovements: LayerMovements[] = [];
  for (const entry of before.pendingMovements) {
    pendingMovements.push({ position: { ...entry.position }, layer: entry.layer, movements: new Set(entry.movements) });
  }
  const rigidMarks: RigidMark[] = [];
  for (const entry of before.rigidMarks) {
    rigidMarks.push({ position: { ...entry.position }, layer: entry.layer, movements: new Set(entry.movements), group: entry.group });
  }
  const entries = [];
  for (const entry of before.commands.entries) entries.push({ command: entry.command, source: entry.source });
  return {
    board: cloneBoard(before.board), pendingMovements, rigidMarks,
    bannedGroups: new Set(before.bannedGroups), canMoveSounds: [...before.canMoveSounds], cantMoveSounds: [...before.cantMoveSounds],
    random: { ...before.random, permutation: [...before.random.permutation] },
    commands: { entries, message: before.commands.message },
    createdObjects: new Set(before.createdObjects), destroyedObjects: new Set(before.destroyedObjects),
  };
}

function directionStep(direction: Direction): Position {
  switch (direction) {
    case Direction.Up: return { x: 0, y: -1 };
    case Direction.Down: return { x: 0, y: 1 };
    case Direction.Left: return { x: -1, y: 0 };
    case Direction.Right: return { x: 1, y: 0 };
    case Direction.InPlace: return { x: 0, y: 0 };
  }
}

function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}

function cellMovements(pending: readonly LayerMovements[], position: Position): LayerMovement[] {
  const movements: LayerMovement[] = [];
  for (const entry of pending) {
    if (!samePosition(entry.position, position)) continue;
    for (const movement of entry.movements) movements.push({ layer: entry.layer, movement });
  }
  return movements;
}

function replaceMovements(
  pending: readonly LayerMovements[], position: Position, movements: readonly LayerMovement[],
): LayerMovements[] {
  const updated: LayerMovements[] = [];
  for (const entry of pending) {
    if (!samePosition(entry.position, position)) updated.push(entry);
  }
  const requests: { layer: number; movements: Set<Movement> }[] = [];
  for (const entry of movements) {
    let request: { layer: number; movements: Set<Movement> } | undefined;
    for (const candidate of requests) {
      if (candidate.layer === entry.layer) request = candidate;
    }
    if (request === undefined) {
      request = { layer: entry.layer, movements: new Set() };
      requests.push(request);
    }
    request.movements.add(entry.movement);
  }
  for (const request of requests) updated.push({ position: { ...position }, layer: request.layer, movements: request.movements });
  return updated;
}

function rigidMarkIndex(marks: readonly RigidMark[], position: Position, layer: number): number {
  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index]!;
    if (mark.layer === layer && samePosition(mark.position, position)) return index;
  }
  return -1;
}

function markRigidLayers(
  game: RuleGame, marks: RigidMark[], position: Position, layers: ReadonlySet<number>, incoming: number,
): boolean {
  const allMovements = [Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action];
  let needsMark = false;
  for (const layer of layers) {
    const mark = marks[rigidMarkIndex(marks, position, layer)];
    for (const movement of allMovements) {
      if (mark === undefined || !mark.movements.has(movement)) needsMark = true;
    }
  }
  if (!needsMark) return false;

  // Current vanilla assigns ownership only to unmarked layers. The historical
  // research mode keeps the old cell-wide guard, where a newly affected layer
  // also combines already assigned owners through the explicit transition map.
  const quirks = vanilla.quirksOf(game);
  for (const layer of layers) {
    const index = rigidMarkIndex(marks, position, layer);
    const previous = marks[index];
    if (!quirks.rigidOwnerOrdinalMerge && previous !== undefined
      && allMovements.every(movement => previous.movements.has(movement))) continue;
    const group = vanilla.combineRigidOwners(quirks, game.rigidMerges, previous === undefined ? incoming : previous.group, incoming);
    const movements = new Set(previous?.movements);
    for (const movement of allMovements) movements.add(movement);
    const mark = { position: { ...position }, layer, movements, group };
    if (previous === undefined) marks.push(mark);
    else marks[index] = mark;
  }
  return true;
}

/** Recheck a recorded tuple, then apply its cell writes in pattern order. */
export function applyRuleAt(
  game: RuleGame, rule: ExecutableRule, before: RuleExecutionState,
  tuple: readonly RowMatch[], recheck: boolean,
): RuleExecutionResult {
  if (recheck) {
    if (tuple.length !== rule.rows.length) return { state: before, changed: false, diagnostics: [] };
    for (let row = 0; row < rule.rows.length; row++) {
      const match = tuple[row];
      if (match === undefined || !matchesRow(rule, row, before, match)) {
        return { state: before, changed: false, diagnostics: [] };
      }
    }
  }
  if (tuple.length !== rule.rows.length) throw new Error('Rule tuple must contain one match per rule row');
  // States are never modified in place, so the result shares unchanged parts with
  // before: new row arrays, new cells for written positions, new collections.
  const rows: Cell[][] = [];
  for (const row of before.board.rows) rows.push([...row]);
  let pendingMovements = [...before.pendingMovements];
  const rigidMarks = [...before.rigidMarks];
  const createdObjects = new Set(before.createdObjects);
  const destroyedObjects = new Set(before.destroyedObjects);
  let random = before.random;
  let changed = false;
  const step = directionStep(rule.direction);

  for (let rowIndex = 0; rowIndex < rule.rows.length; rowIndex++) {
    const row = rule.rows[rowIndex]!;
    const match = tuple[rowIndex];
    if (match === undefined) throw new Error(`Rule tuple is missing row ${rowIndex}`);
    let position = { ...match.start };
    let gapIndex = 0;
    for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
      if (row[cellIndex] === Ellipsis) {
        const gap = match.gaps[gapIndex++];
        if (gap === undefined) throw new Error(`Rule tuple row ${rowIndex} is missing gap ${gapIndex - 1}`);
        position = { x: position.x + step.x * gap, y: position.y + step.y * gap };
        continue;
      }
      const replacement = rule.replacements[rowIndex]?.[cellIndex];
      if (replacement !== null && replacement !== undefined) {
        const currentRow = rows[position.y];
        const current = currentRow?.[position.x];
        if (current === undefined || currentRow === undefined) throw new Error(`Rule replacement cell (${position.x}, ${position.y}) is out of bounds`);
        const result = applyCellEdits(game.collisionLayers, replacement.edits, {
          objects: current.objects, movements: cellMovements(pendingMovements, position),
        }, random, vanilla.quirksOf(game));
        random = result.random;
        currentRow[position.x] = { objects: result.cell.objects };
        pendingMovements = replaceMovements(pendingMovements, position, result.cell.movements);
        for (const object of result.created) createdObjects.add(object);
        for (const object of result.destroyed) destroyedObjects.add(object);
        if (result.changed) changed = true;
        if (rule.rigidGroup !== null && markRigidLayers(game, rigidMarks, position, replacement.rigidLayers, rule.rigidGroup)) changed = true;
      }
      position = { x: position.x + step.x, y: position.y + step.y };
    }
  }
  return {
    state: {
      ...before, board: { width: before.board.width, height: before.board.height, rows },
      pendingMovements, rigidMarks, random, createdObjects, destroyedObjects,
    }, changed, diagnostics: [],
  };
}

/** Match once, apply surviving tuples in order, then queue this rule's commands. */
export function tryApplyRule(game: RuleGame, rule: ExecutableRule, before: RuleExecutionState): RuleExecutionResult {
  const matches = findMatches(rule, before);
  if (matches.length === 0) return { state: before, changed: false, diagnostics: [] };
  let state = before;
  let changed = false;
  if (rule.hasReplacements) {
    const tuples = matchTuples(matches);
    for (let index = 0; index < tuples.length; index++) {
      const result = applyRuleAt(game, rule, state, tuples[index]!, index > 0);
      state = result.state;
      if (result.changed) changed = true;
    }
  }
  state = { ...state, commands: queueCommands(state.commands, rule, rule.commands) };
  return { state, changed, diagnostics: [] };
}
