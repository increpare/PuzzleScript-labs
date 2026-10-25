import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRandom, nextRandom } from '../build/random.js';

// Keep the legacy generator in an isolated realm: rng.js adds a String method.
// Only this compatibility test loads the original JavaScript implementation.
const LegacyRandom = runInNewContext(
  readFileSync(new URL('./vanilla/js/rng.js', import.meta.url), 'utf8') + '\nRNG;',
);

function legacyState(random) {
  return {
    seed: random.seed,
    i: random._state.i,
    j: random._state.j,
    permutation: Array.from(random._state.s),
  };
}

const knownSequences = [
  ['Example', [0.23486116157656023, 0.7972798995050903, 0.7032748228077568, 0.6028563936814503]],
  ['PuzzleScript', [0.3739407287400249, 0.9143900951210789, 0.7934509479752729, 0.06650115161539398]],
  ['éĀ😀', [0.5353826667977228, 0.639580310685463, 0.3320360786758605, 0.20790764006502876]],
  ['\u0000', [0.8675618920562704, 0.22866857759740153, 0.5719875755018078, 0.8004698318357455]],
  ['x\u0000y', [0.738130256642284, 0.4567596741224147, 0.1543785450606292, 0.07077714896457957]],
  ['\ud800', [0.5294927906156452, 0.8210695726525512, 0.468787354250039, 0.09938957201468455]],
];

for (const [seed, expected] of knownSequences) {
  test(`seed ${JSON.stringify(seed)} reproduces known uniform values`, () => {
    let state = createRandom(seed);
    for (const value of expected) {
      const draw = nextRandom(state);
      assert.equal(draw.value, value);
      state = draw.state;
    }
  });
}

for (const seed of ['ASCII seed', 'éĀ😀', '\u0000', 'x\u0000y', '\ud800', '\udc00']) {
  test(`seed ${JSON.stringify(seed)} preserves the full legacy permutation across index wraparound`, () => {
    const legacy = new LegacyRandom(seed);
    let state = createRandom(seed);
    assert.deepEqual(state, legacyState(legacy));
    for (let drawNumber = 0; drawNumber < 80; drawNumber++) {
      const draw = nextRandom(state);
      assert.equal(draw.value, legacy.uniform(), `uniform draw ${drawNumber}`);
      assert.deepEqual(draw.state, legacyState(legacy), `state after draw ${drawNumber}`);
      state = draw.state;
    }
  });
}

test('the same seed creates equal, independent snapshots', () => {
  const first = createRandom('deterministic');
  const second = createRandom('deterministic');
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.permutation, second.permutation);
  assert.deepEqual(nextRandom(first), nextRandom(second));
});

test('a draw consumes seven bytes even when choosing the only candidate', () => {
  const initial = createRandom('single candidate');
  const draw = nextRandom(initial);
  assert.equal(Math.floor(draw.value * 1), 0);
  const legacy = new LegacyRandom(initial.seed);
  for (let byte = 0; byte < 7; byte++) legacy.nextByte();
  assert.deepEqual(draw.state, legacyState(legacy));
  assert.equal(draw.state.i, 7);
  assert.equal(nextRandom(draw.state).value, legacy.uniform());
});

test('drawing from frozen input leaves it unchanged and creates a separate permutation', () => {
  const initial = createRandom('immutable');
  const snapshot = structuredClone(initial);
  Object.freeze(initial.permutation);
  Object.freeze(initial);
  const draw = nextRandom(initial);
  assert.deepEqual(initial, snapshot);
  assert.notEqual(draw.state, initial);
  assert.notEqual(draw.state.permutation, initial.permutation);
  draw.state.permutation.reverse();
  assert.deepEqual(initial, snapshot);
});

test('snapshots can be saved and resumed without sharing the current stream', () => {
  let state = createRandom('resume');
  for (let draw = 0; draw < 13; draw++) state = nextRandom(state).state;
  const saved = JSON.parse(JSON.stringify(state));
  const savedSnapshot = structuredClone(saved);
  const first = nextRandom(state);
  const resumed = nextRandom(saved);
  assert.deepEqual(resumed, first);
  assert.deepEqual(nextRandom(resumed.state), nextRandom(first.state));
  nextRandom(state);
  assert.deepEqual(saved, savedSnapshot);
});

test('an empty seed is rejected with the legacy stream limitation explained', () => {
  assert.throws(() => createRandom(''), /empty seed.*legacy|legacy.*empty seed/i);
});
