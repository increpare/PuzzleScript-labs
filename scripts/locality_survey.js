#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    loadNdjsonCorpusFile,
    sourceFileName,
    spawnCaptured,
} = require('./handheld_memory_audit.js');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function parseLayoutJsonLine(line) {
    const trimmed = String(line).trim();
    if (trimmed === '' || !trimmed.startsWith('{')) {
        return null;
    }
    return JSON.parse(trimmed);
}

function summarizeGames(games) {
    const measured = games.filter((game) => game.ok && game.layout);
    const sortedByArena = measured
        .slice()
        .sort((a, b) => b.layout.mask_arena_bytes - a.layout.mask_arena_bytes)
        .slice(0, 15)
        .map((game) => ({
            name: game.name,
            mask_arena_bytes: game.layout.mask_arena_bytes,
            unique_mask_count: game.layout.unique_mask_count,
            mask_arena_utilization: game.layout.mask_arena_utilization,
            mask_reference_span_ratio: game.layout.mask_reference_span_ratio,
            stride_object: game.layout.stride_object,
            rule_count: game.layout.rule_count,
            board_objects_bytes: game.layout.board_objects_bytes,
        }));

    const sortedBySpan = measured
        .slice()
        .sort((a, b) => b.layout.mask_reference_span_ratio - a.layout.mask_reference_span_ratio)
        .slice(0, 15)
        .map((game) => ({
            name: game.name,
            mask_reference_span_ratio: game.layout.mask_reference_span_ratio,
            mask_arena_bytes: game.layout.mask_arena_bytes,
            unique_mask_count: game.layout.unique_mask_count,
        }));

    const lowUtilization = measured
        .filter((game) => game.layout.mask_slot_count > 0 && game.layout.mask_arena_utilization < 0.5)
        .sort((a, b) => a.layout.mask_arena_utilization - b.layout.mask_arena_utilization)
        .slice(0, 15)
        .map((game) => ({
            name: game.name,
            mask_arena_utilization: game.layout.mask_arena_utilization,
            unique_mask_count: game.layout.unique_mask_count,
            mask_slot_count: game.layout.mask_slot_count,
            mask_arena_bytes: game.layout.mask_arena_bytes,
        }));

    const maxArena = sortedByArena.length > 0 ? sortedByArena[0].mask_arena_bytes : null;
    return {
        game_count: games.length,
        measured_games: measured.length,
        failures: games.length - measured.length,
        max_mask_arena_bytes: maxArena,
        top_mask_arena_bytes: sortedByArena,
        top_mask_reference_span_ratio: sortedBySpan,
        low_mask_arena_utilization: lowUtilization,
    };
}

function loadSolverFocusGames(manifestPath, corpusDir) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const games = new Set();
    for (const target of manifest.targets || []) {
        if (target && typeof target.game === 'string') {
            games.add(target.game);
        }
    }
    return [...games].sort().map((game, index) => ({
        index,
        name: `solver-focus:${game}`,
        sourcePath: path.join(corpusDir, game),
        game,
    }));
}

async function runLayoutForSource(source, options) {
    fs.mkdirSync(options.tmpDir, { recursive: true });
    const sourcePath = source.sourcePath
        ? source.sourcePath
        : path.join(options.tmpDir, sourceFileName(source));
    if (!source.sourcePath) {
        fs.writeFileSync(sourcePath, source.source, 'utf8');
    }

    const args = [
        'layout',
        sourcePath,
    ];
    if (options.measureMaskAccess) {
        args.push('--measure-mask-access');
    }

    const result = await (options.spawn || spawnCaptured)(options.binary, args, {
        encoding: 'utf8',
        maxBuffer: options.maxBufferBytes || DEFAULT_MAX_BUFFER_BYTES,
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    });

    const lines = String(result.stdout || '').split(/\r?\n/);
    let layout = null;
    let localitySurvey = null;
    for (const line of lines) {
        if (line.startsWith('locality_survey ')) {
            localitySurvey = {};
            for (const token of line.slice('locality_survey '.length).trim().split(/\s+/)) {
                const eq = token.indexOf('=');
                if (eq > 0) {
                    localitySurvey[token.slice(0, eq)] = Number(token.slice(eq + 1));
                }
            }
            continue;
        }
        try {
            const parsed = parseLayoutJsonLine(line);
            if (parsed) {
                layout = parsed;
            }
        } catch (_error) {
            // Ignore non-JSON stdout lines.
        }
    }

    const ok = result.status === 0 && result.signal === null && layout !== null;
    return {
        index: source.index,
        name: source.name,
        game: source.game || path.basename(source.name),
        ok,
        exit_code: result.status,
        signal: result.signal,
        layout,
        locality_survey: localitySurvey,
        stderr_tail: String(result.stderr || '').split(/\r?\n/).slice(-20).join('\n'),
        command: [options.binary, ...args],
    };
}

function parseArgs(argv) {
    const options = {
        binary: path.join('build', 'native', 'puzzlescript_cpp'),
        corpusNdjson: null,
        solverFocusManifest: null,
        solverCorpusDir: path.join('src', 'tests', 'solver_tests'),
        out: path.join('build', 'locality_survey.json'),
        tmpDir: path.join('build', 'locality_survey_sources'),
        limit: null,
        measureMaskAccess: false,
        timeoutMs: DEFAULT_TIMEOUT_MS,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--binary' && index + 1 < argv.length) {
            options.binary = argv[++index];
            continue;
        }
        if (arg === '--corpus-ndjson' && index + 1 < argv.length) {
            options.corpusNdjson = argv[++index];
            continue;
        }
        if (arg === '--solver-focus-manifest' && index + 1 < argv.length) {
            options.solverFocusManifest = argv[++index];
            continue;
        }
        if (arg === '--solver-corpus-dir' && index + 1 < argv.length) {
            options.solverCorpusDir = argv[++index];
            continue;
        }
        if (arg === '--out' && index + 1 < argv.length) {
            options.out = argv[++index];
            continue;
        }
        if (arg === '--tmp-dir' && index + 1 < argv.length) {
            options.tmpDir = argv[++index];
            continue;
        }
        if (arg === '--limit' && index + 1 < argv.length) {
            options.limit = Number(argv[++index]);
            continue;
        }
        if (arg === '--measure-mask-access') {
            options.measureMaskAccess = true;
            continue;
        }
        if (arg === '--timeout-ms' && index + 1 < argv.length) {
            options.timeoutMs = Number(argv[++index]);
            continue;
        }
        throw new Error(`unknown or incomplete option: ${arg}`);
    }

    if (!options.help && !options.corpusNdjson && !options.solverFocusManifest) {
        throw new Error('one of --corpus-ndjson or --solver-focus-manifest is required');
    }
    if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
        throw new Error('--limit must be a positive integer');
    }
    return options;
}

function printUsage(out) {
    out.write([
        'Usage:',
        '  node scripts/locality_survey.js --corpus-ndjson build/handheld_testdata.bundle.ndjson [options]',
        '  node scripts/locality_survey.js --solver-focus-manifest src/tests/solver_focus_group.json [options]',
        '',
        'Options:',
        '  --binary PATH                 puzzlescript_cpp binary (default: build/native/puzzlescript_cpp)',
        '  --solver-corpus-dir PATH        solver game directory (default: src/tests/solver_tests)',
        '  --out PATH                      JSON output (default: build/locality_survey.json)',
        '  --tmp-dir PATH                  temp source directory',
        '  --limit N                       measure only the first N records',
        '  --measure-mask-access           run one action step with mask cache-line survey',
        '  --timeout-ms N                  per-game timeout (default: 120000)',
        '',
    ].join('\n'));
}

async function runCli(argv) {
    const options = parseArgs(argv);
    if (options.help) {
        printUsage(process.stdout);
        return 0;
    }
    if (!fs.existsSync(options.binary)) {
        throw new Error(`missing puzzlescript_cpp binary: ${options.binary}`);
    }

    const sources = [];
    if (options.corpusNdjson) {
        sources.push(...loadNdjsonCorpusFile(options.corpusNdjson));
    }
    if (options.solverFocusManifest) {
        sources.push(...loadSolverFocusGames(options.solverFocusManifest, options.solverCorpusDir));
    }

    let work = sources;
    if (options.limit !== null) {
        work = work.slice(0, options.limit);
    }

    const results = [];
    for (let index = 0; index < work.length; index += 1) {
        const source = work[index];
        process.stderr.write(`layout ${index + 1}/${work.length}: ${source.name}\n`);
        results.push(await runLayoutForSource(source, options));
    }

    const report = {
        generated_at: new Date().toISOString(),
        host: {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
        },
        command: {
            binary: options.binary,
            corpus_ndjson: options.corpusNdjson,
            solver_focus_manifest: options.solverFocusManifest,
            solver_corpus_dir: options.solverCorpusDir,
            measure_mask_access: options.measureMaskAccess,
            timeout_ms: options.timeoutMs,
        },
        summary: summarizeGames(results),
        games: results,
    };

    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stderr.write(
        `Wrote ${options.out}; measured ${report.summary.measured_games}/${report.summary.game_count}; ` +
        `max mask arena ${report.summary.max_mask_arena_bytes} bytes\n`,
    );
    return report.summary.failures > 0 ? 1 : 0;
}

if (require.main === module) {
    runCli(process.argv.slice(2)).then((exitCode) => {
        process.exitCode = exitCode;
    }).catch((error) => {
        process.stderr.write(`locality_survey: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    loadSolverFocusGames,
    parseLayoutJsonLine,
    runLayoutForSource,
    summarizeGames,
};
