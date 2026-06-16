'use strict';

const assert = require('assert');
const { analyzeInputSpecialization } = require('../canonicalize');

const BIT = {
    up: 1 << 0,
    left: 1 << 1,
    down: 1 << 2,
    right: 1 << 3,
    action: 1 << 4,
    tick: 1 << 5,
};
const ALL = 0b111111;

const GAME = `
title Input Specialization Test

========
OBJECTS
========
Background
black
Wall
grey
Player
yellow
Crate
brown
Target
green

=======
LEGEND
=======
. = Background
# = Wall
P = Player
* = Crate
O = Target

================
COLLISIONLAYERS
================
Background
Target
Player, Wall, Crate

=====
RULES
=====
[ > Player | Crate ] -> [ > Player | > Crate ]
[ Crate Target ] -> [ Crate Target ] sfx0

=============
WINCONDITIONS
=============
All Crate on Target

======
LEVELS
======
#####
#P*O#
#####
`;

const report = analyzeInputSpecialization(GAME);
assert.strictEqual(report.ok, true, 'fixture should compile');
assert.ok(report.mainRules.length >= 5, 'push line should expand into directional rules');

const byLine = new Map();
for (const rule of report.mainRules) {
    if (!byLine.has(rule.line)) byLine.set(rule.line, []);
    byLine.get(rule.line).push(rule);
}

assert.ok(report.mainRules.some(rule => rule.activeInputsMask !== ALL),
    'at least one main rule should be specialized');
assert.ok(report.mainRules.some(rule => rule.activeInputsMask === ALL),
    'movement-free command rule should be active on all inputs');

const pushLine = Array.from(byLine.values()).find(rules => rules.length >= 4);
assert.ok(pushLine, 'expected one source line to have four directional push copies');

for (const inputName of ['up', 'down', 'left', 'right']) {
    const activeCopies = pushLine.filter(rule => (rule.activeInputsMask & BIT[inputName]) !== 0);
    assert.strictEqual(activeCopies.length, 1,
        `exactly one push copy should be active for ${inputName}`);
}

assert.strictEqual(pushLine.filter(rule => (rule.activeInputsMask & BIT.action) !== 0).length, 0,
    'push copies should be inactive for action');
assert.strictEqual(pushLine.filter(rule => (rule.activeInputsMask & BIT.tick) !== 0).length, 0,
    'push copies should be inactive for tick');

const report2 = analyzeInputSpecialization(GAME);
assert.deepStrictEqual(
    report2.mainRules.map(rule => rule.activeInputsMask),
    report.mainRules.map(rule => rule.activeInputsMask),
    'mask computation should be deterministic',
);

console.log('input_specialization_node: ok');
