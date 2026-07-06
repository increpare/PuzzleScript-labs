#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const probeLog = require('./esp32p4_probe_log');

function withTempDir(callback) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esp32p4-probe-log-test-'));
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
            [path.join(__dirname, 'esp32p4_probe_log.js'), '--log', logPath, '--out', outPath],
            {
                cwd: path.join(__dirname, '..'),
                encoding: 'utf8',
            },
        );

        assert.strictEqual(result.status, 0, result.stderr);
        const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.strictEqual(report.command.log, logPath);
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
            [path.join(__dirname, 'esp32p4_probe_log.js'), '--log', logPath, '--out', outPath, '--fail-on-failure'],
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
            [path.join(__dirname, 'esp32p4_probe_log.js'), '--log', logPath, '--out', outPath, '--fail-on-failure'],
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

function main() {
    parsesEspIdfLogLines();
    summarizesPhaseHeapAndFailureEvents();
    runCliProcessWritesJsonReport();
    failOnFailureTurnsBadHardwareLogsIntoFailingGates();
    failOnFailureAcceptsCleanHardwareLogs();
}

main();
