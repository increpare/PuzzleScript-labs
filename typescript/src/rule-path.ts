import { Direction, type Position } from './model.js';
import { Ellipsis, type RowMatch, type RulePattern } from './rule-model.js';

export function directionStep(direction: Direction): Position {
  switch (direction) {
    case Direction.Up: return { x: 0, y: -1 };
    case Direction.Down: return { x: 0, y: 1 };
    case Direction.Left: return { x: -1, y: 0 };
    case Direction.Right: return { x: 1, y: 0 };
    case Direction.InPlace: return { x: 0, y: 0 };
  }
}

/** Walk concrete pattern cells using already recorded gaps, in source order. */
export function* recordedRowCells(rule: RulePattern, rowIndex: number, match: RowMatch) {
  const row = rule.rows[rowIndex]!;
  const step = directionStep(rule.direction);
  let position = { ...match.start };
  let gapIndex = 0;
  for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
    const pattern = row[cellIndex]!;
    if (pattern === Ellipsis) {
      const gap = match.gaps[gapIndex];
      if (gap === undefined) throw new Error(`Rule tuple row ${rowIndex} is missing gap ${gapIndex}`);
      gapIndex++;
      position = { x: position.x + step.x * gap, y: position.y + step.y * gap };
    } else {
      // Yield before advancing so each replacement reads the current live state
      // and any error it raises precedes a missing gap later in the row.
      yield { cellIndex, pattern, position };
      position = { x: position.x + step.x, y: position.y + step.y };
    }
  }
}
