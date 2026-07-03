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
    'js_solver_bench_pair_slice',
    'solver_bench_summary',
    'solver_bench_freshness',
    'solver_bench_compare',
    'solver_bench_retention_plan',
]) {
    assert.ok(new RegExp(`^${target}:`, 'm').test(makefile), `missing Makefile target ${target}`);
}

assert.ok(/^SOLVER_BENCH_STORE \?= /m.test(makefile), 'missing SOLVER_BENCH_STORE default');
assert.ok(/^SOLVER_BENCH_SLICE \?= smoke-50$/m.test(makefile), 'missing SOLVER_BENCH_SLICE default');
assert.ok(/^SOLVER_BENCH_PAIR_RUNS \?= 3$/m.test(makefile), 'missing SOLVER_BENCH_PAIR_RUNS default');
assert.ok(/^SOLVER_BENCH_RETENTION_DAYS \?= 30$/m.test(makefile), 'missing SOLVER_BENCH_RETENTION_DAYS default');
assert.ok(/^SOLVER_BENCH_BASELINE_VARIANT \?= baseline$/m.test(makefile), 'missing SOLVER_BENCH_BASELINE_VARIANT default');
assert.ok(/^SOLVER_BENCH_CANDIDATE_VARIANT \?= candidate$/m.test(makefile), 'missing SOLVER_BENCH_CANDIDATE_VARIANT default');
assert.ok(/^SOLVER_BENCH_NOISE_BAND \?= 1$/m.test(makefile), 'missing SOLVER_BENCH_NOISE_BAND default');
assert.ok(makefile.includes('--runs $(SOLVER_BENCH_PAIR_RUNS)'), 'pair smoke target should use paired-run count');
assert.ok(makefile.includes('generate_solver_benchmark_slice_manifest.js'), 'slice target should call slice materializer');
assert.ok(makefile.includes('run_js_solver_bench_pair.js'), 'pair target should call JS paired runner');
assert.ok(/^js_solver_bench_pair_slice: solver_benchmark_slice_manifest$/m.test(makefile), 'slice pair target should depend on manifest generation');
assert.ok(makefile.includes('$(SOLVER_BENCH_CORPUS)'), 'slice pair target should use the configured solver bench corpus');
assert.ok(makefile.includes('--slice-manifest "$(SOLVER_BENCH_SLICE_MANIFEST)"'), 'slice pair target should pass the generated manifest');
assert.ok(makefile.includes('solver_bench_store_cli.js summary'), 'summary target should call bench-store summary');
assert.ok(makefile.includes('solver_bench_store_cli.js freshness'), 'freshness target should call bench-store freshness');
assert.ok(makefile.includes('solver_bench_store_cli.js compare'), 'compare target should call bench-store compare');
assert.ok(makefile.includes('--baseline "$(SOLVER_BENCH_BASELINE_VARIANT)"'), 'compare target should use baseline variant default');
assert.ok(makefile.includes('--candidate "$(SOLVER_BENCH_CANDIDATE_VARIANT)"'), 'compare target should use candidate variant default');
assert.ok(makefile.includes('--noise-band $(SOLVER_BENCH_NOISE_BAND)'), 'compare target should use noise band default');
assert.ok(makefile.includes('solver_bench_store_cli.js retention-plan'), 'retention target should call bench-store retention planner');
assert.ok(makefile.includes('--max-age-days $(SOLVER_BENCH_RETENTION_DAYS)'), 'retention target should use retention-days default');

console.log('solver_bench_makefile_node passed');
