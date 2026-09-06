#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');

if (process.argv.length < 6) throw new Error('Usage: compare_native_fixed_work.js BASELINE_EXE CANDIDATE_EXE CORPUS_DIR OUTPUT_JSON [PAIRS=5] [MAX_EXPANDED=2000]');
const binaries = process.argv.slice(2, 4).map(p => path.resolve(p));
const corpus = path.resolve(process.argv[4]);
const output = path.resolve(process.argv[5]);
const pairs = Number(process.argv[6] || 5), cap = Number(process.argv[7] || 2000);
assert(Number.isSafeInteger(pairs) && pairs > 0 && Number.isSafeInteger(cap) && cap > 0);
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PUZZLESCRIPT_')));
const report = {
    scope: 'Serial alternating production native BFS searches after one warmup per binary. Same expansion cap; a wall deadline before the cap is an error. Process wall includes source compilation, level setup and player-runtime replay validation. Both drivers compile the same search source and differ only in their linked runtime/compiler libraries.',
    max_expanded: cap,
    environment: 'PUZZLESCRIPT overrides cleared',
    binary_hashes: binaries.map(hash),
    sources: fs.readdirSync(corpus).filter(n => n.endsWith('.txt')).sort().map(name => ({ name, sha256: hash(path.join(corpus, name)) })),
    result_columns: ['game', 'level', 'status', 'expanded', 'generated', 'unique_states', 'duplicates', 'max_frontier', 'solution'],
    pairs: [],
};
function run(which) {
    const start = performance.now();
    const child = spawnSync(binaries[which], [corpus, String(cap)], { env, encoding: 'utf8', windowsHide: true, timeout: 300000, maxBuffer: 32000000 });
    if (child.error) throw child.error;
    assert.strictEqual(child.status, 0, child.stderr);
    return { wall_ms: performance.now() - start, results: child.stdout.trim().split('\n').map(JSON.parse) };
}
run(0); run(1);
for (let pair = 0; pair < pairs; ++pair) {
    const row = {};
    for (const which of pair % 2 ? [1, 0] : [0, 1]) row[which ? 'candidate' : 'baseline'] = run(which);
    // A faster run with different search work is not a valid performance pair.
    assert.deepStrictEqual(row.candidate.results, row.baseline.results);
    report.pairs.push(row);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`pair ${pair + 1}: ${row.baseline.wall_ms.toFixed(1)} -> ${row.candidate.wall_ms.toFixed(1)} ms; ${row.baseline.results.length} identical results`);
}
