import assert from 'node:assert/strict';
import test from 'node:test';
import { Movement } from '../build/model.js';

const compatibility = () => import('../build/compatibility.js');
const all = [Movement.Up, Movement.Down, Movement.Left, Movement.Right, Movement.Action];

test('restore compatibility identifies a partial layer at the original word boundary', async () => {
  const vanilla = await compatibility();
  const policy = vanilla.restorePolicyFor(1, 1, 8);
  assert.deepEqual(policy.retain.map(entry => [entry.layer, [...entry.movements]]), [
    [6, [Movement.Left, Movement.Right, Movement.Action]], [7, all],
  ]);
  assert.deepEqual(vanilla.restorePolicyFor(2, 3, 5).retain, []);
});

test('restoration retains only the declared old intents and clears shape changes', async () => {
  const vanilla = await compatibility();
  const board = { width: 1, height: 1 };
  const before = [{ position: { x: 0, y: 0 }, layer: 6, movements: new Set(all) }];
  const snapshot = structuredClone(before);
  const policies = [vanilla.restorePolicyFor(1, 1, 8)];
  const retained = vanilla.movementsSurvivingRestore(board, board, before, policies);
  assert.deepEqual([...retained[0].movements], [Movement.Left, Movement.Right, Movement.Action]);
  assert.deepEqual(vanilla.movementsSurvivingRestore(board, { width: 2, height: 1 }, before, policies), []);
  assert.deepEqual(vanilla.movementsSurvivingRestore(board, board, before, []), []);
  assert.deepEqual(before, snapshot);
  assert.notEqual(retained[0].movements, before[0].movements);
});

test('current rigid ownership tables retain the first source group across every incoming group', async () => {
  const vanilla = await compatibility();
  const transitions = vanilla.rigidOwnershipTransitions([10, 20, 30]);
  assert.deepEqual(transitions, new Map([
    [10, new Map([[10, 10], [20, 10], [30, 10]])],
    [20, new Map([[10, 20], [20, 20], [30, 20]])],
    [30, new Map([[10, 30], [20, 30], [30, 30]])],
  ]));
  assert.equal(vanilla.combineRigidOwners(vanilla.vanillaQuirks, new Map(), 10, 20), 10);
});

test('historical issue 1206 research names actual groups or an unattributable owner, never encoded ordinals', async () => {
  const vanilla = await compatibility();
  const research = { ...vanilla.vanillaQuirks, rigidOwnerOrdinalMerge: true };
  const transitions = vanilla.rigidOwnershipTransitions([10, 20, 30], research);
  assert.equal(vanilla.combineRigidOwners(research, transitions, 10, 20), 30);
  assert.equal(vanilla.combineRigidOwners(research, transitions, 10, 10), 10);
  assert.equal(vanilla.combineRigidOwners(research, transitions, null, 20), null);
  assert.equal(vanilla.combineRigidOwners(research, vanilla.rigidOwnershipTransitions([10, 20], research), 10, 20), null);
  assert.throws(() => vanilla.combineRigidOwners(research, new Map(), 10, 20), /Missing rigid provenance/);
});

test('historical movement exceptions do not imply a general opposite-direction cancellation rule', async () => {
  const vanilla = await compatibility();
  assert.deepEqual(vanilla.lhsRandomDirection, [Movement.Up, Movement.Left]);
  assert.equal(vanilla.isSelfCollidingMovement(new Set([Movement.Up, Movement.Down])), true);
  assert.equal(vanilla.isSelfCollidingMovement(new Set(all.slice(0, 4))), true);
  assert.equal(vanilla.isSelfCollidingMovement(new Set([Movement.Left, Movement.Right])), false);
  assert.equal(vanilla.isSelfCollidingMovement(new Set([Movement.Action])), false);
  assert.equal(vanilla.randomDirectionOutsideCardinals(4), Movement.Action);
  assert.throws(() => vanilla.randomDirectionOutsideCardinals(5), /direction index/);
});
