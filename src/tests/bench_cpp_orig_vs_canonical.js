#!/usr/bin/env node
'use strict';

// Benchmark C++ interpreter portfolio solver on original vs canonical corpus.
//
// Usage:
//   node src/tests/bench_cpp_orig_vs_canonical.js [count] [--seed N] [--timeout-ms N]
//   node src/tests/bench_cpp_orig_vs_canonical.js 10 --games game1.txt,game2.txt

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const SOLVER = path.join(REPO, 'build', 'native', 'puzzlescript_solver');
const ORIG_CORPUS = path.join(REPO, 'src/tests/solver_tests');
const CANON_CORPUS = path.join(REPO, 'build/solver-timeout-curve/canonical-corpus');

function parseArgs(argv) {
    const options = {
        count: 10,
        seed: 42,
        timeoutMs: 1000,
        games: null,
        json: false,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--seed' && index + 1 < args.length) {
            options.seed = Number.parseInt(args[++index], 10) || 42;
        } else if (arg === '--timeout-ms' && index + 1 < args.length) {
            options.timeoutMs = Math.max(1, Number.parseInt(args[++index], 10) || 1000);
        } else if (arg === '--games' && index + 1 < args.length) {
            options.games = args[++index].split(',').map((part) => part.trim()).filter(Boolean);
        } else if (arg === '--json') {
            options.json = true;
        } else if (/^\d+$/.test(arg)) {
            options.count = Number.parseInt(arg, 10);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

function seededShuffle(items, seed) {
    const array = items.slice();
    let state = seed >>> 0;
    for (let index = array.length - 1; index > 0; index--) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        const swap = state % (index + 1);
        const tmp = array[index];
        array[index] = array[swap];
        array[swap] = tmp;
    }
    return array;
}

function listSharedGames() {
    const orig = new Set(fs.readdirSync(ORIG_CORPUS).filter((name) => name.endsWith('.txt')));
    return [...orig]
        .filter((name) => fs.existsSync(path.join(CANON_CORPUS, name)))
        .sort();
}

function sumResultMs(results, field) {
    let total = 0;
    for (const result of results) {
        const value = result[field];
        if (Number.isFinite(value)) {
            total += value;
        }
    }
    return total;
}

function runGame(corpus, game, timeoutMs) {
    const started = Date.now();
    const run = spawnSync(SOLVER, [
        corpus,
        '--game', game,
        '--timeout-ms', String(timeoutMs),
        '--jobs', '1',
        '--strategy', 'portfolio',
        '--no-solutions',
        '--quiet',
        '--json',
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const wallMs = Date.now() - started;
    if (run.status !== 0) {
        throw new Error(`${game} on ${corpus} failed: ${run.stderr || run.stdout}`);
    }
    const payload = JSON.parse(run.stdout);
    const results = payload.results || [];
    const playable = results.filter((result) => result.level >= 0 && result.status !== 'skipped_message');
    return {
        corpus,
        game,
        wall_ms: wallMs,
        levels: playable.length,
        solved: playable.filter((result) => result.status === 'solved').length,
        search_ms: sumResultMs(playable, 'elapsed_ms'),
        compile_ms: sumResultMs(playable, 'compile_ms'),
        step_ms: sumResultMs(playable, 'step_ms'),
        expanded: playable.reduce((sum, result) => sum + (result.expanded || 0), 0),
        interpreter_only: playable.every((result) =>
            !result.compiled_rules_attached &&
            !result.specialized_rulegroups_attached &&
            (result.compact_turn_hits || 0) === 0
        ),
        totals: payload.totals || null,
    };
}

function benchOrigVsCanonical(options) {
    if (!fs.existsSync(SOLVER)) {
        throw new Error(`Missing ${SOLVER}. Run: make build_solver`);
    }
    const games = options.games || seededShuffle(listSharedGames(), options.seed).slice(0, options.count);
    const rows = [];
    for (const game of games) {
        const orig = runGame(ORIG_CORPUS, game, options.timeoutMs);
        const canon = runGame(CANON_CORPUS, game, options.timeoutMs);
        rows.push({
            game,
            orig,
            canon,
            wall_speedup: orig.wall_ms / Math.max(canon.wall_ms, 1),
            search_speedup: orig.search_ms / Math.max(canon.search_ms, 1),
            compile_speedup: orig.compile_ms / Math.max(canon.compile_ms, 1),
            expanded_ratio: orig.expanded / Math.max(canon.expanded, 1),
            solved_match: orig.solved === canon.solved,
        });
    }
    const totals = {
        games: rows.length,
        timeout_ms: options.timeoutMs,
        seed: options.seed,
        orig_wall_ms: rows.reduce((sum, row) => sum + row.orig.wall_ms, 0),
        canon_wall_ms: rows.reduce((sum, row) => sum + row.canon.wall_ms, 0),
        orig_search_ms: rows.reduce((sum, row) => sum + row.orig.search_ms, 0),
        canon_search_ms: rows.reduce((sum, row) => sum + row.canon.search_ms, 0),
        orig_compile_ms: rows.reduce((sum, row) => sum + row.orig.compile_ms, 0),
        canon_compile_ms: rows.reduce((sum, row) => sum + row.canon.compile_ms, 0),
        orig_expanded: rows.reduce((sum, row) => sum + row.orig.expanded, 0),
        canon_expanded: rows.reduce((sum, row) => sum + row.canon.expanded, 0),
        solved_mismatches: rows.filter((row) => !row.solved_match).length,
    };
    totals.wall_speedup = totals.orig_wall_ms / Math.max(totals.canon_wall_ms, 1);
    totals.search_speedup = totals.orig_search_ms / Math.max(totals.canon_search_ms, 1);
    totals.compile_speedup = totals.orig_compile_ms / Math.max(totals.canon_compile_ms, 1);
    totals.expanded_ratio = totals.orig_expanded / Math.max(totals.canon_expanded, 1);
    return { games, rows, totals };
}

function printHuman(summary) {
    process.stdout.write(`cpp portfolio interpreter bench (${summary.totals.games} games, ${summary.totals.timeout_ms}ms/level, seed=${summary.totals.seed})\n`);
    for (const row of summary.rows) {
        process.stdout.write(
            `  ${row.game}: wall ${row.orig.wall_ms}ms -> ${row.canon.wall_ms}ms (${row.wall_speedup.toFixed(2)}x) ` +
            `search ${row.orig.search_ms}ms -> ${row.canon.search_ms}ms (${row.search_speedup.toFixed(2)}x) ` +
            `expanded ${row.orig.expanded}->${row.canon.expanded} solved ${row.orig.solved}/${row.orig.levels}->${row.canon.solved}/${row.canon.levels}\n`
        );
    }
    const t = summary.totals;
    process.stdout.write(
        `\nAggregate: wall ${t.orig_wall_ms}ms -> ${t.canon_wall_ms}ms (${t.wall_speedup.toFixed(2)}x faster canonical)\n` +
        `           search ${t.orig_search_ms}ms -> ${t.canon_search_ms}ms (${t.search_speedup.toFixed(2)}x)\n` +
        `           compile ${t.orig_compile_ms.toFixed(1)}ms -> ${t.canon_compile_ms.toFixed(1)}ms (${t.compile_speedup.toFixed(2)}x)\n` +
        `           expanded ${t.orig_expanded} -> ${t.canon_expanded} (${t.expanded_ratio.toFixed(2)}x orig/canonical nodes)\n`
    );
    if (t.solved_mismatches > 0) {
        process.stdout.write(`  solved mismatches: ${t.solved_mismatches}\n`);
    }
}

function main() {
    const options = parseArgs(process.argv);
    const summary = benchOrigVsCanonical(options);
    if (options.json) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
        printHuman(summary);
    }
}

module.exports = {
    parseArgs,
    benchOrigVsCanonical,
    seededShuffle,
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exit(2);
    }
}
