#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { canonicalizeSemanticWithObjectMap, canonicalizeSource, compileSemanticSource } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');

function game(wincondition) {
    return `title Aggregate WIN semantics

objects

Background
black

Player
blue

A
red

B
yellow

legend

. = Background
P = Player
X = A
Y = B
AandB = A and B
Everything = Background and Player and A and B

sounds

collisionlayers

Background
Player
A
B

rules

winconditions

${wincondition}

levels

P.
`;
}

function conditionHolds(condition, objectNames, compiledState) {
    const cellIds = new Set(objectNames.map(name => compiledState.objects[name].id));
    function matches(mask, aggregate) {
        const ids = Object.values(compiledState.objects).map(object => object.id).filter(id => mask.get(id));
        return aggregate ? ids.every(id => cellIds.has(id)) : ids.some(id => cellIds.has(id));
    }
    const a = matches(condition[1], condition[4]);
    const b = matches(condition[2], condition[5]);
    return condition[0] === -1 ? !(a && b) : condition[0] === 0 ? a && b : !a || b;
}

for (const [wincondition, aggregateA, aggregateB] of [
    ['no AandB', true, false],
    ['some Player on AandB', false, true],
    ['all AandB on AandB', true, true],
    ['no Player on Everything', false, true],
    ['all Player on Everything', false, true],
]) {
    const source = game(wincondition);
    const originalState = compileSemanticSource(source).state;
    for (const collapseEquivalentObjects of [false, true]) {
        const { canonical, objectMap } = canonicalizeSemanticWithObjectMap(source, { collapseEquivalentObjects });
        const condition = canonical.winConditions[0];
        assert.strictEqual(condition.aAggregate, aggregateA || undefined, `${wincondition}: preserves aggregate A (${collapseEquivalentObjects})`);
        assert.strictEqual(condition.bAggregate, aggregateB || undefined, `${wincondition}: preserves aggregate B (${collapseEquivalentObjects})`);
        const emitted = decanonicalizeSemantic(canonical);
        const emittedState = compileSemanticSource(emitted).state;
        assert.strictEqual(!!emittedState.winconditions[0][4], aggregateA, `${wincondition}: emitted A retains AND semantics`);
        assert.strictEqual(!!emittedState.winconditions[0][5], aggregateB, `${wincondition}: emitted B retains AND semantics`);
        if (aggregateB) {
            assert.match(emitted.split(/WINCONDITIONS/)[1], /\bon\b/, 'aggregate B must retain ON even for the full universe');
        }
        // All combinations on an injected tile preserve the compiled predicate.
        // Background is present as on every valid PuzzleScript board.
        for (let subset = 0; subset < 8; subset++) {
            const objects = ['background'].concat(['player', 'a', 'b'].filter((_, index) => subset & (1 << index)));
            const mapped = objects.map(name => objectMap.get(name)).filter(Boolean);
            if (canonical.backgroundObjects.length === 0) {
                mapped.push(Object.keys(emittedState.objects).find(name => !Array.from(objectMap.values()).includes(name)));
            }
            assert.strictEqual(
                conditionHolds(emittedState.winconditions[0], mapped, emittedState),
                conditionHolds(originalState.winconditions[0], objects, originalState),
                `${wincondition}: injected object subset ${subset} (${collapseEquivalentObjects})`
            );
        }
        const roundTrip = canonicalizeSource(emitted, 'semantic', { collapseEquivalentObjects });
        assert.strictEqual(roundTrip.winConditions[0].aAggregate, condition.aAggregate);
        assert.strictEqual(roundTrip.winConditions[0].bAggregate, condition.bAggregate);
    }
}

const ordinary = canonicalizeSource(game('no A'), 'semantic').winConditions[0];
assert.ok(!Object.prototype.hasOwnProperty.call(ordinary, 'aAggregate'));
assert.ok(!Object.prototype.hasOwnProperty.call(ordinary, 'bAggregate'));
console.log('aggregate_win_semantics_node: ok');
