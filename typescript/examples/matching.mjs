import { createBoard } from '../build/board.js';
import { Direction } from '../build/model.js';
import { Ellipsis } from '../build/rule-model.js';
import { findMatches } from '../build/matching.js';

const Player = Object.freeze({ name: 'Player' });
const Crate = Object.freeze({ name: 'Crate' });
const Wall = Object.freeze({ name: 'Wall' });

function contains(object) {
  return {
    requiredObjects: new Set([object]),
    forbiddenObjects: new Set(),
    anyObjects: [],
    requiredMovements: [],
    forbiddenMovements: [],
  };
}

const before = {
  board: createBoard([[
    new Set([Player]), new Set([Crate]), new Set(),
    new Set([Crate]), new Set(), new Set([Wall]),
  ]]),
  pendingMovements: [],
};
const rule = {
  direction: Direction.Right,
  rows: [[contains(Player), Ellipsis, contains(Crate), Ellipsis, contains(Wall)]],
};

console.log('Board: PC.C.#');
console.log('Rule:  right [ Player | ... | Crate | ... | Wall ]');
for (const match of findMatches(rule, before)[0]) {
  console.log(`Start (${match.start.x}, ${match.start.y}), gaps: ${match.gaps.join(', ')}`);
}
