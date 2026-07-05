#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
    appendRunRecord,
    applyArtifactRetention,
    comparePairedRuns,
    createRunRecord,
    freshnessReport,
    latestRecords,
    planArtifactRetention,
    readRunRecords,
    summarizeRecords,
} = require('./solver_bench_store');

function usage() {
    process.stderr.write([
        'Usage:',
        '  node src/tests/solver_bench_store_cli.js append --store PATH --input RUN.json --slice NAME --variant NAME [--pair-id ID] [--config-json PATH] [--artifact PATH ...]',
        '  node src/tests/solver_bench_store_cli.js summary --store PATH [--slice NAME] [--variant NAME]',
        '  node src/tests/solver_bench_store_cli.js latest --store PATH [--slice NAME] [--variant NAME] [--limit N]',
        '  node src/tests/solver_bench_store_cli.js freshness --store PATH [--slice NAME] [--variant NAME] [--max-age-hours N]',
        '  node src/tests/solver_bench_store_cli.js compare --store PATH --slice NAME --baseline NAME --candidate NAME [--metric NAME] [--noise-band N]',
        '  node src/tests/solver_bench_store_cli.js retention-plan --store PATH --build-root PATH [--max-age-days N]',
        '  node src/tests/solver_bench_store_cli.js retention-apply --store PATH --build-root PATH [--max-age-days N]',
    ].join('\n') + '\n');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function parseArgs(argv) {
    const command = argv[2];
    if (!command || command === '--help' || command === '-h') {
        usage();
        process.exit(command ? 0 : 2);
    }
    const options = { command, artifacts: [] };
    for (let index = 3; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--store' && index + 1 < argv.length) {
            options.store = path.resolve(argv[++index]);
        } else if (arg === '--input' && index + 1 < argv.length) {
            options.input = path.resolve(argv[++index]);
        } else if (arg === '--slice' && index + 1 < argv.length) {
            options.slice = argv[++index];
        } else if (arg === '--variant' && index + 1 < argv.length) {
            options.variant = argv[++index];
        } else if (arg === '--pair-id' && index + 1 < argv.length) {
            options.pairId = argv[++index];
        } else if (arg === '--config-json' && index + 1 < argv.length) {
            options.configJson = path.resolve(argv[++index]);
        } else if (arg === '--artifact' && index + 1 < argv.length) {
            options.artifacts.push(path.resolve(argv[++index]));
        } else if (arg === '--baseline' && index + 1 < argv.length) {
            options.baseline = argv[++index];
        } else if (arg === '--candidate' && index + 1 < argv.length) {
            options.candidate = argv[++index];
        } else if (arg === '--metric' && index + 1 < argv.length) {
            options.metric = argv[++index];
        } else if (arg === '--noise-band' && index + 1 < argv.length) {
            options.noiseBand = Number(argv[++index]);
        } else if (arg === '--build-root' && index + 1 < argv.length) {
            options.buildRoot = path.resolve(argv[++index]);
        } else if (arg === '--max-age-days' && index + 1 < argv.length) {
            options.maxAgeDays = Number(argv[++index]);
        } else if (arg === '--max-age-hours' && index + 1 < argv.length) {
            options.maxAgeHours = Number(argv[++index]);
        } else if (arg === '--limit' && index + 1 < argv.length) {
            options.limit = Number(argv[++index]);
        } else {
            throw new Error(`unsupported argument: ${arg}`);
        }
    }
    return options;
}

function requireOption(options, name) {
    if (!options[name]) {
        throw new Error(`missing --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    }
    return options[name];
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    if (options.command === 'append') {
        const store = requireOption(options, 'store');
        const input = requireOption(options, 'input');
        const record = createRunRecord(readJson(input), {
            benchmark_slice: requireOption(options, 'slice'),
            variant: requireOption(options, 'variant'),
            pair_id: options.pairId || null,
            config: options.configJson ? readJson(options.configJson) : undefined,
            artifacts: options.artifacts,
            source_path: input,
        });
        appendRunRecord(store, record);
        process.stdout.write(`${JSON.stringify({ appended: 1, store, config_hash: record.config_hash })}\n`);
        return 0;
    }
    if (options.command === 'summary') {
        const records = readRunRecords(requireOption(options, 'store'));
        process.stdout.write(`${JSON.stringify(summarizeRecords(records, {
            benchmark_slice: options.slice || null,
            variant: options.variant || null,
        }), null, 2)}\n`);
        return 0;
    }
    if (options.command === 'latest') {
        const records = readRunRecords(requireOption(options, 'store'));
        process.stdout.write(`${JSON.stringify(latestRecords(records, {
            benchmark_slice: options.slice || null,
            variant: options.variant || null,
            limit: Number.isFinite(options.limit) ? options.limit : 10,
        }), null, 2)}\n`);
        return 0;
    }
    if (options.command === 'freshness') {
        const records = readRunRecords(requireOption(options, 'store'));
        process.stdout.write(`${JSON.stringify(freshnessReport(records, {
            benchmark_slice: options.slice || null,
            variant: options.variant || null,
            max_age_hours: Number.isFinite(options.maxAgeHours) ? options.maxAgeHours : 24,
        }), null, 2)}\n`);
        return 0;
    }
    if (options.command === 'compare') {
        const records = readRunRecords(requireOption(options, 'store'));
        process.stdout.write(`${JSON.stringify(comparePairedRuns(records, {
            benchmark_slice: requireOption(options, 'slice'),
            baseline_variant: requireOption(options, 'baseline'),
            candidate_variant: requireOption(options, 'candidate'),
            metric: options.metric || 'solved',
            noise_band: Number.isFinite(options.noiseBand) ? options.noiseBand : 0,
        }), null, 2)}\n`);
        return 0;
    }
    if (options.command === 'retention-plan') {
        const records = readRunRecords(requireOption(options, 'store'));
        process.stdout.write(`${JSON.stringify(planArtifactRetention({
            build_root: requireOption(options, 'buildRoot'),
            records,
            max_age_days: Number.isFinite(options.maxAgeDays) ? options.maxAgeDays : 30,
        }), null, 2)}\n`);
        return 0;
    }
    if (options.command === 'retention-apply') {
        const records = readRunRecords(requireOption(options, 'store'));
        const result = applyArtifactRetention(planArtifactRetention({
            build_root: requireOption(options, 'buildRoot'),
            records,
            max_age_days: Number.isFinite(options.maxAgeDays) ? options.maxAgeDays : 30,
        }));
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.errors.length === 0 ? 0 : 1;
    }
    throw new Error(`unsupported command: ${options.command}`);
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        usage();
        process.exitCode = 1;
    }
}

module.exports = {
    main,
    parseArgs,
};
