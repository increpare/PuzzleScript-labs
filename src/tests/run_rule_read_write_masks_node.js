#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

loadPuzzleScript();
const { compileSource } = require('./lib/node_test_harness');

// Each fixture compiles a tiny game with exactly ONE rule and asserts on
// that rule's read/write masks. Later tasks append more fixtures here.
const FIXTURES = [
    {
        name: 'lhs-directional-modifier-sets-readMovements',
        source: `
title test
========
OBJECTS
========
Background
white
Player
red
Wall
grey
=======
LEGEND
=======
. = Background
P = Player
# = Wall
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Wall
Player
======
RULES
======
RIGHT [ > Player | Wall ] -> [ Player | Wall ]
==============
WINCONDITIONS
==============
=======
LEVELS
=======
.P#
`,
        expect: {
            // [ > Player | Wall ] gates on Player's movement-bit layer ('>'=right).
            readMovementsNonEmpty: true,
        },
    },
    {
        name: 'rhs-writes-new-object',
        source: `
title test
========
OBJECTS
========
Background
white
Player
red
Crab
blue
=======
LEGEND
=======
. = Background
P = Player
C = Crab
=======
SOUNDS
=======
================
COLLISIONLAYERS
================
Background
Player, Crab
======
RULES
======
[ Player ] -> [ Crab ]
==============
WINCONDITIONS
==============
=======
LEVELS
=======
.P.
`,
        expect: {
            // Crab is on the Player/Crab layer; writeObjects must include its bit.
            writeObjectsNonEmpty: true,
        },
    },
];

let failures = 0;
for (const fixture of FIXTURES) {
    try {
        const state = compileSource(fixture.source);
        const allRules = state.rules.flat().concat((state.lateRules || []).flat());
        assert.strictEqual(allRules.length, 1,
            `${fixture.name}: expected exactly 1 compiled rule, got ${allRules.length}`);
        const rule = allRules[0];
        const exp = fixture.expect;
        if (exp.readMovementsNonEmpty !== undefined) {
            assert.ok(rule.readMovements, `${fixture.name}: readMovements not present on rule`);
            const isZero = rule.readMovements.data.every(w => w === 0);
            assert.strictEqual(!isZero, exp.readMovementsNonEmpty,
                `${fixture.name}: readMovements non-empty`);
        }
        if (exp.writeObjectsNonEmpty !== undefined) {
            assert.ok(rule.writeObjects, `${fixture.name}: writeObjects not present on rule`);
            const isZero = rule.writeObjects.data.every(w => w === 0);
            assert.strictEqual(!isZero, exp.writeObjectsNonEmpty,
                `${fixture.name}: writeObjects non-empty`);
        }
        if (exp.writeMovementsNonEmpty !== undefined) {
            assert.ok(rule.writeMovements, `${fixture.name}: writeMovements not present on rule`);
            const isZero = rule.writeMovements.data.every(w => w === 0);
            assert.strictEqual(!isZero, exp.writeMovementsNonEmpty,
                `${fixture.name}: writeMovements non-empty`);
        }
        if (exp.forceAlwaysRun !== undefined) {
            assert.strictEqual(rule.forceAlwaysRun, exp.forceAlwaysRun,
                `${fixture.name}: forceAlwaysRun`);
        }
        if (exp.forceAlwaysRunReason !== undefined) {
            assert.strictEqual(rule.forceAlwaysRunReason, exp.forceAlwaysRunReason,
                `${fixture.name}: forceAlwaysRunReason`);
        }
        console.log(`  PASS ${fixture.name}`);
    } catch (err) {
        console.error(`  FAIL ${fixture.name}\n    ${err.message}`);
        failures++;
    }
}
process.exit(failures > 0 ? 1 : 0);
