#!/usr/bin/env node
'use strict';

// Long-running batch fuzzer for large external corpora.
//
// Runs static-contract and/or canonicalization fuzzers over every .txt game in
// a directory, writing a timestamped log file plus JSON checkpoint/summary
// artifacts for later inspection. Designed for overnight or multi-day runs on
// tens of thousands of games.
//
// Usage:
//   node src/tests/fuzz_corpus_batch.js --corpus /path/to/games --mode both
//
// Overnight example (30k gist corpus, shard 0 of 4):
//   nohup node src/tests/fuzz_corpus_batch.js \
//     --corpus /Users/stephenlavelle/Documents/google_gist_scraper/dumpprocessed_compiles \
//     --mode both --start 0 --end 7500 \
//     --log-dir build/fuzz-batch/shard-0 \
//     > /dev/null 2>&1 &
//
// Resume after interruption:
//   node src/tests/fuzz_corpus_batch.js --corpus ... --log-dir build/fuzz-batch/shard-0 --resume
//
// Options:
//   --corpus PATH         directory of .txt games (or PUZZLESCRIPT_FUZZ_CORPUS)
//   --mode MODE           static | canonical | both (default both)
//   --log-dir PATH        output directory (default build/fuzz-batch/<timestamp>)
//   --resume              continue from checkpoint.json in --log-dir
//   --exit-on-failure     exit 1 when unexpected failures are found (default: keep going)
//   --start N --end N      corpus index window for sharding
//   --game SUBSTRING      only fuzz matching games
//   --iterations N        per (game, level); default 1 for batch (vs 2 in standalone static fuzzer)
//   --input-length N      max inputs per sequence (default 30)
//   --max-levels N        playable levels per game (default 1)
//   --include-meta-inputs pass undo/restart into canonicalization traces
//   --strict              static fuzzer: treat known limitations as failures

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function loadStaticFuzzer() {
    return require('./fuzz_static_contracts');
}

function loadCanonicalFuzzer() {
    return require('./fuzz_canonicalization');
}

const DEFAULT_CORPUS = process.env.PUZZLESCRIPT_FUZZ_CORPUS
    || path.join(__dirname, 'solver_tests');

function parseArgs(argv) {
    const options = {
        corpusPath: DEFAULT_CORPUS,
        mode: 'both',
        logDir: null,
        resume: false,
        fresh: false,
        exitOnFailure: false,
        startIndex: 0,
        endIndex: Infinity,
        gameFilter: null,
        iterations: 1,
        inputLength: 30,
        maxLevels: 1,
        includeMetaInputs: false,
        strict: false,
        shardId: null,
        progressEvery: null,
        help: false,
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--corpus') options.corpusPath = path.resolve(argv[++index]);
        else if (arg === '--mode') options.mode = argv[++index];
        else if (arg === '--log-dir') options.logDir = path.resolve(argv[++index]);
        else if (arg === '--resume') options.resume = true;
        else if (arg === '--fresh') options.fresh = true;
        else if (arg === '--exit-on-failure') options.exitOnFailure = true;
        else if (arg === '--start') options.startIndex = Number(argv[++index]);
        else if (arg === '--end') options.endIndex = Number(argv[++index]);
        else if (arg === '--shard-id') options.shardId = Number(argv[++index]);
        else if (arg === '--progress-every') options.progressEvery = Number(argv[++index]);
        else if (arg === '--game') options.gameFilter = argv[++index];
        else if (arg === '--iterations') options.iterations = Number(argv[++index]);
        else if (arg === '--input-length') options.inputLength = Number(argv[++index]);
        else if (arg === '--max-levels') options.maxLevels = Number(argv[++index]);
        else if (arg === '--include-meta-inputs') options.includeMetaInputs = true;
        else if (arg === '--strict') options.strict = true;
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    if (!['static', 'canonical', 'both'].includes(options.mode)) {
        throw new Error(`--mode must be static, canonical, or both (got ${options.mode})`);
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/fuzz_corpus_batch.js --corpus PATH [options]',
        '',
        '  --mode static|canonical|both   which fuzzer(s) to run (default both)',
        '  --log-dir PATH                 output directory (created if missing)',
        '  --resume                       continue from checkpoint.json in log-dir',
        '  --fresh                        ignore existing checkpoint.json and start over',
        '                                 (if neither flag is set and a checkpoint exists,',
        '                                  prompts on a TTY; otherwise exits with instructions)',
        '  --exit-on-failure              exit 1 when failures are found',
        '  --start N --end N              shard the sorted corpus by index',
        '  --iterations N --input-length N --max-levels N',
        '  --include-meta-inputs          canonicalization fuzzer only',
        '  --strict                       static fuzzer only',
        '',
        'Environment:',
        '  PUZZLESCRIPT_FUZZ_CORPUS       default --corpus when flag omitted',
        '',
        'Outputs in --log-dir:',
        '  run.log            human-readable progress + failures',
        '  failures.jsonl     one JSON object per failure line',
        '  checkpoint.json    resume state (updated after each game)',
        '  summary.json       final totals (written on completion)',
    ].join('\n');
}

function timestampSlug(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('-');
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

class BatchLogger {
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
        this.line(`FAILURE ${record.fuzzer} ${record.label} [${record.phase}] ${record.error.slice(0, 240)}`);
    }

    close() {
        return new Promise(resolve => {
            this.stream.end(resolve);
        });
    }
}

function listCorpusGames(corpusPath, gameFilter) {
    return fs.readdirSync(corpusPath)
        .filter(name => name.endsWith('.txt'))
        .filter(name => !gameFilter || name.includes(gameFilter))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function phaseGamesCompleted(checkpoint, phaseName, windowStart, windowEnd) {
    const windowSize = windowEnd - windowStart;
    if (windowSize <= 0) return 0;
    const phase = checkpoint.phases && checkpoint.phases[phaseName];
    if (!phase) return 0;
    const targetEnd = Math.min(windowEnd, checkpoint.gamesTotal || windowEnd);
    if (phase.lastCompletedIndex >= targetEnd - 1) {
        return windowSize;
    }
    if (phase.lastCompletedIndex < windowStart) {
        return 0;
    }
    return Math.min(windowSize, phase.lastCompletedIndex - windowStart + 1);
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '?';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
    if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
}

function formatPercent(done, total) {
    if (total <= 0) return '100.0%';
    return `${((done / total) * 100).toFixed(1)}%`;
}

function aggregateCheckpointProgress(ranges, logDir, gamesTotal, mode) {
    const phases = {
        static: { gamesDone: 0, casesRun: 0, casesSkipped: 0, failures: 0 },
        canonical: { gamesDone: 0, casesRun: 0, casesSkipped: 0, failures: 0 },
    };
    const shards = [];

    for (const range of ranges) {
        const checkpoint = readJsonIfExists(path.join(logDir, `shard-${range.shard}`, 'checkpoint.json'));
        const shardProgress = { shard: range.shard, window: { start: range.start, end: range.end } };
        for (const phaseName of ['static', 'canonical']) {
            const done = checkpoint
                ? phaseGamesCompleted(checkpoint, phaseName, range.start, range.end)
                : 0;
            phases[phaseName].gamesDone += done;
            const stats = checkpoint && checkpoint.phases && checkpoint.phases[phaseName]
                ? checkpoint.phases[phaseName].stats
                : null;
            if (stats) {
                phases[phaseName].casesRun += stats.casesRun || 0;
                phases[phaseName].casesSkipped += stats.casesSkipped || 0;
                phases[phaseName].failures += stats.failures || 0;
            }
            shardProgress[phaseName] = {
                gamesDone: done,
                windowSize: range.end - range.start,
            };
        }
        shards.push(shardProgress);
    }

    const activePhases = mode === 'both' ? ['static', 'canonical']
        : mode === 'static' ? ['static'] : ['canonical'];
    let workUnits = 0;
    let completedUnits = 0;
    for (const phaseName of activePhases) {
        workUnits += gamesTotal;
        completedUnits += phases[phaseName].gamesDone;
    }
    const overallPercent = workUnits > 0 ? (completedUnits / workUnits) * 100 : 100;

    return {
        gamesTotal,
        mode,
        overallPercent,
        workUnits,
        completedUnits,
        phases,
        shards,
    };
}

function formatAggregateProgressLine(progress, elapsedMs) {
    const parts = [`overall ${progress.overallPercent.toFixed(1)}%`];
    if (progress.mode === 'static' || progress.mode === 'both') {
        const phase = progress.phases.static;
        parts.push(`static ${phase.gamesDone}/${progress.gamesTotal} (${formatPercent(phase.gamesDone, progress.gamesTotal)})`);
    }
    if (progress.mode === 'canonical' || progress.mode === 'both') {
        const phase = progress.phases.canonical;
        parts.push(`canonical ${phase.gamesDone}/${progress.gamesTotal} (${formatPercent(phase.gamesDone, progress.gamesTotal)})`);
    }
    const totalFailures = progress.phases.static.failures + progress.phases.canonical.failures;
    parts.push(`fail=${totalFailures}`);
    parts.push(`elapsed=${formatDuration(elapsedMs)}`);
    if (progress.completedUnits > 0 && progress.completedUnits < progress.workUnits) {
        const etaMs = (elapsedMs / progress.completedUnits) * (progress.workUnits - progress.completedUnits);
        parts.push(`eta=${formatDuration(etaMs)}`);
    }
    return parts.join(' | ');
}

function promptContinueOrRestart(contextMessage) {
    process.stderr.write(`${contextMessage}\n`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question('Continue partial run or restart fresh? [C]ontinue / [R]estart: ', answer => {
            rl.close();
            const normalized = String(answer).trim().toLowerCase();
            if (normalized === 'r' || normalized === 'restart' || normalized === 'fresh') {
                resolve('fresh');
            } else {
                resolve('resume');
            }
        });
    });
}

function partialRunInstructions(logDir, detail) {
    return [
        `Partial progress found in ${logDir}${detail ? ` (${detail})` : ''}.`,
        'Pass --resume (or FUZZ_BATCH_RESUME=true) to continue, or --fresh (or FUZZ_BATCH_FRESH=true) to restart.',
    ].join(' ');
}

async function resolvePartialRunAction(options, { logDir, detail }) {
    if (options.fresh || options.resume) {
        return options;
    }
    const checkpointPath = path.join(logDir, 'checkpoint.json');
    const hasPartial = fs.existsSync(checkpointPath);
    if (!hasPartial) {
        return options;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error(partialRunInstructions(logDir, detail));
    }
    const choice = await promptContinueOrRestart(partialRunInstructions(logDir, detail));
    if (choice === 'fresh') {
        options.fresh = true;
    } else {
        options.resume = true;
    }
    return options;
}

function writeCheckpoint(logDir, checkpoint) {
    fs.writeFileSync(path.join(logDir, 'checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function phaseTargetEnd(checkpoint, options) {
    return Math.min(options.endIndex, checkpoint.gamesTotal);
}

function phaseIsComplete(checkpoint, options, fuzzerName) {
    const phase = checkpoint.phases[fuzzerName];
    return phase.lastCompletedIndex >= phaseTargetEnd(checkpoint, options) - 1;
}

function makeFuzzOptions(options, logger, checkpoint, fuzzerName) {
    const phase = checkpoint.phases[fuzzerName];
    const effectiveStart = phaseIsComplete(checkpoint, options, fuzzerName)
        ? options.endIndex
        : Math.max(options.startIndex, phase.lastCompletedIndex + 1);
    const windowEnd = Math.min(options.endIndex, checkpoint.gamesTotal);
    const windowSize = windowEnd - options.startIndex;
    const progressEvery = options.progressEvery != null
        ? options.progressEvery
        : (options.shardId != null ? 0 : (windowSize > 200 ? 50 : 1));
    const shardTag = options.shardId != null ? `s${options.shardId}` : null;

    return {
        corpusPath: options.corpusPath,
        iterations: options.iterations,
        inputLength: options.inputLength,
        maxLevels: options.maxLevels,
        gameFilter: options.gameFilter,
        startIndex: effectiveStart,
        endIndex: options.endIndex,
        strict: options.strict,
        includeMetaInputs: options.includeMetaInputs,
        onGameComplete(progress) {
            phase.lastCompletedIndex = progress.gameIndex;
            phase.lastCompletedGame = progress.game;
            phase.stats = {
                casesRun: progress.casesRun,
                casesSkipped: progress.casesSkipped,
                failures: progress.failures.length,
            };
            checkpoint.updatedAt = new Date().toISOString();
            writeCheckpoint(options.logDir, checkpoint);

            const shardDone = progress.gameIndex - options.startIndex + 1;
            const isLastInWindow = progress.gameIndex >= windowEnd - 1;
            const shouldLog = progressEvery > 0 && (
                shardDone === 1
                || isLastInWindow
                || shardDone % progressEvery === 0
            );
            if (!shouldLog) return;

            const shardPct = formatPercent(shardDone, windowSize);
            const corpusPct = formatPercent(progress.gameIndex + 1, progress.gamesTotal);
            const prefix = shardTag ? `${fuzzerName} ${shardTag}` : fuzzerName;
            logger.line(
                `${prefix}: shard ${shardDone}/${windowSize} (${shardPct}) | `
                + `corpus ${progress.gameIndex + 1}/${progress.gamesTotal} (${corpusPct}) | `
                + `cases=${progress.casesRun} skip=${progress.casesSkipped} fail=${progress.failures.length}`,
            );
        },
    };
}

function recordFailures(logger, fuzzerName, failures) {
    for (const failure of failures) {
        logger.failure({
            fuzzer: fuzzerName,
            at: new Date().toISOString(),
            ...failure,
        });
    }
}

function freshPhaseState(startIndex) {
    return {
        lastCompletedIndex: startIndex - 1,
        lastCompletedGame: null,
        complete: false,
        stats: null,
    };
}

function spawnCanonicalPhase(options) {
    const args = [
        __filename,
        '--corpus', options.corpusPath,
        '--mode', 'canonical',
        '--log-dir', options.logDir,
        '--resume',
        '--start', String(options.startIndex),
        '--iterations', String(options.iterations),
        '--input-length', String(options.inputLength),
        '--max-levels', String(options.maxLevels),
    ];
    if (Number.isFinite(options.endIndex)) {
        args.push('--end', String(options.endIndex));
    }
    if (options.gameFilter) {
        args.push('--game', options.gameFilter);
    }
    if (options.includeMetaInputs) {
        args.push('--include-meta-inputs');
    }
    if (options.exitOnFailure) {
        args.push('--exit-on-failure');
    }
    const child = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (child.error) {
        throw child.error;
    }
    return child.status || 0;
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

    if (!options.logDir) {
        options.logDir = path.join(process.cwd(), 'build', 'fuzz-batch', timestampSlug());
    }
    ensureDir(options.logDir);

    await resolvePartialRunAction(options, { logDir: options.logDir });

    const checkpointPath = path.join(options.logDir, 'checkpoint.json');
    let checkpoint = readJsonIfExists(checkpointPath);
    if (options.fresh && checkpoint) {
        fs.unlinkSync(checkpointPath);
        checkpoint = null;
    }
    if (options.resume) {
        if (!checkpoint) {
            throw new Error(`--resume requested but no checkpoint.json in ${options.logDir}`);
        }
    } else if (!checkpoint) {
        const games = listCorpusGames(options.corpusPath, options.gameFilter);
        checkpoint = {
            startedAt: new Date().toISOString(),
            corpusPath: options.corpusPath,
            mode: options.mode,
            shardId: options.shardId,
            startIndex: options.startIndex,
            endIndex: Number.isFinite(options.endIndex) ? options.endIndex : games.length,
            gamesTotal: games.length,
            phases: {
                static: freshPhaseState(options.startIndex),
                canonical: freshPhaseState(options.startIndex),
            },
            options: {
                iterations: options.iterations,
                inputLength: options.inputLength,
                maxLevels: options.maxLevels,
                includeMetaInputs: options.includeMetaInputs,
                strict: options.strict,
                gameFilter: options.gameFilter,
            },
        };
        writeCheckpoint(options.logDir, checkpoint);
    }
    if (!checkpoint.phases) {
        throw new Error('checkpoint.json is missing phases; delete it and restart without --resume');
    }

    const logger = new BatchLogger(options.logDir);
    logger.line(`fuzz_corpus_batch: starting mode=${options.mode} corpus=${options.corpusPath}`);
    logger.line(`fuzz_corpus_batch: log-dir=${options.logDir} resume=${options.resume} window=[${options.startIndex},${options.endIndex})`);

    const games = listCorpusGames(options.corpusPath, options.gameFilter);
    const windowEnd = Math.min(options.endIndex, games.length);

    const summary = {
        startedAt: checkpoint.startedAt,
        finishedAt: null,
        corpusPath: options.corpusPath,
        mode: options.mode,
        logDir: options.logDir,
        gamesTotal: games.length,
        window: { start: options.startIndex, end: windowEnd },
        fuzzers: {
            static: { casesRun: 0, casesSkipped: 0, knownIssues: 0, failures: 0 },
            canonical: { casesRun: 0, casesSkipped: 0, failures: 0 },
        },
    };

    let unexpectedFailures = 0;

    if (options.mode === 'static' || options.mode === 'both') {
        if (!phaseIsComplete(checkpoint, options, 'static')) {
            logger.line('fuzz_corpus_batch: running static-contract fuzzer');
            const { runStaticContractsFuzzer } = loadStaticFuzzer();
            const result = runStaticContractsFuzzer(makeFuzzOptions(options, logger, checkpoint, 'static'));
            for (const failure of result.known) {
                logger.line(`static: known limitation (${failure.kind}): ${failure.label}`);
            }
            recordFailures(logger, 'static', result.unexpected);
            unexpectedFailures += result.unexpected.length;
            summary.fuzzers.static = {
                casesRun: result.casesRun,
                casesSkipped: result.casesSkipped,
                knownIssues: result.known.length,
                failures: result.unexpected.length,
            };
            writeCheckpoint(options.logDir, checkpoint);
            logger.line(`fuzz_corpus_batch: static done cases=${result.casesRun} skipped=${result.casesSkipped} known=${result.known.length} failures=${result.unexpected.length}`);
        } else {
            logger.line('fuzz_corpus_batch: static phase already complete (resume)');
        }
    }

    if (options.mode === 'both' && !phaseIsComplete(checkpoint, options, 'canonical')) {
        summary.finishedAt = null;
        summary.unexpectedFailures = unexpectedFailures;
        fs.writeFileSync(path.join(options.logDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
        logger.line('fuzz_corpus_batch: handing off canonical phase to fresh node process');
        await logger.close();
        const childStatus = spawnCanonicalPhase(options);
        process.exit(childStatus);
    }

    if (options.mode === 'canonical') {
        if (!phaseIsComplete(checkpoint, options, 'canonical')) {
            logger.line('fuzz_corpus_batch: running canonicalization fuzzer');
            const { runCanonicalizationFuzzer } = loadCanonicalFuzzer();
            const result = runCanonicalizationFuzzer(makeFuzzOptions(options, logger, checkpoint, 'canonical'));
            recordFailures(logger, 'canonical', result.failures);
            unexpectedFailures += result.failures.length;
            summary.fuzzers.canonical = {
                casesRun: result.casesRun,
                casesSkipped: result.casesSkipped,
                failures: result.failures.length,
            };
            writeCheckpoint(options.logDir, checkpoint);
            logger.line(`fuzz_corpus_batch: canonical done cases=${result.casesRun} skipped=${result.casesSkipped} failures=${result.failures.length}`);
        } else {
            logger.line('fuzz_corpus_batch: canonical phase already complete (resume)');
        }
    }

    const priorSummary = readJsonIfExists(path.join(options.logDir, 'summary.json'));
    if (priorSummary && priorSummary.fuzzers && priorSummary.fuzzers.static) {
        summary.fuzzers.static = priorSummary.fuzzers.static;
        unexpectedFailures += priorSummary.fuzzers.static.failures || 0;
    }

    summary.finishedAt = new Date().toISOString();
    summary.unexpectedFailures = unexpectedFailures;
    fs.writeFileSync(path.join(options.logDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

    logger.line(`fuzz_corpus_batch: finished unexpected_failures=${unexpectedFailures}`);
    logger.line(`fuzz_corpus_batch: summary=${path.join(options.logDir, 'summary.json')}`);
    await logger.close();

    if (unexpectedFailures > 0 && options.exitOnFailure) {
        process.exit(1);
    }
    console.log(`fuzz_corpus_batch: ok (log-dir=${options.logDir})`);
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`fuzz_corpus_batch: fatal ${error && error.stack ? error.stack : error}\n`);
        process.exit(1);
    });
}

module.exports = {
    aggregateCheckpointProgress,
    formatAggregateProgressLine,
    formatDuration,
    formatPercent,
    listCorpusGames,
    partialRunInstructions,
    phaseGamesCompleted,
    promptContinueOrRestart,
    resolvePartialRunAction,
    timestampSlug,
};
