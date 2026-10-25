import { createBoard } from '../build/board.js';
import { Movement } from '../build/model.js';
import { resolveMovements } from '../build/movement.js';

const Player = Object.freeze({ name: 'Player' });
const Crate = Object.freeze({ name: 'Crate' });
const Wall = Object.freeze({ name: 'Wall' });

const game = {
  collisionLayers: [[Player, Crate, Wall]],
  rigid: false,
  movementSounds: [[]],
  failureSounds: [],
};

const before = {
  board: createBoard([[new Set([Player]), new Set([Crate]), new Set()]]),
  // A pushing rule would have requested movement for both objects already.
  pendingMovements: [
    { position: { x: 0, y: 0 }, layer: 0, movements: new Set([Movement.Right]) },
    { position: { x: 1, y: 0 }, layer: 0, movements: new Set([Movement.Right]) },
  ],
  rigidMarks: [],
  bannedGroups: new Set(),
  canMoveSounds: [],
  cantMoveSounds: [],
};

const glyphs = new Map([[Player, 'P'], [Crate, 'C'], [Wall, '#']]);
function draw(board) {
  return board.rows.map(row => row.map(cell =>
    [...cell.objects].map(object => glyphs.get(object)).join('') || '.',
  ).join('')).join('\n');
}

const after = resolveMovements(game, before);
console.log('Legend: P = Player, C = Crate, # = Wall, . = empty');
console.log('Before: ' + draw(before.board));
console.log('Requests: ' + Movement[Movement.Right] + ' for Player and Crate');
console.log('After:  ' + draw(after.board));
