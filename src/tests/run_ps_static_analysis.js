#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { analyzeFile, discoverInputFiles } = require('./ps_static_analysis');

function usage() {
    console.error([
        'Usage: node src/tests/run_ps_static_analysis.js <file-or-dir> [more paths]',
        '  [--out PATH] [--family NAME] [--game SUBSTRING]',
        '  [--summary-only] [--include-ps-tagged] [--no-ps-tagged]',
    ].join('\n'));
    process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
}

const inputs = [];
const options = { includePsTagged: true, familyFilter: null, gameFilter: null, summaryOnly: false };
let outPath = null;

for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--out' && index + 1 < args.length) {
        outPath = path.resolve(args[++index]);
    } else if (arg === '--family' && index + 1 < args.length) {
        options.familyFilter = args[++index];
    } else if (arg === '--game' && index + 1 < args.length) {
        options.gameFilter = args[++index];
    } else if (arg === '--summary-only' || arg === '--compact') {
        options.summaryOnly = true;
    } else if (arg === '--include-ps-tagged') {
        options.includePsTagged = true;
    } else if (arg === '--no-ps-tagged') {
        options.includePsTagged = false;
    } else if (arg.startsWith('--')) {
        throw new Error(`Unsupported argument: ${arg}`);
    } else {
        inputs.push(arg);
    }
}

const files = discoverInputFiles(inputs)
    .filter(filePath => !options.gameFilter || filePath.toLowerCase().includes(options.gameFilter.toLowerCase()));

function writeIndentedJson(write, value, indent) {
    const prefix = ' '.repeat(indent);
    const json = JSON.stringify(value, null, 2).split('\n').map(line => `${prefix}${line}`).join('\n');
    write(json);
}

function countStatuses(items) {
    const counts = {};
    for (const item of items || []) {
        const key = item && item.status ? item.status : 'unknown';
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

function summarizeFacts(facts) {
    const out = {};
    for (const family of Object.keys(facts || {}).sort()) {
        const items = facts[family] || [];
        out[family] = {
            total: items.length,
            statuses: countStatuses(items),
        };
    }
    return out;
}

function addCounts(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
        target[key] = (target[key] || 0) + value;
    }
}

function addFactSummaries(target, facts) {
    for (const [family, summary] of Object.entries(facts || {})) {
        if (!target[family]) {
            target[family] = { total: 0, statuses: {} };
        }
        target[family].total += summary.total || 0;
        addCounts(target[family].statuses, summary.statuses);
    }
}

function summarizeReport(report) {
    return {
        source: report.source,
        status: report.status,
        summary: report.summary || {},
        facts: summarizeFacts(report.facts),
    };
}

function writeBatch(write) {
    const aggregate = {
        reports: { total: 0, statuses: {} },
        facts: {},
        summary: {},
    };
    const schema = options.summaryOnly
        ? 'ps-static-analysis-batch-summary-v1'
        : 'ps-static-analysis-batch-v1';
    write('{\n');
    write(`  "schema": ${JSON.stringify(schema)},\n`);
    write(`  "generated_at": ${JSON.stringify(new Date().toISOString())},\n`);
    write(`  "source_count": ${files.length},\n`);
    write('  "reports": [\n');
    files.forEach((filePath, index) => {
        if (index > 0) write(',\n');
        const report = options.summaryOnly
            ? summarizeReport(analyzeFile(filePath, Object.assign({}, options, { includePsTagged: false })))
            : analyzeFile(filePath, options);
        if (options.summaryOnly) {
            aggregate.reports.total++;
            aggregate.reports.statuses[report.status || 'unknown'] = (aggregate.reports.statuses[report.status || 'unknown'] || 0) + 1;
            addCounts(aggregate.summary, report.summary);
            addFactSummaries(aggregate.facts, report.facts);
        }
        writeIndentedJson(write, report, 4);
    });
    write('\n  ]');
    if (options.summaryOnly) {
        write(',\n  "aggregate": ');
        writeIndentedJson(write, aggregate, 2);
        write('\n');
    } else {
        write('\n');
    }
    write('}\n');
}

if (outPath) {
    const fd = fs.openSync(outPath, 'w');
    try {
        writeBatch(chunk => fs.writeSync(fd, chunk));
    } finally {
        fs.closeSync(fd);
    }
} else {
    writeBatch(chunk => process.stdout.write(chunk));
}
