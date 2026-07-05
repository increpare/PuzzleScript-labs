#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const audit = require('./handheld_memory_audit');

function withTempDir(callback) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handheld-memory-audit-test-'));
    let result;
    try {
        result = callback(tmpDir);
    } catch (error) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw error;
    }
    if (result && typeof result.then === 'function') {
        return result.finally(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return result;
}

function writeExecutableScript(filePath, body) {
    fs.writeFileSync(filePath, `#!/usr/bin/env node\n${body}`, 'utf8');
    fs.chmodSync(filePath, 0o755);
}

function writeFakeTimeScript(filePath) {
    writeExecutableScript(filePath, `
const childProcess = require('child_process');

const args = process.argv.slice(2);
if (args[0] === '-lp' && args[1] === 'true') {
    process.stderr.write('        0.01 real\\n');
    process.stderr.write('      1024 maximum resident set size\\n');
    process.exit(0);
}
if (args[0] !== '-lp') {
    process.stderr.write('unsupported fake time flavor\\n');
    process.exit(2);
}

const command = args[1];
const commandArgs = args.slice(2);
const result = childProcess.spawnSync(command, commandArgs, { encoding: 'utf8' });
if (result.stdout) {
    process.stdout.write(result.stdout);
}
if (result.stderr) {
    process.stderr.write(result.stderr);
}
if (process.env.FAKE_TIME_PARSE_FAILURE === '1') {
    process.stderr.write('fake time omitted rss\\n');
} else {
    process.stderr.write('        0.05 real\\n');
    process.stderr.write('   2097152 maximum resident set size\\n');
}
if (result.error) {
    process.stderr.write(result.error.message + '\\n');
    process.exit(127);
}
process.exit(typeof result.status === 'number' ? result.status : 1);
`);
}

function writeFakeBinaryScript(filePath, status) {
    writeExecutableScript(filePath, `
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] !== 'run' || !args[1] || !fs.existsSync(args[1])) {
    process.stderr.write('bad fake binary args: ' + JSON.stringify(args) + '\\n');
    process.exit(64);
}
process.stdout.write('fake binary ran ' + args[1] + '\\n');
process.exit(${status});
`);
}

function writeCorpus(filePath, rows) {
    fs.writeFileSync(
        filePath,
        rows.map((row) => `${JSON.stringify(row)}\n`).join(''),
        'utf8',
    );
}

function runCliProcess(args, options = {}) {
    return childProcess.spawnSync(
        process.execPath,
        [path.join(__dirname, 'handheld_memory_audit.js'), ...args],
        {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8',
            env: { ...process.env, ...options.env },
        },
    );
}

function runCliProcessWritesSuccessfulOneGameReport() {
    withTempDir((tmpDir) => {
        const fakeTime = path.join(tmpDir, 'fake-time');
        const fakeBinary = path.join(tmpDir, 'fake-puzzlescript-cpp');
        const corpus = path.join(tmpDir, 'corpus.ndjson');
        const out = path.join(tmpDir, 'report.json');
        const sourceTmp = path.join(tmpDir, 'sources');
        writeFakeTimeScript(fakeTime);
        writeFakeBinaryScript(fakeBinary, 0);
        writeCorpus(corpus, [
            { index: 9, name: 'one game', source: 'title one game\nLEVELS\n.' },
        ]);

        const result = runCliProcess([
            '--binary',
            fakeBinary,
            '--corpus-ndjson',
            corpus,
            '--out',
            out,
            '--tmp-dir',
            sourceTmp,
            '--time-executable',
            fakeTime,
            '--time-flavor',
            'auto',
        ]);

        assert.strictEqual(result.status, 0, result.stderr);
        const report = JSON.parse(fs.readFileSync(out, 'utf8'));
        assert.strictEqual(report.summary.measured_games, 1);
        assert.strictEqual(report.summary.failures, 0);
        assert.strictEqual(report.command.binary, fakeBinary);
        assert.strictEqual(report.command.corpus_ndjson, corpus);
        assert.strictEqual(report.command.time_executable, fakeTime);
        assert.strictEqual(report.command.time_flavor, 'darwin');
        assert.strictEqual(report.games.length, 1);
        assert.strictEqual(report.games[0].ok, true);
        assert.deepStrictEqual(report.games[0].command.slice(0, 3), [fakeTime, '-lp', fakeBinary]);
        assert.strictEqual(report.games[0].time_format, 'darwin');
    });
}

function runCliProcessExitsNonzeroAndWritesFailureReportForBinaryFailure() {
    withTempDir((tmpDir) => {
        const fakeTime = path.join(tmpDir, 'fake-time');
        const fakeBinary = path.join(tmpDir, 'fake-puzzlescript-cpp');
        const corpus = path.join(tmpDir, 'corpus.ndjson');
        const out = path.join(tmpDir, 'report.json');
        writeFakeTimeScript(fakeTime);
        writeFakeBinaryScript(fakeBinary, 7);
        writeCorpus(corpus, [
            { index: 0, name: 'failing game', source: 'title failing' },
        ]);

        const result = runCliProcess([
            '--binary',
            fakeBinary,
            '--corpus-ndjson',
            corpus,
            '--out',
            out,
            '--tmp-dir',
            path.join(tmpDir, 'sources'),
            '--time-executable',
            fakeTime,
        ]);

        assert.notStrictEqual(result.status, 0, result.stderr);
        const report = JSON.parse(fs.readFileSync(out, 'utf8'));
        assert.strictEqual(report.summary.measured_games, 1);
        assert.strictEqual(report.summary.failures, 1);
        assert.strictEqual(report.games[0].ok, false);
        assert.strictEqual(report.games[0].exit_code, 7);
    });
}

function runCliProcessExitsNonzeroAndWritesFailureReportForUnparseableTimeOutput() {
    withTempDir((tmpDir) => {
        const fakeTime = path.join(tmpDir, 'fake-time');
        const fakeBinary = path.join(tmpDir, 'fake-puzzlescript-cpp');
        const corpus = path.join(tmpDir, 'corpus.ndjson');
        const out = path.join(tmpDir, 'report.json');
        writeFakeTimeScript(fakeTime);
        writeFakeBinaryScript(fakeBinary, 0);
        writeCorpus(corpus, [
            { index: 0, name: 'unmeasured game', source: 'title unmeasured' },
        ]);

        const result = runCliProcess([
            '--binary',
            fakeBinary,
            '--corpus-ndjson',
            corpus,
            '--out',
            out,
            '--tmp-dir',
            path.join(tmpDir, 'sources'),
            '--time-executable',
            fakeTime,
        ], { env: { FAKE_TIME_PARSE_FAILURE: '1' } });

        assert.notStrictEqual(result.status, 0, result.stderr);
        const report = JSON.parse(fs.readFileSync(out, 'utf8'));
        assert.strictEqual(report.summary.measured_games, 0);
        assert.strictEqual(report.summary.failures, 1);
        assert.strictEqual(report.games[0].ok, false);
        assert.match(report.games[0].parse_error, /maximum resident set size/);
    });
}

function runCliProcessExitsNonzeroAndWritesEmptyCorpusReport() {
    withTempDir((tmpDir) => {
        const fakeTime = path.join(tmpDir, 'fake-time');
        const fakeBinary = path.join(tmpDir, 'fake-puzzlescript-cpp');
        const corpus = path.join(tmpDir, 'empty.ndjson');
        const out = path.join(tmpDir, 'report.json');
        writeFakeTimeScript(fakeTime);
        writeFakeBinaryScript(fakeBinary, 0);
        writeCorpus(corpus, []);

        const result = runCliProcess([
            '--binary',
            fakeBinary,
            '--corpus-ndjson',
            corpus,
            '--out',
            out,
            '--tmp-dir',
            path.join(tmpDir, 'sources'),
            '--time-executable',
            fakeTime,
        ]);

        assert.notStrictEqual(result.status, 0, result.stderr);
        const report = JSON.parse(fs.readFileSync(out, 'utf8'));
        assert.strictEqual(report.summary.game_count, 0);
        assert.strictEqual(report.summary.measured_games, 0);
        assert.strictEqual(report.summary.failures, 0);
    });
}

function parsesDarwinTimeOutput() {
    const parsed = audit.parseTimeOutput([
        '        0.03 real',
        '        0.01 user',
        '        0.01 sys',
        '     123456 maximum resident set size',
    ].join('\n'));

    assert.deepStrictEqual(parsed, {
        format: 'darwin',
        maxRssBytes: 123456,
        realSeconds: 0.03,
    });
}

function parsesGnuTimeOutput() {
    const parsed = audit.parseTimeOutput([
        'Command being timed: "true"',
        'Elapsed (wall clock) time (h:mm:ss or m:ss): 1:02.50',
        'Maximum resident set size (kbytes): 2048',
    ].join('\n'));

    assert.deepStrictEqual(parsed, {
        format: 'gnu',
        maxRssBytes: 2048 * 1024,
        realSeconds: 62.5,
    });
}

function rejectsMissingPeakRss() {
    assert.throws(
        () => audit.parseTimeOutput('0.01 real\n0.00 user\n0.00 sys\n'),
        /maximum resident set size/,
    );
}

function loadsNdjsonCorpusText() {
    const rows = audit.loadNdjsonCorpusText(
        'inline.ndjson',
        [
            '',
            '{"index":7,"name":"demo","source":"title demo\\nLEVELS\\nP"}',
            '   ',
            '{"name":"second","source":"title second"}',
        ].join('\n'),
    );

    assert.deepStrictEqual(rows, [
        { index: 7, name: 'demo', source: 'title demo\nLEVELS\nP' },
        { index: 1, name: 'second', source: 'title second' },
    ]);
}

function rejectsMalformedNdjsonRecords() {
    assert.throws(
        () => audit.loadNdjsonCorpusText('bad.ndjson', '[]\n'),
        /bad\.ndjson:1: record must be a JSON object/,
    );
    assert.throws(
        () => audit.loadNdjsonCorpusText('bad.ndjson', '{"source":"x"}\n'),
        /bad\.ndjson:1: missing string field name/,
    );
    assert.throws(
        () => audit.loadNdjsonCorpusText('bad.ndjson', '{"name":"x"}\n'),
        /bad\.ndjson:1: missing string field source/,
    );
    assert.throws(
        () => audit.loadNdjsonCorpusText('bad.ndjson', '{"name":3,"source":"x"}\n'),
        /bad\.ndjson:1: field name must be a string/,
    );
}

function sanitizesSourceFileNames() {
    assert.strictEqual(
        audit.sourceFileName({ index: 12, name: '../Odd Game: v1?.txt' }),
        '0012-Odd_Game_v1.txt',
    );
    assert.strictEqual(
        audit.sourceFileName({ index: 3, name: '***' }),
        '0003-game.txt',
    );
}

function summarizesResultsAgainstCeiling() {
    const ceiling = 32 * 1024 * 1024;
    const summary = audit.summarizeResults(
        [
            {
                index: 0,
                name: 'small',
                ok: true,
                peak_rss_bytes: 4 * 1024 * 1024,
                elapsed_seconds: 0.1,
            },
            {
                index: 1,
                name: 'large',
                ok: true,
                peak_rss_bytes: 110 * 1024 * 1024,
                elapsed_seconds: 1.5,
            },
            {
                index: 2,
                name: 'failed',
                ok: false,
                peak_rss_bytes: null,
                elapsed_seconds: null,
            },
        ],
        ceiling,
    );

    assert.strictEqual(summary.game_count, 3);
    assert.strictEqual(summary.measured_games, 2);
    assert.strictEqual(summary.failures, 1);
    assert.strictEqual(summary.memory_ceiling_bytes, ceiling);
    assert.strictEqual(summary.over_ceiling, 1);
    assert.strictEqual(summary.max_peak_rss_bytes, 110 * 1024 * 1024);
    assert.strictEqual(summary.max_peak_rss_mb, 110);
    assert.strictEqual(summary.top_peak_rss[0].name, 'large');
    assert.strictEqual(summary.top_peak_rss[0].peak_rss_mb, 110);
    assert.strictEqual(summary.top_peak_rss[1].name, 'small');
}

function summarizesFailedMeasuredRecordsAgainstCeiling() {
    const ceiling = 32 * 1024 * 1024;
    const summary = audit.summarizeResults(
        [
            {
                index: 0,
                name: 'small',
                ok: true,
                peak_rss_bytes: 4 * 1024 * 1024,
                elapsed_seconds: 0.1,
            },
            {
                index: 1,
                name: 'failed-with-rss',
                ok: false,
                peak_rss_bytes: 110 * 1024 * 1024,
                elapsed_seconds: 1.5,
            },
            {
                index: 2,
                name: 'failed-without-rss',
                ok: false,
                peak_rss_bytes: null,
                elapsed_seconds: null,
            },
        ],
        ceiling,
    );

    assert.strictEqual(summary.game_count, 3);
    assert.strictEqual(summary.measured_games, 2);
    assert.strictEqual(summary.failures, 2);
    assert.strictEqual(summary.over_ceiling, 1);
    assert.strictEqual(summary.max_peak_rss_bytes, 110 * 1024 * 1024);
    assert.strictEqual(summary.max_peak_rss_mb, 110);
    assert.strictEqual(summary.top_peak_rss[0].name, 'failed-with-rss');
    assert.strictEqual(summary.top_peak_rss[0].over_ceiling, true);
    assert.strictEqual(summary.top_peak_rss[1].name, 'small');
}

async function runMeasuredGameRecordsSpawnErrors() {
    return withTempDir((tmpDir) => {
        const spawnError = new Error('spawn failed');
        spawnError.code = 'ENOENT';

        return audit.runMeasuredGame(
            { index: 4, name: 'missing binary', source: 'title missing' },
            {
                binary: 'missing-binary',
                maxBufferBytes: 1024,
                memoryCeilingBytes: 32 * 1024 * 1024,
                timeFlavor: 'darwin',
                timeoutMs: 120000,
                tmpDir,
                spawn: () => ({
                    status: null,
                    signal: null,
                    stdout: '',
                    stderr: '',
                    error: spawnError,
                }),
                timeExecutable: '/fake/time',
            },
        ).then((record) => {
            assert.strictEqual(record.ok, false);
            assert.strictEqual(record.spawn_error, 'spawn failed');
            assert.strictEqual(record.spawn_error_code, 'ENOENT');
        });
    });
}

async function runMeasuredGamePassesTimeoutToSpawn() {
    return withTempDir((tmpDir) => {
        const calls = [];
        return audit.runMeasuredGame(
            { index: 5, name: 'demo', source: 'title demo' },
            {
                binary: 'puzzlescript_cpp',
                maxBufferBytes: 2048,
                memoryCeilingBytes: 32 * 1024 * 1024,
                timeFlavor: 'darwin',
                timeoutMs: 4242,
                tmpDir,
                spawn: (command, args, spawnOptions) => {
                    calls.push({ command, args, spawnOptions });
                    return {
                        status: 0,
                        signal: null,
                        stdout: '',
                        stderr: [
                            '        0.02 real',
                            '        0.01 user',
                            '        0.00 sys',
                            '      4096 maximum resident set size',
                        ].join('\n'),
                    };
                },
                timeExecutable: '/fake/time',
            },
        ).then((record) => {
            assert.strictEqual(record.ok, true);
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].command, '/fake/time');
            assert.strictEqual(calls[0].spawnOptions.timeout, 4242);
        });
    });
}

function parsesCliTimeoutAndRejectsInvalidTimeFlavor() {
    assert.throws(
        () => audit.parseArgs(['--corpus-ndjson', 'corpus.ndjson', '--time-flavor', 'bsd']),
        /--time-flavor must be one of auto, darwin, gnu/,
    );

    const options = audit.parseArgs([
        '--corpus-ndjson',
        'corpus.ndjson',
        '--timeout-ms',
        '5000',
        '--time-flavor',
        'gnu',
        '--time-executable',
        '/fake/time',
    ]);

    assert.strictEqual(options.timeoutMs, 5000);
    assert.strictEqual(options.timeFlavor, 'gnu');
    assert.strictEqual(options.timeExecutable, '/fake/time');
}

async function main() {
    parsesDarwinTimeOutput();
    parsesGnuTimeOutput();
    rejectsMissingPeakRss();
    loadsNdjsonCorpusText();
    rejectsMalformedNdjsonRecords();
    sanitizesSourceFileNames();
    summarizesResultsAgainstCeiling();
    summarizesFailedMeasuredRecordsAgainstCeiling();
    await runMeasuredGameRecordsSpawnErrors();
    await runMeasuredGamePassesTimeoutToSpawn();
    parsesCliTimeoutAndRejectsInvalidTimeFlavor();
    runCliProcessWritesSuccessfulOneGameReport();
    runCliProcessExitsNonzeroAndWritesFailureReportForBinaryFailure();
    runCliProcessExitsNonzeroAndWritesFailureReportForUnparseableTimeOutput();
    runCliProcessExitsNonzeroAndWritesEmptyCorpusReport();
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
