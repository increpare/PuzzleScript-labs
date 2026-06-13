#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-solver-level-benchmark-'));
const corpusDir = path.join(tmpDir, 'corpus');
fs.mkdirSync(corpusDir);
fs.writeFileSync(path.join(corpusDir, 'meta.txt'), 'title meta\n');

const fakeSolverPath = path.join(tmpDir, 'fake_solver.js');
fs.writeFileSync(fakeSolverPath, `#!/usr/bin/env node
'use strict';
process.stdout.write(JSON.stringify({
  totals: { errors: 0 },
  results: [{
    game: 'meta.txt',
    level: 0,
    status: 'timeout',
    strategy: 'portfolio',
    heuristic: 'mixed:auto:balanced',
    astar_weight: 2,
    elapsed_ms: 1000,
    expanded: 10,
    generated: 20,
    unique_states: 15,
    duplicates: 5,
    max_frontier: 30,
    solution_length: 0,
    timeout_ms: 1000,
    portfolio_profile: 'balanced',
    portfolio_rule_count: 4,
    portfolio_object_mutating_rule_count: 2,
    portfolio_movement_only_rule_count: 4,
    portfolio_command_rule_count: 0,
    portfolio_semantic_command_rule_count: 0,
    portfolio_command_only_rule_count: 0,
    portfolio_late_rule_count: 0,
    portfolio_all_win_condition_count: 0,
    portfolio_some_win_condition_count: 1,
    portfolio_all_plain_win_count: 0,
    portfolio_no_plain_win_count: 0,
    portfolio_win_condition_count: 1,
    portfolio_has_action_input: false,
    portfolio_has_again: true,
    portfolio_run_rules_on_level_start: false,
    portfolio_uses_random: false
  }]
}) + '\\n');
`);
fs.chmodSync(fakeSolverPath, 0o755);

const manifestPath = path.join(tmpDir, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify({
    targets: [
        { game: 'meta.txt', level: 0, first_solved_timeout_ms: 1000 },
    ],
}, null, 2)}\n`);

const outPath = path.join(tmpDir, 'benchmark.json');
const result = spawnSync(process.execPath, [
    path.join(rootDir, 'src/tests/run_solver_level_benchmark.js'),
    fakeSolverPath,
    corpusDir,
    manifestPath,
    '--runs',
    '1',
    '--out',
    outPath,
    '--strategy',
    'portfolio',
], {
    cwd: rootDir,
    encoding: 'utf8',
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);

const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
assert.strictEqual(output.targets.length, 1);
const row = output.targets[0];
assert.strictEqual(row.samples[0].portfolio_profile, 'balanced');
assert.strictEqual(row.samples[0].portfolio_rule_count, 4);
assert.strictEqual(row.samples[0].portfolio_has_action_input, false);
assert.strictEqual(row.median.portfolio_profile, 'balanced');
assert.strictEqual(row.median.portfolio_rule_count, 4);
assert.strictEqual(row.median.portfolio_has_again, true);

console.log('run_solver_level_benchmark_node passed');
