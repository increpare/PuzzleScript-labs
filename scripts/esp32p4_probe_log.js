#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function bytesToMb(bytes) {
    if (bytes === null || bytes === undefined) {
        return null;
    }
    return Math.round((Number(bytes) / (1024 * 1024)) * 100) / 100;
}

function parseProbeLogText(label, text) {
    const events = [];
    const parseErrors = [];
    let ignoredLines = 0;
    const lines = String(text).split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        const lineNumber = index + 1;
        if (rawLine.trim() === '') {
            continue;
        }

        const jsonStart = rawLine.indexOf('{');
        if (jsonStart < 0) {
            ignoredLines += 1;
            continue;
        }

        const jsonText = rawLine.slice(jsonStart).trim();
        try {
            const record = JSON.parse(jsonText);
            if (record !== null && !Array.isArray(record) && typeof record === 'object') {
                const event = { ...record, log_line: lineNumber };
                if (!Object.prototype.hasOwnProperty.call(record, 'line')) {
                    event.line = lineNumber;
                }
                events.push(event);
            } else {
                parseErrors.push({
                    label,
                    line: lineNumber,
                    message: 'invalid JSON: record must be an object',
                    text: rawLine,
                });
            }
        } catch (error) {
            parseErrors.push({
                label,
                line: lineNumber,
                message: `invalid JSON: ${error.message}`,
                text: rawLine,
            });
        }
    }

    return {
        label,
        events,
        parse_errors: parseErrors,
        ignored_lines: ignoredLines,
    };
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function updateMinimum(target, key, value) {
    const number = asNumber(value);
    if (number === null) {
        return;
    }
    if (target[key] === null || target[key] === undefined || number < target[key]) {
        target[key] = number;
    }
}

function updateMaximum(target, key, value) {
    const number = asNumber(value);
    if (number === null) {
        return;
    }
    if (target[key] === null || target[key] === undefined || number > target[key]) {
        target[key] = number;
    }
}

function ensureHeapStats(container, region) {
    if (!Object.prototype.hasOwnProperty.call(container, region)) {
        container[region] = {
            samples: 0,
            min_free: null,
            min_free_mb: null,
            max_allocated: null,
            max_allocated_mb: null,
            min_largest_free_block: null,
            min_largest_free_block_mb: null,
            min_minimum_free: null,
            min_minimum_free_mb: null,
            free: null,
            allocated: null,
            largest_free_block: null,
            minimum_free: null,
            last_free: null,
            last_allocated: null,
            last_largest_free_block: null,
            last_minimum_free: null,
        };
    }
    return container[region];
}

function finalizeHeapStats(stats) {
    stats.min_free_mb = bytesToMb(stats.min_free);
    stats.max_allocated_mb = bytesToMb(stats.max_allocated);
    stats.min_largest_free_block_mb = bytesToMb(stats.min_largest_free_block);
    stats.min_minimum_free_mb = bytesToMb(stats.min_minimum_free);
}

function updateHeapStats(stats, event) {
    stats.samples += 1;
    updateMinimum(stats, 'min_free', event.free);
    updateMaximum(stats, 'max_allocated', event.allocated);
    updateMinimum(stats, 'min_largest_free_block', event.largest_free_block);
    updateMinimum(stats, 'min_minimum_free', event.minimum_free);
    stats.free = asNumber(event.free);
    stats.allocated = asNumber(event.allocated);
    stats.largest_free_block = asNumber(event.largest_free_block);
    stats.minimum_free = asNumber(event.minimum_free);
    stats.last_free = asNumber(event.free);
    stats.last_allocated = asNumber(event.allocated);
    stats.last_largest_free_block = asNumber(event.largest_free_block);
    stats.last_minimum_free = asNumber(event.minimum_free);
    finalizeHeapStats(stats);
}

function sourceKey(event) {
    return String(event.source || '');
}

function assignLatestPhase(container, event, phase, previous) {
    container[phase] = {
        line: event.log_line || event.line,
        phase,
        source: sourceKey(event),
        status: event.status || '',
        detail: event.detail || '',
        elapsed_ms: asNumber(event.elapsed_ms),
        fb_mode: event.fb_mode || '',
        fb_width: asNumber(event.fb_width),
        fb_height: asNumber(event.fb_height),
        fb_count: asNumber(event.fb_count),
        fb_bpp: asNumber(event.fb_bpp),
        count: previous ? previous.count + 1 : 1,
    };
    return container[phase];
}

function summarizeEvents(events, parseErrors = []) {
    const phases = {};
    const phasesBySource = {};
    const phaseRuns = [];
    const failures = [];
    const diagnostics = [];
    const allocFailures = [];
    const sourceEvents = [];
    const heap = {
        regions: {},
        by_phase: {},
        by_source: {},
    };
    let boot = null;
    let phaseCount = 0;
    let failedPhaseCount = 0;

    for (const event of events) {
        if (event.event === 'boot' && boot === null) {
            boot = event;
            continue;
        }

        if (event.event === 'phase') {
            phaseCount += 1;
            const phase = String(event.phase || 'UNKNOWN');
            const source = sourceKey(event);
            const latest = assignLatestPhase(phases, event, phase, phases[phase]);
            phaseRuns.push({ ...latest });
            if (source !== '') {
                if (!Object.prototype.hasOwnProperty.call(phasesBySource, source)) {
                    phasesBySource[source] = {};
                }
                assignLatestPhase(phasesBySource[source], event, phase, phasesBySource[source][phase]);
            }
            if (event.status !== 'pass') {
                failedPhaseCount += 1;
                failures.push({
                    line: event.log_line || event.line,
                    event: event.event,
                    phase,
                    source,
                    status: event.status || '',
                    detail: event.detail || '',
                    elapsed_ms: asNumber(event.elapsed_ms),
                });
            }
            continue;
        }

        if (event.event === 'heap') {
            const phase = String(event.phase || 'UNKNOWN');
            const region = String(event.region || 'unknown');
            const source = sourceKey(event);
            if (!Object.prototype.hasOwnProperty.call(heap.by_phase, phase)) {
                heap.by_phase[phase] = {};
            }
            updateHeapStats(ensureHeapStats(heap.regions, region), event);
            updateHeapStats(ensureHeapStats(heap.by_phase[phase], region), event);
            if (source !== '') {
                if (!Object.prototype.hasOwnProperty.call(heap.by_source, source)) {
                    heap.by_source[source] = {};
                }
                if (!Object.prototype.hasOwnProperty.call(heap.by_source[source], phase)) {
                    heap.by_source[source][phase] = {};
                }
                updateHeapStats(ensureHeapStats(heap.by_source[source][phase], region), event);
            }
            continue;
        }

        if (event.event === 'alloc_failed') {
            allocFailures.push({
                line: event.log_line || event.line,
                phase: event.phase || '',
                source: sourceKey(event),
                requested: asNumber(event.requested),
                requested_mb: bytesToMb(event.requested),
                caps: asNumber(event.caps),
                function: event.function || '',
            });
            continue;
        }

        if (event.event === 'diagnostic') {
            const hasDiagnosticLine = event.log_line !== event.line;
            diagnostics.push({
                line: event.log_line || event.line,
                source: event.source || '',
                severity: event.severity || '',
                status: event.status || '',
                code: asNumber(event.code),
                diagnostic_line: hasDiagnosticLine ? asNumber(event.line) : null,
                message: event.message || event.detail || '',
            });
            continue;
        }

        if (event.source || event.status) {
            sourceEvents.push({
                line: event.log_line || event.line,
                event: event.event || '',
                source: event.source || '',
                status: event.status || '',
                detail: event.detail || '',
            });
        }
    }

    return {
        event_count: events.length,
        parse_error_count: parseErrors.length,
        ignored_boot: boot === null,
        boot,
        phase_count: phaseCount,
        failed_phase_count: failedPhaseCount,
        phases,
        phases_by_source: phasesBySource,
        phase_runs: phaseRuns,
        failures,
        alloc_failures: allocFailures,
        diagnostics,
        source_events: sourceEvents,
        heap,
    };
}

function parseArgs(argv) {
    const options = {
        help: false,
        log: null,
        out: path.join('build', 'esp32p4_probe_log_summary.json'),
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--log') {
            index += 1;
            options.log = argv[index] || null;
        } else if (arg === '--out') {
            index += 1;
            options.out = argv[index] || null;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    if (!options.help && !options.log) {
        throw new Error('missing required --log PATH');
    }
    if (!options.help && !options.out) {
        throw new Error('missing required --out PATH');
    }
    return options;
}

function printUsage(stream) {
    stream.write([
        'Usage: node scripts/esp32p4_probe_log.js --log probe.log [--out build/esp32p4_probe_log_summary.json]',
        '',
        'Summarizes ESP32-P4 board-probe JSON-lines captured from serial monitor output.',
        '',
        'Options:',
        '  --log PATH    captured serial log to parse',
        '  --out PATH    JSON report path (default: build/esp32p4_probe_log_summary.json)',
        '',
    ].join('\n'));
}

function buildReport(options, parsed) {
    return {
        generated_at: new Date().toISOString(),
        host: {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
        },
        command: {
            log: options.log,
        },
        summary: summarizeEvents(parsed.events, parsed.parse_errors),
        parse_errors: parsed.parse_errors,
        events: parsed.events,
    };
}

function runCli(argv) {
    const options = parseArgs(argv);
    if (options.help) {
        printUsage(process.stdout);
        return 0;
    }

    const parsed = parseProbeLogText(options.log, fs.readFileSync(options.log, 'utf8'));
    const report = buildReport(options, parsed);
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stderr.write(
        `Wrote ${options.out}; ${report.summary.event_count} events, ` +
        `${report.summary.failed_phase_count} failed phases, ` +
        `${report.summary.alloc_failures.length} allocation failures\n`,
    );
    return report.summary.event_count > 0 ? 0 : 1;
}

if (require.main === module) {
    try {
        process.exitCode = runCli(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`esp32p4_probe_log: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    bytesToMb,
    buildReport,
    parseArgs,
    parseProbeLogText,
    runCli,
    summarizeEvents,
};
