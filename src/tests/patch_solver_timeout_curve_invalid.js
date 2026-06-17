#!/usr/bin/env node
'use strict';

// Re-solve and patch only solver-timeout-curve JSON entries whose stored
// solutions do not replay on the source corpus.
//
// Usage:
//   node src/tests/patch_solver_timeout_curve_invalid.js \
//     --json build/solver-timeout-curve/js.json
//
//   node src/tests/patch_solver_timeout_curve_invalid.js \
//     --json build/solver-timeout-curve/js-canonical.json \
//     --corpus build/solver-timeout-curve/canonical-corpus
//
//   node src/tests/patch_solver_timeout_curve_invalid.js --both

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { replaySolutionOnGameFile } = require('./run_solver_tests_js');

const DEFAULT_ORIG_JSON = path.resolve('build/solver-timeout-curve/js.json');
const DEFAULT_CANON_JSON = path.resolve('build/solver-timeout-curve/js-canonical.json');
const DEFAULT_ORIG_CORPUS = path.resolve('src/tests/solver_tests');
const DEFAULT_CANON_CORPUS = path.resolve('build/solver-timeout-curve/canonical-corpus');
const SOLVER_SCRIPT = path.resolve(__dirname, 'run_solver_tests_js.js');
const DEFAULT_STRATEGY = 'portfolio';

function usage(exitCode) {
    const message = [
        'Usage: node src/tests/patch_solver_timeout_curve_invalid.js [options]',
        '  --json PATH              Solver results JSON to patch',
        '  --corpus DIR             Corpus dir for replay + re-solve (default: meta.corpus or solver_tests)',
        '  --both                   Patch js.json and js-canonical.json',
        '  --timeout-ms N           Override solve timeout (default: meta.max_ms or entry timeout_ms or 1000)',
        '  --strategy NAME          Solver strategy (default: portfolio)',
        '  --dry-run                List invalid entries only; do not write',
        '  --quiet                  Less output',
        '  --output-json            Print JSON summary to stdout',
    ].join('\n');
    (exitCode === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const options = {
        jsonPath: null,
        corpus: null,
        both: false,
        timeoutMs: null,
        strategy: DEFAULT_STRATEGY,
        dryRun: false,
        quiet: false,
        outputJson: false,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') {
            usage(0);
        } else if (arg === '--json' && index + 1 < args.length) {
            options.jsonPath = path.resolve(args[++index]);
        } else if (arg === '--corpus' && index + 1 < args.length) {
            options.corpus = path.resolve(args[++index]);
        } else if (arg === '--both') {
            options.both = true;
        } else if (arg === '--timeout-ms' && index + 1 < args.length) {
            options.timeoutMs = Math.max(1, Number.parseInt(args[++index], 10) || 1000);
        } else if (arg === '--strategy' && index + 1 < args.length) {
            options.strategy = args[++index];
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--quiet') {
            options.quiet = true;
        } else if (arg === '--output-json') {
            options.outputJson = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (options.both) {
        return options;
    }
    if (!options.jsonPath) {
        throw new Error('--json is required (or use --both)');
    }
    return options;
}

function loadPayload(jsonPath) {
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!payload.results || !Array.isArray(payload.results)) {
        throw new Error(`Expected results[] in ${jsonPath}`);
    }
    return payload;
}

function resultKey(result) {
    return `${result.game}#${result.level}`;
}

function findInvalidEntries(payload, corpus) {
    const invalid = [];
    for (const result of payload.results) {
        if (result.level < 0) {
            continue;
        }
        if (result.status !== 'solved' || !Array.isArray(result.solution) || result.solution.length === 0) {
            continue;
        }
        const gamePath = path.join(corpus, result.game);
        const replay = replaySolutionOnGameFile(gamePath, result.level, result.solution);
        if (replay.status !== 'solved') {
            invalid.push({
                result,
                replayStatus: replay.status,
                replaySteps: replay.steps,
            });
        }
    }
    return invalid;
}

function resolveTimeoutMs(payload, entry, override) {
    if (override != null) {
        return override;
    }
    if (payload.meta && Number.isFinite(payload.meta.max_ms)) {
        return payload.meta.max_ms;
    }
    if (Number.isFinite(entry.timeout_ms)) {
        return entry.timeout_ms;
    }
    return 1000;
}

function solveLevel(corpus, game, level, timeoutMs, strategy) {
    const run = spawnSync(process.execPath, [
        SOLVER_SCRIPT,
        corpus,
        '--game', game,
        '--level', String(level),
        '--timeout-ms', String(timeoutMs),
        '--strategy', strategy,
        '--quiet',
        '--json',
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (run.status !== 0) {
        throw new Error(run.stderr || run.stdout || `solver exited ${run.status}`);
    }
    const payload = JSON.parse(run.stdout);
    const result = payload.results.find((entry) => entry.game === game && entry.level === level);
    if (!result) {
        throw new Error(`solver JSON missing ${game}#${level}`);
    }
    return result;
}

function patchPayload(payload, corpus, options) {
    const invalid = findInvalidEntries(payload, corpus);
    const summary = {
        jsonPath: options.jsonPath,
        corpus,
        invalid: invalid.length,
        patched: 0,
        stillInvalid: 0,
        unresolved: 0,
        entries: [],
    };
    if (invalid.length === 0) {
        return summary;
    }
    if (!options.quiet) {
        process.stderr.write(`patch_solver_timeout_curve_invalid ${path.basename(options.jsonPath)}: ${invalid.length} invalid entr${invalid.length === 1 ? 'y' : 'ies'}\n`);
    }
    if (options.dryRun) {
        for (const item of invalid) {
            summary.entries.push({
                game: item.result.game,
                level: item.result.level,
                old_status: item.result.status,
                old_solution_length: item.result.solution_length,
                replay_status: item.replayStatus,
            });
        }
        return summary;
    }
    const byKey = new Map(payload.results.map((result, index) => [resultKey(result), index]));
    for (const item of invalid) {
        const { result } = item;
        const timeoutMs = resolveTimeoutMs(payload, result, options.timeoutMs);
        if (!options.quiet) {
            process.stderr.write(`  re-solving ${result.game}#${result.level} timeout=${timeoutMs}ms...\n`);
        }
        const fresh = solveLevel(corpus, result.game, result.level, timeoutMs, options.strategy);
        const index = byKey.get(resultKey(result));
        if (index === undefined) {
            throw new Error(`Missing results index for ${result.game}#${result.level}`);
        }
        payload.results[index] = fresh;
        const replay = replaySolutionOnGameFile(path.join(corpus, result.game), result.level, fresh.solution || []);
        const entrySummary = {
            game: result.game,
            level: result.level,
            old_status: result.status,
            old_solution_length: result.solution_length,
            new_status: fresh.status,
            new_solution_length: fresh.solution_length,
            replay_status: replay.status,
        };
        summary.entries.push(entrySummary);
        if (fresh.status === 'solved' && replay.status === 'solved') {
            summary.patched++;
        } else if (fresh.status === 'solved') {
            summary.stillInvalid++;
        } else {
            summary.unresolved++;
        }
        if (!options.quiet) {
            process.stderr.write(
                `    -> ${fresh.status} len=${fresh.solution_length || 0} replay=${replay.status}\n`
            );
        }
    }
    if (payload.meta) {
        payload.meta.patched_at = new Date().toISOString();
        payload.meta.patched_invalid_entries = summary.patched;
    }
    fs.writeFileSync(options.jsonPath, `${JSON.stringify(payload)}\n`);
    return summary;
}

function patchOne(jsonPath, corpusOverride, options) {
    const patchOptions = {
        ...options,
        jsonPath,
        corpus: corpusOverride || options.corpus,
    };
    const payload = loadPayload(jsonPath);
    if (!patchOptions.corpus) {
        patchOptions.corpus = payload.meta && payload.meta.corpus
            ? path.resolve(payload.meta.corpus)
            : DEFAULT_ORIG_CORPUS;
    }
    if (!fs.existsSync(patchOptions.corpus)) {
        throw new Error(`Corpus not found: ${patchOptions.corpus}`);
    }
    return patchPayload(payload, patchOptions.corpus, patchOptions);
}

function main() {
    const options = parseArgs(process.argv);
    const summaries = [];
    if (options.both) {
        summaries.push(patchOne(DEFAULT_ORIG_JSON, DEFAULT_ORIG_CORPUS, options));
        summaries.push(patchOne(DEFAULT_CANON_JSON, DEFAULT_CANON_CORPUS, options));
    } else {
        summaries.push(patchOne(options.jsonPath, options.corpus, options));
    }
    if (options.outputJson) {
        process.stdout.write(`${JSON.stringify({ summaries }, null, 2)}\n`);
    } else {
        for (const summary of summaries) {
            process.stdout.write(
                `patched ${path.basename(summary.jsonPath)}: invalid=${summary.invalid} patched=${summary.patched} still_invalid=${summary.stillInvalid} unresolved=${summary.unresolved}${options.dryRun ? ' (dry-run)' : ''}\n`
            );
        }
    }
    const failed = summaries.some((summary) => summary.stillInvalid > 0 || summary.unresolved > 0);
    process.exit(failed ? 1 : 0);
}

module.exports = {
    parseArgs,
    findInvalidEntries,
    patchPayload,
    patchOne,
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exit(2);
    }
}
