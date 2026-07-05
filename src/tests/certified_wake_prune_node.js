#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUNNER = path.join(__dirname, 'run_solver_tests_js.js');
const POSITIVE_SOURCE_PATH = path.join(__dirname, 'solver_tests', 'snortal.txt');

const NO_BENEFIT_SOURCE = `
title certified wake prune no benefit fixture
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
Goal
Player

======
RULES
======

[ Player ] -> [ Player ]

==============
WINCONDITIONS
==============

some Player on Goal

======
LEVELS
======

P.G
`;

function runSolverWithSources(sources) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-certified-wake-prune-'));
    try {
        for (const [name, source] of Object.entries(sources)) {
            fs.writeFileSync(path.join(tmp, name), source, 'utf8');
        }
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
        return JSON.parse(out);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function resultFor(payload, game) {
    return (payload.results || []).find(row => row.game === game);
}

function run() {
    const payload = runSolverWithSources({
        'positive.txt': fs.readFileSync(POSITIVE_SOURCE_PATH, 'utf8'),
        'no-benefit.txt': NO_BENEFIT_SOURCE,
    });
    assert.strictEqual(payload.totals.levels, 2);
    assert.strictEqual(payload.totals.certified_wake_prune_enabled, true);
    assert.strictEqual(payload.totals.certified_wake_prune_installed_games, 1);
    assert.strictEqual(payload.totals.certified_wake_prune_abstained_games, 1);

    const installed = resultFor(payload, 'positive.txt');
    assert.ok(installed, 'fixture result should exist');
    assert.strictEqual(installed.certified_wake_prune_installed, true);
    assert.ok(installed.certified_wake_prune_mapped_rules >= 2);
    assert.ok(installed.certified_wake_prune_rule_refs_removed > 0);

    const noBenefit = resultFor(payload, 'no-benefit.txt');
    assert.ok(noBenefit, 'no-benefit result should exist');
    assert.strictEqual(noBenefit.certified_wake_prune_installed, false);
    assert.strictEqual(noBenefit.certified_wake_prune_abstained, true);
    assert.strictEqual(noBenefit.certified_wake_prune_abstain_reason, 'no_rule_ref_reduction');
    assert.strictEqual(noBenefit.certified_wake_prune_rule_refs_removed, 0);
}

run();
process.stdout.write('certified_wake_prune_node: ok\n');
