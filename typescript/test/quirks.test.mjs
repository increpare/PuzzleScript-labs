import assert from 'node:assert/strict';
import test from 'node:test';
import { Movement } from '../build/model.js';
import { compileSource, SourceCompilationKind } from '../build/source-compiler.js';
import { createSession, stepSession, undoSession, restartSession } from '../build/session.js';
import { resolveMovements } from '../build/movement.js';
import { movementPositions } from '../build/scan-order.js';
import * as vanilla from '../build/compatibility-vanilla-5a94bde1.js';

const without = name => ({ ...vanilla.vanillaQuirks, [name]: false });

// From test/repros/movement-restore-bug-report.md: eight layers put Dust's
// pending movement in the second storage word of its tile.
const restoreSource = `title Pending movement survives undo and restart
objects
Background
black
Player
white
Spare1
red
Spare2
red
Spare3
red
Spare4
red
Spare5
red
Dust
yellow
legend
. = Background
P = Player
D = Dust
sounds
collisionlayers
Background
Player
Spare1
Spare2
Spare3
Spare4
Spare5
Dust
rules
late [ Dust ] -> [ randomdir Dust ]
winconditions
levels
P..
.D.
...
`;

function play(source, quirks, inputs) {
  const compiled = compileSource(source, { quirks });
  assert.equal(compiled.outcome.kind, SourceCompilationKind.Accepted);
  const { game } = compiled.outcome;
  let loads = 0;
  const environment = { nextLevelSeed: () => `late-restore:${++loads}` };
  let state = createSession(game, { seed: 'late-restore' }, environment).state;
  for (const input of inputs) {
    if (input === 'undo') state = undoSession(game, state, { ignoreDuplicates: true }).state;
    else if (input === 'restart') state = restartSession(game, state, environment).state;
    else state = stepSession(game, state, input, environment).state;
  }
  return state;
}

function dustPosition(state) {
  const rows = state.execution.board.rows;
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
    if ([...rows[y][x].objects].some(object => object.name === 'dust')) return [x, y];
  }
  return null;
}

test('vanilla and clean quirk sets name the same switches; vanilla is the default', () => {
  assert.deepEqual(Object.keys(vanilla.noQuirks), vanilla.quirkNames);
  assert.ok(vanilla.quirkNames.every(name => vanilla.vanillaQuirks[name] === true && vanilla.noQuirks[name] === false));
  assert.equal(compileSource(restoreSource).outcome.game.quirks, vanilla.vanillaQuirks);
  assert.equal(vanilla.quirksOf({}), vanilla.vanillaQuirks);
});

for (const restoration of ['undo', 'restart']) {
  test(`restoreKeepsMovements: ${restoration} keeps or clears the discarded turn's movement`, () => {
    const inputs = [Movement.Right, restoration, Movement.Action];
    assert.deepEqual(dustPosition(play(restoreSource, vanilla.vanillaQuirks, inputs)), [2, 1]);
    assert.deepEqual(dustPosition(play(restoreSource, without('restoreKeepsMovements'), inputs)), [1, 1]);
  });
}

test('lateMovementsCarryOver: a late randomdir moves Dust on the next turn only with the quirk', () => {
  const inputs = [Movement.Action, Movement.Action];
  assert.notDeepEqual(dustPosition(play(restoreSource, vanilla.vanillaQuirks, inputs)), [1, 1]);
  assert.deepEqual(dustPosition(play(restoreSource, without('lateMovementsCarryOver'), inputs)), [1, 1]);
});

test('lhsRandomDirIsUpAndLeft: off, a left-hand randomdir is a compile error', () => {
  const source = restoreSource.replace('late [ Dust ] -> [ randomdir Dust ]', '[ randomdir Player ] -> [ Player ]');
  const codes = quirks => compileSource(source, { quirks }).diagnostics.map(issue => issue.code);
  assert.ok(!codes(vanilla.vanillaQuirks).includes('random-direction-on-left'));
  assert.ok(codes(without('lhsRandomDirIsUpAndLeft')).includes('random-direction-on-left'));
});

test('uniformCanReachOne: off, a draw of exactly one selects the last choice', () => {
  assert.equal(vanilla.choiceIndex(vanilla.vanillaQuirks, 1, 4), 4);
  assert.equal(vanilla.choiceIndex(without('uniformCanReachOne'), 1, 4), 3);
  assert.equal(vanilla.choiceIndex(without('uniformCanReachOne'), 0.5, 4), 2);
});

test('rigidOwnerOrdinalMerge: off, the first group to mark a layer keeps it', () => {
  const transitions = vanilla.rigidOwnershipTransitions([10, 20, 30]);
  assert.equal(vanilla.combineRigidOwners(vanilla.vanillaQuirks, transitions, 10, 20), 30);
  assert.equal(vanilla.combineRigidOwners(without('rigidOwnerOrdinalMerge'), transitions, 10, 20), 10);
});

test('combinedMovementsStayPut: off, Up+Down on one layer is an error', () => {
  const crate = { name: 'crate' };
  const game = quirks => ({ collisionLayers: [[crate]], rigid: false, movementSounds: [[]], failureSounds: [], quirks });
  const before = {
    board: { width: 1, height: 3, rows: [[{ objects: new Set() }], [{ objects: new Set([crate]) }], [{ objects: new Set() }]] },
    pendingMovements: [{ position: { x: 0, y: 1 }, layer: 0, movements: new Set([Movement.Up, Movement.Down]) }],
    rigidMarks: [], bannedGroups: new Set(), canMoveSounds: [], cantMoveSounds: [],
  };
  const after = resolveMovements(game(vanilla.vanillaQuirks), before);
  assert.ok(after.board.rows[1][0].objects.has(crate));
  assert.throws(() => resolveMovements(game(without('combinedMovementsStayPut')), before), /Unsupported movement combination/);
});

test('columnMajorMovementOrder: off, movement visits cells in reading order', () => {
  const order = columnMajor => [...movementPositions({ width: 2, height: 2 }, columnMajor)].map(({ x, y }) => `${x}${y}`);
  assert.deepEqual(order(true), ['00', '01', '10', '11']);
  assert.deepEqual(order(false), ['00', '10', '01', '11']);
});
