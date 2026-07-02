#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const STEP_PROFILE_FIELDS = [
    'step_profile_early_rules_ms',
    'step_profile_late_rules_ms',
    'step_profile_other_rules_ms',
    'step_profile_rule_match_ms',
    'step_profile_rule_apply_ms',
    'step_profile_movement_ms',
    'step_profile_command_ms',
    'step_profile_win_ms',
];

const PROBE_FIELDS = [
    'probe_dir_steps',
    'probe_noops',
    'probe_blocked',
    'probe_blocked_changed',
    'probe_blocked_noop',
];

function usage() {
    process.stderr.write([
        'Usage: node src/tests/build_solver_forensics_report.js',
        '  --game-name NAME',
        '  --out-report PATH',
        '  --out-summary PATH',
        '  --out-triage-csv PATH',
        '  --js-baseline LABEL:PATH',
        '  [--js-baseline LABEL:PATH ...]',
        '  [--js-step-profile LABEL:PATH]',
        '  [--js-noop-probe LABEL:PATH]',
        '  [--js-cpu-ready LABEL:PATH]',
        '  [--native-series LABEL:PATH ...]',
        '  [--corpus-series LABEL:PATH:fresh|historical ...]',
    ].join('\n') + '\n');
}

function parseLabeledPath(value, withFreshness = false) {
    const parts = String(value).split(':');
    if ((!withFreshness && parts.length < 2) || (withFreshness && parts.length < 3)) {
        throw new Error(`invalid labeled path: ${value}`);
    }
    const label = parts.shift();
    const freshness = withFreshness ? parts.pop() : null;
    const filePath = parts.join(':');
    if (!label || !filePath) {
        throw new Error(`invalid labeled path: ${value}`);
    }
    if (freshness !== null && freshness !== 'fresh' && freshness !== 'historical') {
        throw new Error(`invalid freshness for ${label}: ${freshness}`);
    }
    return { label, path: filePath, freshness };
}

function parseArgs(argv) {
    const options = {
        gameName: null,
        outReport: null,
        outSummary: null,
        outTriageCsv: null,
        jsBaselines: [],
        jsStepProfile: null,
        jsNoopProbe: null,
        jsCpuReady: null,
        nativeSeries: [],
        corpusSeries: [],
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--game-name' && index + 1 < argv.length) {
            options.gameName = argv[++index];
        } else if (arg === '--out-report' && index + 1 < argv.length) {
            options.outReport = argv[++index];
        } else if (arg === '--out-summary' && index + 1 < argv.length) {
            options.outSummary = argv[++index];
        } else if (arg === '--out-triage-csv' && index + 1 < argv.length) {
            options.outTriageCsv = argv[++index];
        } else if (arg === '--js-baseline' && index + 1 < argv.length) {
            options.jsBaselines.push(parseLabeledPath(argv[++index]));
        } else if (arg === '--js-step-profile' && index + 1 < argv.length) {
            options.jsStepProfile = parseLabeledPath(argv[++index]);
        } else if (arg === '--js-noop-probe' && index + 1 < argv.length) {
            options.jsNoopProbe = parseLabeledPath(argv[++index]);
        } else if (arg === '--js-cpu-ready' && index + 1 < argv.length) {
            options.jsCpuReady = parseLabeledPath(argv[++index]);
        } else if (arg === '--native-series' && index + 1 < argv.length) {
            options.nativeSeries.push(parseLabeledPath(argv[++index]));
        } else if (arg === '--corpus-series' && index + 1 < argv.length) {
            options.corpusSeries.push(parseLabeledPath(argv[++index], true));
        } else {
            throw new Error(`unsupported argument: ${arg}`);
        }
    }
    if (!options.gameName || !options.outReport || !options.outSummary || !options.outTriageCsv) {
        usage();
        throw new Error('missing required output or game arguments');
    }
    if (options.jsBaselines.length === 0) {
        throw new Error('at least one --js-baseline is required');
    }
    return options;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeFileEnsuringDir(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function resultRows(run) {
    return Array.isArray(run && run.results) ? run.results : [];
}

function playableRows(rows) {
    return rows.filter((row) => row.status !== 'skipped_message');
}

function solvedAt(rows, timeoutMs) {
    return rows.filter((row) => row.status === 'solved' && Number(row.elapsed_ms) <= timeoutMs).length;
}

function statusCounts(rows) {
    const counts = {};
    for (const row of rows) {
        counts[row.status || 'unknown'] = (counts[row.status || 'unknown'] || 0) + 1;
    }
    return counts;
}

function numeric(row, field) {
    const value = Number(row && row[field]);
    return Number.isFinite(value) ? value : 0;
}

function sumField(rows, field) {
    return rows.reduce((sum, row) => sum + numeric(row, field), 0);
}

function aggregateField(run, playable, field) {
    if (run && run.totals && Number.isFinite(Number(run.totals[field]))) {
        return Number(run.totals[field]);
    }
    return sumField(playable, field);
}

function summarizeRun(label, run, freshness = 'fresh') {
    const rows = resultRows(run);
    const playable = playableRows(rows);
    const generated = aggregateField(run, playable, 'generated');
    const stepMs = aggregateField(run, playable, 'step_ms');
    const noOp = aggregateField(run, playable, 'step_no_op');
    const changed = aggregateField(run, playable, 'step_changed');
    const summary = {
        label,
        freshness,
        total_levels: rows.length,
        playable_levels: playable.length,
        solved_total: rows.filter((row) => row.status === 'solved').length,
        solved_500: solvedAt(rows, 500),
        solved_1000: solvedAt(rows, 1000),
        status_counts: statusCounts(rows),
        generated,
        expanded: aggregateField(run, playable, 'expanded'),
        step_ms: stepMs,
        heuristic_ms: aggregateField(run, playable, 'heuristic_ms'),
        clone_ms: aggregateField(run, playable, 'clone_ms'),
        snapshot_ms: aggregateField(run, playable, 'snapshot_ms'),
        hash_ms: aggregateField(run, playable, 'hash_ms'),
        queue_ms: aggregateField(run, playable, 'queue_ms'),
        reconstruct_ms: aggregateField(run, playable, 'reconstruct_ms'),
        us_per_generated: generated > 0 ? (stepMs * 1000) / generated : 0,
        step_no_op: noOp,
        step_changed: changed,
        step_no_op_pct: noOp + changed > 0 ? (100 * noOp) / (noOp + changed) : 0,
    };
    for (const field of STEP_PROFILE_FIELDS) {
        summary[field] = aggregateField(run, playable, field);
    }
    for (const field of PROBE_FIELDS) {
        summary[field] = aggregateField(run, playable, field);
    }
    return summary;
}

function rowKey(row) {
    return `${row.game || ''}#${row.level}`;
}

function indexByKey(rows) {
    const map = new Map();
    for (const row of rows) {
        map.set(rowKey(row), row);
    }
    return map;
}

function triageCategory(row, nativeMaps) {
    if (row.status === 'solved' && numeric(row, 'elapsed_ms') <= 500) return 'solved_under_500ms';
    if (row.status === 'solved') return 'solved_after_500ms';
    const nativeSolved = nativeMaps.some((map) => {
        const native = map.get(rowKey(row));
        return native && native.status === 'solved' && numeric(native, 'elapsed_ms') <= 500;
    });
    if (nativeSolved) return 'js_missed_native_solved';
    const generated = numeric(row, 'generated');
    const stepMs = numeric(row, 'step_ms');
    const heuristicMs = numeric(row, 'heuristic_ms');
    if (stepMs >= heuristicMs && stepMs >= 50) return 'high_step_cost_timeout';
    if (heuristicMs > stepMs && heuristicMs >= 20) return 'high_heuristic_cost_timeout';
    if (generated >= 1000) return 'high_expansion_timeout';
    return row.status || 'other';
}

function buildLevelTriage(jsRun, nativeRuns = []) {
    const nativeMaps = nativeRuns.map((entry) => indexByKey(resultRows(entry.run)));
    const nativeMapsByLabel = nativeRuns.map((entry, index) => ({ label: entry.label, map: nativeMaps[index] }));
    return playableRows(resultRows(jsRun)).map((row) => {
        const nativeSummary = nativeMapsByLabel.map((entry) => {
            const native = entry.map.get(rowKey(row));
            return `${entry.label}:${native ? native.status : 'missing'}:${native ? Math.round(numeric(native, 'elapsed_ms')) : ''}`;
        }).join('|');
        return {
            game: row.game || '',
            level: row.level,
            category: triageCategory(row, nativeMaps),
            status: row.status || '',
            elapsed_ms: numeric(row, 'elapsed_ms'),
            expanded: numeric(row, 'expanded'),
            generated: numeric(row, 'generated'),
            step_ms: numeric(row, 'step_ms'),
            heuristic_ms: numeric(row, 'heuristic_ms'),
            clone_ms: numeric(row, 'clone_ms'),
            snapshot_ms: numeric(row, 'snapshot_ms'),
            hash_ms: numeric(row, 'hash_ms'),
            queue_ms: numeric(row, 'queue_ms'),
            step_no_op: numeric(row, 'step_no_op'),
            step_changed: numeric(row, 'step_changed'),
            native_summary: nativeSummary,
        };
    }).sort((left, right) =>
        right.generated - left.generated || right.step_ms - left.step_ms || Number(left.level) - Number(right.level)
    );
}

function csvEscape(value) {
    const text = String(value === undefined || value === null ? '' : value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function triageToCsv(rows) {
    const fields = [
        'game', 'level', 'category', 'status', 'elapsed_ms', 'expanded', 'generated',
        'step_ms', 'heuristic_ms', 'clone_ms', 'snapshot_ms', 'hash_ms', 'queue_ms',
        'step_no_op', 'step_changed', 'native_summary',
    ];
    return [
        fields.join(','),
        ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(',')),
    ].join('\n') + '\n';
}

function formatPct(count, total) {
    return total > 0 ? `${((100 * count) / total).toFixed(1)}%` : '0.0%';
}

function formatNumber(value) {
    return Number(value || 0).toFixed(1);
}

function table(headers, rows) {
    return [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n');
}

function topCategories(triageRows) {
    const counts = {};
    for (const row of triageRows) {
        counts[row.category] = (counts[row.category] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function runtimeBreakdownRows(row) {
    return [
        ['step_ms', formatNumber(row.step_ms)],
        ['heuristic_ms', formatNumber(row.heuristic_ms)],
        ['clone_ms', formatNumber(row.clone_ms)],
        ['snapshot_ms', formatNumber(row.snapshot_ms)],
        ['hash_ms', formatNumber(row.hash_ms)],
        ['queue_ms', formatNumber(row.queue_ms)],
        ['reconstruct_ms', formatNumber(row.reconstruct_ms)],
    ];
}

function stepProfileRows(row) {
    return STEP_PROFILE_FIELDS.map((field) => [field, formatNumber(row[field])]);
}

function probeRows(row) {
    return PROBE_FIELDS.map((field) => [field, formatNumber(row[field])]);
}

function buildMarkdownReport({ gameName, jsSummaries, nativeSummaries, corpusSummaries, triageRows, artifactIndex }) {
    const primary = jsSummaries[0];
    const stepProfile = jsSummaries.find((row) => /step profile/i.test(row.label)) || primary;
    const noopProbe = jsSummaries.find((row) => /no-op|noop/i.test(row.label)) || primary;
    const lines = [];
    lines.push('# JS-First Solver Forensics: Anonymous Game at 500ms');
    lines.push('');
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(`- Game: \`${gameName}\`.`);
    lines.push(`- Primary JS baseline solves ${primary.solved_500}/${primary.playable_levels} playable levels by 500ms (${formatPct(primary.solved_500, primary.playable_levels)}).`);
    lines.push(`- JS generated ${primary.generated} candidate steps with ${formatNumber(primary.step_ms)}ms in stepping and ${formatNumber(primary.heuristic_ms)}ms in heuristic scoring.`);
    lines.push(`- JS no-op steps are ${formatNumber(primary.step_no_op_pct)}% of measured changed/no-op steps.`);
    lines.push('- Native data is included as calibration, not as the sole optimization target.');
    lines.push('- Hypotheses below are candidates for reviewer inspection, not a closed list.');
    lines.push('');
    lines.push('## Single-Game Solver Calibration');
    lines.push('');
    lines.push(table(
        ['Solver', 'Freshness', 'Playable', '<=500ms', '<=1000ms', 'Solved Total', 'Step ms', 'Heuristic ms', 'No-op %'],
        [...jsSummaries, ...nativeSummaries].map((row) => [
            row.label,
            row.freshness,
            row.playable_levels,
            `${row.solved_500} (${formatPct(row.solved_500, row.playable_levels)})`,
            `${row.solved_1000} (${formatPct(row.solved_1000, row.playable_levels)})`,
            row.solved_total,
            formatNumber(row.step_ms),
            formatNumber(row.heuristic_ms),
            formatNumber(row.step_no_op_pct),
        ]),
    ));
    lines.push('');
    lines.push('## Corpus Calibration');
    lines.push('');
    lines.push(table(
        ['Solver', 'Freshness', 'Playable', '<=500ms', '<=1000ms', 'Solved Total'],
        corpusSummaries.map((row) => [
            row.label,
            row.freshness,
            row.playable_levels,
            `${row.solved_500} (${formatPct(row.solved_500, row.playable_levels)})`,
            `${row.solved_1000} (${formatPct(row.solved_1000, row.playable_levels)})`,
            row.solved_total,
        ]),
    ));
    lines.push('');
    lines.push('## Per-Level Triage');
    lines.push('');
    lines.push(table(['Category', 'Count'], topCategories(triageRows).map(([name, count]) => [name, count])));
    lines.push('');
    lines.push('Top generated-count levels:');
    lines.push('');
    lines.push(table(
        ['Level', 'Category', 'Status', 'Elapsed ms', 'Generated', 'Expanded', 'Step ms', 'Heuristic ms', 'Native summary'],
        triageRows.slice(0, 12).map((row) => [
            row.level,
            row.category,
            row.status,
            formatNumber(row.elapsed_ms),
            row.generated,
            row.expanded,
            formatNumber(row.step_ms),
            formatNumber(row.heuristic_ms),
            row.native_summary || '',
        ]),
    ));
    lines.push('');
    lines.push('## JS Runtime Breakdown');
    lines.push('');
    lines.push('Baseline timing buckets:');
    lines.push('');
    lines.push(table(['Bucket', 'ms'], runtimeBreakdownRows(primary)));
    lines.push('');
    lines.push('Step-profile timing buckets:');
    lines.push('');
    lines.push(table(['Bucket', 'ms'], stepProfileRows(stepProfile)));
    lines.push('');
    lines.push('No-op probe counters:');
    lines.push('');
    lines.push(table(['Counter', 'Value'], probeRows(noopProbe)));
    lines.push('');
    lines.push('## Native Calibration Notes');
    lines.push('');
    lines.push('- C++ interpreted and compiled rows are calibration evidence for whether JS symptoms are runtime-specific or search/semantic-level.');
    lines.push('- HDA rows can improve solve counts by parallelizing search; they do not by themselves prove a better single-threaded heuristic.');
    lines.push('- Historical compiled/corpus artifacts are useful yardsticks but should be refreshed before making tight regression claims.');
    lines.push('');
    lines.push('## Open Hypothesis Space');
    lines.push('');
    lines.push('- Observed facts are separated from interpretations so a reviewer can reject our reading.');
    lines.push('- Consider heuristic improvements, macro-actions, partial-order reductions, pattern databases, rule-structure classification, per-level strategy selection, sound no-op proofs, JS runtime experiments, native compact specialization, and alternate search algorithms.');
    lines.push('- Reviewer questions: Which levels suggest search-order failure rather than runtime cost? Which rule shapes invite safe abstraction? Which JS experiments can cheaply falsify the highest-payoff ideas?');
    lines.push('');
    lines.push('## Candidate Hypotheses');
    lines.push('');
    lines.push('- If `step_ms` dominates, prototype JS runtime reductions or macro-actions that reduce expensive `processInput` calls.');
    lines.push('- If high-generated timeouts dominate, inspect heuristic guidance and per-level strategy selection before micro-optimizing stepping.');
    lines.push('- If native compiled solvers solve JS misses, compare per-level statuses to separate JS implementation overhead from semantic/search difficulty.');
    lines.push('- If no-op rates are high, look for sound proof systems or macro actions rather than unsafe skip predicates.');
    lines.push('');
    lines.push('## Artifact Index');
    lines.push('');
    lines.push(table(['Label', 'Path', 'Freshness'], artifactIndex.map((row) => [row.label, `\`${row.path}\``, row.freshness || 'fresh'])));
    return lines.join('\n');
}

function loadEntry(entry, freshnessOverride = null) {
    return {
        label: entry.label,
        path: entry.path,
        freshness: freshnessOverride || entry.freshness || 'fresh',
        run: readJson(entry.path),
    };
}

function buildReportArtifacts(options) {
    const jsEntries = options.jsBaselines.map((entry) => loadEntry(entry, 'fresh'));
    const extraJsEntries = [options.jsStepProfile, options.jsNoopProbe, options.jsCpuReady]
        .filter(Boolean)
        .map((entry) => loadEntry(entry, 'fresh'));
    const nativeEntries = options.nativeSeries.map((entry) =>
        loadEntry(entry, /historical/i.test(entry.label) ? 'historical' : 'fresh')
    );
    const corpusEntries = options.corpusSeries.map((entry) => loadEntry(entry, entry.freshness));
    const jsSummaries = [...jsEntries, ...extraJsEntries].map((entry) => summarizeRun(entry.label, entry.run, entry.freshness));
    const nativeSummaries = nativeEntries.map((entry) => summarizeRun(entry.label, entry.run, entry.freshness));
    const corpusSummaries = corpusEntries.map((entry) => summarizeRun(entry.label, entry.run, entry.freshness));
    const triageRows = buildLevelTriage(jsEntries[0].run, nativeEntries);
    const artifactIndex = [...jsEntries, ...extraJsEntries, ...nativeEntries, ...corpusEntries].map((entry) => ({
        label: entry.label,
        path: entry.path,
        freshness: entry.freshness,
    }));
    const summary = {
        game_name: options.gameName,
        generated_at: new Date().toISOString(),
        js_summaries: jsSummaries,
        native_summaries: nativeSummaries,
        corpus_summaries: corpusSummaries,
        triage_counts: Object.fromEntries(topCategories(triageRows)),
        artifacts: artifactIndex,
    };
    const report = buildMarkdownReport({
        gameName: options.gameName,
        jsSummaries,
        nativeSummaries,
        corpusSummaries,
        triageRows,
        artifactIndex,
    });
    writeFileEnsuringDir(options.outSummary, `${JSON.stringify(summary, null, 2)}\n`);
    writeFileEnsuringDir(options.outTriageCsv, triageToCsv(triageRows));
    writeFileEnsuringDir(options.outReport, `${report}\n`);
    return { summary, triageRows, report };
}

function main() {
    const options = parseArgs(process.argv);
    buildReportArtifacts(options);
}

Object.assign(module.exports, {
    parseArgs,
    parseLabeledPath,
    readJson,
    writeFileEnsuringDir,
    resultRows,
    playableRows,
    solvedAt,
    statusCounts,
    summarizeRun,
    rowKey,
    buildLevelTriage,
    triageToCsv,
    buildMarkdownReport,
    buildReportArtifacts,
});

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        process.exit(1);
    }
}
