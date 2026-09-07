#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');

if (process.argv.length < 5) throw new Error('Usage: compare_native_spatial_cache.js EXPERIMENT_EXE CORPUS_DIR OUTPUT_JSON [PAIRS=3] [MAX_EXPANDED=100]');
const [binary, corpus, output] = process.argv.slice(2, 5).map(p => path.resolve(p));
const pairs = Number(process.argv[5] || 3), cap = Number(process.argv[6] || 100);
assert(Number.isSafeInteger(pairs) && pairs > 0 && Number.isSafeInteger(cap) && cap > 0);
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PUZZLESCRIPT_')));
const report = {
    scope: 'Same executable, serial alternating cache-off/cache-on production BFS searches. Every solved result is replayed in player mode. Diagnostics are per-game process work including compilation; they are not deadline solve counts.',
    max_expanded: cap,
    warmup_max_expanded: Math.min(20, cap),
    binary_sha256: hash(binary),
    sources: fs.readdirSync(corpus).filter(n => n.endsWith('.txt')).sort().map(name => ({ name, sha256: hash(path.join(corpus, name)) })),
    pairs: [],
};
function run(mode, budget) {
    const start = performance.now();
    const child = spawnSync(binary, [corpus, String(budget), mode], {
        env, encoding: 'utf8', windowsHide: true, timeout: 300000, maxBuffer: 32000000,
    });
    if (child.error) throw child.error;
    assert.strictEqual(child.status, 0, child.stderr);
    const diagnostics = child.stderr.trim();
    assert(diagnostics, 'Use a PS_SPATIAL_MATCH_CACHE build of solver_fixed_work_bench');
    return {
        wall_ms: performance.now() - start,
        results: child.stdout.trim().split('\n').map(JSON.parse),
        games: diagnostics.split('\n').map(JSON.parse),
    };
}
run('cache-off', report.warmup_max_expanded); run('cache-on', report.warmup_max_expanded);
for (let pair = 0; pair < pairs; ++pair) {
    const row = {};
    for (const mode of pair % 2 ? ['cache-on', 'cache-off'] : ['cache-off', 'cache-on']) row[mode] = run(mode, cap);
    assert.deepStrictEqual(row['cache-on'].results, row['cache-off'].results);
    report.pairs.push(row);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`pair ${pair + 1}: ${row['cache-off'].wall_ms.toFixed(1)} -> ${row['cache-on'].wall_ms.toFixed(1)} ms; ${row['cache-on'].results.length} identical results`);
}
