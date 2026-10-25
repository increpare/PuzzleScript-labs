import { createBoard } from '../build/board.js';
import { Movement } from '../build/model.js';
import { PlayerMatchKind } from '../build/turn-rules.js';
import { LevelKind } from '../build/session-model.js';
import { createSession, stepSession, undoSession, restartSession } from '../build/session.js';

const Player = Object.freeze({ name: 'Player' });
const board = createBoard([[new Set([Player]), new Set(), new Set()]]);
const noRules = { groups: [], loops: new Map() };
const game = {
  collisionLayers: [[Player]],
  player: { kind: PlayerMatchKind.Any, objects: new Set([Player]) },
  earlyRules: noRules, lateRules: noRules,
  rigid: false, rigidMerges: new Map(), movementSounds: [[]], failureSounds: [],
  levels: [{ kind: LevelKind.Grid, board, sourceLine: 1 }], winConditions: [],
  metadata: { requirePlayerMovement: false, runRulesOnLevelStart: false, noUndo: false, noRestart: false },
  sounds: { simple: new Map(), sfx: new Map(), creation: [], destruction: [] },
};
const environment = { nextLevelSeed: () => 'example' };
let current = createSession(game, { seed: 'example' }, environment).state;

function show(label) {
  const picture = current.execution.board.rows.map(row =>
    row.map(cell => cell.objects.has(Player) ? 'P' : '.').join('')).join('\n');
  console.log(label.padEnd(9) + picture + '   undo states: ' + current.history.length);
}

show('Initial');
current = stepSession(game, current, Movement.Right, environment).state;
show('Right');
current = stepSession(game, current, Movement.Right, environment).state;
show('Right');
current = undoSession(game, current).state;
show('Undo');
current = restartSession(game, current, environment).state;
show('Restart');
