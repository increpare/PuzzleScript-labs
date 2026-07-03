#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
    packConfigs,
    summarizeTotals,
    aggregateProbeTotals,
} = require('./run_js_solver_instrumentation_pack');
const { analyzeSummary } = require('./analyze_js_solver_instrumentation_pack');

const corpusDir = path.join(__dirname, 'solver_smoke_tests');
const runner = path.join(__dirname, 'run_solver_tests_js.js');
const packRunner = path.join(__dirname, 'run_js_solver_instrumentation_pack.js');

assert.strictEqual(packConfigs.length, 4);

const baseline = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
));
assert.strictEqual(baseline.results[0].status, 'solved');
assert.ok(Array.isArray(baseline.results[0].heuristic_breakdown) || baseline.results[0].heuristic_breakdown === null);

const againProfiled = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions'],
    {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: Object.assign({}, process.env, { PUZZLESCRIPT_SOLVER_AGAIN_PROFILE: '1' }),
    },
));
assert.ok(Number.isFinite(againProfiled.results[0].process_input_calls), 'process_input_calls should be numeric');
assert.ok(Number.isFinite(againProfiled.results[0].again_passes), 'again_passes should be numeric');
assert.ok(againProfiled.results[0].process_input_calls >= againProfiled.results[0].generated);

const profiled = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions'],
    {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: Object.assign({}, process.env, { PUZZLESCRIPT_SOLVER_STEP_PROFILE: '1' }),
    },
));
assert.ok(profiled.results[0].step_profile_rule_match_ms > 0, 'rule match profiler should accumulate time');
assert.ok(profiled.results[0].step_profile_rule_apply_ms >= 0, 'rule apply profiler should accumulate time');
assert.ok(profiled.results[0].step_profile_early_rules_ms > 0, 'early rules profiler should accumulate time');

const hotspotProfiled = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions'],
    {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: Object.assign({}, process.env, {
            PUZZLESCRIPT_SOLVER_STEP_PROFILE: '1',
            PUZZLESCRIPT_SOLVER_RULE_HOTSPOTS: '1',
        }),
    },
));
assert.ok(Array.isArray(hotspotProfiled.results[0].rule_hotspots), 'rule_hotspots should be an array');
assert.ok(hotspotProfiled.results[0].rule_hotspots.length > 0, 'rule_hotspots should contain rows');
assert.ok(
    Number.isFinite(hotspotProfiled.results[0].rule_hotspots[0].try_apply_calls),
    'rule hotspot try_apply_calls should be numeric',
);

const heuristicSplit = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
));
assert.ok(heuristicSplit.totals.heuristic_score_ms > 0, 'heuristic score timing should be recorded');
assert.ok(Number.isFinite(heuristicSplit.totals.expanded_per_solved), 'expanded_per_solved should be in totals');

const adaptive = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions', '--adaptive-step-cost'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
));
assert.strictEqual(adaptive.results[0].adaptive_step_cost, true);
assert.ok(Number.isFinite(adaptive.results[0].adaptive_step_cost_triggered));

const adaptiveBfs = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions', '--strategy', 'bfs', '--adaptive-step-cost'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
));
assert.strictEqual(adaptiveBfs.results[0].adaptive_step_cost, false);
assert.strictEqual(adaptiveBfs.results[0].adaptive_step_cost_triggered, 0);

const adaptiveUntimed = JSON.parse(execFileSync(
    process.execPath,
    [runner, corpusDir, '--game', 'push_goal.txt', '--quiet', '--json', '--no-solutions', '--adaptive-step-cost'],
    {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: Object.assign({}, process.env, { PUZZLESCRIPT_SOLVER_DETAIL_TIMING: '0' }),
    },
));
assert.strictEqual(adaptiveUntimed.results[0].adaptive_step_cost, false);
assert.strictEqual(adaptiveUntimed.results[0].adaptive_step_cost_triggered, 0);

const benchStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-solver-bench-store-'));
const benchStorePath = path.join(benchStoreDir, 'bench-store.jsonl');
const benchArtifactPath = path.join(benchStoreDir, 'push-goal.json');
execFileSync(
    process.execPath,
    [
        runner,
        corpusDir,
        '--game', 'push_goal.txt',
        '--quiet',
        '--json',
        '--no-solutions',
        '--bench-store', benchStorePath,
        '--bench-slice', 'smoke-50',
        '--bench-variant', 'baseline',
        '--bench-pair-id', 'pair-js-1',
        '--bench-artifact', benchArtifactPath,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
const benchRecords = fs.readFileSync(benchStorePath, 'utf8')
    .trim()
    .split(/\n/)
    .map((line) => JSON.parse(line));
assert.strictEqual(benchRecords.length, 1);
assert.strictEqual(benchRecords[0].benchmark_slice, 'smoke-50');
assert.strictEqual(benchRecords[0].variant, 'baseline');
assert.strictEqual(benchRecords[0].pair_id, 'pair-js-1');
assert.strictEqual(benchRecords[0].totals.solved, 1);
assert.strictEqual(benchRecords[0].results[0].game, 'push_goal.txt');
assert.strictEqual(benchRecords[0].results[0].status, 'solved');
assert.ok(benchRecords[0].artifacts.includes(path.resolve(benchArtifactPath)));
assert.ok(fs.existsSync(benchArtifactPath), 'bench artifact JSON should be written');

const compileErrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-solver-compile-error-'));
fs.writeFileSync(path.join(compileErrorDir, 'bad.txt'), 'not puzzlescript at all\n');
const compileErrorAdaptive = JSON.parse(execFileSync(
    process.execPath,
    [runner, compileErrorDir, '--quiet', '--json', '--no-solutions', '--adaptive-step-cost'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
));
assert.strictEqual(compileErrorAdaptive.results[0].status, 'compile_error');
assert.strictEqual(compileErrorAdaptive.results[0].adaptive_step_cost, false);
assert.strictEqual(compileErrorAdaptive.results[0].adaptive_step_cost_triggered, 0);
assert.strictEqual(compileErrorAdaptive.totals.adaptive_step_cost_triggered, 0);

const adaptivePhaseSplit = JSON.parse(execFileSync(
    process.execPath,
    [
        runner,
        corpusDir,
        '--game', 'push_goal.txt',
        '--quiet',
        '--json',
        '--no-solutions',
        '--strategy', 'phase-split',
        '--portfolio-heuristics', 'auto,winconditions',
        '--adaptive-step-cost',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
));
assert.ok(Number.isFinite(adaptivePhaseSplit.results[0].adaptive_step_cost_triggered));

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-solver-pack-'));
execFileSync(
    process.execPath,
    [packRunner, corpusDir, '--out-dir', outDir, '--timeout-ms', '250', '--game', 'push_goal.txt'],
    { encoding: 'utf8', stdio: 'pipe' },
);
const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'summary.json'), 'utf8'));
assert.ok(summary.configs.baseline);
assert.ok(summary.configs.step_profile);
assert.ok(summary.configs.noop_probe);
assert.ok(summary.configs.cpu_profile_ready);
assert.strictEqual(summary.configs.baseline.totals.solved, 1);

const report = analyzeSummary(summary);
assert.ok(report.includes('JS solver instrumentation analysis'));
assert.ok(report.includes('Step profile'));

const noopTotals = summarizeTotals(Object.assign(
    {},
    JSON.parse(fs.readFileSync(path.join(outDir, 'noop_probe.json'), 'utf8')).totals,
    aggregateProbeTotals(JSON.parse(fs.readFileSync(path.join(outDir, 'noop_probe.json'), 'utf8')).results),
));
assert.ok(Number.isFinite(noopTotals.probe_dir_steps));

console.log('js_solver_instrumentation_pack_node passed');
