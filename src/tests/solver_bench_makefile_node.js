#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');

for (const target of [
    'solver_benchmark_slice_manifest',
    'js_solver_bench_pair_smoke',
    'solver_bench_summary',
    'solver_bench_freshness',
]) {
    assert.ok(new RegExp(`^${target}:`, 'm').test(makefile), `missing Makefile target ${target}`);
}

assert.ok(/^SOLVER_BENCH_STORE \?= /m.test(makefile), 'missing SOLVER_BENCH_STORE default');
assert.ok(/^SOLVER_BENCH_SLICE \?= smoke-50$/m.test(makefile), 'missing SOLVER_BENCH_SLICE default');
assert.ok(/^SOLVER_BENCH_PAIR_RUNS \?= 3$/m.test(makefile), 'missing SOLVER_BENCH_PAIR_RUNS default');
assert.ok(makefile.includes('--runs $(SOLVER_BENCH_PAIR_RUNS)'), 'pair smoke target should use paired-run count');
assert.ok(makefile.includes('generate_solver_benchmark_slice_manifest.js'), 'slice target should call slice materializer');
assert.ok(makefile.includes('run_js_solver_bench_pair.js'), 'pair target should call JS paired runner');
assert.ok(makefile.includes('solver_bench_store_cli.js summary'), 'summary target should call bench-store summary');
assert.ok(makefile.includes('solver_bench_store_cli.js freshness'), 'freshness target should call bench-store freshness');

console.log('solver_bench_makefile_node passed');
