import type { Board, GameObject } from './model.js';

export function createBoard(rows: readonly (readonly ReadonlySet<GameObject>[])[]): Board {
  const width = rows[0]?.length ?? 0;
  for (const row of rows) {
    if (row.length !== width) throw new Error('Board rows must all have the same width');
  }
  return {
    width,
    height: rows.length,
    rows: rows.map(row => row.map(objects => ({ objects: new Set(objects) }))),
  };
}

export function cloneBoard(board: Board): Board {
  return createBoard(board.rows.map(row => row.map(cell => cell.objects)));
}
