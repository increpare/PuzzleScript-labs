#!/usr/bin/env node
'use strict';

// Parallel launcher for run_static_analysis_corpus_audit.js.
//
// Usage:
//   node src/tests/run_static_analysis_corpus_parallel.js \
//     --corpus PATH --jobs 8 --checks both --log-dir build/static-analysis-audit-giant

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
    listCorpusGames,
    partialRunInstructions,
    promptContinueOrRestart,
    timestampSlug,
} = require('./fuzz_corpus_batch');
const {
    aggregateAuditCheckpointProgress,
    formatAuditProgressLine,
} = require('./run_static_analysis_corpus_audit');

const PROGRESS_POLL_MS = 15000;

function parseArgs(argv) {
    const options = {
        corpusPath: path.join(__dirname, 'solver_tests'),
        jobs: 8,
        checks: 'both',
        logDir: null,
        resume: false,
        fresh: false,
        exitOnFailure: false,
        gameFilter: null,
        extraArgs: [],
        help: false,
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--corpus') options.corpusPath = path.resolve(argv[++index]);
        else if (arg === '--jobs') options.jobs = Number(argv[++index]);
        else if (arg === '--checks') options.checks = argv[++index];
        else if (arg === '--log-dir') options.logDir = path.resolve(argv[++index]);
        else if (arg === '--resume') options.resume = true;
        else if (arg === '--fresh') options.fresh = true;
        else if (arg === '--exit-on-failure') options.exitOnFailure = true;
        else if (arg === '--game') options.gameFilter = argv[++index];
        else if (arg === '--help' || arg === '-h') options.help = true;
        else options.extraArgs.push(arg);
    }
    if (!Number.isInteger(options.jobs) || options.jobs < 1) {
        throw new Error('--jobs must be a positive integer');
    }
    if (!['consistency', 'parity', 'both'].includes(options.checks)) {
        throw new Error(`--checks must be consistency, parity, or both (got ${options.checks})`);
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/run_static_analysis_corpus_parallel.js --corpus PATH --jobs N [options]',
        '',
        '  --log-dir PATH          parent output directory',
        '  --checks consistency|parity|both',
        '  --resume / --fresh      checkpoint behavior',
        '  --exit-on-failure       exit 1 when violations are found',
    ].join('\n');
}

function shardRanges(total, jobs) {
    const ranges = [];
    const baseSize = Math.floor(total / jobs);
    const remainder = total % jobs;
    let start = 0;
    for (let shard = 0; shard < jobs; shard++) {
        const size = baseSize + (shard < remainder ? 1 : 0);
        if (size === 0) break;
        ranges.push({ shard, start, end: start + size });
        start += size;
    }
    return ranges;
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runShard(workerScript, options, range) {
    const shardLogDir = path.join(options.logDir, `shard-${range.shard}`);
    fs.mkdirSync(shardLogDir, { recursive: true });

    const args = [
        workerScript,
        '--corpus', options.corpusPath,
        '--checks', options.checks,
        '--log-dir', shardLogDir,
        ...options.extraArgs,
        '--start', String(range.start),
        '--end', String(range.end),
        '--shard-id', String(range.shard),
    ];
    if (options.gameFilter) {
        args.push('--game', options.gameFilter);
    }
    const checkpointPath = path.join(shardLogDir, 'checkpoint.json');
    if (options.fresh && fs.existsSync(checkpointPath)) {
        fs.unlinkSync(checkpointPath);
    }
    if (options.resume && fs.existsSync(checkpointPath)) {
        args.push('--resume');
    }

    return new Promise(resolve => {
        const startedAt = new Date().toISOString();
        process.stderr.write(`run_static_analysis_corpus_parallel: starting shard ${range.shard} [${range.start},${range.end}) -> ${shardLogDir}\n`);
        const child = spawn(process.execPath, args, { stdio: 'inherit' });
        child.on('close', code => {
            resolve({
                shard: range.shard,
                start: range.start,
                end: range.end,
                logDir: shardLogDir,
                startedAt,
                finishedAt: new Date().toISOString(),
                exitCode: code || 0,
            });
        });
    });
}

async function runPool(taskFactories, concurrency) {
    const results = new Array(taskFactories.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < taskFactories.length) {
            const taskIndex = nextIndex++;
            results[taskIndex] = await taskFactories[taskIndex]();
        }
    }

    await Promise.all(Array.from(
        { length: Math.min(concurrency, taskFactories.length) },
        () => worker(),
    ));
    return results;
}

function aggregateShardSummaries(shardResults) {
    const aggregate = {
        shards: shardResults.length,
        gamesTotal: 0,
        unexpectedFailures: 0,
        stats: {
            consistency: { analyzed: 0, compileErrors: 0, threw: 0, violations: 0 },
            parity: { analyzed: 0, skipped: 0, compileErrors: 0, violations: 0 },
        },
        shardSummaries: [],
    };

    for (const shard of shardResults) {
        const summary = readJsonIfExists(path.join(shard.logDir, 'summary.json')) || {};
        aggregate.gamesTotal = Math.max(aggregate.gamesTotal, summary.gamesTotal || 0);
        aggregate.unexpectedFailures += summary.unexpectedFailures || 0;
        for (const checkName of ['consistency', 'parity']) {
            const checkStats = summary.stats && summary.stats[checkName];
            if (!checkStats) continue;
            for (const key of Object.keys(aggregate.stats[checkName])) {
                aggregate.stats[checkName][key] += checkStats[key] || 0;
            }
        }
        aggregate.shardSummaries.push({
            shard: shard.shard,
            window: { start: shard.start, end: shard.end },
            logDir: shard.logDir,
            exitCode: shard.exitCode,
            unexpectedFailures: summary.unexpectedFailures || 0,
        });
    }

    return aggregate;
}

function writeProgressSnapshot(logDir, manifest, ranges, startedAtMs) {
    const progress = aggregateAuditCheckpointProgress(ranges, logDir, manifest.gamesTotal);
    const elapsedMs = Date.now() - startedAtMs;
    const snapshot = {
        updatedAt: new Date().toISOString(),
        elapsedMs,
        etaMs: progress.gamesDone > 0 && progress.gamesDone < progress.gamesTotal
            ? (elapsedMs / progress.gamesDone) * (progress.gamesTotal - progress.gamesDone)
            : null,
        checks: manifest.checks,
        ...progress,
    };
    fs.writeFileSync(path.join(logDir, 'progress.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stderr.write(`run_static_analysis_corpus_parallel: ${formatAuditProgressLine(progress, elapsedMs)}\n`);
    return snapshot;
}

function startProgressMonitor(logDir, manifest, ranges, startedAtMs) {
    writeProgressSnapshot(logDir, manifest, ranges, startedAtMs);
    return setInterval(() => {
        writeProgressSnapshot(logDir, manifest, ranges, startedAtMs);
    }, PROGRESS_POLL_MS);
}

function clearShardCheckpoints(logDir, ranges) {
    for (const range of ranges) {
        const checkpointPath = path.join(logDir, `shard-${range.shard}`, 'checkpoint.json');
        if (fs.existsSync(checkpointPath)) {
            fs.unlinkSync(checkpointPath);
        }
    }
}

function countShardCheckpoints(logDir, ranges) {
    return ranges.filter(range => fs.existsSync(
        path.join(logDir, `shard-${range.shard}`, 'checkpoint.json'),
    )).length;
}

async function resolveParallelPartialRunAction(options, logDir, ranges) {
    if (options.fresh || options.resume) {
        return options;
    }
    const checkpointCount = countShardCheckpoints(logDir, ranges);
    if (checkpointCount === 0) {
        return options;
    }
    const detail = `${checkpointCount}/${ranges.length} shard checkpoints`;
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
        options.logDir = path.join(process.cwd(), 'build', 'static-analysis-audit', timestampSlug());
    }
    fs.mkdirSync(options.logDir, { recursive: true });

    const games = listCorpusGames(options.corpusPath, options.gameFilter);
    const ranges = shardRanges(games.length, options.jobs);
    const workerScript = path.join(__dirname, 'run_static_analysis_corpus_audit.js');

    await resolveParallelPartialRunAction(options, options.logDir, ranges);

    if (options.fresh) {
        clearShardCheckpoints(options.logDir, ranges);
        process.stderr.write('run_static_analysis_corpus_parallel: restarting fresh (shard checkpoints cleared)\n');
    } else if (options.resume) {
        process.stderr.write(`run_static_analysis_corpus_parallel: continuing partial run (${countShardCheckpoints(options.logDir, ranges)} shard checkpoints)\n`);
    }

    const manifest = {
        startedAt: new Date().toISOString(),
        corpusPath: options.corpusPath,
        checks: options.checks,
        jobs: options.jobs,
        gamesTotal: games.length,
        shards: ranges,
        extraArgs: options.extraArgs,
    };
    fs.writeFileSync(path.join(options.logDir, 'shards.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    process.stderr.write(`run_static_analysis_corpus_parallel: corpus=${options.corpusPath} games=${games.length} jobs=${options.jobs} shards=${ranges.length} log-dir=${options.logDir}\n`);
    process.stderr.write(`run_static_analysis_corpus_parallel: live progress -> ${path.join(options.logDir, 'progress.json')} (every ${PROGRESS_POLL_MS / 1000}s)\n`);

    const startedAtMs = Date.now();
    const progressTimer = startProgressMonitor(options.logDir, manifest, ranges, startedAtMs);

    let shardResults;
    try {
        shardResults = await runPool(
            ranges.map(range => () => runShard(workerScript, options, range)),
            options.jobs,
        );
    } finally {
        clearInterval(progressTimer);
        writeProgressSnapshot(options.logDir, manifest, ranges, startedAtMs);
    }

    const aggregate = aggregateShardSummaries(shardResults);
    aggregate.finishedAt = new Date().toISOString();
    aggregate.logDir = options.logDir;
    aggregate.checks = options.checks;
    aggregate.failedShards = shardResults.filter(shard => shard.exitCode !== 0).map(shard => shard.shard);
    fs.writeFileSync(path.join(options.logDir, 'aggregate-summary.json'), `${JSON.stringify(aggregate, null, 2)}\n`);

    process.stderr.write(`run_static_analysis_corpus_parallel: finished shards=${ranges.length} violations=${aggregate.unexpectedFailures} failed_shards=${aggregate.failedShards.length}\n`);
    process.stderr.write(`run_static_analysis_corpus_parallel: aggregate=${path.join(options.logDir, 'aggregate-summary.json')}\n`);

    if (aggregate.failedShards.length > 0) {
        process.stderr.write(`run_static_analysis_corpus_parallel: failed (${aggregate.failedShards.length} shard(s): ${aggregate.failedShards.join(', ')})\n`);
        process.exit(1);
    }
    if (aggregate.unexpectedFailures > 0 && options.exitOnFailure) {
        process.exit(1);
    }
    console.log(`run_static_analysis_corpus_parallel: ok (log-dir=${options.logDir})`);
}

main().catch(error => {
    process.stderr.write(`run_static_analysis_corpus_parallel: fatal ${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
});
