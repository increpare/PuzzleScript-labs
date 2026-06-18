#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 1000;

let corpus = path.join(__dirname, 'solver_tests');
let interpreterSolver = null;
let compiledSolver = null;
let timeoutMs = DEFAULT_TIMEOUT_MS;

for (let i = 2; i < process.argv.length; ++i) {
    const arg = process.argv[i];
    const next = () => {
        assert.ok(i + 1 < process.argv.length, `missing value for ${arg}`);
        return process.argv[++i];
    };
    if (arg === '--corpus') {
        corpus = next();
    } else if (arg === '--interpreter-solver') {
        interpreterSolver = next();
    } else if (arg === '--compiled-solver') {
        compiledSolver = next();
    } else if (arg === '--timeout-ms') {
        timeoutMs = Number(next());
    } else if (arg === '--help' || arg === '-h') {
        console.log([
            'Usage: node src/tests/compact_turn_perf_regression_node.js',
            '  --interpreter-solver PATH --compiled-solver PATH [--corpus DIR] [--timeout-ms N]',
        ].join('\n'));
        process.exit(0);
    } else {
        throw new Error(`unknown argument ${arg}`);
    }
}

if (!interpreterSolver || !compiledSolver) {
    throw new Error('expected --interpreter-solver and --compiled-solver');
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid --timeout-ms ${timeoutMs}`);
}

function parseCounters(output) {
    const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith('solver_runtime_counters '));
    const counters = {};
    if (!line) {
        return counters;
    }
    for (const part of line.slice('solver_runtime_counters '.length).trim().split(/\s+/)) {
        const [key, value] = part.split('=');
        counters[key] = Number(value);
    }
    return counters;
}

function parseJson(output) {
    const jsonStart = output.indexOf('{');
    assert.notStrictEqual(jsonStart, -1, `solver output did not contain JSON:\n${output}`);
    return JSON.parse(output.slice(jsonStart));
}

function runSolver(solver, testCase, extraArgs) {
    const args = [
        corpus,
        '--timeout-ms', String(timeoutMs),
        '--jobs', '1',
        '--strategy', 'portfolio',
        '--game', testCase.game,
        '--level', String(testCase.level),
        '--json',
        '--no-solutions',
        '--quiet',
        '--profile-runtime-counters',
        ...extraArgs,
    ];
    const result = spawnSync(solver, args, { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error([
            `solver exited ${result.status}: ${solver}`,
            `args: ${args.join(' ')}`,
            'stdout:',
            result.stdout,
            'stderr:',
            result.stderr,
        ].join('\n'));
    }
    const json = parseJson(result.stdout);
    assert.strictEqual(json.results.length, 1, `expected one result for ${testCase.name}`);
    return {
        result: json.results[0],
        totals: json.totals || {},
        counters: parseCounters(`${result.stdout}\n${result.stderr}`),
    };
}

function msPerGenerated(run) {
    const generated = Number(run.result.generated) || 0;
    const stepMs = Number(run.result.step_ms) || 0;
    return generated > 0 ? stepMs / generated : Number.POSITIVE_INFINITY;
}

const cases = [
    {
        name: 'manic_ammo sparse anchor win',
        game: 'manic_ammo.txt',
        level: 26,
        validate(interpreter, compiled) {
            assert.ok(compiled.result.compact_turn_native_hits > 0, 'manic_ammo compiled run should use native compact turns');
            assert.ok(
                compiled.result.step_ms <= interpreter.result.step_ms * 0.35,
                `manic_ammo compiled step_ms should stay <=35% of interpreter: interpreter=${interpreter.result.step_ms} compiled=${compiled.result.step_ms}`
            );
        },
    },
    {
        name: 'Voitex Rasteriser 2 scan regression',
        game: 'Voitex Rasteriser 2.txt',
        level: 1,
        validate(interpreter, compiled) {
            const generatedClose = compiled.result.generated >= interpreter.result.generated * 0.9;
            const throughputClose = msPerGenerated(compiled) <= msPerGenerated(interpreter) * 1.15;
            assert.ok(
                compiled.result.compact_turn_native_hits > 0,
                'Voitex should use native compact turns after mini-VM parity'
            );
            assert.ok(
                generatedClose || throughputClose,
                [
                    'Voitex compiled run should not scan itself slower than interpreter',
                    `compiled native_hits=${compiled.result.compact_turn_native_hits}`,
                    `interpreter generated=${interpreter.result.generated} step_ms=${interpreter.result.step_ms} candidate_cells=${interpreter.counters.candidate_cells_tested}`,
                    `compiled generated=${compiled.result.generated} step_ms=${compiled.result.step_ms} candidate_cells=${compiled.counters.candidate_cells_tested}`,
                ].join('\n')
            );
        },
    },
];

const failures = [];
for (const testCase of cases) {
    const interpreter = runSolver(interpreterSolver, testCase, []);
    const compiled = runSolver(compiledSolver, testCase, ['--compact-node-storage']);
    try {
        testCase.validate(interpreter, compiled);
        console.log(
            `${testCase.name}: ok interpreter generated=${interpreter.result.generated} step_ms=${interpreter.result.step_ms}`
            + ` compiled generated=${compiled.result.generated} step_ms=${compiled.result.step_ms}`
        );
    } catch (error) {
        failures.push(`${testCase.name}: ${error.message}`);
    }
}

if (failures.length > 0) {
    throw new Error(failures.join('\n\n'));
}

console.log('compact_turn_perf_regression_node passed');
