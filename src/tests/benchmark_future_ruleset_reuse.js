#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { analyzeSource } = require('./ps_static_analysis');
const solver = require('./run_solver_tests_js');
const { FUTURE_OBJECT_FACT_FAMILIES, createFutureObjectAnalyzer, createRuntimeObjectCounter,
    createFutureObjectSession } = require('./lib/future_object_universe');
const out = process.argv[2] || 'build/future-ruleset-reuse.json';
const candidates = Number(process.argv[3] || 1000);
const pairs = Number(process.argv[4] || 5);
if (!Number.isInteger(candidates) || candidates < 1 || !Number.isInteger(pairs) || pairs < 1) throw new Error('Invalid benchmark bounds');
const result = {
    scope: 'Analysis-only batch benchmark, not generation or solving throughput. Each candidate is an existing template with cyclically shifted tiles; all retain their template population. Fresh reproduces the previous per-level plan/count/inspect path; shared retains a ruleset session and also checks the actual player count. One cold session per measured batch. Full/filtered static analysis is measured separately. Warmup then serial alternating pairs.',
    node: process.version, candidates, pairs, games: [],
};
for (const game of ['chaos wizard', 'cakemonsters', 'dropswap']) {
    const file = `src/tests/solver_tests/${game}.txt`;
    const text = fs.readFileSync(file, 'utf8');
    solver.compileGameFile(file);
    const runtime = state;
    const stride = STRIDE_OBJ;
    const templates = runtime.levels.filter(l => l.objects);
    const boards = Array.from({ length: candidates }, (_, i) => {
        const input = templates[i % templates.length].objects;
        const output = new Int32Array(input.length);
        const offset = (Math.floor(i / templates.length) % (input.length / stride)) * stride;
        for (let n = 0; n < input.length; n++) output[n] = input[(n + offset) % input.length];
        return output;
    });
    const full = analyzeSource(text);
    const filtered = analyzeSource(text, { familyFilter: FUTURE_OBJECT_FACT_FAMILIES });
    assert.strictEqual(full.status, 'ok');
    assert.strictEqual(filtered.status, 'ok');
    const row = { game, templates: templates.length, static_pairs: [], batch_pairs: [] };
    function batch(shared) {
        const start = performance.now();
        const session = shared ? createFutureObjectSession(filtered, runtime) : null;
        let dead = 0, single = 0, closures = 0;
        for (const board of boards) {
            if (shared) {
                dead += session.preventsCompletion(board, stride) ? 1 : 0;
                single += session.certifyPlayer(board, stride).single_player_certified ? 1 : 0;
            } else {
                const analyzer = createFutureObjectAnalyzer(full);
                const counts = createRuntimeObjectCounter(full, runtime)(board, stride);
                const certificate = analyzer.inspect(counts);
                dead += certificate.prevents_completion ? 1 : 0;
                single += certificate.single_player_certified ? 1 : 0;
                closures += analyzer.counters.closures;
            }
        }
        return { ms: performance.now() - start, dead, single,
            plan_builds: shared ? 1 : candidates,
            closures: shared ? session.analyzer.counters.closures : closures,
            cache_hits: shared ? session.counters.cache_hits : 0 };
    }
    // Compare individual answers, not just batch totals, before timing.
    const check = createFutureObjectSession(filtered, runtime);
    const reference = createFutureObjectAnalyzer(full);
    const count = createRuntimeObjectCounter(full, runtime);
    for (const board of boards) {
        const expected = reference.inspect(count(board, stride));
        assert.strictEqual(check.preventsCompletion(board, stride), expected.prevents_completion);
        assert.strictEqual(check.certifyPlayer(board, stride).single_player_certified, expected.single_player_certified);
    }
    batch(false); batch(true);
    for (let i = 0; i < pairs; i++) {
        const staticPair = {}, batchPair = {};
        for (const shared of i % 2 ? [true, false] : [false, true]) {
            const start = performance.now();
            const report = analyzeSource(text, shared ? { familyFilter: FUTURE_OBJECT_FACT_FAMILIES } : {});
            staticPair[shared ? 'filtered_ms' : 'full_ms'] = performance.now() - start;
            assert.strictEqual(report.status, 'ok');
        }
        for (const shared of i % 2 ? [true, false] : [false, true]) batchPair[shared ? 'shared' : 'fresh'] = batch(shared);
        assert.strictEqual(batchPair.shared.dead, batchPair.fresh.dead);
        assert.strictEqual(batchPair.shared.single, batchPair.fresh.single);
        row.static_pairs.push(staticPair);
        row.batch_pairs.push(batchPair);
    }
    result.games.push(row);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    console.log(`${game}: batch ${median(row.batch_pairs.map(p => p.fresh.ms)).toFixed(2)} -> ${median(row.batch_pairs.map(p => p.shared.ms)).toFixed(2)} ms; plans ${candidates} -> 1`);
}
