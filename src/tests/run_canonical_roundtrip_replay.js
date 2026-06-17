#!/usr/bin/env node
'use strict';

// Verify canonical roundtrip semantics by replaying solver solutions across corpora.
//
// Primary check (catches timeout-curve regressions):
//   original solver JSON solved levels -> replay on canonical corpus files
//
// Reverse check (same invariant as run_canonical_solution_replay.js):
//   canonical solver JSON solved levels -> replay on original corpus files
//
// Usage:
//   node src/tests/run_canonical_roundtrip_replay.js \
//     --from-json-orig build/solver-timeout-curve/js.json \
//     --canonical-corpus build/solver-timeout-curve/canonical-corpus
//
//   node src/tests/run_canonical_roundtrip_replay.js \
//     --from-json-orig build/solver-timeout-curve/js.json \
//     --from-json-canonical build/solver-timeout-curve/js-canonical.json \
//     --original-corpus src/tests/solver_tests \
//     --canonical-corpus build/solver-timeout-curve/canonical-corpus \
//     --both
//
// Solver JSON from run_solver_tests_js / solver_timeout_curve includes full
// solution token arrays even when --no-solutions is set (that flag only skips
// annotated .txt export under --solutions-dir).

const fs = require('fs');
const path = require('path');

const { replaySolutionOnGameFile } = require('./run_solver_tests_js');

function usage(exitCode) {
    const message = [
        'Usage: node src/tests/run_canonical_roundtrip_replay.js [options]',
        '  --from-json-orig PATH          Original solver results JSON',
        '  --from-json-canonical PATH     Canonical solver results JSON (for reverse check)',
        '  --original-corpus DIR          Original .txt corpus (default: src/tests/solver_tests)',
        '  --canonical-corpus DIR         Canonical .txt corpus',
        '  --direction orig-to-canon|canon-to-orig|both',
        '  --both                         Shorthand for --direction both',
        '  --game SUBSTRING               Only check matching game filenames',
        '  --quiet                        Only print failures / summary',
        '  --json                         Print JSON summary to stdout',
    ].join('\n');
    (exitCode === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const options = {
        fromJsonOrig: null,
        fromJsonCanonical: null,
        originalCorpus: path.resolve('src/tests/solver_tests'),
        canonicalCorpus: null,
        direction: 'orig-to-canon',
        gameFilter: null,
        quiet: false,
        json: false,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') {
            usage(0);
        } else if (arg === '--from-json-orig' && index + 1 < args.length) {
            options.fromJsonOrig = path.resolve(args[++index]);
        } else if (arg === '--from-json-canonical' && index + 1 < args.length) {
            options.fromJsonCanonical = path.resolve(args[++index]);
        } else if (arg === '--original-corpus' && index + 1 < args.length) {
            options.originalCorpus = path.resolve(args[++index]);
        } else if (arg === '--canonical-corpus' && index + 1 < args.length) {
            options.canonicalCorpus = path.resolve(args[++index]);
        } else if (arg === '--direction' && index + 1 < args.length) {
            options.direction = args[++index];
        } else if (arg === '--both') {
            options.direction = 'both';
        } else if (arg === '--game' && index + 1 < args.length) {
            options.gameFilter = args[++index];
        } else if (arg === '--quiet') {
            options.quiet = true;
        } else if (arg === '--json') {
            options.json = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!['orig-to-canon', 'canon-to-orig', 'both'].includes(options.direction)) {
        throw new Error(`Unsupported --direction: ${options.direction}`);
    }
    if (options.direction === 'orig-to-canon' || options.direction === 'both') {
        if (!options.fromJsonOrig) {
            throw new Error('--from-json-orig is required for orig-to-canon checks');
        }
        if (!options.canonicalCorpus) {
            throw new Error('--canonical-corpus is required for orig-to-canon checks');
        }
    }
    if (options.direction === 'canon-to-orig' || options.direction === 'both') {
        if (!options.fromJsonCanonical) {
            throw new Error('--from-json-canonical is required for canon-to-orig checks');
        }
        if (!options.originalCorpus) {
            throw new Error('--original-corpus is required for canon-to-orig checks');
        }
    }
    return options;
}

function loadSolverResults(jsonPath) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return raw.results || raw;
}

function safeCorpusPath(root, game) {
    const full = path.resolve(root, game);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Game path escapes corpus: ${game}`);
    }
    return full;
}

function gameMatchesFilter(game, filter) {
    return filter == null || game.includes(filter);
}

function formatFailure(failure) {
    const solution = Array.isArray(failure.solution) ? failure.solution.join(',') : '';
    return [
        `${failure.direction} ${failure.game}#${failure.level}`,
        `  source_status=${failure.source_status} replay_status=${failure.replay_status} steps=${failure.replay_steps}`,
        `  solution=${solution}`,
        failure.error ? `  error=${failure.error}` : null,
    ].filter(Boolean).join('\n');
}

function verifyDirection({
    direction,
    sourceResults,
    sourceCorpus,
    targetCorpus,
    gameFilter,
}) {
    const failures = [];
    let checked = 0;
    let skippedMissingFile = 0;
    let skippedInvalidSource = 0;
    for (const result of sourceResults) {
        if (!gameMatchesFilter(result.game, gameFilter)) {
            continue;
        }
        if (result.level < 0) {
            continue;
        }
        if (result.status !== 'solved' || !Array.isArray(result.solution) || result.solution.length === 0) {
            continue;
        }
        const targetPath = safeCorpusPath(targetCorpus, result.game);
        if (!fs.existsSync(targetPath)) {
            skippedMissingFile++;
            failures.push({
                direction,
                game: result.game,
                level: result.level,
                source_status: result.status,
                replay_status: 'missing_target_file',
                replay_steps: 0,
                solution: result.solution,
                error: `Missing target corpus file: ${targetPath}`,
            });
            continue;
        }
        if (sourceCorpus) {
            const sourcePath = safeCorpusPath(sourceCorpus, result.game);
            const sourceReplay = replaySolutionOnGameFile(sourcePath, result.level, result.solution);
            if (sourceReplay.status !== 'solved') {
                skippedInvalidSource++;
                continue;
            }
        }
        checked++;
        const replay = replaySolutionOnGameFile(targetPath, result.level, result.solution);
        if (replay.status !== 'solved') {
            failures.push({
                direction,
                game: result.game,
                level: result.level,
                source_status: result.status,
                replay_status: replay.status,
                replay_steps: replay.steps,
                solution: result.solution,
                error: replay.error,
            });
        }
    }
    return { direction, checked, skippedMissingFile, skippedInvalidSource, failures };
}

function runCanonicalRoundtripReplay(options) {
    const summary = {
        direction: options.direction,
        checks: [],
        failures: [],
        totals: {
            checked: 0,
            failures: 0,
            skipped_missing_file: 0,
            skipped_invalid_source: 0,
        },
    };
    if (options.direction === 'orig-to-canon' || options.direction === 'both') {
        const origResults = loadSolverResults(options.fromJsonOrig);
        const check = verifyDirection({
            direction: 'orig_to_canon',
            sourceResults: origResults,
            sourceCorpus: options.originalCorpus,
            targetCorpus: options.canonicalCorpus,
            gameFilter: options.gameFilter,
        });
        summary.checks.push(check);
    }
    if (options.direction === 'canon-to-orig' || options.direction === 'both') {
        const canonResults = loadSolverResults(options.fromJsonCanonical);
        const check = verifyDirection({
            direction: 'canon_to_orig',
            sourceResults: canonResults,
            sourceCorpus: options.canonicalCorpus,
            targetCorpus: options.originalCorpus,
            gameFilter: options.gameFilter,
        });
        summary.checks.push(check);
    }
    for (const check of summary.checks) {
        summary.failures.push(...check.failures);
        summary.totals.checked += check.checked;
        summary.totals.skipped_missing_file += check.skippedMissingFile;
        summary.totals.skipped_invalid_source += check.skippedInvalidSource || 0;
    }
    summary.totals.failures = summary.failures.length;
    return summary;
}

function printHuman(summary, options) {
    if (!options.quiet || summary.failures.length > 0) {
        for (const failure of summary.failures) {
            process.stdout.write(`${formatFailure(failure)}\n`);
        }
    }
    const parts = summary.checks.map((check) => `${check.direction}=${check.checked}`).join(' ');
    process.stdout.write(
        `canonical_roundtrip_replay direction=${summary.direction} checked=${summary.totals.checked} failures=${summary.totals.failures} missing_target=${summary.totals.skipped_missing_file} invalid_source=${summary.totals.skipped_invalid_source}${parts ? ` (${parts})` : ''}\n`
    );
}

function main() {
    const options = parseArgs(process.argv);
    const summary = runCanonicalRoundtripReplay(options);
    if (options.json) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
        printHuman(summary, options);
    }
    process.exit(summary.totals.failures > 0 ? 1 : 0);
}

module.exports = {
    parseArgs,
    loadSolverResults,
    runCanonicalRoundtripReplay,
    verifyDirection,
    formatFailure,
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exit(2);
    }
}
