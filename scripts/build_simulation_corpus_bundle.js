#!/usr/bin/env node
'use strict';

/**
 * Emit an NDJSON simulation corpus for on-device native replay profiling.
 * Each line: { index, name, source, inputs, target_level, seed? }
 *
 * Usage:
 *   node scripts/build_simulation_corpus_bundle.js
 *   node scripts/build_simulation_corpus_bundle.js --out build/codex-perf/simulation_corpus.bundle.ndjson
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');

function parseArgs(argv) {
    const options = {
        out: path.join(repoRoot, 'build', 'codex-perf', 'simulation_corpus.bundle.ndjson'),
        limit: null,
        maxSourceBytes: null,
        testdataOut: null,
    };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--out' && argv[index + 1]) {
            options.out = path.isAbsolute(argv[index + 1])
                ? argv[index + 1]
                : path.join(repoRoot, argv[index + 1]);
            index += 1;
        } else if (arg === '--limit' && argv[index + 1]) {
            options.limit = Number(argv[index + 1]);
            index += 1;
        } else if (arg === '--max-source-bytes' && argv[index + 1]) {
            options.maxSourceBytes = Number(argv[index + 1]);
            index += 1;
        } else if (arg === '--testdata-out' && argv[index + 1]) {
            options.testdataOut = path.isAbsolute(argv[index + 1])
                ? argv[index + 1]
                : path.join(repoRoot, argv[index + 1]);
            index += 1;
        }
    }
    return options;
}

function smokeIndices(total, limit, rows, maxSourceBytes) {
    let pool = Array.from({ length: total }, (_, index) => index);
    if (maxSourceBytes != null) {
        pool = pool.filter((index) => rows[index][1][0].length <= maxSourceBytes);
    }
    if (limit === null || limit >= pool.length) {
        return pool;
    }
    const indices = [];
    for (let pick = 0; pick < limit; pick += 1) {
        const poolIndex = Math.floor((pick * (pool.length - 1)) / Math.max(limit - 1, 1));
        indices.push(pool[poolIndex]);
    }
    return indices;
}

function loadJsArray(filePath, symbol) {
    const source = fs.readFileSync(filePath, 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: filePath });
    return sandbox[symbol];
}

function normalizeInputs(rawInputs) {
    if (!Array.isArray(rawInputs)) {
        return [];
    }
    return rawInputs.map((value) => {
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(Math.trunc(value));
        }
        return '0';
    });
}

function main() {
    const options = parseArgs(process.argv);
    const testdataPath = path.join(repoRoot, 'src', 'tests', 'resources', 'testdata.js');
    const rows = loadJsArray(testdataPath, 'testdata');
    const indices = smokeIndices(rows.length, options.limit, rows, options.maxSourceBytes);
    const lines = [];
    const testdataRows = [];
    for (const index of indices) {
        const row = rows[index];
        const name = row[0];
        const payload = row[1];
        const source = payload[0];
        const inputs = normalizeInputs(payload[1]);
        const targetLevel = payload.length >= 4 && payload[3] != null ? payload[3] : 0;
        const record = {
            index,
            name,
            source,
            inputs,
            target_level: targetLevel,
        };
        if (payload.length >= 5 && payload[4] != null) {
            record.seed = payload[4];
        }
        lines.push(`${JSON.stringify(record)}\n`);
        testdataRows.push(row);
    }
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, lines.join(''), 'utf8');
    process.stderr.write(`wrote ${lines.length} simulation corpus lines to ${options.out}\n`);
    if (options.testdataOut) {
        fs.mkdirSync(path.dirname(options.testdataOut), { recursive: true });
        fs.writeFileSync(
            options.testdataOut,
            `var testdata = ${JSON.stringify(testdataRows, null, 2)};\n`,
            'utf8',
        );
        process.stderr.write(`wrote ${testdataRows.length} testdata rows to ${options.testdataOut}\n`);
    }
}

main();
