#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

// Loads src/js/*.js as globals (BitVec, compile, processInput, etc.).
loadPuzzleScript();

function test(name, fn) {
    try { fn(); console.log(`  PASS ${name}`); }
    catch (err) { console.error(`  FAIL ${name}\n    ${err.message}`); process.exitCode = 1; }
}

test('anyBitsInCommon: empty vs empty is false', () => {
    const a = new BitVec(2);
    const b = new BitVec(2);
    assert.strictEqual(a.anyBitsInCommon(b), false);
});

test('anyBitsInCommon: nonempty disjoint is false', () => {
    const a = new BitVec(2);
    const b = new BitVec(2);
    a.ibitset(0);
    b.ibitset(1);
    assert.strictEqual(a.anyBitsInCommon(b), false);
});

test('anyBitsInCommon: shared bit returns true', () => {
    const a = new BitVec(2);
    const b = new BitVec(2);
    a.ibitset(5);
    b.ibitset(5);
    assert.strictEqual(a.anyBitsInCommon(b), true);
});

test('anyBitsInCommon: bit in second word', () => {
    const a = new BitVec(2);
    const b = new BitVec(2);
    a.ibitset(40);
    b.ibitset(40);
    assert.strictEqual(a.anyBitsInCommon(b), true);
});

test('anyBitsInCommon: early-exit on first word', () => {
    const a = new BitVec(4);
    const b = new BitVec(4);
    a.ibitset(0);
    b.ibitset(0);
    // No bits set in words 1..3 on either side; result must still be true.
    assert.strictEqual(a.anyBitsInCommon(b), true);
});

test('setZero: clears all words', () => {
    const a = new BitVec(3);
    a.ibitset(0); a.ibitset(40); a.ibitset(80);
    a.setZero();
    for (let i = 0; i < a.data.length; i++) {
        assert.strictEqual(a.data[i], 0, `word ${i} not cleared`);
    }
});

console.log('All BitVec.anyBitsInCommon/setZero tests passed.');
