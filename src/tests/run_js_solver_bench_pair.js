#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
    comparePairedRuns,
    readRunRecords,
} = require('./solver_bench_store');

const RUNNER = path.join(__dirname, 'run_solver_tests_js.js');

function usage() {
    process.stderr.write([
        'Usage: node src/tests/run_js_solver_bench_pair.js <corpus_dir>',
        '  --store PATH --slice NAME [--runs N] [--out-dir DIR]',
        '  [--baseline-variant NAME] [--candidate-variant NAME]',
        '  [--metric NAME] [--noise-band N]',
        '  [--baseline-env KEY=VALUE ...] [--candidate-env KEY=VALUE ...]',
        '  [--baseline-arg ARG ...] [--candidate-arg ARG ...]',
        '  -- [run_solver_tests_js args...]',
    ].join('\n') + '\n');
}

function parsePositiveInt(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer: ${value}`);
    }
    return parsed;
}

function parseEnvAssignment(value, label) {
    const equalIndex = String(value).indexOf('=');
    if (equalIndex <= 0) {
        throw new Error(`${label} must be KEY=VALUE: ${value}`);
    }
    return [value.slice(0, equalIndex), value.slice(equalIndex + 1)];
}

function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        usage();
        process.exit(args.length === 0 ? 1 : 0);
    }
    const options = {
        corpus: path.resolve(args.shift()),
        store: null,
        slice: null,
        runs: 3,
        outDir: path.resolve('build/solver-bench-pairs'),
        baselineVariant: 'baseline',
        candidateVariant: 'candidate',
        metric: 'solved',
        noiseBand: 0,
        baselineEnv: {},
        candidateEnv: {},
        baselineArgs: [],
        candidateArgs: [],
        runnerArgs: [],
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--') {
            options.runnerArgs = args.slice(index + 1);
            break;
        } else if (arg === '--store' && index + 1 < args.length) {
            options.store = path.resolve(args[++index]);
        } else if (arg === '--slice' && index + 1 < args.length) {
            options.slice = args[++index];
        } else if (arg === '--runs' && index + 1 < args.length) {
            options.runs = parsePositiveInt(args[++index], '--runs');
        } else if (arg === '--out-dir' && index + 1 < args.length) {
            options.outDir = path.resolve(args[++index]);
        } else if (arg === '--baseline-variant' && index + 1 < args.length) {
            options.baselineVariant = args[++index];
        } else if (arg === '--candidate-variant' && index + 1 < args.length) {
            options.candidateVariant = args[++index];
        } else if (arg === '--metric' && index + 1 < args.length) {
            options.metric = args[++index];
        } else if (arg === '--noise-band' && index + 1 < args.length) {
            options.noiseBand = Number(args[++index]);
            if (!Number.isFinite(options.noiseBand) || options.noiseBand < 0) {
                throw new Error(`--noise-band must be non-negative: ${args[index]}`);
            }
        } else if (arg === '--baseline-env' && index + 1 < args.length) {
            const [key, value] = parseEnvAssignment(args[++index], '--baseline-env');
            options.baselineEnv[key] = value;
        } else if (arg === '--candidate-env' && index + 1 < args.length) {
            const [key, value] = parseEnvAssignment(args[++index], '--candidate-env');
            options.candidateEnv[key] = value;
        } else if (arg === '--baseline-arg' && index + 1 < args.length) {
            options.baselineArgs.push(args[++index]);
        } else if (arg === '--candidate-arg' && index + 1 < args.length) {
            options.candidateArgs.push(args[++index]);
        } else {
            throw new Error(`unsupported argument: ${arg}`);
        }
    }
    if (!options.store || !options.slice) {
        throw new Error('--store and --slice are required');
    }
    return options;
}

function runVariant(options, pairId, variant, variantArgs, variantEnv) {
    const artifactPath = path.join(options.outDir, `${pairId}-${variant}.json`);
    const argv = [
        RUNNER,
        options.corpus,
        ...options.runnerArgs,
        ...variantArgs,
        '--bench-store', options.store,
        '--bench-slice', options.slice,
        '--bench-variant', variant,
        '--bench-pair-id', pairId,
        '--bench-artifact', artifactPath,
    ];
    const result = spawnSync(process.execPath, argv, {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        env: Object.assign({}, process.env, variantEnv),
    });
    if (result.status !== 0) {
        throw new Error(`variant ${variant} failed for ${pairId}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    return artifactPath;
}

function runPairs(options) {
    fs.mkdirSync(options.outDir, { recursive: true });
    for (let index = 0; index < options.runs; index++) {
        const pairId = `pair-${index + 1}`;
        runVariant(options, pairId, options.baselineVariant, options.baselineArgs, options.baselineEnv);
        runVariant(options, pairId, options.candidateVariant, options.candidateArgs, options.candidateEnv);
    }
    return comparePairedRuns(readRunRecords(options.store), {
        benchmark_slice: options.slice,
        baseline_variant: options.baselineVariant,
        candidate_variant: options.candidateVariant,
        metric: options.metric,
        noise_band: options.noiseBand,
    });
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    const comparison = runPairs(options);
    process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
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
    parseArgs,
    runPairs,
};
