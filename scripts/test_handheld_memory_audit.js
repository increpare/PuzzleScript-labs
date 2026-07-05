#!/usr/bin/env node
'use strict';

const assert = require('assert');

const audit = require('./handheld_memory_audit');

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

parsesDarwinTimeOutput();
parsesGnuTimeOutput();
rejectsMissingPeakRss();
loadsNdjsonCorpusText();
rejectsMalformedNdjsonRecords();
sanitizesSourceFileNames();
summarizesResultsAgainstCeiling();
