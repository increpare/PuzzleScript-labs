#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-single-game-make-'));
const corpusDir = path.join(tmpRoot, 'games');
const gamePath = path.join(corpusDir, 'tiny-levels.txt');

fs.mkdirSync(corpusDir, { recursive: true });
fs.writeFileSync(gamePath, 'title tiny\n\nobjects\nbackground\nblack\n\nlegend\n. = background\n\nlevels\n.\n');

const result = spawnSync(
    'make',
    [
        'solver-time-curve-single-game',
        gamePath,
        'SOLVER_TIMEOUT_CURVE_MAX_MS=123',
        'MAKE=echo',
    ],
    {
        cwd: repoRoot,
        encoding: 'utf8',
    }
);

const output = `${result.stdout}\n${result.stderr}`;
assert.strictEqual(result.status, 0, output);
assert.match(output, /\bsolver_timeout_curve\b/);
assert.ok(
    output.includes(`SOLVER_TESTS_CORPUS="build/solver-timeout-curve-tiny-levels-123ms/input-corpus"`),
    output
);
assert.ok(
    output.includes('mkdir -p "build/solver-timeout-curve-tiny-levels-123ms/input-corpus"'),
    output
);
assert.ok(
    output.includes(`cp "${gamePath}" "build/solver-timeout-curve-tiny-levels-123ms/input-corpus/tiny-levels.txt"`),
    output
);
assert.ok(
    output.includes('SOLVER_TIMEOUT_CURVE_OUT_DIR="build/solver-timeout-curve-tiny-levels-123ms"'),
    output
);
assert.ok(
    output.includes('SOLVER_TIMEOUT_CURVE_EXTRA_ARGS="--game tiny-levels.txt"'),
    output
);
assert.ok(
    output.includes('SOLVER_TIMEOUT_CURVE_CPP_PORTFOLIO_ARGS="--jobs 1 --strategy portfolio --game tiny-levels.txt"'),
    output
);
assert.ok(
    output.includes('SOLVER_TIMEOUT_CURVE_CPP_HDA_ARGS="--strategy hda-weighted-astar --hda-jobs 8 --game tiny-levels.txt"'),
    output
);

console.log('solver_time_curve_single_game_make_node passed');

const hdaOnly = spawnSync(
    'make',
    [
        '-n',
        'solver-time-curve-single-game-hda-compiled',
        gamePath,
        'SOLVER_TIMEOUT_CURVE_MAX_MS=30000',
    ],
    {
        cwd: repoRoot,
        encoding: 'utf8',
    }
);

const hdaOutput = `${hdaOnly.stdout}\n${hdaOnly.stderr}`;
assert.strictEqual(hdaOnly.status, 0, hdaOutput);
assert.ok(
    hdaOutput.includes(`SOLVER_TESTS_CORPUS="${path.join('build', 'solver-timeout-curve-tiny-levels-30000ms-hda-compiled', 'input-corpus')}"`)
        || hdaOutput.includes(`"build/solver-timeout-curve-tiny-levels-30000ms-hda-compiled/input-corpus"`),
    hdaOutput
);
assert.ok(
    hdaOutput.includes('--series "c++ hda-weighted-astar x8 compiled:'),
    hdaOutput
);
assert.ok(
    hdaOutput.includes('--max-ms 30000'),
    hdaOutput
);
assert.ok(
    !hdaOutput.includes('--label "Javascript"'),
    hdaOutput
);
assert.ok(
    !hdaOutput.includes('cpp-portfolio'),
    hdaOutput
);

console.log('solver_time_curve_single_game_hda_compiled_make_node passed');
