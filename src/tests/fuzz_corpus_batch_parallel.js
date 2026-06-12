#!/usr/bin/env node
'use strict';

// Parallel shard launcher for fuzz_corpus_batch.js.
//
// Splits a corpus into N index windows and runs one batch worker per shard,
// with at most --jobs workers in flight at once.
//
// Usage:
//   node src/tests/fuzz_corpus_batch_parallel.js \
//     --corpus /path/to/games --jobs 8 --log-dir build/fuzz-batch

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
    aggregateCheckpointProgress,
    formatAggregateProgressLine,
    listCorpusGames,
    partialRunInstructions,
    promptContinueOrRestart,
    timestampSlug,
} = require('./fuzz_corpus_batch');

const PROGRESS_POLL_MS = 15000;

const DEFAULT_CORPUS = process.env.PUZZLESCRIPT_FUZZ_CORPUS
    || path.join(__dirname, 'solver_tests');

function parseArgs(argv) {
    const options = {
        corpusPath: DEFAULT_CORPUS,
        jobs: 8,
        mode: 'both',
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
        else if (arg === '--mode') options.mode = argv[++index];
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
    if (!['static', 'canonical', 'both'].includes(options.mode)) {
        throw new Error(`--mode must be static, canonical, or both (got ${options.mode})`);
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/fuzz_corpus_batch_parallel.js --corpus PATH --jobs N [options]',
        '',
        '  --log-dir PATH          parent output directory (default build/fuzz-batch/<timestamp>)',
        '  --mode static|canonical|both',
        '  --resume                continue from checkpoint.json',
        '  --fresh                 ignore existing shard checkpoints and start over',
        '                          (if neither flag is set and checkpoints exist,',
        '                           prompts on a TTY; otherwise exits with instructions)',
        '  --exit-on-failure       exit 1 if any shard process exits non-zero',
        '  --game SUBSTRING        only fuzz matching games',
        '',
        'Additional flags are forwarded to each shard worker, e.g.:',
        '  --iterations 1 --max-levels 1 --input-length 30',
        '',
        'Outputs in --log-dir:',
        '  shards.json             shard index windows + worker log dirs',
        '  aggregate-summary.json  rolled-up totals across shards',
        '  progress.json           live overall completion (updated every 15s)',
        '  shard-N/                per-shard run.log, failures.jsonl, checkpoint.json, summary.json',
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

function runShard(batchScript, options, range) {
    const shardLogDir = path.join(options.logDir, `shard-${range.shard}`);
    fs.mkdirSync(shardLogDir, { recursive: true });

    const args = [
        batchScript,
        '--corpus', options.corpusPath,
        '--mode', options.mode,
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
        process.stderr.write(`fuzz_corpus_batch_parallel: starting shard ${range.shard} [${range.start},${range.end}) -> ${shardLogDir}\n`);
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
        fuzzers: {
            static: { casesRun: 0, casesSkipped: 0, knownIssues: 0, failures: 0 },
            canonical: { casesRun: 0, casesSkipped: 0, failures: 0 },
        },
        shardSummaries: [],
    };

    for (const shard of shardResults) {
        const summary = readJsonIfExists(path.join(shard.logDir, 'summary.json')) || {};
        aggregate.gamesTotal = Math.max(aggregate.gamesTotal, summary.gamesTotal || 0);
        aggregate.unexpectedFailures += summary.unexpectedFailures || 0;
        for (const fuzzerName of ['static', 'canonical']) {
            const fuzzer = summary.fuzzers && summary.fuzzers[fuzzerName];
            if (!fuzzer) continue;
            for (const key of Object.keys(aggregate.fuzzers[fuzzerName])) {
                aggregate.fuzzers[fuzzerName][key] += fuzzer[key] || 0;
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
    const progress = aggregateCheckpointProgress(
        ranges,
        logDir,
        manifest.gamesTotal,
        manifest.mode,
    );
    const elapsedMs = Date.now() - startedAtMs;
    const snapshot = {
        updatedAt: new Date().toISOString(),
        elapsedMs,
        etaMs: progress.completedUnits > 0 && progress.completedUnits < progress.workUnits
            ? (elapsedMs / progress.completedUnits) * (progress.workUnits - progress.completedUnits)
            : null,
        ...progress,
    };
    fs.writeFileSync(path.join(logDir, 'progress.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stderr.write(`fuzz_corpus_batch_parallel: ${formatAggregateProgressLine(progress, elapsedMs)}\n`);
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
        options.logDir = path.join(process.cwd(), 'build', 'fuzz-batch', timestampSlug());
    }
    fs.mkdirSync(options.logDir, { recursive: true });

    const games = listCorpusGames(options.corpusPath, options.gameFilter);
    const ranges = shardRanges(games.length, options.jobs);
    const batchScript = path.join(__dirname, 'fuzz_corpus_batch.js');

    await resolveParallelPartialRunAction(options, options.logDir, ranges);

    if (options.fresh) {
        clearShardCheckpoints(options.logDir, ranges);
        process.stderr.write('fuzz_corpus_batch_parallel: restarting fresh (shard checkpoints cleared)\n');
    } else if (options.resume) {
        process.stderr.write(`fuzz_corpus_batch_parallel: continuing partial run (${countShardCheckpoints(options.logDir, ranges)} shard checkpoints)\n`);
    }

    const manifest = {
        startedAt: new Date().toISOString(),
        corpusPath: options.corpusPath,
        mode: options.mode,
        jobs: options.jobs,
        gamesTotal: games.length,
        shards: ranges,
        extraArgs: options.extraArgs,
    };
    fs.writeFileSync(path.join(options.logDir, 'shards.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    process.stderr.write(`fuzz_corpus_batch_parallel: corpus=${options.corpusPath} games=${games.length} jobs=${options.jobs} shards=${ranges.length} log-dir=${options.logDir}\n`);
    process.stderr.write(`fuzz_corpus_batch_parallel: live progress -> ${path.join(options.logDir, 'progress.json')} (every ${PROGRESS_POLL_MS / 1000}s)\n`);

    const startedAtMs = Date.now();
    const progressTimer = startProgressMonitor(options.logDir, manifest, ranges, startedAtMs);

    let shardResults;
    try {
        shardResults = await runPool(
            ranges.map(range => () => runShard(batchScript, options, range)),
            options.jobs,
        );
    } finally {
        clearInterval(progressTimer);
        writeProgressSnapshot(options.logDir, manifest, ranges, startedAtMs);
    }

    const aggregate = aggregateShardSummaries(shardResults);
    aggregate.finishedAt = new Date().toISOString();
    aggregate.logDir = options.logDir;
    aggregate.failedShards = shardResults.filter(shard => shard.exitCode !== 0).map(shard => shard.shard);
    fs.writeFileSync(path.join(options.logDir, 'aggregate-summary.json'), `${JSON.stringify(aggregate, null, 2)}\n`);

    process.stderr.write(`fuzz_corpus_batch_parallel: finished shards=${ranges.length} unexpected_failures=${aggregate.unexpectedFailures} failed_shards=${aggregate.failedShards.length}\n`);
    process.stderr.write(`fuzz_corpus_batch_parallel: aggregate=${path.join(options.logDir, 'aggregate-summary.json')}\n`);

    if (aggregate.failedShards.length > 0) {
        process.stderr.write(`fuzz_corpus_batch_parallel: failed (${aggregate.failedShards.length} shard(s): ${aggregate.failedShards.join(', ')})\n`);
        process.exit(1);
    }
    if (aggregate.unexpectedFailures > 0 && options.exitOnFailure) {
        process.exit(1);
    }
    console.log(`fuzz_corpus_batch_parallel: ok (log-dir=${options.logDir})`);
}

main().catch(error => {
    process.stderr.write(`fuzz_corpus_batch_parallel: fatal ${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
});
