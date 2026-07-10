#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MEMORY_CEILING_MB = 32;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_TIME_EXECUTABLE = '/usr/bin/time';
const VALID_TIME_FLAVORS = ['auto', 'darwin', 'gnu'];

function bytesToMb(bytes) {
    if (bytes === null || bytes === undefined) {
        return null;
    }
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function parseClockSeconds(value) {
    const parts = String(value).trim().split(':').map(Number);
    if (parts.some((part) => Number.isNaN(part))) {
        return null;
    }
    if (parts.length === 1) {
        return parts[0];
    }
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
}

function parseTimeOutput(stderrText) {
    const text = String(stderrText);
    const darwinRss = text.match(/^\s*(\d+)\s+maximum resident set size\s*$/m);
    if (darwinRss) {
        const real = text.match(/^\s*([0-9.]+)\s+real\s*$/m);
        return {
            format: 'darwin',
            maxRssBytes: Number(darwinRss[1]),
            realSeconds: real ? Number(real[1]) : null,
        };
    }

    const gnuRss = text.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
    if (gnuRss) {
        const elapsed = text.match(/^\s*Elapsed \(wall clock\) time.*\):\s*([0-9:.]+)\s*$/m);
        return {
            format: 'gnu',
            maxRssBytes: Number(gnuRss[1]) * 1024,
            realSeconds: elapsed ? parseClockSeconds(elapsed[1]) : null,
        };
    }

    throw new Error('could not parse maximum resident set size from time output');
}

function requireStringField(object, key, context) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) {
        throw new Error(`${context}missing string field ${key}`);
    }
    if (typeof object[key] !== 'string') {
        throw new Error(`${context}field ${key} must be a string`);
    }
    return object[key];
}

function loadNdjsonCorpusText(label, ndjsonText) {
    const sources = [];
    const lines = String(ndjsonText).split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const lineNumber = lineIndex + 1;
        if (line.trim() === '') {
            continue;
        }
        const context = `${label}:${lineNumber}: `;
        let record;
        try {
            record = JSON.parse(line);
        } catch (error) {
            throw new Error(`${context}invalid JSON: ${error.message}`);
        }
        if (record === null || Array.isArray(record) || typeof record !== 'object') {
            throw new Error(`${context}record must be a JSON object`);
        }
        sources.push({
            index: Number.isInteger(record.index) ? record.index : sources.length,
            name: requireStringField(record, 'name', context),
            source: requireStringField(record, 'source', context),
        });
    }
    return sources;
}

function loadNdjsonCorpusFile(filePath) {
    return loadNdjsonCorpusText(filePath, fs.readFileSync(filePath, 'utf8'));
}

function sourceFileName(source) {
    const index = String(source.index).padStart(4, '0');
    const base = path.basename(String(source.name || 'game'), path.extname(String(source.name || '')));
    const cleaned = base
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return `${index}-${cleaned || 'game'}.txt`;
}

function stderrTail(text, maxLines = 20, maxChars = 4000) {
    const lines = String(text || '').split(/\r?\n/).slice(-maxLines).join('\n');
    if (lines.length <= maxChars) {
        return lines;
    }
    return lines.slice(lines.length - maxChars);
}

function killProcessGroup(child, signal) {
    if (!child || !child.pid) {
        return;
    }
    if (process.platform !== 'win32') {
        try {
            process.kill(-child.pid, signal);
            return;
        } catch (error) {
            if (error.code !== 'ESRCH') {
                try {
                    child.kill(signal);
                } catch (_killError) {
                    // Best-effort cleanup; close/error events still report the final state.
                }
            }
            return;
        }
    }
    try {
        child.kill(signal);
    } catch (_error) {
        // Best-effort cleanup on Windows.
    }
}

function spawnCaptured(command, args, options) {
    const encoding = options.encoding || 'utf8';
    const maxBuffer = options.maxBuffer || DEFAULT_MAX_BUFFER_BYTES;
    const timeoutMs = options.timeout || DEFAULT_TIMEOUT_MS;

    return new Promise((resolve) => {
        const spawnOptions = {
            cwd: options.cwd,
            env: options.env,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        };
        const stdoutChunks = [];
        const stderrChunks = [];
        let stdoutLength = 0;
        let stderrLength = 0;
        let error = null;
        let settled = false;
        let timeout = null;
        let forceKillTimeout = null;

        function finish(status, signal) {
            if (settled) {
                return;
            }
            settled = true;
            if (timeout !== null) {
                clearTimeout(timeout);
            }
            if (forceKillTimeout !== null) {
                clearTimeout(forceKillTimeout);
            }
            resolve({
                status,
                signal,
                stdout: Buffer.concat(stdoutChunks, stdoutLength).toString(encoding),
                stderr: Buffer.concat(stderrChunks, stderrLength).toString(encoding),
                error,
            });
        }

        let child;
        try {
            child = childProcess.spawn(command, args, spawnOptions);
        } catch (spawnError) {
            error = spawnError;
            finish(null, null);
            return;
        }

        function appendChunk(chunks, streamName, chunk) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
            const currentLength = streamName === 'stdout' ? stdoutLength : stderrLength;
            const available = maxBuffer - currentLength;
            if (available > 0) {
                chunks.push(buffer.length > available ? buffer.subarray(0, available) : buffer);
                if (streamName === 'stdout') {
                    stdoutLength += Math.min(buffer.length, available);
                } else {
                    stderrLength += Math.min(buffer.length, available);
                }
            }
            if (buffer.length > available && error === null) {
                error = new Error(`${streamName} maxBuffer length exceeded`);
                error.code = 'ENOBUFS';
                killProcessGroup(child, 'SIGTERM');
            }
        }

        child.stdout.on('data', (chunk) => appendChunk(stdoutChunks, 'stdout', chunk));
        child.stderr.on('data', (chunk) => appendChunk(stderrChunks, 'stderr', chunk));
        child.on('error', (spawnError) => {
            if (error === null) {
                error = spawnError;
            }
        });
        child.on('close', finish);

        timeout = setTimeout(() => {
            if (error === null) {
                error = new Error(`spawn ${command} ETIMEDOUT`);
                error.code = 'ETIMEDOUT';
            }
            killProcessGroup(child, 'SIGTERM');
            forceKillTimeout = setTimeout(() => {
                killProcessGroup(child, 'SIGKILL');
            }, 1000);
        }, timeoutMs);
    });
}

async function supportedTimeFlavor(preferredFlavor, timeExecutable, spawnFn) {
    if (preferredFlavor && preferredFlavor !== 'auto') {
        return preferredFlavor;
    }
    const run = spawnFn || spawnCaptured;
    const executable = timeExecutable || DEFAULT_TIME_EXECUTABLE;
    const probeOptions = {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 10000,
    };
    const darwinProbe = await run(executable, ['-lp', 'true'], probeOptions);
    if (darwinProbe.status === 0) {
        return 'darwin';
    }
    const gnuProbe = await run(executable, ['-v', 'true'], probeOptions);
    if (gnuProbe.status === 0) {
        return 'gnu';
    }
    throw new Error(`could not find a supported time mode (-lp or -v) with ${executable}`);
}

function timeArgs(flavor) {
    if (flavor === 'darwin') {
        return ['-lp'];
    }
    if (flavor === 'gnu') {
        return ['-v'];
    }
    throw new Error(`unsupported time flavor: ${flavor}`);
}

async function runMeasuredGame(source, options) {
    fs.mkdirSync(options.tmpDir, { recursive: true });
    const sourcePath = path.join(options.tmpDir, sourceFileName(source));
    fs.writeFileSync(sourcePath, source.source, 'utf8');
    const spawnFn = options.spawn || spawnCaptured;
    const timeExecutable = options.timeExecutable || DEFAULT_TIME_EXECUTABLE;
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    const commandArgs = [
        ...timeArgs(options.timeFlavor),
        options.binary,
        'run',
        sourcePath,
        '--headless',
        '--native-compile',
    ];

    const startedAt = Date.now();
    const result = await spawnFn(timeExecutable, commandArgs, {
        encoding: 'utf8',
        maxBuffer: options.maxBufferBytes,
        timeout: timeoutMs,
    });
    const wallSeconds = (Date.now() - startedAt) / 1000;
    const spawnError = result.error || null;

    let measurement = null;
    let parseError = null;
    try {
        measurement = parseTimeOutput(result.stderr || '');
    } catch (error) {
        parseError = error.message;
    }

    const exitCode = typeof result.status === 'number' ? result.status : null;
    const ok = exitCode === 0 && result.signal === null && spawnError === null && measurement !== null;
    return {
        index: source.index,
        name: source.name,
        source_bytes: Buffer.byteLength(source.source, 'utf8'),
        ok,
        exit_code: exitCode,
        signal: result.signal,
        peak_rss_bytes: measurement ? measurement.maxRssBytes : null,
        peak_rss_mb: measurement ? bytesToMb(measurement.maxRssBytes) : null,
        elapsed_seconds: measurement && measurement.realSeconds !== null ? measurement.realSeconds : wallSeconds,
        time_format: measurement ? measurement.format : options.timeFlavor,
        over_ceiling: measurement ? measurement.maxRssBytes > options.memoryCeilingBytes : false,
        spawn_error: spawnError ? spawnError.message : null,
        spawn_error_code: spawnError && spawnError.code ? spawnError.code : null,
        timed_out: spawnError && spawnError.code === 'ETIMEDOUT',
        timeout_ms: timeoutMs,
        parse_error: parseError,
        stdout_tail: stderrTail(result.stdout),
        stderr_tail: stderrTail(result.stderr),
        command: [timeExecutable, ...commandArgs],
    };
}

function summarizeResults(results, memoryCeilingBytes) {
    const measured = results.filter((record) => typeof record.peak_rss_bytes === 'number');
    const failures = results.filter((record) => !record.ok);
    const overCeiling = measured.filter((record) => record.peak_rss_bytes > memoryCeilingBytes);
    const sorted = measured
        .slice()
        .sort((a, b) => b.peak_rss_bytes - a.peak_rss_bytes)
        .slice(0, 10)
        .map((record) => ({
            index: record.index,
            name: record.name,
            peak_rss_bytes: record.peak_rss_bytes,
            peak_rss_mb: bytesToMb(record.peak_rss_bytes),
            elapsed_seconds: record.elapsed_seconds,
            over_ceiling: record.peak_rss_bytes > memoryCeilingBytes,
        }));
    const maxPeak = sorted.length > 0 ? sorted[0].peak_rss_bytes : null;

    return {
        game_count: results.length,
        measured_games: measured.length,
        failures: failures.length,
        memory_ceiling_bytes: memoryCeilingBytes,
        memory_ceiling_mb: bytesToMb(memoryCeilingBytes),
        over_ceiling: overCeiling.length,
        max_peak_rss_bytes: maxPeak,
        max_peak_rss_mb: bytesToMb(maxPeak),
        top_peak_rss: sorted,
    };
}

function parseArgs(argv) {
    const options = {
        binary: path.join('build', 'native', 'puzzlescript_cpp'),
        corpusNdjson: null,
        out: path.join('build', 'handheld_memory_audit.json'),
        tmpDir: path.join('build', 'handheld_memory_audit_sources'),
        limit: null,
        memoryCeilingBytes: DEFAULT_MEMORY_CEILING_MB * 1024 * 1024,
        timeExecutable: DEFAULT_TIME_EXECUTABLE,
        timeFlavor: 'auto',
        maxBufferBytes: DEFAULT_MAX_BUFFER_BYTES,
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
        if (arg === '--memory-ceiling-mb' && index + 1 < argv.length) {
            options.memoryCeilingBytes = Number(argv[++index]) * 1024 * 1024;
            continue;
        }
        if (arg === '--time-flavor' && index + 1 < argv.length) {
            options.timeFlavor = argv[++index];
            continue;
        }
        if (arg === '--time-executable' && index + 1 < argv.length) {
            options.timeExecutable = argv[++index];
            continue;
        }
        if (arg === '--timeout-ms' && index + 1 < argv.length) {
            options.timeoutMs = Number(argv[++index]);
            continue;
        }
        throw new Error(`unknown or incomplete option: ${arg}`);
    }

    if (!VALID_TIME_FLAVORS.includes(options.timeFlavor)) {
        throw new Error('--time-flavor must be one of auto, darwin, gnu');
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error('--timeout-ms must be a positive integer');
    }
    if (!options.help && !options.corpusNdjson) {
        throw new Error('--corpus-ndjson is required');
    }
    if (!options.help && (!Number.isFinite(options.memoryCeilingBytes) || options.memoryCeilingBytes <= 0)) {
        throw new Error('--memory-ceiling-mb must be a positive number');
    }
    if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
        throw new Error('--limit must be a positive integer');
    }
    return options;
}

function printUsage(out) {
    out.write([
        'Usage: node scripts/handheld_memory_audit.js --corpus-ndjson build/handheld_testdata.bundle.ndjson [options]',
        '',
        'Options:',
        '  --binary PATH              puzzlescript_cpp binary (default: build/native/puzzlescript_cpp)',
        '  --out PATH                 JSON output path (default: build/handheld_memory_audit.json)',
        '  --tmp-dir PATH             temporary source directory (default: build/handheld_memory_audit_sources)',
        '  --limit N                  measure only the first N corpus records',
        '  --memory-ceiling-mb N      embedded memory ceiling for outlier flags (default: 32)',
        '  --time-flavor auto|darwin|gnu',
        '  --time-executable PATH     time executable wrapper (default: /usr/bin/time)',
        '  --timeout-ms N             per-game timeout in milliseconds (default: 120000)',
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
    options.timeFlavor = await supportedTimeFlavor(options.timeFlavor, options.timeExecutable);

    let sources = loadNdjsonCorpusFile(options.corpusNdjson);
    if (options.limit !== null) {
        sources = sources.slice(0, options.limit);
    }

    const results = [];
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        process.stderr.write(`measuring ${index + 1}/${sources.length}: ${source.name}\n`);
        results.push(await runMeasuredGame(source, options));
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
            time_executable: options.timeExecutable,
            time_flavor: options.timeFlavor,
            timeout_ms: options.timeoutMs,
        },
        summary: summarizeResults(results, options.memoryCeilingBytes),
        games: results,
    };

    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stderr.write(
        `Wrote ${options.out}; max peak RSS ${report.summary.max_peak_rss_mb} MB; ` +
        `${report.summary.over_ceiling} over ${report.summary.memory_ceiling_mb} MB\n`,
    );
    if (report.summary.failures > 0 || report.summary.measured_games === 0) {
        return 1;
    }
    return 0;
}

if (require.main === module) {
    runCli(process.argv.slice(2)).then((exitCode) => {
        process.exitCode = exitCode;
    }).catch((error) => {
        process.stderr.write(`handheld_memory_audit: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    bytesToMb,
    DEFAULT_TIME_EXECUTABLE,
    loadNdjsonCorpusFile,
    loadNdjsonCorpusText,
    parseClockSeconds,
    parseArgs,
    parseTimeOutput,
    runMeasuredGame,
    spawnCaptured,
    sourceFileName,
    summarizeResults,
    supportedTimeFlavor,
};
