#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.join(__dirname, 'run_solver_tests_js.js');

function usage() {
    process.stderr.write(
        'Usage: node src/tests/bench_solver.js <corpus_dir> [runner args...] [--out PATH] [--csv PATH] [--configs PATH]\n' +
        '  --configs JSON: [{ "name": "baseline", "env": {}, "args": [] }, ...]\n',
    );
    process.exit(2);
}

function parseArgs(argv) {
    const options = {
        corpus: null,
        runnerArgs: [],
        out: null,
        csv: null,
        configs: null,
    };
    const args = argv.slice(2);
    if (args.length === 0) usage();
    options.corpus = args.shift();
    while (args.length > 0) {
        const arg = args[0];
        if (arg === '--out' && args.length > 1) {
            options.out = args[1];
            args.splice(0, 2);
        } else if (arg === '--csv' && args.length > 1) {
            options.csv = args[1];
            args.splice(0, 2);
        } else if (arg === '--configs' && args.length > 1) {
            options.configs = JSON.parse(fs.readFileSync(path.resolve(args[1]), 'utf8'));
            args.splice(0, 2);
        } else {
            options.runnerArgs.push(arg);
            args.shift();
        }
    }
    return options;
}

function runConfig(corpus, runnerArgs, config) {
    const env = { ...process.env, ...(config.env || {}) };
    const extraArgs = Array.isArray(config.args) ? config.args : [];
    const child = spawnSync(
        process.execPath,
        [RUNNER, corpus, ...runnerArgs, ...extraArgs, '--quiet', '--json', '--no-solutions'],
        { env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 },
    );
    if (child.status !== 0) {
        throw new Error(`bench_solver run failed (${config.name || 'config'}): ${child.stderr || child.stdout}`);
    }
    return JSON.parse(child.stdout);
}

function summaryFromJson(json, label) {
    const t = json.totals || {};
    const generated = Number(t.generated) || 0;
    const stepMs = Number(t.step_ms) || 0;
    const usPerStep = generated > 0 ? (stepMs * 1000) / generated : 0;
    const stepTotal = (Number(t.step_changed) || 0) + (Number(t.step_no_op) || 0);
    const noOpPct = stepTotal > 0 ? (100 * (Number(t.step_no_op) || 0)) / stepTotal : 0;
    return {
        label: label || 'run',
        solved: Number(t.solved) || 0,
        timeout: Number(t.timeout) || 0,
        levels: Number(t.levels) || 0,
        generated,
        expanded: Number(t.expanded) || 0,
        step_ms: stepMs,
        heuristic_ms: Number(t.heuristic_ms) || 0,
        us_per_step: usPerStep,
        step_no_op: Number(t.step_no_op) || 0,
        step_changed: Number(t.step_changed) || 0,
        step_no_op_pct: noOpPct,
    };
}

function csvEscape(value) {
    const s = String(value);
    if (/[",\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function writeCsv(csvPath, json, label) {
    const header = 'config,game,level,status,solved,generated,expanded,elapsed_ms,step_ms,heuristic_ms,solution_length,step_no_op,step_changed';
    let body = '';
    for (const row of json.results || []) {
        const solved = row.status === 'solved' ? 1 : 0;
        body += [
            csvEscape(label),
            csvEscape(row.game),
            row.level,
            csvEscape(row.status),
            solved,
            row.generated || 0,
            row.expanded || 0,
            row.elapsed_ms || 0,
            row.step_ms || 0,
            row.heuristic_ms || 0,
            row.solution_length || 0,
            row.step_no_op || 0,
            row.step_changed || 0,
        ].join(',') + '\n';
    }
    const exists = fs.existsSync(csvPath);
    if (!exists) {
        fs.mkdirSync(path.dirname(path.resolve(csvPath)), { recursive: true });
        fs.writeFileSync(csvPath, `${header}\n${body}`);
    } else {
        fs.appendFileSync(csvPath, body);
    }
}

function printSummaryRow(summary) {
    process.stdout.write(
        `bench_summary config=${summary.label} solved=${summary.solved}/${summary.levels} ` +
        `timeout=${summary.timeout} step_ms=${summary.step_ms.toFixed(3)} ` +
        `heuristic_ms=${summary.heuristic_ms.toFixed(3)} generated=${summary.generated} ` +
        `us_per_step=${summary.us_per_step.toFixed(2)} step_no_op_pct=${summary.step_no_op_pct.toFixed(1)}%\n`,
    );
}

function main() {
    const options = parseArgs(process.argv);
    const configs = options.configs || [{ name: 'default', env: {}, args: [] }];
    const summaries = [];

    for (const config of configs) {
        const json = runConfig(options.corpus, options.runnerArgs, config);
        const label = config.name || 'config';
        if (options.out) {
            const outPath = Array.isArray(options.out)
                ? options.out[configs.indexOf(config)]
                : configs.length === 1
                    ? options.out
                    : options.out.replace(/\.json$/, `-${label}.json`);
            fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
            fs.writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`);
        }
        if (options.csv) {
            writeCsv(options.csv, json, label);
        }
        summaries.push(summaryFromJson(json, label));
    }

    for (const summary of summaries) {
        printSummaryRow(summary);
    }

    if (summaries.length === 2) {
        const [a, b] = summaries;
        process.stdout.write(
            `bench_delta solved=${b.solved - a.solved} step_ms=${(b.step_ms - a.step_ms).toFixed(3)} ` +
            `us_per_step=${(b.us_per_step - a.us_per_step).toFixed(2)} ` +
            `no_op_pct=${(b.step_no_op_pct - a.step_no_op_pct).toFixed(1)}pp\n`,
        );
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        process.exit(1);
    }
}

module.exports = { parseArgs, runConfig, summaryFromJson };
