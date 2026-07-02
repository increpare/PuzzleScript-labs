# JS-First Solver Forensics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a JS-first solver forensics evidence pack and Markdown report for the anonymous game, with native and corpus calibration tables.

**Architecture:** Add one focused Node.js report builder that consumes raw solver JSON and writes `summary.json`, `level-triage.csv`, and the final Markdown report. Use existing JS/native solver runners to collect raw evidence, keeping solver behavior unchanged and raw generated artifacts under `build/solver-forensics/anonymous-js-first-500ms/`.

**Tech Stack:** Node.js, existing PuzzleScript JS solver runner, existing native `puzzlescript_solver`, existing JSON result schema, Markdown/CSV output.

---

## File Structure

- Create `src/tests/build_solver_forensics_report.js`: pure report/table builder; parses solver JSON, computes calibration counts, level triage, timing breakdowns, open hypothesis prompts, and writes report artifacts.
- Create `src/tests/build_solver_forensics_report_node.js`: unit test using synthetic solver JSON to lock the report builder behavior.
- Create `docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md`: generated final report from fresh/saved artifacts.
- Generate under `build/solver-forensics/anonymous-js-first-500ms/`: staged one-file corpus, raw JS JSON, raw native JSON, `summary.json`, and `level-triage.csv`.
- Modify no solver runtime/search files.

## Task 1: Report Builder Script

**Files:**
- Create: `src/tests/build_solver_forensics_report.js`
- Test later: `src/tests/build_solver_forensics_report_node.js`

- [ ] **Step 1: Create the report builder skeleton**

Add `src/tests/build_solver_forensics_report.js` with these exported functions and CLI parsing:

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

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

module.exports = {
    parseArgs,
    parseLabeledPath,
    readJson,
    writeFileEnsuringDir,
};
```

- [ ] **Step 2: Add result summarization helpers**

Extend the script with:

```js
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

function summarizeRun(label, run, freshness = 'fresh') {
    const rows = resultRows(run);
    const playable = playableRows(rows);
    const generated = sumField(playable, 'generated');
    const stepMs = sumField(playable, 'step_ms');
    const noOp = sumField(playable, 'step_no_op');
    const changed = sumField(playable, 'step_changed');
    return {
        label,
        freshness,
        total_levels: rows.length,
        playable_levels: playable.length,
        solved_total: rows.filter((row) => row.status === 'solved').length,
        solved_500: solvedAt(rows, 500),
        solved_1000: solvedAt(rows, 1000),
        status_counts: statusCounts(rows),
        generated,
        expanded: sumField(playable, 'expanded'),
        step_ms: stepMs,
        heuristic_ms: sumField(playable, 'heuristic_ms'),
        clone_ms: sumField(playable, 'clone_ms'),
        snapshot_ms: sumField(playable, 'snapshot_ms'),
        hash_ms: sumField(playable, 'hash_ms'),
        queue_ms: sumField(playable, 'queue_ms'),
        reconstruct_ms: sumField(playable, 'reconstruct_ms'),
        us_per_generated: generated > 0 ? (stepMs * 1000) / generated : 0,
        step_no_op: noOp,
        step_changed: changed,
        step_no_op_pct: noOp + changed > 0 ? (100 * noOp) / (noOp + changed) : 0,
    };
}
```

Export `summarizeRun`, `solvedAt`, `statusCounts`, and `playableRows`.

- [ ] **Step 3: Add per-level triage helpers**

Add:

```js
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
    const generated = numeric(row, 'generated');
    const stepMs = numeric(row, 'step_ms');
    const heuristicMs = numeric(row, 'heuristic_ms');
    const nativeSolved = nativeMaps.some((map) => {
        const native = map.get(rowKey(row));
        return native && native.status === 'solved' && numeric(native, 'elapsed_ms') <= 500;
    });
    if (nativeSolved) return 'js_missed_native_solved';
    if (stepMs >= heuristicMs && stepMs >= 50) return 'high_step_cost_timeout';
    if (heuristicMs > stepMs && heuristicMs >= 20) return 'high_heuristic_cost_timeout';
    if (generated >= 1000) return 'high_expansion_timeout';
    return row.status || 'other';
}

function buildLevelTriage(jsRun, nativeRuns = []) {
    const nativeMaps = nativeRuns.map((entry) => indexByKey(resultRows(entry.run)));
    return playableRows(resultRows(jsRun)).map((row) => {
        const nativeSummary = nativeRuns.map((entry) => {
            const native = indexByKey(resultRows(entry.run)).get(rowKey(row));
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
```

Export `buildLevelTriage` and `triageToCsv`.

- [ ] **Step 4: Add Markdown report generation**

Add:

```js
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
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function buildMarkdownReport({ gameName, jsSummaries, nativeSummaries, corpusSummaries, triageRows, artifactIndex }) {
    const primary = jsSummaries[0];
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
    lines.push('');
    return lines.join('\n');
}
```

Export `buildMarkdownReport`.

- [ ] **Step 5: Add CLI main**

Add:

```js
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
    const nativeEntries = options.nativeSeries.map((entry) => loadEntry(entry, 'fresh'));
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

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        process.exit(1);
    }
}

Object.assign(module.exports, {
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
```

## Task 2: Report Builder Unit Test

**Files:**
- Create: `src/tests/build_solver_forensics_report_node.js`

- [ ] **Step 1: Add synthetic JSON test**

Create `src/tests/build_solver_forensics_report_node.js`:

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    parseLabeledPath,
    summarizeRun,
    buildLevelTriage,
    triageToCsv,
    buildReportArtifacts,
} = require('./build_solver_forensics_report');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-forensics-report-'));

function writeJson(name, value) {
    const filePath = path.join(tmpRoot, name);
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
    return filePath;
}

const jsRun = {
    results: [
        { game: 'hard.txt', level: 0, status: 'skipped_message', elapsed_ms: 0 },
        { game: 'hard.txt', level: 1, status: 'solved', elapsed_ms: 120, generated: 20, expanded: 5, step_ms: 8, heuristic_ms: 2, step_no_op: 3, step_changed: 7 },
        { game: 'hard.txt', level: 2, status: 'timeout', elapsed_ms: 500, generated: 2000, expanded: 400, step_ms: 240, heuristic_ms: 30, clone_ms: 4, snapshot_ms: 5, hash_ms: 6, queue_ms: 7, step_no_op: 80, step_changed: 120 },
        { game: 'hard.txt', level: 3, status: 'timeout', elapsed_ms: 500, generated: 800, expanded: 300, step_ms: 20, heuristic_ms: 90, step_no_op: 20, step_changed: 40 },
    ],
};

const nativeRun = {
    results: [
        { game: 'hard.txt', level: 0, status: 'skipped_message', elapsed_ms: 0 },
        { game: 'hard.txt', level: 1, status: 'solved', elapsed_ms: 90, generated: 15, expanded: 4, step_ms: 4, heuristic_ms: 1 },
        { game: 'hard.txt', level: 2, status: 'solved', elapsed_ms: 300, generated: 900, expanded: 200, step_ms: 100, heuristic_ms: 10 },
        { game: 'hard.txt', level: 3, status: 'timeout', elapsed_ms: 500, generated: 700, expanded: 250, step_ms: 10, heuristic_ms: 70 },
    ],
};

const corpusRun = {
    results: [
        { game: 'a.txt', level: 0, status: 'solved', elapsed_ms: 100 },
        { game: 'a.txt', level: 1, status: 'solved', elapsed_ms: 800 },
        { game: 'a.txt', level: 2, status: 'timeout', elapsed_ms: 1000 },
        { game: 'a.txt', level: 3, status: 'skipped_message', elapsed_ms: 0 },
    ],
};

assert.deepStrictEqual(parseLabeledPath('JS baseline:/tmp/x.json'), {
    label: 'JS baseline',
    path: '/tmp/x.json',
    freshness: null,
});
assert.deepStrictEqual(parseLabeledPath('Corpus:/tmp/x.json:historical', true), {
    label: 'Corpus',
    path: '/tmp/x.json',
    freshness: 'historical',
});

const summary = summarizeRun('JS baseline', jsRun, 'fresh');
assert.strictEqual(summary.playable_levels, 3);
assert.strictEqual(summary.solved_500, 1);
assert.strictEqual(summary.solved_1000, 1);
assert.strictEqual(summary.status_counts.timeout, 2);
assert.ok(summary.step_no_op_pct > 0);

const triage = buildLevelTriage(jsRun, [{ label: 'native', run: nativeRun }]);
assert.strictEqual(triage.length, 3);
assert.strictEqual(triage.find((row) => row.level === 1).category, 'solved_under_500ms');
assert.strictEqual(triage.find((row) => row.level === 2).category, 'js_missed_native_solved');
assert.strictEqual(triage.find((row) => row.level === 3).category, 'high_heuristic_cost_timeout');
assert.ok(triageToCsv(triage).includes('native:solved:300'));

const jsPath = writeJson('js.json', jsRun);
const nativePath = writeJson('native.json', nativeRun);
const corpusPath = writeJson('corpus.json', corpusRun);
const reportPath = path.join(tmpRoot, 'report.md');
const summaryPath = path.join(tmpRoot, 'summary.json');
const csvPath = path.join(tmpRoot, 'triage.csv');

const artifacts = buildReportArtifacts({
    gameName: 'hard.txt',
    outReport: reportPath,
    outSummary: summaryPath,
    outTriageCsv: csvPath,
    jsBaselines: [{ label: 'JS baseline', path: jsPath }],
    jsStepProfile: null,
    jsNoopProbe: null,
    jsCpuReady: null,
    nativeSeries: [{ label: 'native', path: nativePath }],
    corpusSeries: [{ label: 'corpus JS', path: corpusPath, freshness: 'historical' }],
});

assert.strictEqual(artifacts.summary.game_name, 'hard.txt');
assert.ok(fs.readFileSync(reportPath, 'utf8').includes('Open Hypothesis Space'));
assert.ok(fs.readFileSync(reportPath, 'utf8').includes('corpus JS'));
assert.ok(JSON.parse(fs.readFileSync(summaryPath, 'utf8')).corpus_summaries[0].freshness === 'historical');
assert.ok(fs.readFileSync(csvPath, 'utf8').includes('js_missed_native_solved'));

console.log('build_solver_forensics_report_node passed');
```

- [ ] **Step 2: Run the test and verify it passes**

Run:

```bash
node src/tests/build_solver_forensics_report_node.js
```

Expected output:

```text
build_solver_forensics_report_node passed
```

- [ ] **Step 3: Run existing instrumentation smoke tests**

Run:

```bash
node src/tests/js_solver_instrumentation_pack_node.js
node src/tests/native_solver_instrumentation_pack_node.js
node src/tests/analyze_native_solver_instrumentation_pack_node.js
```

Expected outputs:

```text
js_solver_instrumentation_pack_node passed
native_solver_instrumentation_pack_node passed
analyze_native_solver_instrumentation_pack_node passed
```

- [ ] **Step 4: Commit report-builder code**

Run:

```bash
git add src/tests/build_solver_forensics_report.js src/tests/build_solver_forensics_report_node.js
git commit -m "test: add solver forensics report builder"
```

Expected: commit succeeds with only those two files.

## Task 3: Collect Fresh Single-Game Evidence

**Files:**
- Generate: `build/solver-forensics/anonymous-js-first-500ms/input-corpus/ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt`
- Generate: `build/solver-forensics/anonymous-js-first-500ms/js-baseline-1.json`
- Generate: `build/solver-forensics/anonymous-js-first-500ms/js-baseline-2.json`
- Generate: `build/solver-forensics/anonymous-js-first-500ms/js-baseline-3.json`
- Generate: `build/solver-forensics/anonymous-js-first-500ms/js-step-profile.json`
- Generate: `build/solver-forensics/anonymous-js-first-500ms/js-noop-probe.json`
- Generate: `build/solver-forensics/anonymous-js-first-500ms/js-cpu-ready.json`
- Generate: native calibration JSON files in the same directory

- [ ] **Step 1: Stage the one-file corpus**

Run:

```bash
mkdir -p build/solver-forensics/anonymous-js-first-500ms/input-corpus
cp /Users/stephenlavelle/Documents/google_gist_scraper/dumpprocessed/ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt build/solver-forensics/anonymous-js-first-500ms/input-corpus/ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt
```

Expected: staged corpus directory contains exactly one `.txt` file.

- [ ] **Step 2: Run JS baseline repetitions**

Run three serial baseline runs:

```bash
node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus --timeout-ms 500 --quiet --json --no-solutions > build/solver-forensics/anonymous-js-first-500ms/js-baseline-1.json
node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus --timeout-ms 500 --quiet --json --no-solutions > build/solver-forensics/anonymous-js-first-500ms/js-baseline-2.json
node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus --timeout-ms 500 --quiet --json --no-solutions > build/solver-forensics/anonymous-js-first-500ms/js-baseline-3.json
```

Expected: each JSON parses and contains one `results` array.

- [ ] **Step 3: Run JS profile variants**

Run:

```bash
PUZZLESCRIPT_SOLVER_STEP_PROFILE=1 node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus --timeout-ms 500 --quiet --json --no-solutions > build/solver-forensics/anonymous-js-first-500ms/js-step-profile.json
PUZZLESCRIPT_SOLVER_NOOP_PROBE=1 node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus --timeout-ms 500 --quiet --json --no-solutions > build/solver-forensics/anonymous-js-first-500ms/js-noop-probe.json
PUZZLESCRIPT_SOLVER_DETAIL_TIMING=0 node src/tests/run_solver_tests_js.js build/solver-forensics/anonymous-js-first-500ms/input-corpus --timeout-ms 500 --quiet --json --no-solutions > build/solver-forensics/anonymous-js-first-500ms/js-cpu-ready.json
```

Expected: each JSON parses; step-profile JSON includes `step_profile_*` fields on totals or result rows; no-op JSON includes probe counters when predicates run.

- [ ] **Step 4: Build native solver if needed**

Run:

```bash
make build_solver
```

Expected: `build/native/puzzlescript_solver` exists.

- [ ] **Step 5: Run native interpreter calibration**

Run:

```bash
build/native/puzzlescript_solver build/solver-forensics/anonymous-js-first-500ms/input-corpus --timeout-ms 500 --jobs 1 --strategy portfolio --quiet --json --no-solutions > build/solver-forensics/anonymous-js-first-500ms/native-portfolio.json
build/native/puzzlescript_solver build/solver-forensics/anonymous-js-first-500ms/input-corpus --timeout-ms 500 --strategy hda-weighted-astar --hda-jobs 8 --compact-node-storage --quiet --json --no-solutions > build/solver-forensics/anonymous-js-first-500ms/native-hda-8.json
```

Expected: both JSON files parse and contain result rows for the staged game.

- [ ] **Step 6: Capture compiled native calibration**

Reuse the existing single-game compiled HDA JSON if still present:

```text
build/solver-timeout-curve-ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f-30000ms-hda-compiled/cpp-hda-weighted-astar-8-compiled.json
```

If compiled portfolio is available in the older 5000ms single-game directory, use it as historical calibration; otherwise omit compiled portfolio and state that it was not freshly collected.

- [ ] **Step 7: Validate raw JSON files**

Run:

```bash
node -e "const fs=require('fs'); for (const p of process.argv.slice(1)) { const j=JSON.parse(fs.readFileSync(p,'utf8')); if (!Array.isArray(j.results)) throw new Error(p+' missing results'); console.log(p, j.results.length); }" build/solver-forensics/anonymous-js-first-500ms/js-baseline-1.json build/solver-forensics/anonymous-js-first-500ms/js-baseline-2.json build/solver-forensics/anonymous-js-first-500ms/js-baseline-3.json build/solver-forensics/anonymous-js-first-500ms/js-step-profile.json build/solver-forensics/anonymous-js-first-500ms/js-noop-probe.json build/solver-forensics/anonymous-js-first-500ms/js-cpu-ready.json build/solver-forensics/anonymous-js-first-500ms/native-portfolio.json build/solver-forensics/anonymous-js-first-500ms/native-hda-8.json
```

Expected: each path prints with a result count.

## Task 4: Generate Report Artifacts

**Files:**
- Create: `docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md`
- Generate: `build/solver-forensics/anonymous-js-first-500ms/summary.json`
- Generate: `build/solver-forensics/anonymous-js-first-500ms/level-triage.csv`

- [ ] **Step 1: Run the report builder**

Run:

```bash
node src/tests/build_solver_forensics_report.js \
  --game-name ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f.txt \
  --out-report docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md \
  --out-summary build/solver-forensics/anonymous-js-first-500ms/summary.json \
  --out-triage-csv build/solver-forensics/anonymous-js-first-500ms/level-triage.csv \
  --js-baseline "JS baseline run 1:build/solver-forensics/anonymous-js-first-500ms/js-baseline-1.json" \
  --js-baseline "JS baseline run 2:build/solver-forensics/anonymous-js-first-500ms/js-baseline-2.json" \
  --js-baseline "JS baseline run 3:build/solver-forensics/anonymous-js-first-500ms/js-baseline-3.json" \
  --js-step-profile "JS step profile:build/solver-forensics/anonymous-js-first-500ms/js-step-profile.json" \
  --js-noop-probe "JS no-op probe:build/solver-forensics/anonymous-js-first-500ms/js-noop-probe.json" \
  --js-cpu-ready "JS detail timing off:build/solver-forensics/anonymous-js-first-500ms/js-cpu-ready.json" \
  --native-series "C++ portfolio interpreter:build/solver-forensics/anonymous-js-first-500ms/native-portfolio.json" \
  --native-series "C++ HDA x8 interpreter:build/solver-forensics/anonymous-js-first-500ms/native-hda-8.json" \
  --native-series "C++ HDA x8 compiled historical:build/solver-timeout-curve-ANONYMOUS_BATCH_OLD_ce2474f62432e2a703bba3fb65f5b01f-30000ms-hda-compiled/cpp-hda-weighted-astar-8-compiled.json" \
  --corpus-series "Corpus JS historical:build/solver-timeout-curve/js.json:historical" \
  --corpus-series "Corpus C++ portfolio historical:build/solver-timeout-curve/cpp-portfolio.json:historical" \
  --corpus-series "Corpus C++ HDA x8 historical:build/solver-timeout-curve/cpp-hda-weighted-astar-8.json:historical" \
  --corpus-series "Corpus C++ portfolio compiled historical:build/solver-timeout-curve/cpp-portfolio-compiled.json:historical" \
  --corpus-series "Corpus C++ HDA x8 compiled historical:build/solver-timeout-curve/cpp-hda-weighted-astar-8-compiled.json:historical"
```

Expected: report, summary JSON, and triage CSV are written.

- [ ] **Step 2: Inspect generated report for evidence quality**

Run:

```bash
sed -n '1,220p' docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md
```

Expected: report includes executive summary, single-game calibration, corpus calibration, triage, open hypothesis space, candidate hypotheses, and artifact index.

- [ ] **Step 3: Verify generated counts match raw JSON**

Run:

```bash
node -e "const fs=require('fs'); const s=JSON.parse(fs.readFileSync('build/solver-forensics/anonymous-js-first-500ms/summary.json','utf8')); if (!s.js_summaries.length) throw new Error('missing JS summaries'); if (!s.native_summaries.length) throw new Error('missing native summaries'); if (!s.corpus_summaries.length) throw new Error('missing corpus summaries'); console.log('summary ok', s.js_summaries[0].solved_500, s.js_summaries[0].playable_levels);"
```

Expected: prints `summary ok ...`.

- [ ] **Step 4: Commit the report**

Run:

```bash
git add docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md
git commit -m "docs: add JS-first solver forensics report"
```

Expected: commit includes only the report, not build artifacts.

## Task 5: Final Verification and Handoff

**Files:**
- Read: `docs/solver-forensics/2026-07-02-anonymous-game-js-first-500ms-report.md`
- Read: `build/solver-forensics/anonymous-js-first-500ms/summary.json`
- Read: `build/solver-forensics/anonymous-js-first-500ms/level-triage.csv`

- [ ] **Step 1: Run final smoke tests**

Run:

```bash
node src/tests/build_solver_forensics_report_node.js
node src/tests/js_solver_instrumentation_pack_node.js
node src/tests/native_solver_instrumentation_pack_node.js
node src/tests/analyze_native_solver_instrumentation_pack_node.js
```

Expected: all four commands print their `... passed` messages.

- [ ] **Step 2: Check git status**

Run:

```bash
git status --short
```

Expected: no tracked source/docs changes except intentionally untracked `build/solver-forensics/...` generated artifacts.

- [ ] **Step 3: Final response**

Tell Stephen:

- Report path.
- Summary artifact path.
- Triage CSV path.
- Which commands/tests passed.
- That no solver behavior was changed.
