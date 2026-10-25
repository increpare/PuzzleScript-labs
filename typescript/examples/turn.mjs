import { createBoard } from '../build/board.js';
import { Direction, Movement } from '../build/model.js';
import { createRandom } from '../build/random.js';
import { applyTurnRules, PlayerMatchKind } from '../build/turn-rules.js';

const Player = Object.freeze({ name: 'Player' });
const Crate = Object.freeze({ name: 'Crate' });

const unconstrained = {
  requiredObjects: new Set(), forbiddenObjects: new Set(), anyObjects: [],
  requiredMovements: [], forbiddenMovements: [],
};
const pushCrate = {
  direction: Direction.Right,
  sourceLine: 1,
  // right [ > Player | Crate ] -> [ > Player | > Crate ]
  rows: [[
    { ...unconstrained, requiredObjects: new Set([Player]),
      requiredMovements: [{ layer: 0, movement: Movement.Right }] },
    { ...unconstrained, requiredObjects: new Set([Crate]) },
  ]],
  hasReplacements: true,
  replacements: [[null, {
    edits: {
      removeObjects: new Set(), addObjects: new Set(), vacateLayers: new Set(),
      removeMovements: [], addMovements: [{ layer: 0, movement: Movement.Right }],
      resetMovementLayers: new Set([0]), randomObjects: [], randomDirectionLayers: new Set(),
    },
    rigidLayers: new Set(),
  }]],
  commands: [], rigidGroup: null,
};

const game = {
  collisionLayers: [[Player, Crate]],
  player: { kind: PlayerMatchKind.Any, objects: new Set([Player]) },
  earlyRules: { groups: [{ rules: [pushCrate], random: false }], loops: new Map() },
  lateRules: { groups: [], loops: new Map() },
  rigid: false, rigidMerges: new Map(), movementSounds: [[]], failureSounds: [],
};
const before = {
  board: createBoard([[new Set([Player]), new Set([Crate]), new Set()]]),
  pendingMovements: [], rigidMarks: [], bannedGroups: new Set(),
  commands: { entries: [], message: '' },
  createdObjects: new Set(), destroyedObjects: new Set(),
  canMoveSounds: [], cantMoveSounds: [], random: createRandom('example'),
};

function draw(board) {
  return board.rows.map(row => row.map(cell =>
    cell.objects.has(Player) ? 'P' : cell.objects.has(Crate) ? 'C' : '.',
  ).join('')).join('\n');
}

const result = applyTurnRules(game, before, Movement.Right);
console.log('Before: ' + draw(before.board));
console.log('Input:  ' + Movement[Movement.Right]);
console.log('Rule:   right [ > Player | Crate ] -> [ > Player | > Crate ]');
console.log('After:  ' + draw(result.state.board));
