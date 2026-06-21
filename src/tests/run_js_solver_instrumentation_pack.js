#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNNER = path.join(__dirname, 'run_solver_tests_js.js');
const DEFAULT_OUT_DIR = path.resolve('build/js/solver_instrumentation_pack');
const DEFAULT_TIMEOUT_MS = 250;

const packConfigs = [
    {
        id: 'baseline',
        label: 'baseline',
        env: {},
        args: [],
    },
    {
        id: 'step_profile',
        label: 'step-profile',
        env: { PUZZLESCRIPT_SOLVER_STEP_PROFILE: '1' },
        args: [],
    },
    {
        id: 'noop_probe',
        label: 'noop-probe',
        env: { PUZZLESCRIPT_SOLVER_NOOP_PROBE: '1' },
        args: [],
    },
    {
        id: 'cpu_profile_ready',
        label: 'cpu-profile-ready',
        env: { PUZZLESCRIPT_SOLVER_DETAIL_TIMING: '0' },
        args: [],
    },
];

function usage() {
    process.stderr.write(
        'Usage: node src/tests/run_js_solver_instrumentation_pack.js <solver_tests_dir> ' +
        '[--out-dir DIR] [--timeout-ms N] [--game NAME] [--level N] [--dry-run]\n',
    );
    process.exit(1);
}

function parseArgs(argv) {
    const options = {
        corpusDir: null,
        outDir: DEFAULT_OUT_DIR,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        gameFilter: null,
        levelFilter: null,
        dryRun: false,
        runnerArgs: [],
    };
    const args = argv.slice(2);
    if (args.length === 0) usage();
    options.corpusDir = path.resolve(args.shift());
    while (args.length > 0) {
        const arg = args[0];
        if (arg === '--out-dir' && args.length > 1) {
            options.outDir = path.resolve(args[1]);
            args.splice(0, 2);
        } else if (arg === '--timeout-ms' && args.length > 1) {
            options.timeoutMs = Number.parseInt(args[1], 10);
            args.splice(0, 2);
        } else if (arg === '--game' && args.length > 1) {
            options.gameFilter = args[1];
            args.splice(0, 2);
        } else if (arg === '--level' && args.length > 1) {
            options.levelFilter = Number.parseInt(args[1], 10);
            args.splice(0, 2);
        } else if (arg === '--dry-run') {
            options.dryRun = true;
            args.shift();
        } else {
            options.runnerArgs.push(arg);
            args.shift();
        }
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error(`--timeout-ms must be positive: ${options.timeoutMs}`);
    }
    return options;
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runConfig(options, config) {
    const runnerArgs = [
        options.corpusDir,
        '--timeout-ms', String(options.timeoutMs),
        '--quiet',
        '--json',
        '--no-solutions',
        ...options.runnerArgs,
        ...config.args,
    ];
    if (options.gameFilter) {
        runnerArgs.push('--game', options.gameFilter);
    }
    if (options.levelFilter !== null) {
        runnerArgs.push('--level', String(options.levelFilter));
    }
    if (options.dryRun) {
        return { argv: [RUNNER, ...runnerArgs], env: config.env };
    }
    const child = spawnSync(
        process.execPath,
        [RUNNER, ...runnerArgs],
        {
            env: Object.assign({}, process.env, config.env),
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 256,
        },
    );
    if (child.status !== 0) {
        throw new Error(
            `instrumentation pack config ${config.id} failed: ${child.stderr || child.stdout}`,
        );
    }
    return JSON.parse(child.stdout);
}

function summarizeTotals(totals) {
    const generated = Number(totals.generated) || 0;
    const stepMs = Number(totals.step_ms) || 0;
    const stepTotal = (Number(totals.step_changed) || 0) + (Number(totals.step_no_op) || 0);
    return {
        solved: Number(totals.solved) || 0,
        timeout: Number(totals.timeout) || 0,
        levels: Number(totals.levels) || 0,
        generated,
        expanded: Number(totals.expanded) || 0,
        expanded_per_solved: Number(totals.expanded_per_solved) || 0,
        step_ms: stepMs,
        heuristic_ms: Number(totals.heuristic_ms) || 0,
        heuristic_classify_ms: Number(totals.heuristic_classify_ms) || 0,
        heuristic_score_ms: Number(totals.heuristic_score_ms) || 0,
        us_per_step: generated > 0 ? (stepMs * 1000) / generated : 0,
        step_no_op_pct: stepTotal > 0 ? (100 * (Number(totals.step_no_op) || 0)) / stepTotal : 0,
        step_profile_early_rules_ms: Number(totals.step_profile_early_rules_ms) || 0,
        step_profile_late_rules_ms: Number(totals.step_profile_late_rules_ms) || 0,
        step_profile_movement_ms: Number(totals.step_profile_movement_ms) || 0,
        step_profile_command_ms: Number(totals.step_profile_command_ms) || 0,
        step_profile_win_ms: Number(totals.step_profile_win_ms) || 0,
        step_profile_rule_match_ms: Number(totals.step_profile_rule_match_ms) || 0,
        step_profile_rule_apply_ms: Number(totals.step_profile_rule_apply_ms) || 0,
        probe_dir_steps: Number(totals.probe_dir_steps) || 0,
        probe_noops: Number(totals.probe_noops) || 0,
        probe_blocked: Number(totals.probe_blocked) || 0,
        probe_blocked_changed: Number(totals.probe_blocked_changed) || 0,
        probe_blocked_noop: Number(totals.probe_blocked_noop) || 0,
    };
}

function aggregateProbeTotals(results) {
    const out = {
        probe_dir_steps: 0,
        probe_noops: 0,
        probe_blocked: 0,
        probe_blocked_changed: 0,
        probe_blocked_noop: 0,
    };
    for (const row of results || []) {
        out.probe_dir_steps += row.probe_dir_steps || 0;
        out.probe_noops += row.probe_noops || 0;
        out.probe_blocked += row.probe_blocked || 0;
        out.probe_blocked_changed += row.probe_blocked_changed || 0;
        out.probe_blocked_noop += row.probe_blocked_noop || 0;
    }
    return out;
}

function main() {
    const options = parseArgs(process.argv);
    const summary = {
        source: 'run_js_solver_instrumentation_pack.js',
        corpus_dir: options.corpusDir,
        timeout_ms: options.timeoutMs,
        game_filter: options.gameFilter,
        level_filter: options.levelFilter,
        configs: {},
    };

    if (options.dryRun) {
        for (const config of packConfigs) {
            summary.configs[config.id] = runConfig(options, config);
        }
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        return;
    }

    fs.mkdirSync(options.outDir, { recursive: true });
    for (const config of packConfigs) {
        process.stderr.write(`js_solver_instrumentation_pack config=${config.id}\n`);
        const json = runConfig(options, config);
        const outPath = path.join(options.outDir, `${config.id}.json`);
        writeJson(outPath, json);
        const totals = Object.assign({}, json.totals || {}, aggregateProbeTotals(json.results));
        summary.configs[config.id] = {
            label: config.label,
            env: config.env,
            output: outPath,
            totals: summarizeTotals(totals),
        };
    }
    const summaryPath = path.join(options.outDir, 'summary.json');
    writeJson(summaryPath, summary);
    process.stderr.write(
        `js_solver_instrumentation_pack wrote ${options.outDir} ` +
        `(baseline solved ${summary.configs.baseline.totals.solved})\n`,
    );
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        process.exit(1);
    }
}

module.exports = {
    packConfigs,
    parseArgs,
    summarizeTotals,
    aggregateProbeTotals,
};
