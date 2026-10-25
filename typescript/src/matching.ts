import { Direction, type GameObject, type Position } from './model.js';
import { Ellipsis, type CellPattern, type LayerMovement, type MatchingState, type RowMatch, type RulePattern } from './rule-model.js';

export function matchesCell(pattern: CellPattern, objects: ReadonlySet<GameObject>, movements: readonly LayerMovement[]): boolean {
  for (const object of pattern.requiredObjects) {
    if (!objects.has(object)) return false;
  }
  for (const object of pattern.forbiddenObjects) {
    if (objects.has(object)) return false;
  }
  for (const group of pattern.anyObjects) {
    let present = false;
    for (const object of group) {
      if (objects.has(object)) present = true;
    }
    if (!present) return false;
  }
  const hasMovement = (required: LayerMovement): boolean => movements.some(
    actual => actual.layer === required.layer && actual.movement === required.movement,
  );
  if (!pattern.requiredMovements.every(hasMovement)) return false;
  if (pattern.forbiddenMovements.some(hasMovement)) return false;
  return true;
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

function advance(position: Position, step: Position, distance = 1): Position {
  return { x: position.x + step.x * distance, y: position.y + step.y * distance };
}

function inBounds(before: MatchingState, position: Position): boolean {
  return position.x >= 0 && position.x < before.board.width && position.y >= 0 && position.y < before.board.height;
}

function matchesAt(pattern: CellPattern, before: MatchingState, position: Position): boolean {
  if (!inBounds(before, position)) return false;
  const current = before.board.rows[position.y]?.[position.x];
  if (current === undefined) return false;
  const movements: LayerMovement[] = [];
  for (const entry of before.pendingMovements) {
    if (entry.position.x === position.x && entry.position.y === position.y) {
      for (const movement of entry.movements) movements.push({ layer: entry.layer, movement });
    }
  }
  return matchesCell(pattern, current.objects, movements);
}

export function findMatches(rule: RulePattern, before: MatchingState): RowMatch[][] {
  // Native recovery has no wildcard search range for a zero-step row.
  // Fixed-gap rechecks remain finite and still evaluate the row's predicates.
  if (rule.direction === Direction.InPlace && rule.rows.some(row => row.includes(Ellipsis))) return [];
  const step = directionStep(rule.direction);
  const matches: RowMatch[][] = [];
  for (const row of rule.rows) {
    if (row.length === 0) return [];
    const rowMatches: RowMatch[] = [];
    function scanFrom(start: Position): void {
      function visit(index: number, position: Position, gaps: readonly number[]): void {
        const pattern = row[index];
        if (pattern === undefined) {
          rowMatches.push({ start: { ...start }, gaps: [...gaps] });
        } else if (pattern === Ellipsis) {
          // Earlier gaps surround the recursive loops for later gaps.
          let afterGap = position;
          for (let gap = 0; inBounds(before, afterGap); gap++) {
            visit(index + 1, afterGap, [...gaps, gap]);
            afterGap = advance(afterGap, step);
          }
        } else if (matchesAt(pattern, before, position)) {
          visit(index + 1, advance(position, step), gaps);
        }
      }
      visit(0, start, []);
    }
    // Horizontal and in-place scans visit rows first; vertical scans visit columns first.
    if (step.x !== 0 || rule.direction === Direction.InPlace) {
      for (let y = 0; y < before.board.height; y++) {
        for (let x = 0; x < before.board.width; x++) scanFrom({ x, y });
      }
    } else {
      for (let x = 0; x < before.board.width; x++) {
        for (let y = 0; y < before.board.height; y++) scanFrom({ x, y });
      }
    }
    if (rowMatches.length === 0) return [];
    matches.push(rowMatches);
  }
  return matches;
}

export function matchesRow(rule: RulePattern, rowIndex: number, before: MatchingState, match: RowMatch): boolean {
  const row = rule.rows[rowIndex];
  if (row === undefined || row.length === 0) return false;
  if (!Number.isInteger(match.start.x) || !Number.isInteger(match.start.y) || !inBounds(before, match.start)) return false;
  const step = directionStep(rule.direction);
  let position = match.start;
  let gapIndex = 0;
  for (const pattern of row) {
    if (pattern === Ellipsis) {
      const gap = match.gaps[gapIndex++];
      if (gap === undefined || !Number.isInteger(gap) || gap < 0) return false;
      position = advance(position, step, gap);
    } else {
      if (!matchesAt(pattern, before, position)) return false;
      position = advance(position, step);
    }
  }
  return gapIndex === match.gaps.length;
}

export function matchTuples(matches: readonly (readonly RowMatch[])[]): RowMatch[][] {
  let tuples: RowMatch[][] = [[]];
  for (const row of matches) {
    const next: RowMatch[][] = [];
    for (const candidate of row) {
      for (const tuple of tuples) next.push([...tuple, candidate]);
    }
    tuples = next;
  }
  return tuples;
}
