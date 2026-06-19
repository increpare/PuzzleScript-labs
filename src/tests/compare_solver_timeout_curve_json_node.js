#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { compareSolverJson, solvedAt } = require('./compare_solver_timeout_curve_json');

const origPath = path.resolve('build/solver-timeout-curve/js.json');
const canonPath = path.resolve('build/solver-timeout-curve/js-canonical.json');

const summary = compareSolverJson(origPath, canonPath);
assert.strictEqual(summary.max_ms, 1000);
assert(summary.orig_solved > 0);
assert(summary.canon_solved > 0);
assert.strictEqual(summary.flip_count, summary.gained_count + summary.lost_count);

assert.strictEqual(solvedAt({ status: 'solved', elapsed_ms: 500 }, 1000), true);
assert.strictEqual(solvedAt({ status: 'solved', elapsed_ms: 1500 }, 1000), false);
assert.strictEqual(solvedAt({ status: 'timeout', elapsed_ms: 100 }, 1000), false);

console.log('compare_solver_timeout_curve_json_node passed');
