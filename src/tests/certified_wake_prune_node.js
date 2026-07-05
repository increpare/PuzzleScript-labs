#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUNNER = path.join(__dirname, 'run_solver_tests_js.js');

const SOURCE = `
title certified wake prune fixture
author test

========
OBJECTS
========

Background
black

Player
white

Goal
green

Marker
red

=======
LEGEND
=======

. = Background
P = Player
G = Goal
M = Marker

======
SOUNDS
======

================
COLLISIONLAYERS
================

Background
Goal
Player
Marker

======
RULES
======

[ Marker ] -> [ Marker ]
[ ACTION Player ] -> [ ACTION Player Marker ]

==============
WINCONDITIONS
==============

some Player on Goal

======
LEVELS
======

P.G
`;

function run() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-certified-wake-prune-'));
    try {
        fs.writeFileSync(path.join(tmp, 'fixture.txt'), SOURCE, 'utf8');
        const out = execFileSync(process.execPath, [
            RUNNER,
            tmp,
            '--certified-wake-prune',
            '--solver-opt-parity',
            '--timeout-ms',
            '1000',
            '--strategy',
            'bfs',
            '--quiet',
            '--json',
            '--no-solutions',
        ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
        const payload = JSON.parse(out);
        assert.strictEqual(payload.totals.levels, 1);
        assert.strictEqual(payload.totals.certified_wake_prune_enabled, true);
        assert.strictEqual(payload.totals.certified_wake_prune_installed_games, 1);
        assert.ok(payload.totals.certified_wake_prune_mapped_rules >= 2);
        assert.ok(payload.results[0].certified_wake_prune_rule_refs_removed >= 0);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

run();
process.stdout.write('certified_wake_prune_node: ok\n');
