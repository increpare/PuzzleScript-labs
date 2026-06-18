#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { buildCurve, pointsAtStep, stepPolylinePoints } = require('./solver_timeout_curve');

const levels = [
    { status: 'solved', elapsed_ms: 37 },
    { status: 'solved', elapsed_ms: 37 },
    { status: 'solved', elapsed_ms: 83 },
    { status: 'timeout', elapsed_ms: 1000 },
    { status: 'skipped_message' },
    { status: 'compile_error' },
];
const options = { maxMs: 100, stepMs: 50 };

const curve = buildCurve(levels, options);
assert.strictEqual(curve.playable, 4);
assert.strictEqual(curve.totalSolvedAtMax, 3);
assert.deepStrictEqual(
    curve.points.map((p) => [p.timeout_ms, p.solved]),
    [[37, 2], [83, 3], [100, 3]]
);

const sampled = pointsAtStep(curve.points, options);
assert.deepStrictEqual(
    sampled.map((p) => [p.timeout_ms, p.solved]),
    [[50, 2], [100, 3]]
);

const steps = stepPolylinePoints(curve.points);
assert.deepStrictEqual(steps, [
    [0, 0],
    [37, 0],
    [37, 2],
    [83, 2],
    [83, 3],
    [100, 3],
]);

console.log('solver_timeout_curve_build_node passed');
