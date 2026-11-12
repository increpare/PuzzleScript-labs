#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { canonicalizeSource, canonicalizeSemanticWithObjectMap, canonicalizeSemanticStateWithObjectMap,
    compileSemanticSource, hashCanonical } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');
const { loadPuzzleScript } = require('../../typescript/test/native-host.cjs');
const { normalizeCanonicalExecutionOrder } = require('../js/canonicalize_order');

const source = `objects
Background
black

Start
blue

Finish
green

Near
yellow

Far
red

Goal
white

Mark
pink

legend
. = Background
P = Start
N = Near
F = Far and Goal
player = Start or Finish
obstacle = ORDER

sounds

collisionlayers
Background
Start, Finish
Near
Far
Goal
Mark

rules
right [ action Start | ... | obstacle ] -> [ Finish | ... | obstacle Mark ]

winconditions
some Mark on Goal

levels
P.N.F
`;
const options = { executionOrder: 'dependency', staticOptimizations: false };
const canonical = text => canonicalizeSource(text, 'semantic', options);
const hash = text => hashCanonical(canonical(text));
const farFirst = source.replace('ORDER', 'Far or Near');
const nearFirst = source.replace('ORDER', 'Near or Far');
assert.equal(hashCanonical(canonicalizeSource(farFirst, 'semantic')), hashCanonical(canonicalizeSource(nearFirst, 'semantic')));
assert.notEqual(hash(farFirst), hash(nearFirst), 'competing property alternatives must keep expansion order');
assert.throws(() => canonicalizeSemanticStateWithObjectMap(compileSemanticSource(farFirst).state, options), /already coalesced/);
assert.throws(() => canonicalizeSource(farFirst, 'semantic', { executionOrder: 'unknown' }), /executionOrder/);

// Check behavior with the pinned vanilla runtime, independently of the Labs
// compiler that originally hid this discrepancy.
loadPuzzleScript();
unitTesting = true;
function replay(text, inputs, objectMap) {
    resetParserErrorState(); levelString = text;
    compile(['loadLevel', 0], text, 'canonical-order-regression');
    assert.equal(errorCount, 0);
    const snapshot = () => {
        const cells = [];
        for (let i = 0; i < level.n_tiles; i++) {
            const names = [];
            for (const [name, object] of Object.entries(state.objects)) {
                if (!level.getCell(i).get(object.id)) continue;
                const mapped = objectMap ? objectMap.get(name) : name;
                if (mapped) names.push(mapped);
            }
            cells.push(names.sort());
        }
        return { cells, width: level.width, height: level.height, titleScreen, textMode, winning };
    };
    const trace = [snapshot()];
    for (const input of inputs) {
        if (input === 'undo') DoUndo(false, true);
        else if (input === 'restart') DoRestart();
        else processInput(input);
        let count = 0;
        while (againing) {
            assert.ok(++count < 1000);
            againing = false; processInput(-1);
        }
        trace.push(snapshot());
    }
    return { ...trace.at(-1), trace };
}
function replayProjected(projected, inputs) {
    const names = projected.canonical.collisionLayers.flat();
    return replay(decanonicalizeSemantic(projected.canonical), inputs, new Map(names.map(name => [name, name])));
}
for (const [text, wins] of [[farFirst, true], [nearFirst, false]]) {
    const projected = canonicalizeSemanticWithObjectMap(text, options);
    const emitted = decanonicalizeSemantic(projected.canonical);
    const original = replay(text, [4], projected.objectMap);
    assert.equal(original.titleScreen, wins);
    assert.deepEqual(replayProjected(projected, [4]), original);
    assert.equal(hash(emitted), hash(text), 'projection must be idempotent through source emission');
}

// These independent groups touch separate collision layers. Their order can
// change without changing the result, and should no longer split hashes.
const independentBase = nearFirst.replace(
    'right [ action Start | ... | obstacle ] -> [ Finish | ... | obstacle Mark ]',
    'RULES_HERE');
const a = 'right [ action Start ] -> [ Finish ]';
const b = 'right [ Near ] -> [ Far ]'; // Near and Far have distinct layers.
const independent = independentBase.replace('RULES_HERE', a + '\n' + b);
const swapped = independentBase.replace('RULES_HERE', b + '\n' + a);
assert.notEqual(hashCanonical(canonicalizeSource(independent, 'semantic')), hashCanonical(canonicalizeSource(swapped, 'semantic')));
assert.equal(hash(independent), hash(swapped), 'independent groups should share a canonical ordering');
for (const text of [independent, swapped]) {
    const p = canonicalizeSemanticWithObjectMap(text, options);
    assert.deepEqual(replayProjected(p, [4]), replay(text, [4], p.objectMap));
}
const withInertAliases = swapped.replace('legend\n', 'Unused1\ngreen\n\nUnused2\ngreen\n\nlegend\n')
    .replace('Mark\n\nrules\n', 'Mark\nUnused1, Unused2\n\nrules\n');
assert.notEqual(withInertAliases, swapped);
assert.equal(hash(decanonicalizeSemantic(canonical(withInertAliases))), hash(withInertAliases),
    'discarded inert aliases must not change the labeling-safety decision');
const randomProperty = nearFirst.replace('right [ action Start', 'random right [ action Start');
assert.equal(hash(decanonicalizeSemantic(canonical(randomProperty))), hash(randomProperty),
    'expanded random variants must normalize the group-wide random flag');
const randomProjection = canonicalizeSemanticWithObjectMap(randomProperty, options);
assert.deepEqual(replayProjected(randomProjection, [4]), replay(randomProperty, [4], randomProjection.objectMap),
    'seeded random-group candidate order must preserve the observed result');

// Stable predicates + identical constant writes can keep a multi-layer
// property compact; the new path need not expand everything.
const stable = nearFirst.replace(
    '[ Finish | ... | obstacle Mark ]', '[ action Start | ... | obstacle Mark ]');
assert.ok(canonical(stable).rules.some(rule => rule.lhs.some(row => row.some(cell =>
    !cell.ellipsis && cell.some(entry => entry.objs && entry.objs.length > 1)))));
assert.equal(hash(decanonicalizeSemantic(canonical(stable))), hash(stable), 'compact certificate must survive explicit stationary writes from the emitter');

// Do not confuse a failed independence proof with permission to sort. Check
// implicit same-layer erasure, movement conflicts, commands, random groups,
// rigid effects, and loop/phase boundaries using explicit canonical fixtures.
const empty = { format: 'puzzlescript-semantic-canonical-v1', metadata: [], playerObjects: ['p'], backgroundObjects: [],
    collisionLayers: [['p'], ['a', 'z'], ['b']], rules: [], levels: [], winConditions: [] };
const rule = (object, replacement, groupNumber = 0) => ({ direction: 'right', late: false, rigid: false, randomRule: false,
    groupNumber, lhs: [[[ { dir: '', obj: object } ]]], rhs: [[[ { dir: '', obj: replacement } ]]], commands: [] });
const normalize = rules => normalizeCanonicalExecutionOrder({ ...empty, rules }).rules;
const z = rule('z', 'z'), ar = rule('a', 'a');
assert.deepEqual(normalize([z, { ...ar, commands: [['cancel']] }]), [z, { ...ar, commands: [['cancel']] }]);
for (const flag of ['rigid', 'randomRule']) assert.deepEqual(normalize([{ ...z, [flag]: true }, ar]), [{ ...z, [flag]: true }, ar]);
const mixedRandom = [{ ...z, randomRule: true }, rule('b', 'p'), ar];
assert.deepEqual(normalize(mixedRandom), mixedRandom, 'RANDOM governs all + rules, including ones without a local random flag');
const eraser = rule('b', 'a');
assert.equal(normalize([eraser, z])[0].lhs[0][0][0].obj, 'b', 'writing A may erase Z on the same collision layer');
const looped = { ...empty, rules: [rule('b', 'b', 0), rule('a', 'a', 1)], loops: [{ startGroup: 0, endGroup: 0 }] };
assert.deepEqual(normalizeCanonicalExecutionOrder(looped), looped);
const late = [{ ...z, late: true }, { ...ar, groupNumber: 1 }];
assert.deepEqual(normalize(late), late);

// Real Snortal roundtrip, including the recorded portal/undo/restart tape.
const snortal = fs.readFileSync(require('node:path').join(__dirname, 'solver_tests/snortal.txt'), 'utf8');
const reversedSnortal = snortal.replace(/Obstacle = SnakeBod or Wall/i, 'Obstacle = Wall or SnakeBod');
assert.notEqual(reversedSnortal, snortal);
assert.notEqual(hash(snortal), hash(reversedSnortal), 'Snortal property-order variants must retain distinct projections');
const projected = canonicalizeSemanticWithObjectMap(snortal, options);
assert.equal(hash(decanonicalizeSemantic(projected.canonical)), hash(snortal));
const tape = [1, 1, 2, 2, 3, 0, 4, 3, 3, 'restart', 4, 3, 4, 3, 3, 3, 1, 'undo', 'undo', 3, 0, 2, 1, 1, 2, 4, 2, 3, 4, 3, 3, 3, 3];
assert.deepEqual(replayProjected(projected, tape), replay(snortal, tape, projected.objectMap));
console.log('canonical_execution_order_node: ok');
