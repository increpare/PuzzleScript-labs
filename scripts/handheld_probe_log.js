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

const CAPTURE_BAUD_MARKER_RE = /--- baud \d+ ---/g;

function extractJsonText(line) {
    const jsonStart = line.indexOf('{');
    if (jsonStart < 0) {
        return null;
    }
    return line.slice(jsonStart).trim();
}

function tryParseProbeJson(jsonText) {
    if (!jsonText) {
        return null;
    }
    try {
        const record = JSON.parse(jsonText);
        if (record !== null && !Array.isArray(record) && typeof record === 'object') {
            return record;
        }
    } catch (error) {
        return null;
    }
    return null;
}

function isContinuationLine(line) {
    const trimmed = line.trimStart();
    if (!trimmed) {
        return false;
    }
    if (/^I \(\d+\)/.test(trimmed)) {
        return false;
    }
    return /^[":,\d\}]/.test(trimmed);
}

function normalizeProbeLogLines(text) {
    const cleaned = String(text).replace(CAPTURE_BAUD_MARKER_RE, '');
    const rawLines = cleaned.split(/\r?\n/);
    const assembled = [];
    let pending = null;
    let pendingLineNumber = null;

    for (let index = 0; index < rawLines.length; index += 1) {
        const line = rawLines[index].replace(/\r$/, '');
        if (!line.trim()) {
            continue;
        }

        if (pending !== null) {
            pending += line;
            if (tryParseProbeJson(extractJsonText(pending))) {
                assembled.push({ line: pendingLineNumber, text: pending });
                pending = null;
                pendingLineNumber = null;
            }
            continue;
        }

        if (isContinuationLine(line)) {
            continue;
        }

        const jsonText = extractJsonText(line);
        if (!jsonText) {
            continue;
        }

        if (tryParseProbeJson(jsonText)) {
            assembled.push({ line: index + 1, text: line });
        } else {
            pending = line;
            pendingLineNumber = index + 1;
        }
    }

    if (pending !== null) {
        assembled.push({ line: pendingLineNumber, text: pending, incomplete: true });
    }

    return assembled;
}

function parseProbeLogText(label, text) {
    const events = [];
    const parseErrors = [];
    const lines = normalizeProbeLogLines(text);
    const rawLineCount = String(text).split(/\r?\n/).filter((line) => line.trim() !== '').length;
    const ignoredLines = Math.max(0, rawLineCount - lines.length);

    for (const entry of lines) {
        const { line: lineNumber, text: rawLine, incomplete = false } = entry;
        const jsonText = extractJsonText(rawLine);
        const record = tryParseProbeJson(jsonText);
        if (record) {
            const event = { ...record, log_line: lineNumber };
            if (!Object.prototype.hasOwnProperty.call(record, 'line')) {
                event.line = lineNumber;
            }
            events.push(event);
            continue;
        }

        let message = 'invalid JSON: record must be an object';
        if (incomplete && jsonText) {
            try {
                JSON.parse(jsonText);
            } catch (error) {
                message = `invalid JSON: ${error.message}`;
            }
        }

        parseErrors.push({
            label,
            line: lineNumber,
            message,
            text: rawLine,
        });
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

const HEAP_MEASUREMENT_FIELDS = [
    'free',
    'allocated',
    'largest_free_block',
    'minimum_free',
];

function validateHeapMeasurements(event) {
    const missingFields = [];
    const invalidFields = [];
    for (const field of HEAP_MEASUREMENT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(event, field)) {
            missingFields.push(field);
            continue;
        }
        const value = event[field];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            invalidFields.push(field);
        }
    }
    return { missingFields, invalidFields };
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
    const malformedHeapRecords = [];
    const sourceEvents = [];
    const heap = {
        regions: {},
        by_phase: {},
        by_source: {},
    };
    let boot = null;
    let simulationCorpusSummary = null;
    let phaseCount = 0;
    let failedPhaseCount = 0;

    for (const event of events) {
        if (event.event === 'boot' && boot === null) {
            boot = event;
            continue;
        }

        if (event.event === 'simulation_corpus_summary' && simulationCorpusSummary === null) {
            simulationCorpusSummary = event;
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
            const validation = validateHeapMeasurements(event);
            if (validation.missingFields.length > 0 || validation.invalidFields.length > 0) {
                malformedHeapRecords.push({
                    line: event.log_line ?? event.line ?? null,
                    phase,
                    region,
                    missing_fields: validation.missingFields,
                    invalid_fields: validation.invalidFields,
                });
                continue;
            }
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
        simulation_corpus_summary: simulationCorpusSummary,
        phase_count: phaseCount,
        failed_phase_count: failedPhaseCount,
        phases,
        phases_by_source: phasesBySource,
        phase_runs: phaseRuns,
        failures,
        alloc_failures: allocFailures,
        malformed_heap_record_count: malformedHeapRecords.length,
        malformed_heap_records: malformedHeapRecords,
        diagnostics,
        source_events: sourceEvents,
        heap,
    };
}

function optionValue(argv, index, option) {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) {
        throw new Error(`missing value for ${option}`);
    }
    return value;
}

function parseArgs(argv) {
    const options = {
        help: false,
        failOnFailure: false,
        log: null,
        out: path.join('build', 'handheld_probe_log_summary.json'),
        requiredPhases: [],
        requiredHeapRegions: [],
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--fail-on-failure') {
            options.failOnFailure = true;
        } else if (arg === '--log') {
            options.log = optionValue(argv, index, arg);
            index += 1;
        } else if (arg === '--out') {
            options.out = optionValue(argv, index, arg);
            index += 1;
        } else if (arg === '--require-phase') {
            options.requiredPhases.push(optionValue(argv, index, arg));
            index += 1;
        } else if (arg === '--require-heap-region') {
            options.requiredHeapRegions.push(optionValue(argv, index, arg));
            index += 1;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }

    if (options.requiredPhases.length > 0 || options.requiredHeapRegions.length > 0) {
        options.failOnFailure = true;
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
        'Usage: node scripts/handheld_probe_log.js --log probe.log [--out build/handheld_probe_log_summary.json]',
        '',
        'Summarizes handheld board-probe JSON-lines captured from ESP-IDF serial output.',
        '',
        'Options:',
        '  --log PATH                    captured serial log to parse',
        '  --out PATH                    JSON report path (default: build/handheld_probe_log_summary.json)',
        '  --require-phase NAME',
        '                                require a passing phase; repeat for each required phase',
        '  --require-heap-region NAME',
        '                                require at least one heap sample; repeat for each region',
        '  Specifying either requirement option enables the failure gate.',
        '  --fail-on-failure',
        '                                exit nonzero if phases, allocations, parsing, or boot checks fail',
        '',
    ].join('\n'));
}

function gateFailureReasons(summary, requiredPhases = [], requiredHeapRegions = []) {
    const reasons = [];
    if (summary.event_count === 0) {
        reasons.push('no probe events');
    }
    if (summary.ignored_boot) {
        reasons.push('missing boot event');
    }
    if (summary.parse_error_count > 0) {
        reasons.push(`${summary.parse_error_count} parse error(s)`);
    }
    if (summary.failed_phase_count > 0) {
        reasons.push(`${summary.failed_phase_count} failed phase(s)`);
    }
    if (summary.alloc_failures.length > 0) {
        reasons.push(`${summary.alloc_failures.length} allocation failure(s)`);
    }
    if (summary.malformed_heap_record_count > 0) {
        reasons.push(`${summary.malformed_heap_record_count} malformed heap record(s)`);
    }
    for (const phase of requiredPhases) {
        if (!summary.phases[phase] || summary.phases[phase].status !== 'pass') {
            reasons.push(`missing passing ${phase} phase`);
        }
    }
    for (const region of requiredHeapRegions) {
        const hasRegion = Object.prototype.hasOwnProperty.call(summary.heap.regions, region);
        const stats = hasRegion ? summary.heap.regions[region] : null;
        if (!stats || !Number.isFinite(stats.samples) || stats.samples < 1) {
            reasons.push(`missing ${region} heap sample`);
        }
    }
    return reasons;
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
            fail_on_failure: options.failOnFailure,
            required_phases: options.requiredPhases,
            required_heap_regions: options.requiredHeapRegions,
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
    if (options.failOnFailure) {
        const reasons = gateFailureReasons(
            report.summary,
            options.requiredPhases,
            options.requiredHeapRegions,
        );
        if (reasons.length > 0) {
            process.stderr.write(`probe log gate failed: ${reasons.join(', ')}\n`);
            return 1;
        }
    }
    return report.summary.event_count > 0 ? 0 : 1;
}

if (require.main === module) {
    try {
        process.exitCode = runCli(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`handheld_probe_log: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    bytesToMb,
    buildReport,
    gateFailureReasons,
    normalizeProbeLogLines,
    parseArgs,
    parseProbeLogText,
    runCli,
    summarizeEvents,
};
