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
        {
            game: 'hard.txt',
            level: 1,
            status: 'solved',
            elapsed_ms: 120,
            generated: 20,
            expanded: 5,
            step_ms: 8,
            heuristic_ms: 2,
            step_no_op: 3,
            step_changed: 7,
        },
        {
            game: 'hard.txt',
            level: 2,
            status: 'timeout',
            elapsed_ms: 500,
            generated: 2000,
            expanded: 400,
            step_ms: 240,
            heuristic_ms: 30,
            clone_ms: 4,
            snapshot_ms: 5,
            hash_ms: 6,
            queue_ms: 7,
            step_no_op: 80,
            step_changed: 120,
        },
        {
            game: 'hard.txt',
            level: 3,
            status: 'timeout',
            elapsed_ms: 500,
            generated: 800,
            expanded: 300,
            step_ms: 20,
            heuristic_ms: 90,
            step_no_op: 20,
            step_changed: 40,
        },
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
assert.ok(fs.readFileSync(reportPath, 'utf8').includes('JS Runtime Breakdown'));
assert.ok(fs.readFileSync(reportPath, 'utf8').includes('corpus JS'));
assert.ok(JSON.parse(fs.readFileSync(summaryPath, 'utf8')).corpus_summaries[0].freshness === 'historical');
assert.ok(fs.readFileSync(csvPath, 'utf8').includes('js_missed_native_solved'));

console.log('build_solver_forensics_report_node passed');
