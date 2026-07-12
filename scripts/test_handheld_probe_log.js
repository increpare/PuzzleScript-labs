#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const probeLog = require('./handheld_probe_log');
const compatibilityProbeLog = require('./esp32p4_probe_log');

const REQUIRED_CAPTURE_PHASES = [
    'BOOT',
    'LOAD_IR',
    'CREATE_RUNTIME',
    'LOAD_LEVEL',
    'INPUT_TRACE',
    'UNLOAD',
];

function withTempDir(callback) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handheld-probe-log-test-'));
    try {
        return callback(tmpDir);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function sampleLogText() {
    return [
        'I (12) ps_probe: {"event":"boot","cores":2,"revision":1,"flash_bytes":33554432,"idf":"v5.4.1","reset_reason":1}',
        'I (13) board_7b: Create MIPI DSI bus',
        '{"event":"phase","phase":"BOOT","status":"pass","detail":"boot_summary","elapsed_ms":1,"fb_mode":"none","fb_width":0,"fb_height":0,"fb_count":0,"fb_bpp":2}',
        'I (14) ps_probe: {"event":"heap","phase":"BOOT","region":"internal","free":180000,"allocated":20000,"largest_free_block":110000,"minimum_free":170000}',
        'I (15) ps_probe: {"event":"heap","phase":"BOOT","region":"spiram","free":32000000,"allocated":500000,"largest_free_block":31900000,"minimum_free":31800000}',
        'I (22) ps_probe: {"event":"phase","phase":"COMPILE_SOURCE","source":"embedded:broken_smoke.txt","status":"fail","detail":"compile_failed","elapsed_ms":42,"fb_mode":"target_800x480","fb_width":1024,"fb_height":600,"fb_count":1,"fb_bpp":2}',
        'I (23) ps_probe: {"event":"heap","phase":"COMPILE_SOURCE","source":"embedded:broken_smoke.txt","region":"spiram","free":25000000,"allocated":7500000,"largest_free_block":21000000,"minimum_free":24000000}',
        'E (24) ps_probe: {"event":"alloc_failed","phase":"COMPILE_SOURCE","source":"embedded:broken_smoke.txt","requested":1048576,"caps":32776,"function":"operator new"}',
        'I (25) ps_probe: {"event":"diagnostic","source":"embedded:broken_smoke.txt","severity":"error","code":1001,"line":12,"message":"Unexpected end of rule."}',
        'I (26) ps_probe: {not valid json}',
        '',
    ].join('\n');
}

function passingLogText() {
    return [
        'I (12) ps_probe: {"event":"boot","cores":2,"revision":1,"flash_bytes":33554432,"idf":"v5.4.1","reset_reason":1}',
        'I (13) ps_probe: {"event":"phase","phase":"BOOT","status":"pass","detail":"boot_summary","elapsed_ms":1,"fb_mode":"none","fb_width":0,"fb_height":0,"fb_count":0,"fb_bpp":2}',
        'I (14) ps_probe: {"event":"heap","phase":"BOOT","region":"internal","free":180000,"allocated":20000,"largest_free_block":110000,"minimum_free":170000}',
        'I (15) ps_probe: {"event":"heap","phase":"BOOT","region":"spiram","free":32000000,"allocated":500000,"largest_free_block":31900000,"minimum_free":31800000}',
        '',
    ].join('\n');
}

function malformedCompleteLogText() {
    const lines = [
        'I (12) ps_probe: {"event":"boot","target":"esp32s3","board":"ES3C28P"}',
    ];
    for (const [index, phase] of REQUIRED_CAPTURE_PHASES.entries()) {
        lines.push(`I (${20 + index}) ps_probe: {"event":"phase","phase":"${phase}","status":"pass"}`);
    }
    lines.push('I (30) ps_probe: {"event":"heap","phase":"UNLOAD","region":"internal"}');
    lines.push('I (31) ps_probe: {"event":"heap","phase":"UNLOAD","region":"spiram"}');
    lines.push('');
    return lines.join('\n');
}

function parsesEspIdfLogLines() {
    const parsed = probeLog.parseProbeLogText('sample.log', sampleLogText());

    assert.strictEqual(parsed.events.length, 8);
    assert.strictEqual(parsed.parse_errors.length, 1);
    assert.strictEqual(parsed.parse_errors[0].line, 10);
    assert.match(parsed.parse_errors[0].message, /JSON/);
    assert.strictEqual(parsed.ignored_lines, 1);
    assert.strictEqual(parsed.events[0].line, 1);
    assert.strictEqual(parsed.events[0].event, 'boot');
    assert.strictEqual(parsed.events[1].event, 'phase');
}

function summarizesPhaseHeapAndFailureEvents() {
    const parsed = probeLog.parseProbeLogText('sample.log', sampleLogText());
    const summary = probeLog.summarizeEvents(parsed.events, parsed.parse_errors);

    assert.strictEqual(summary.event_count, 8);
    assert.strictEqual(summary.parse_error_count, 1);
    assert.strictEqual(summary.boot.flash_bytes, 33554432);
    assert.strictEqual(summary.phase_count, 2);
    assert.strictEqual(summary.failed_phase_count, 1);
    assert.strictEqual(summary.phases.BOOT.status, 'pass');
    assert.strictEqual(summary.phases.COMPILE_SOURCE.status, 'fail');
    assert.strictEqual(summary.phases.COMPILE_SOURCE.source, 'embedded:broken_smoke.txt');
    assert.strictEqual(summary.phases.COMPILE_SOURCE.elapsed_ms, 42);
    assert.strictEqual(summary.phase_runs[1].source, 'embedded:broken_smoke.txt');
    assert.strictEqual(summary.phases_by_source['embedded:broken_smoke.txt'].COMPILE_SOURCE.status, 'fail');
    assert.strictEqual(summary.heap.regions.internal.min_free, 180000);
    assert.strictEqual(summary.heap.regions.spiram.min_free, 25000000);
    assert.strictEqual(summary.heap.by_phase.COMPILE_SOURCE.spiram.largest_free_block, 21000000);
    assert.strictEqual(summary.heap.by_source['embedded:broken_smoke.txt'].COMPILE_SOURCE.spiram.largest_free_block, 21000000);
    assert.strictEqual(summary.failures.length, 1);
    assert.strictEqual(summary.failures[0].phase, 'COMPILE_SOURCE');
    assert.strictEqual(summary.failures[0].source, 'embedded:broken_smoke.txt');
    assert.strictEqual(summary.alloc_failures.length, 1);
    assert.strictEqual(summary.alloc_failures[0].requested, 1048576);
    assert.strictEqual(summary.alloc_failures[0].source, 'embedded:broken_smoke.txt');
    assert.strictEqual(summary.diagnostics.length, 1);
    assert.strictEqual(summary.diagnostics[0].source, 'embedded:broken_smoke.txt');
}

function runCliProcessWritesJsonReport() {
    withTempDir((tmpDir) => {
        const logPath = path.join(tmpDir, 'probe.log');
        const outPath = path.join(tmpDir, 'summary.json');
        fs.writeFileSync(logPath, sampleLogText(), 'utf8');

        const result = childProcess.spawnSync(
            process.execPath,
            [path.join(__dirname, 'handheld_probe_log.js'), '--log', logPath, '--out', outPath],
            {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            },
        );

        assert.strictEqual(result.status, 0, result.stderr);
        const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.strictEqual(report.command.log, logPath);
        assert.strictEqual(report.command.fail_on_failure, false);
        assert.strictEqual(report.summary.event_count, 8);
        assert.strictEqual(report.summary.failed_phase_count, 1);
        assert.strictEqual(report.events.length, 8);
        assert.match(result.stderr, /Wrote .*summary\.json/);
    });
}

function failOnFailureTurnsBadHardwareLogsIntoFailingGates() {
    withTempDir((tmpDir) => {
        const logPath = path.join(tmpDir, 'probe.log');
        const outPath = path.join(tmpDir, 'summary.json');
        fs.writeFileSync(logPath, sampleLogText(), 'utf8');

        const result = childProcess.spawnSync(
            process.execPath,
            [path.join(__dirname, 'handheld_probe_log.js'), '--log', logPath, '--out', outPath, '--fail-on-failure'],
            {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            },
        );

        assert.strictEqual(result.status, 1, result.stderr);
        const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.strictEqual(report.summary.failed_phase_count, 1);
        assert.strictEqual(report.summary.alloc_failures.length, 1);
        assert.match(result.stderr, /probe log gate failed/);
    });
}

function failOnFailureAcceptsCleanHardwareLogs() {
    withTempDir((tmpDir) => {
        const logPath = path.join(tmpDir, 'probe.log');
        const outPath = path.join(tmpDir, 'summary.json');
        fs.writeFileSync(logPath, passingLogText(), 'utf8');

        const result = childProcess.spawnSync(
            process.execPath,
            [path.join(__dirname, 'handheld_probe_log.js'), '--log', logPath, '--out', outPath, '--fail-on-failure'],
            {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            },
        );

        assert.strictEqual(result.status, 0, result.stderr);
        const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.strictEqual(report.summary.failed_phase_count, 0);
        assert.strictEqual(report.summary.alloc_failures.length, 0);
    });
}

function parsesRepeatableGateRequirements() {
    const options = probeLog.parseArgs([
        '--log',
        'probe.log',
        '--require-phase',
        'BOOT',
        '--require-heap-region',
        'internal',
        '--require-phase',
        'LOAD_IR',
        '--require-heap-region',
        'spiram',
    ]);

    assert.strictEqual(options.out, path.join('build', 'handheld_probe_log_summary.json'));
    assert.strictEqual(options.failOnFailure, true);
    assert.deepStrictEqual(options.requiredPhases, ['BOOT', 'LOAD_IR']);
    assert.deepStrictEqual(options.requiredHeapRegions, ['internal', 'spiram']);
    assert.throws(
        () => probeLog.parseArgs(['--log', 'probe.log', '--require-phase']),
        /missing value for --require-phase/,
    );
    assert.throws(
        () => probeLog.parseArgs(['--log', 'probe.log', '--require-heap-region']),
        /missing value for --require-heap-region/,
    );
    assert.throws(
        () => probeLog.parseArgs(['--log', 'probe.log', '--require-phase', '--fail-on-failure']),
        /missing value for --require-phase/,
    );
    assert.throws(
        () => probeLog.parseArgs(['--log', 'probe.log', '--require-heap-region', '--fail-on-failure']),
        /missing value for --require-heap-region/,
    );
}

function rejectsOptionLikeValuesConsistently() {
    const cases = [
        [['--log', '--out', 'x'], 'missing value for --log'],
        [['--out', '--fail-on-failure'], 'missing value for --out'],
        [['--log', 'probe.log', '--require-phase', '--out'], 'missing value for --require-phase'],
        [['--log', 'probe.log', '--require-heap-region', '--log'], 'missing value for --require-heap-region'],
    ];

    for (const [argv, expectedMessage] of cases) {
        assert.throws(
            () => probeLog.parseArgs(argv),
            (error) => error.message === expectedMessage,
        );
    }
}

function malformedCliOrderingCannotFalsePass() {
    withTempDir((tmpDir) => {
        const logPath = path.join(tmpDir, 'probe.log');
        fs.writeFileSync(logPath, passingLogText(), 'utf8');

        const result = childProcess.spawnSync(
            process.execPath,
            [path.join(__dirname, 'handheld_probe_log.js'), '--log', logPath, '--out', '--help'],
            {
                cwd: tmpDir,
                encoding: 'utf8',
            },
        );

        assert.strictEqual(result.status, 1, result.stderr);
        assert.strictEqual(result.stderr, 'handheld_probe_log: missing value for --out\n');
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '--help')), false);
    });
}

function esp32p4CompatibilityWrapperUsesGenericParser() {
    assert.strictEqual(compatibilityProbeLog, probeLog);
    assert.strictEqual(compatibilityProbeLog.gateFailureReasons, probeLog.gateFailureReasons);

    for (const helpArg of ['--help', '-h']) {
        const result = childProcess.spawnSync(
            process.execPath,
            [path.join(__dirname, 'esp32p4_probe_log.js'), helpArg],
            {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            },
        );

        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(
            result.stdout,
            /^Usage: node scripts\/esp32p4_probe_log\.js --log probe\.log \[--out build\/esp32p4_probe_log_summary\.json\]/,
        );
        assert.match(result.stdout, /Summarizes ESP32-P4 board-probe JSON-lines captured from serial monitor output\./);
        assert.match(result.stdout, /default: build\/esp32p4_probe_log_summary\.json/);
        assert.match(result.stdout, /--require-phase NAME/);
        assert.match(result.stdout, /--require-heap-region NAME/);
        assert.doesNotMatch(result.stdout, /handheld_probe_log/);
    }
}

function esp32p4CompatibilityWrapperPreservesLegacyOutputDefault() {
    withTempDir((tmpDir) => {
        const logPath = path.join(tmpDir, 'probe.log');
        const legacyOutPath = path.join(tmpDir, 'build', 'esp32p4_probe_log_summary.json');
        const genericOutPath = path.join(tmpDir, 'build', 'handheld_probe_log_summary.json');
        fs.writeFileSync(logPath, passingLogText(), 'utf8');

        const result = childProcess.spawnSync(
            process.execPath,
            [path.join(__dirname, 'esp32p4_probe_log.js'), '--log', logPath],
            { cwd: tmpDir, encoding: 'utf8' },
        );

        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(fs.existsSync(legacyOutPath), true);
        assert.strictEqual(fs.existsSync(genericOutPath), false);
        assert.match(result.stderr, /build[/\\]esp32p4_probe_log_summary\.json/);
    });

    withTempDir((tmpDir) => {
        const logPath = path.join(tmpDir, 'probe.log');
        const explicitOutPath = path.join(tmpDir, 'custom', 'p4-summary.json');
        const legacyOutPath = path.join(tmpDir, 'build', 'esp32p4_probe_log_summary.json');
        fs.writeFileSync(logPath, passingLogText(), 'utf8');

        const result = childProcess.spawnSync(
            process.execPath,
            [
                path.join(__dirname, 'esp32p4_probe_log.js'),
                '--log',
                logPath,
                '--out',
                explicitOutPath,
            ],
            { cwd: tmpDir, encoding: 'utf8' },
        );

        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(fs.existsSync(explicitOutPath), true);
        assert.strictEqual(fs.existsSync(legacyOutPath), false);
    });
}

function acceptsPocketCardBootRecord() {
    const text = [
        'I (12) ps_probe: {"event":"boot","target":"esp32s3","board":"ES3C28P","cores":2,"flash_bytes":16777216}',
        'I (13) ps_probe: {"event":"phase","phase":"BOOT","status":"pass","detail":"boot_summary","elapsed_ms":1,"fb_mode":"none","fb_width":0,"fb_height":0,"fb_count":0,"fb_bpp":2}',
        'I (14) ps_probe: {"event":"heap","phase":"BOOT","region":"internal","free":180000,"allocated":20000,"largest_free_block":110000,"minimum_free":170000}',
        'I (15) ps_probe: {"event":"heap","phase":"BOOT","region":"spiram","free":7000000,"allocated":500000,"largest_free_block":6900000,"minimum_free":6800000}',
        '',
    ].join('\n');
    const parsed = probeLog.parseProbeLogText('pocket.log', text);
    const summary = probeLog.summarizeEvents(parsed.events, parsed.parse_errors);

    assert.strictEqual(summary.boot.target, 'esp32s3');
    assert.strictEqual(summary.boot.board, 'ES3C28P');
    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary, ['BOOT'], ['internal', 'spiram']),
        [],
    );
    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary, ['BOOT', 'LOAD_IR'], ['internal', 'spiram']),
        ['missing passing LOAD_IR phase'],
    );
}

function rejectsInheritedAndInvalidHeapRegionSamples() {
    const parsed = probeLog.parseProbeLogText('passing.log', passingLogText());
    const summary = probeLog.summarizeEvents(parsed.events, parsed.parse_errors);

    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary, [], ['constructor', 'toString']),
        ['missing constructor heap sample', 'missing toString heap sample'],
    );

    summary.heap.regions.string_count = { samples: '1' };
    summary.heap.regions.infinite_count = { samples: Infinity };
    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary, [], ['string_count', 'infinite_count']),
        ['missing string_count heap sample', 'missing infinite_count heap sample'],
    );
}

function rejectsMalformedHeapMeasurements() {
    const validMeasurements = {
        free: 100,
        allocated: 20,
        largest_free_block: 80,
        minimum_free: 90,
    };
    const malformedEvents = [
        { event: 'heap', line: 2, phase: 'BOOT', region: 'missing', ...validMeasurements },
        { event: 'heap', line: 3, phase: 'BOOT', region: 'null', ...validMeasurements, allocated: null },
        { event: 'heap', line: 4, phase: 'BOOT', region: 'string', ...validMeasurements, largest_free_block: '80' },
        { event: 'heap', line: 5, phase: 'BOOT', region: 'boolean', ...validMeasurements, minimum_free: false },
        { event: 'heap', line: 6, phase: 'BOOT', region: 'nan', ...validMeasurements, free: NaN },
        { event: 'heap', line: 7, phase: 'BOOT', region: 'infinity', ...validMeasurements, allocated: Infinity },
        { event: 'heap', line: 8, phase: 'BOOT', region: 'negative', ...validMeasurements, minimum_free: -1 },
    ];
    delete malformedEvents[0].free;

    const summary = probeLog.summarizeEvents([{ event: 'boot', line: 1 }, ...malformedEvents]);

    assert.strictEqual(summary.malformed_heap_record_count, 7);
    assert.deepStrictEqual(summary.heap.regions, {});
    assert.deepStrictEqual(summary.heap.by_phase, {});
    assert.deepStrictEqual(summary.heap.by_source, {});
    assert.deepStrictEqual(summary.malformed_heap_records, [
        { line: 2, phase: 'BOOT', region: 'missing', missing_fields: ['free'], invalid_fields: [] },
        { line: 3, phase: 'BOOT', region: 'null', missing_fields: [], invalid_fields: ['allocated'] },
        { line: 4, phase: 'BOOT', region: 'string', missing_fields: [], invalid_fields: ['largest_free_block'] },
        { line: 5, phase: 'BOOT', region: 'boolean', missing_fields: [], invalid_fields: ['minimum_free'] },
        { line: 6, phase: 'BOOT', region: 'nan', missing_fields: [], invalid_fields: ['free'] },
        { line: 7, phase: 'BOOT', region: 'infinity', missing_fields: [], invalid_fields: ['allocated'] },
        { line: 8, phase: 'BOOT', region: 'negative', missing_fields: [], invalid_fields: ['minimum_free'] },
    ]);
    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary),
        ['7 malformed heap record(s)'],
    );
    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary, [], ['missing']),
        ['7 malformed heap record(s)', 'missing missing heap sample'],
    );

    const mixedSummary = probeLog.summarizeEvents([
        { event: 'boot', line: 1 },
        { event: 'heap', line: 2, phase: 'BOOT', region: 'mixed', ...validMeasurements },
        { event: 'heap', line: 3, phase: 'BOOT', region: 'mixed' },
    ]);
    assert.strictEqual(mixedSummary.heap.regions.mixed.samples, 1);
    assert.strictEqual(mixedSummary.malformed_heap_record_count, 1);
}

function acceptsZeroHeapMeasurements() {
    const summary = probeLog.summarizeEvents([
        { event: 'boot', line: 1 },
        {
            event: 'heap',
            line: 2,
            phase: 'BOOT',
            region: 'zero',
            free: 0,
            allocated: 0,
            largest_free_block: 0,
            minimum_free: 0,
        },
    ]);

    assert.strictEqual(summary.malformed_heap_record_count, 0);
    assert.strictEqual(summary.heap.regions.zero.samples, 1);
    assert.strictEqual(summary.heap.regions.zero.free, 0);
    assert.deepStrictEqual(probeLog.gateFailureReasons(summary, [], ['zero']), []);
}

function malformedHeapRecordsCannotSatisfyCompleteCaptureGate() {
    const parsed = probeLog.parseProbeLogText('malformed-complete.log', malformedCompleteLogText());
    const summary = probeLog.summarizeEvents(parsed.events, parsed.parse_errors);

    assert.deepStrictEqual(
        probeLog.gateFailureReasons(summary, REQUIRED_CAPTURE_PHASES, ['internal', 'spiram']),
        [
            '2 malformed heap record(s)',
            'missing internal heap sample',
            'missing spiram heap sample',
        ],
    );

    withTempDir((tmpDir) => {
        const logPath = path.join(tmpDir, 'probe.log');
        const outPath = path.join(tmpDir, 'summary.json');
        fs.writeFileSync(logPath, malformedCompleteLogText(), 'utf8');
        const args = [path.join(__dirname, 'handheld_probe_log.js'), '--log', logPath, '--out', outPath];
        for (const phase of REQUIRED_CAPTURE_PHASES) {
            args.push('--require-phase', phase);
        }
        args.push('--require-heap-region', 'internal', '--require-heap-region', 'spiram');

        const result = childProcess.spawnSync(process.execPath, args, {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8',
        });

        assert.strictEqual(result.status, 1, result.stderr);
        const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.strictEqual(report.summary.malformed_heap_record_count, 2);
        assert.strictEqual(report.summary.malformed_heap_records.length, 2);
        assert.deepStrictEqual(report.summary.heap.regions, {});
        assert.match(result.stderr, /2 malformed heap record\(s\)/);
        assert.match(result.stderr, /missing internal heap sample/);
        assert.match(result.stderr, /missing spiram heap sample/);
    });
}

function requirementsRejectMissingRecordsWithoutExplicitFailureFlag() {
    withTempDir((tmpDir) => {
        const logPath = path.join(tmpDir, 'probe.log');
        const outPath = path.join(tmpDir, 'summary.json');
        fs.writeFileSync(logPath, passingLogText(), 'utf8');

        const result = childProcess.spawnSync(
            process.execPath,
            [
                path.join(__dirname, 'handheld_probe_log.js'),
                '--log',
                logPath,
                '--out',
                outPath,
                '--require-phase',
                'LOAD_IR',
                '--require-heap-region',
                'dma',
            ],
            {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            },
        );

        assert.strictEqual(result.status, 1, result.stderr);
        const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.strictEqual(report.command.fail_on_failure, true);
        assert.deepStrictEqual(report.command.required_phases, ['LOAD_IR']);
        assert.deepStrictEqual(report.command.required_heap_regions, ['dma']);
        assert.match(result.stderr, /missing passing LOAD_IR phase/);
        assert.match(result.stderr, /missing dma heap sample/);
    });
}

function fragmentedCaptureLogText() {
    return [
        'I (2419) ps_probe: {"event":"heap","phase":"COMPILE_SOURCE","source":"embedded:sokoban_basic.txt","region":"8bit","free":31499711,"allocated":2556584,"largest_free_block":30932992,"minimum_free":31487127,"allocated_blocks":2--- baud 115200 ---',
        '10,"free_blocks":51,"total_blocks":261}',
        'I (2502) ps_probe: {"event":"heap","phase"--- baud 115200 ---',
        ':"RUN_INPUT_TRACE","source":"embedded:sokoban_basic.txt","region":"8bit","free":31494211,"allocated":2561916,"largest_free_block":30932992,"minimum_free":31487127,"allocated_blocks":252,"free_blocks":29,"total_blocks":281}',
        '',
    ].join('\n');
}

function reassemblesFragmentedSerialCaptureLines() {
    const parsed = probeLog.parseProbeLogText('fragmented.log', fragmentedCaptureLogText());

    assert.strictEqual(parsed.parse_errors.length, 0);
    assert.strictEqual(parsed.events.length, 2);
    assert.strictEqual(parsed.events[0].event, 'heap');
    assert.strictEqual(parsed.events[0].phase, 'COMPILE_SOURCE');
    assert.strictEqual(parsed.events[0].allocated_blocks, 210);
    assert.strictEqual(parsed.events[1].phase, 'RUN_INPUT_TRACE');
    assert.strictEqual(parsed.events[1].allocated_blocks, 252);
}

function main() {
    parsesEspIdfLogLines();
    summarizesPhaseHeapAndFailureEvents();
    reassemblesFragmentedSerialCaptureLines();
    parsesRepeatableGateRequirements();
    rejectsOptionLikeValuesConsistently();
    malformedCliOrderingCannotFalsePass();
    esp32p4CompatibilityWrapperUsesGenericParser();
    esp32p4CompatibilityWrapperPreservesLegacyOutputDefault();
    acceptsPocketCardBootRecord();
    rejectsInheritedAndInvalidHeapRegionSamples();
    rejectsMalformedHeapMeasurements();
    acceptsZeroHeapMeasurements();
    malformedHeapRecordsCannotSatisfyCompleteCaptureGate();
    runCliProcessWritesJsonReport();
    failOnFailureTurnsBadHardwareLogsIntoFailingGates();
    failOnFailureAcceptsCleanHardwareLogs();
    requirementsRejectMissingRecordsWithoutExplicitFailureFlag();
}

main();
