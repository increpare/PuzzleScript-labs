#!/usr/bin/env node
'use strict';

// Single-shard canonicalizer corpus audit worker.
//
// For each game in a corpus window:
//   1. Skip if the original source does not compile cleanly (no errors/warnings).
//   2. Canonicalize (semantic mode), decanonicalize to PuzzleScript source.
//   3. Fail if the round-tripped source does not compile cleanly.
//
// Usage:
//   node src/tests/run_canonicalizer_corpus_audit.js \
//     --corpus PATH --start 0 --end 100 \
//     --log-dir build/canonicalizer-audit/shard-0

const fs = require('fs');
const path = require('path');

const {
    canonicalizeSource,
    compileSemanticSource,
} = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');
const { listCorpusGames, partialRunInstructions, resolvePartialRunAction } = require('./fuzz_corpus_batch');

function parseArgs(argv) {
    const options = {
        corpusPath: path.join(__dirname, 'solver_tests'),
        logDir: null,
        startIndex: 0,
        endIndex: Infinity,
        resume: false,
        fresh: false,
        exitOnFailure: false,
        gameFilter: null,
        shardId: null,
        progressEvery: null,
        help: false,
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--corpus') options.corpusPath = path.resolve(argv[++index]);
        else if (arg === '--log-dir') options.logDir = path.resolve(argv[++index]);
        else if (arg === '--start') options.startIndex = Number(argv[++index]);
        else if (arg === '--end') options.endIndex = Number(argv[++index]);
        else if (arg === '--resume') options.resume = true;
        else if (arg === '--fresh') options.fresh = true;
        else if (arg === '--exit-on-failure') options.exitOnFailure = true;
        else if (arg === '--game') options.gameFilter = argv[++index];
        else if (arg === '--shard-id') options.shardId = Number(argv[++index]);
        else if (arg === '--progress-every') options.progressEvery = Number(argv[++index]);
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/run_canonicalizer_corpus_audit.js --corpus PATH [options]',
        '',
        '  --log-dir PATH          output directory (required for batch runs)',
        '  --start N --end N       corpus index window',
        '  --resume / --fresh      checkpoint behavior',
        '  --exit-on-failure       exit 1 when round-trip compile failures are found',
        '  --shard-id N            shard label for progress lines',
    ].join('\n');
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeCheckpoint(logDir, checkpoint) {
    fs.writeFileSync(path.join(logDir, 'checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function freshStats() {
    return {
        skippedOriginalCompile: 0,
        tested: 0,
        passed: 0,
        canonicalizeThrew: 0,
        decanonicalizeThrew: 0,
        roundtripCompileFailures: 0,
    };
}

function compileClean(source, sourcePath) {
    try {
        const compiled = compileSemanticSource(source, {
            throwOnError: false,
            sourcePath,
        });
        const ok = compiled.errorCount === 0
            && compiled.state !== null
            && !compiled.state.invalid;
        return {
            ok,
            errorCount: compiled.errorCount || 0,
            errorStrings: (compiled.errorStrings || []).slice(),
        };
    } catch (error) {
        return {
            ok: false,
            errorCount: 1,
            errorStrings: [error && error.message ? error.message : String(error)],
            threw: true,
        };
    }
}

function auditCanonicalRoundTrip(source, game) {
    const baseline = compileClean(source, game);
    if (!baseline.ok) {
        return {
            outcome: 'skipped_original_compile',
            baseline,
        };
    }

    let canonical;
    try {
        canonical = canonicalizeSource(source, 'semantic', { sourcePath: game });
    } catch (error) {
        return {
            outcome: 'canonicalize_threw',
            baseline,
            message: error && error.message ? error.message : String(error),
        };
    }

    let rehydrated;
    try {
        rehydrated = decanonicalizeSemantic(canonical);
    } catch (error) {
        return {
            outcome: 'decanonicalize_threw',
            baseline,
            message: error && error.message ? error.message : String(error),
        };
    }

    const roundtrip = compileClean(rehydrated, `${game}#rehydrated`);
    if (!roundtrip.ok) {
        return {
            outcome: 'roundtrip_compile_failure',
            baseline,
            roundtrip,
        };
    }

    return {
        outcome: 'passed',
        baseline,
        roundtrip,
    };
}

function updateStats(stats, result) {
    switch (result.outcome) {
        case 'skipped_original_compile':
            stats.skippedOriginalCompile++;
            break;
        case 'canonicalize_threw':
            stats.tested++;
            stats.canonicalizeThrew++;
            break;
        case 'decanonicalize_threw':
            stats.tested++;
            stats.decanonicalizeThrew++;
            break;
        case 'roundtrip_compile_failure':
            stats.tested++;
            stats.roundtripCompileFailures++;
            break;
        case 'passed':
            stats.tested++;
            stats.passed++;
            break;
        default:
            throw new Error(`Unknown audit outcome: ${result.outcome}`);
    }
}

function failureRecord(game, gameIndex, result) {
    if (result.outcome === 'canonicalize_threw') {
        return {
            at: new Date().toISOString(),
            game,
            gameIndex,
            phase: 'canonicalize',
            message: result.message,
        };
    }
    if (result.outcome === 'decanonicalize_threw') {
        return {
            at: new Date().toISOString(),
            game,
            gameIndex,
            phase: 'decanonicalize',
            message: result.message,
        };
    }
    if (result.outcome === 'roundtrip_compile_failure') {
        return {
            at: new Date().toISOString(),
            game,
            gameIndex,
            phase: 'roundtrip_compile',
            errorCount: result.roundtrip.errorCount,
            message: result.roundtrip.errorStrings.join('\n'),
        };
    }
    return null;
}

class AuditLogger {
    constructor(logDir) {
        this.logDir = logDir;
        this.logPath = path.join(logDir, 'run.log');
        this.failuresPath = path.join(logDir, 'failures.jsonl');
        this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
    }

    line(message) {
        const text = `[${new Date().toISOString()}] ${message}\n`;
        this.stream.write(text);
        process.stderr.write(text);
    }

    failure(record) {
        fs.appendFileSync(this.failuresPath, `${JSON.stringify(record)}\n`);
        this.line(`FAILURE ${record.phase} ${record.game}: ${record.message.slice(0, 240)}`);
    }

    close() {
        return new Promise(resolve => {
            this.stream.end(resolve);
        });
    }
}

function gamesCompletedInWindow(checkpoint, windowStart, windowEnd) {
    const windowSize = windowEnd - windowStart;
    if (windowSize <= 0 || !checkpoint) return 0;
    const targetEnd = Math.min(windowEnd, checkpoint.gamesTotal || windowEnd);
    if (checkpoint.lastCompletedIndex >= targetEnd - 1) {
        return windowSize;
    }
    if (checkpoint.lastCompletedIndex < windowStart) {
        return 0;
    }
    return Math.min(windowSize, checkpoint.lastCompletedIndex - windowStart + 1);
}

function aggregateAuditCheckpointProgress(ranges, logDir, gamesTotal) {
    let gamesDone = 0;
    const stats = freshStats();
    const shards = [];

    for (const range of ranges) {
        const checkpoint = readJsonIfExists(path.join(logDir, `shard-${range.shard}`, 'checkpoint.json'));
        const done = gamesCompletedInWindow(checkpoint, range.start, range.end);
        gamesDone += done;
        if (checkpoint && checkpoint.stats) {
            for (const key of Object.keys(stats)) {
                stats[key] += checkpoint.stats[key] || 0;
            }
        }
        shards.push({
            shard: range.shard,
            window: { start: range.start, end: range.end },
            gamesDone: done,
            windowSize: range.end - range.start,
        });
    }

    const overallPercent = gamesTotal > 0 ? (gamesDone / gamesTotal) * 100 : 100;
    const failures = stats.canonicalizeThrew + stats.decanonicalizeThrew + stats.roundtripCompileFailures;

    return {
        gamesTotal,
        gamesDone,
        overallPercent,
        stats,
        failures,
        shards,
    };
}

function formatAuditProgressLine(progress, elapsedMs) {
    const { formatDuration, formatPercent } = require('./fuzz_corpus_batch');
    const parts = [
        `overall ${progress.overallPercent.toFixed(1)}%`,
        `games ${progress.gamesDone}/${progress.gamesTotal} (${formatPercent(progress.gamesDone, progress.gamesTotal)})`,
        `tested=${progress.stats.tested}`,
        `failures=${progress.failures}`,
        `elapsed=${formatDuration(elapsedMs)}`,
    ];
    if (progress.gamesDone > 0 && progress.gamesDone < progress.gamesTotal) {
        const etaMs = (elapsedMs / progress.gamesDone) * (progress.gamesTotal - progress.gamesDone);
        parts.push(`eta=${formatDuration(etaMs)}`);
    }
    return parts.join(' | ');
}

async function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.error(usage());
        process.exit(1);
    }

    if (!fs.existsSync(options.corpusPath)) {
        throw new Error(`Corpus directory does not exist: ${options.corpusPath}`);
    }

    const games = listCorpusGames(options.corpusPath, options.gameFilter);
    const windowEnd = Math.min(options.endIndex, games.length);
    const windowGames = games.slice(options.startIndex, windowEnd);

    if (!options.logDir) {
        options.logDir = path.join(process.cwd(), 'build', 'canonicalizer-audit', 'single');
    }
    ensureDir(options.logDir);

    await resolvePartialRunAction(options, {
        logDir: options.logDir,
        detail: 'single-shard checkpoint',
    });

    const checkpointPath = path.join(options.logDir, 'checkpoint.json');
    if (options.fresh && fs.existsSync(checkpointPath)) {
        fs.unlinkSync(checkpointPath);
    }

    let checkpoint = readJsonIfExists(checkpointPath);
    if (options.resume && checkpoint) {
        process.stderr.write(`run_canonicalizer_corpus_audit: resuming from ${checkpoint.lastCompletedGame || 'start'}\n`);
    } else {
        checkpoint = {
            startedAt: new Date().toISOString(),
            corpusPath: options.corpusPath,
            gamesTotal: games.length,
            startIndex: options.startIndex,
            endIndex: windowEnd,
            lastCompletedIndex: options.startIndex - 1,
            lastCompletedGame: null,
            stats: freshStats(),
        };
    }

    const logger = new AuditLogger(options.logDir);
    const effectiveStart = Math.max(
        options.startIndex,
        checkpoint.lastCompletedIndex + 1,
    );
    const windowSize = windowEnd - options.startIndex;
    const progressEvery = options.progressEvery != null
        ? options.progressEvery
        : (options.shardId != null ? 0 : (windowSize > 200 ? 50 : 1));
    const shardTag = options.shardId != null ? `s${options.shardId}` : null;

    let failures = 0;

    for (let offset = effectiveStart - options.startIndex; offset < windowGames.length; offset++) {
        const gameIndex = options.startIndex + offset;
        const game = windowGames[offset];
        const source = fs.readFileSync(path.join(options.corpusPath, game), 'utf8');
        const result = auditCanonicalRoundTrip(source, game);
        const failure = failureRecord(game, gameIndex, result);
        if (failure) {
            logger.failure(failure);
            failures++;
        }

        updateStats(checkpoint.stats, result);
        checkpoint.lastCompletedIndex = gameIndex;
        checkpoint.lastCompletedGame = game;
        checkpoint.updatedAt = new Date().toISOString();
        writeCheckpoint(options.logDir, checkpoint);

        const shardDone = gameIndex - options.startIndex + 1;
        const isLastInWindow = gameIndex >= windowEnd - 1;
        const shouldLog = progressEvery > 0 && (
            shardDone === 1 || isLastInWindow || shardDone % progressEvery === 0
        );
        if (shouldLog) {
            const prefix = shardTag ? `canonicalizer ${shardTag}` : 'canonicalizer';
            logger.line(
                `${prefix}: shard ${shardDone}/${windowSize} | `
                + `corpus ${gameIndex + 1}/${games.length} | `
                + `tested=${checkpoint.stats.tested} fail=${failures}`,
            );
        }
    }

    const summary = {
        finishedAt: new Date().toISOString(),
        corpusPath: options.corpusPath,
        gamesTotal: games.length,
        window: { start: options.startIndex, end: windowEnd },
        failures,
        stats: checkpoint.stats,
    };
    fs.writeFileSync(path.join(options.logDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    await logger.close();

    process.stderr.write(
        `run_canonicalizer_corpus_audit: finished window=[${options.startIndex},${windowEnd}) failures=${failures}\n`
    );

    if (failures > 0 && options.exitOnFailure) {
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`run_canonicalizer_corpus_audit: fatal ${error && error.stack ? error.stack : error}\n`);
        process.exit(1);
    });
}

module.exports = {
    aggregateAuditCheckpointProgress,
    auditCanonicalRoundTrip,
    compileClean,
    failureRecord,
    formatAuditProgressLine,
    freshStats,
    updateStats,
};
