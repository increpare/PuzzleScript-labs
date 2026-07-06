#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const {
    parseArgs,
    __solverSearchInternals,
} = require('./run_solver_tests_js');

const { createSolverHashProjectionObjectWords } = __solverSearchInternals;

function solverHashProjectionReport(value) {
    return {
        status: 'ok',
        facts: {
            solver_hash_projection: [{
                id: 'solver_hash_projection',
                status: 'candidate',
                value,
            }],
        },
    };
}

function run() {
    assert.strictEqual(
        parseArgs(['node', 'run_solver_tests_js.js', 'src/tests/solver_smoke_tests', '--solver-hash-projection']).solverHashProjection,
        true,
        'CLI should enable solver hash projection',
    );
    assert.strictEqual(
        parseArgs(['node', 'run_solver_tests_js.js', 'src/tests/solver_smoke_tests', '--solver-hash-projection-parity']).solverHashProjectionParity,
        true,
        'CLI should enable solver hash projection parity',
    );

    const mockState = {
        objects: {
            player: { id: 0 },
            sparkle: { id: 1 },
            alpha: { id: 33 },
        },
        original_case_names: {
            player: 'Player',
            sparkle: 'Sparkle',
            alpha: 'Alpha',
        },
    };
    const projected = createSolverHashProjectionObjectWords(solverHashProjectionReport({
        scope: 'solver_hash_only',
        projected_objects: ['Sparkle'],
        transient_objects: ['Alpha'],
        blockers: [],
    }), mockState, 2);
    assert.strictEqual(projected.count, 2, 'projected and transient object names should both enter the mask');
    assert.strictEqual(projected.words[0], 1 << 1, 'Sparkle id=1 should set word 0 bit 1');
    assert.strictEqual(projected.words[1], 1 << 1, 'Alpha id=33 should set word 1 bit 1');

    const blocked = createSolverHashProjectionObjectWords(solverHashProjectionReport({
        scope: 'solver_hash_only',
        projected_objects: ['Sparkle'],
        transient_objects: [],
        blockers: ['random_mechanics'],
    }), mockState, 2);
    assert.strictEqual(blocked.count, 0, 'blocked projection facts should not be consumed automatically');
    assert.ok(blocked.blockers.includes('random_mechanics'));

    const runner = path.join(__dirname, 'run_solver_tests_js.js');
    const corpus = path.join(__dirname, 'solver_smoke_tests');
    const stdout = execFileSync(process.execPath, [
        runner,
        corpus,
        '--game', 'hash_projection_cosmetic.txt',
        '--level', '0',
        '--timeout-ms', '1000',
        '--strategy', 'bfs',
        '--solver-hash-projection',
        '--solver-hash-projection-parity',
        '--no-solutions',
        '--json',
        '--quiet',
    ], {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf8',
    });
    const payload = JSON.parse(stdout);
    assert.strictEqual(payload.results.length, 1);
    assert.strictEqual(payload.results[0].status, 'solved');
    assert.ok(payload.results[0].hash_mode.includes('hash_projection'), payload.results[0].hash_mode);
    assert.ok(payload.results[0].solver_hash_projection_projected_objects >= 1);
    assert.ok(payload.totals.solver_hash_projection_projected_objects >= 1);

    const baselineToggle = JSON.parse(execFileSync(process.execPath, [
        runner,
        corpus,
        '--game', 'hash_projection_toggle.txt',
        '--level', '0',
        '--timeout-ms', '1000',
        '--strategy', 'bfs',
        '--no-solutions',
        '--json',
        '--quiet',
    ], {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf8',
    }));
    const projectedToggle = JSON.parse(execFileSync(process.execPath, [
        runner,
        corpus,
        '--game', 'hash_projection_toggle.txt',
        '--level', '0',
        '--timeout-ms', '1000',
        '--strategy', 'bfs',
        '--solver-hash-projection',
        '--solver-hash-projection-parity',
        '--no-solutions',
        '--json',
        '--quiet',
    ], {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf8',
    }));
    assert.strictEqual(baselineToggle.results[0].status, 'exhausted');
    assert.strictEqual(projectedToggle.results[0].status, 'exhausted');
    assert.ok(projectedToggle.results[0].solver_hash_projection_projected_objects >= 1);
    assert.ok(
        projectedToggle.results[0].unique_states < baselineToggle.results[0].unique_states,
        `expected projection to reduce unique states (${baselineToggle.results[0].unique_states} -> ${projectedToggle.results[0].unique_states})`,
    );
}

run();
process.stdout.write('solver_hash_projection_node: ok\n');
