#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
    materializeSlice,
    writeSliceManifest,
} = require('./generate_solver_benchmark_slice_manifest');

const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, 'solver_benchmark_slices.json');
const DEFAULT_OUT_DIR = path.resolve('build/solver-bench/slice-health');
const DEFAULT_RUNNER_PATH = path.resolve(__dirname, 'run_solver_tests_js.js');

function usage() {
    process.stderr.write([
        'Usage: node src/tests/solver_benchmark_slice_health.js',
        '  [--registry PATH] [--slice NAME ...] [--out-dir PATH] [--timeout-ms N]',
    ].join('\n') + '\n');
}

function readRegistry(registryPath) {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (registry.schema_version !== 1 || !Array.isArray(registry.slices)) {
        throw new Error(`invalid slice registry: ${registryPath}`);
    }
    return registry;
}

function parseArgs(argv) {
    const options = {
        registry_path: DEFAULT_REGISTRY_PATH,
        slice_names: [],
        out_dir: DEFAULT_OUT_DIR,
        timeout_ms: 1,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--registry' && index + 1 < args.length) {
            options.registry_path = path.resolve(args[++index]);
        } else if (arg === '--slice' && index + 1 < args.length) {
            options.slice_names.push(args[++index]);
        } else if (arg === '--out-dir' && index + 1 < args.length) {
            options.out_dir = path.resolve(args[++index]);
        } else if (arg === '--timeout-ms' && index + 1 < args.length) {
            options.timeout_ms = Math.max(1, Number.parseInt(args[++index], 10) || 1);
        } else if (arg === '--help' || arg === '-h') {
            usage();
            process.exit(0);
        } else {
            throw new Error(`unsupported argument: ${arg}`);
        }
    }
    return options;
}

function runSolverJson(corpusPath, manifestPath, timeoutMs, runnerPath) {
    const stdout = execFileSync(process.execPath, [
        runnerPath,
        corpusPath,
        '--solver-focus-manifest', manifestPath,
        '--timeout-ms', String(timeoutMs),
        '--quiet',
        '--json',
        '--no-solutions',
    ], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    return JSON.parse(stdout);
}

function sliceReport(manifest, payload, manifestPath) {
    const totals = payload.totals || {};
    const resultCount = Array.isArray(payload.results) ? payload.results.length : 0;
    const issues = [];
    if (resultCount !== manifest.target_count) {
        issues.push(`result_count ${resultCount} != target_count ${manifest.target_count}`);
    }
    if ((totals.skipped_message || 0) > 0) {
        issues.push(`skipped_message ${totals.skipped_message}`);
    }
    if ((totals.errors || 0) > 0) {
        issues.push(`errors ${totals.errors}`);
    }
    return {
        name: manifest.name,
        manifest_path: manifestPath,
        target_count: manifest.target_count,
        result_count: resultCount,
        totals,
        healthy: issues.length === 0,
        issues,
    };
}

function runSliceHealth(options = {}) {
    const registryPath = path.resolve(options.registry_path || DEFAULT_REGISTRY_PATH);
    const registry = readRegistry(registryPath);
    const outDir = path.resolve(options.out_dir || DEFAULT_OUT_DIR);
    const runnerPath = path.resolve(options.runner_path || DEFAULT_RUNNER_PATH);
    const timeoutMs = Math.max(1, Number.parseInt(options.timeout_ms, 10) || 1);
    const sliceNames = options.slice_names && options.slice_names.length > 0
        ? options.slice_names
        : registry.slices.map((slice) => slice.name);
    const report = {
        schema_version: 1,
        generated_at: options.generated_at || new Date().toISOString(),
        registry: path.relative(process.cwd(), registryPath),
        timeout_ms: timeoutMs,
        healthy: true,
        slices: [],
    };
    fs.mkdirSync(outDir, { recursive: true });
    for (const name of sliceNames) {
        const manifest = materializeSlice(name, {
            registry_path: registryPath,
            generated_at: options.generated_at,
        });
        const manifestPath = path.join(outDir, `${name}.json`);
        writeSliceManifest(manifest, manifestPath);
        try {
            const payload = runSolverJson(path.resolve(manifest.corpus), manifestPath, timeoutMs, runnerPath);
            const entry = sliceReport(manifest, payload, manifestPath);
            report.slices.push(entry);
            report.healthy = report.healthy && entry.healthy;
        } catch (error) {
            report.healthy = false;
            report.slices.push({
                name,
                manifest_path: manifestPath,
                target_count: manifest.target_count,
                result_count: 0,
                totals: {},
                healthy: false,
                issues: [error && error.message ? error.message : String(error)],
            });
        }
    }
    return report;
}

function main(argv = process.argv) {
    const report = runSliceHealth(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.healthy ? 0 : 1;
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
    parseArgs,
    runSliceHealth,
};
