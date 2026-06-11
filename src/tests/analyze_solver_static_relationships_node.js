#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-static-relationships-'));
const corpusDir = path.join(tmpDir, 'corpus');
fs.mkdirSync(corpusDir);

const compatibleSource = `
title compatible

========
OBJECTS
========
Background
black
Player
white
Goal
yellow

=======
LEGEND
=======
. = Background
P = Player
G = Goal

======
SOUNDS
======

================
COLLISIONLAYERS
================
Background
Player
Goal

=====
RULES
=====
[ > Player | ] -> [ | > Player ]

=============
WINCONDITIONS
=============
Some Player On Goal

======
LEVELS
======
P.G
`;

const unsupportedSource = `
title unsupported

========
OBJECTS
========
Background
black
Player
white
Box
gray

=======
LEGEND
=======
. = Background
P = Player
B = Box

======
SOUNDS
======

================
COLLISIONLAYERS
================
Background
Player
Box

=====
RULES
=====
[ > Player | Box ] -> [ Player | Box ]

=============
WINCONDITIONS
=============
No Box

======
LEVELS
======
PB
`;

fs.writeFileSync(path.join(corpusDir, 'compatible.txt'), compatibleSource);
fs.writeFileSync(path.join(corpusDir, 'unsupported.txt'), unsupportedSource);

const manifestPath = path.join(tmpDir, 'solver_focus_group.json');
fs.writeFileSync(manifestPath, `${JSON.stringify({
    schema_version: 1,
    kind: 'solver_focus_group',
    targets: [
        { game: 'compatible.txt', level: 0 },
        { game: 'unsupported.txt', level: 0 },
    ],
}, null, 2)}\n`);

const outPath = path.join(tmpDir, 'relationships.json');
const result = spawnSync(process.execPath, [
    path.join(rootDir, 'src/tests/analyze_solver_static_relationships.js'),
    corpusDir,
    manifestPath,
    '--out',
    outPath,
    '--quiet',
], {
    cwd: rootDir,
    encoding: 'utf8',
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);

const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
assert.strictEqual(report.kind, 'solver_static_relationships');
assert.strictEqual(report.games.length, 2);
assert.ok(report.games.find(game => game.game === 'compatible.txt' && !game.skipped));

const skipped = report.games.find(game => game.game === 'unsupported.txt');
assert.ok(skipped, 'unsupported game should still be represented in the report');
assert.deepStrictEqual(skipped.skipped, {
    reason: 'unsupported_wincondition',
    detail: 'expected a single SOME ... ON ... wincondition',
});

console.log('analyze_solver_static_relationships_node: ok');
