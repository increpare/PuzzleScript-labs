#!/usr/bin/env node
'use strict';

// Single-shard static analysis corpus audit worker (analyze-only, no engine).
//
// Usage:
//   node src/tests/run_static_analysis_corpus_audit.js \
//     --corpus PATH --start 0 --end 100 \
//     --log-dir build/static-analysis-audit/shard-0 \
//     --checks consistency|parity|both

const fs = require('fs');
const path = require('path');

const { analyzeSource } = require('./ps_static_analysis');
const { analyzeAndAudit, mergeInfoStats, emptyInfoStats } = require('./static_analysis_consistency_audit');
const { auditCanonicalParity } = require('./static_analysis_canonical_parity_audit');
const { listCorpusGames, partialRunInstructions, resolvePartialRunAction } = require('./fuzz_corpus_batch');

function parseArgs(argv) {
    const options = {
        corpusPath: path.join(__dirname, 'solver_tests'),
        logDir: null,
        startIndex: 0,
        endIndex: Infinity,
        checks: 'both',
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
        else if (arg === '--checks') options.checks = argv[++index];
        else if (arg === '--resume') options.resume = true;
        else if (arg === '--fresh') options.fresh = true;
        else if (arg === '--exit-on-failure') options.exitOnFailure = true;
        else if (arg === '--game') options.gameFilter = argv[++index];
        else if (arg === '--shard-id') options.shardId = Number(argv[++index]);
        else if (arg === '--progress-every') options.progressEvery = Number(argv[++index]);
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    if (!['consistency', 'parity', 'both'].includes(options.checks)) {
        throw new Error(`--checks must be consistency, parity, or both (got ${options.checks})`);
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/run_static_analysis_corpus_audit.js --corpus PATH [options]',
        '',
        '  --log-dir PATH          output directory (required for batch runs)',
        '  --start N --end N       corpus index window',
        '  --checks consistency|parity|both',
        '  --resume / --fresh      checkpoint behavior',
        '  --exit-on-failure       exit 1 when violations are found',
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
        consistency: {
            analyzed: 0,
            compileErrors: 0,
            threw: 0,
            violations: 0,
            ...emptyInfoStats(),
        },
        parity: {
            analyzed: 0,
            skipped: 0,
            objectCountMismatch: 0,
            compileErrors: 0,
            violations: 0,
        },
    };
}

function runChecksForGame(source, game, checks) {
    const result = { consistency: null, parity: null };
    if (checks === 'consistency' || checks === 'both') {
        result.consistency = analyzeAndAudit(source, game, analyzeSource);
    }
    if (checks === 'parity' || checks === 'both') {
        result.parity = auditCanonicalParity(source, game, analyzeSource);
    }
    return result;
}

function updateStats(stats, checkResults) {
    if (checkResults.consistency) {
        const check = checkResults.consistency;
        if (check.skipped === 'compile_error') stats.consistency.compileErrors++;
        else if (check.skipped === 'threw') stats.consistency.threw++;
        else stats.consistency.analyzed++;
        mergeInfoStats(stats.consistency, check.info || emptyInfoStats());
        stats.consistency.violations += check.violations.length;
    }
    if (checkResults.parity) {
        const check = checkResults.parity;
        if (check.skipped === 'compile_error') stats.parity.compileErrors++;
        else if (check.skipped === 'object_count_mismatch') stats.parity.objectCountMismatch++;
        else if (check.skipped) stats.parity.skipped++;
        else stats.parity.analyzed++;
        stats.parity.violations += check.violations.length;
    }
}

function collectViolations(checkResults) {
    const violations = [];
    if (checkResults.consistency) violations.push(...checkResults.consistency.violations);
    if (checkResults.parity) violations.push(...checkResults.parity.violations);
    return violations;
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
        this.line(`VIOLATION ${record.check} ${record.game}: ${record.message.slice(0, 240)}`);
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
            for (const checkName of ['consistency', 'parity']) {
                const shardStats = checkpoint.stats[checkName];
                if (!shardStats) continue;
                for (const key of Object.keys(stats[checkName])) {
                    stats[checkName][key] += shardStats[key] || 0;
                }
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
    const totalViolations = stats.consistency.violations + stats.parity.violations;

    return {
        gamesTotal,
        gamesDone,
        overallPercent,
        stats,
        totalViolations,
        shards,
    };
}

function formatAuditProgressLine(progress, elapsedMs) {
    const { formatDuration, formatPercent } = require('./fuzz_corpus_batch');
    const parts = [
        `overall ${progress.overallPercent.toFixed(1)}%`,
        `games ${progress.gamesDone}/${progress.gamesTotal} (${formatPercent(progress.gamesDone, progress.gamesTotal)})`,
        `violations=${progress.totalViolations}`,
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
        options.logDir = path.join(process.cwd(), 'build', 'static-analysis-audit', 'single');
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
        process.stderr.write(`run_static_analysis_corpus_audit: resuming from ${checkpoint.lastCompletedGame || 'start'}\n`);
    } else {
        checkpoint = {
            startedAt: new Date().toISOString(),
            corpusPath: options.corpusPath,
            checks: options.checks,
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

    let unexpectedFailures = 0;

    for (let offset = effectiveStart - options.startIndex; offset < windowGames.length; offset++) {
        const gameIndex = options.startIndex + offset;
        const game = windowGames[offset];
        const source = fs.readFileSync(path.join(options.corpusPath, game), 'utf8');
        const checkResults = runChecksForGame(source, game, options.checks);
        const violations = collectViolations(checkResults);

        for (const violation of violations) {
            const check = violation.includes('canonical parity') ? 'parity' : 'consistency';
            logger.failure({
                at: new Date().toISOString(),
                check,
                game,
                gameIndex,
                message: violation,
            });
        }

        unexpectedFailures += violations.length;
        updateStats(checkpoint.stats, checkResults);
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
            const prefix = shardTag ? `audit ${shardTag}` : 'audit';
            logger.line(
                `${prefix}: shard ${shardDone}/${windowSize} | `
                + `corpus ${gameIndex + 1}/${games.length} | `
                + `fail=${unexpectedFailures}`,
            );
        }
    }

    const summary = {
        finishedAt: new Date().toISOString(),
        corpusPath: options.corpusPath,
        checks: options.checks,
        gamesTotal: games.length,
        window: { start: options.startIndex, end: windowEnd },
        unexpectedFailures,
        stats: checkpoint.stats,
    };
    fs.writeFileSync(path.join(options.logDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    await logger.close();

    process.stderr.write(
        `run_static_analysis_corpus_audit: finished window=[${options.startIndex},${windowEnd}) failures=${unexpectedFailures}\n`
    );

    if (unexpectedFailures > 0 && options.exitOnFailure) {
        process.exit(1);
    }
    console.log(`run_static_analysis_corpus_audit: ok (log-dir=${options.logDir})`);
}

module.exports = {
    aggregateAuditCheckpointProgress,
    formatAuditProgressLine,
};

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`run_static_analysis_corpus_audit: fatal ${error && error.stack ? error.stack : error}\n`);
        process.exit(1);
    });
}
