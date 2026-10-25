import { Direction, type Board, type Position } from './model.js';

type BoardShape = Pick<Board, 'width' | 'height'>;

/** Observable movement, player-input and level-diagnostic order. */
export function* positionsByColumn(board: BoardShape): IterableIterator<Position> {
  for (let x = 0; x < board.width; x++) {
    for (let y = 0; y < board.height; y++) yield { x, y };
  }
}

export function* positionsByRow(board: BoardShape): IterableIterator<Position> {
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) yield { x, y };
  }
}

/** Movement and player-input order: vanilla's storage order, or reading order. */
export function movementPositions(board: BoardShape, columnMajor: boolean): IterableIterator<Position> {
  return columnMajor ? positionsByColumn(board) : positionsByRow(board);
}

/** Match enumeration affects overlapping writes, random choices and sounds. */
export function matchingPositions(board: BoardShape, direction: Direction): IterableIterator<Position> {
  return direction === Direction.Up || direction === Direction.Down
    ? positionsByColumn(board) : positionsByRow(board);
}
