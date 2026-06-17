#!/usr/bin/env node
'use strict';

// Scan corpus for canonical rule/object reduction, then benchmark C++ solver
// on high-reduction games vs a matched control sample.
//
// Usage:
//   node src/tests/analyze_canonical_reduction_bench.js
//   node src/tests/analyze_canonical_reduction_bench.js --top 10 --control 10
//   node src/tests/analyze_canonical_reduction_bench.js --scan-only

const fs = require('fs');
const path = require('path');
const { compileGameFile } = require('./run_solver_tests_js');
const { benchOrigVsCanonical, seededShuffle } = require('./bench_cpp_orig_vs_canonical');

const REPO = path.resolve(__dirname, '..', '..');
const ORIG_CORPUS = path.join(REPO, 'src/tests/solver_tests');
const CANON_CORPUS = path.join(REPO, 'build/solver-timeout-curve/canonical-corpus');

function parseArgs(argv) {
    const options = {
        top: 10,
        control: 10,
        seed: 42,
        timeoutMs: 1000,
        scanOnly: false,
        minRuleRatio: 0.5,
        minObjectRatio: 0.2,
        json: false,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--top' && index + 1 < args.length) {
            options.top = Number.parseInt(args[++index], 10) || 10;
        } else if (arg === '--control' && index + 1 < args.length) {
            options.control = Number.parseInt(args[++index], 10) || 10;
        } else if (arg === '--seed' && index + 1 < args.length) {
            options.seed = Number.parseInt(args[++index], 10) || 42;
        } else if (arg === '--timeout-ms' && index + 1 < args.length) {
            options.timeoutMs = Math.max(1, Number.parseInt(args[++index], 10) || 1000);
        } else if (arg === '--min-rule-ratio' && index + 1 < args.length) {
            options.minRuleRatio = Number.parseFloat(args[++index]);
        } else if (arg === '--min-object-ratio' && index + 1 < args.length) {
            options.minObjectRatio = Number.parseFloat(args[++index]);
        } else if (arg === '--scan-only') {
            options.scanOnly = true;
        } else if (arg === '--json') {
            options.json = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

function countCompiledRules() {
    let total = 0;
    for (const groups of [state.rules, state.lateRules]) {
        for (const group of groups || []) {
            total += group.length;
        }
    }
    return total;
}

function measureGame(game) {
    const origPath = path.join(ORIG_CORPUS, game);
    const canonPath = path.join(CANON_CORPUS, game);
    compileGameFile(origPath);
    const orig = {
        objects: state.objectCount || 0,
        rules: countCompiledRules(),
        layers: state.collisionLayers ? state.collisionLayers.length : 0,
    };
    compileGameFile(canonPath);
    const canon = {
        objects: state.objectCount || 0,
        rules: countCompiledRules(),
        layers: state.collisionLayers ? state.collisionLayers.length : 0,
    };
    const ruleRatio = canon.rules / Math.max(orig.rules, 1);
    const objectRatio = canon.objects / Math.max(orig.objects, 1);
    const ruleReduction = 1 - ruleRatio;
    const objectReduction = 1 - objectRatio;
    const combinedReduction = 1 - ((canon.rules + canon.objects) / Math.max(orig.rules + orig.objects, 1));
    return {
        game,
        orig,
        canon,
        ruleRatio,
        objectRatio,
        ruleReduction,
        objectReduction,
        combinedReduction,
        drastic: ruleReduction >= 0.5 || objectReduction >= 0.3,
    };
}

function scanCorpus() {
    const games = fs.readdirSync(ORIG_CORPUS)
        .filter((name) => name.endsWith('.txt') && fs.existsSync(path.join(CANON_CORPUS, name)))
        .sort();
    const rows = [];
    for (const game of games) {
        try {
            rows.push(measureGame(game));
        } catch (error) {
            rows.push({
                game,
                error: error && error.message ? error.message : String(error),
            });
        }
    }
    return rows;
}

function pickSamples(rows, options) {
    const valid = rows.filter((row) => !row.error);
    const drastic = valid
        .filter((row) => row.drastic)
        .sort((a, b) => b.combinedReduction - a.combinedReduction);
    const mild = valid
        .filter((row) => !row.drastic)
        .sort((a, b) => a.combinedReduction - b.combinedReduction);
    const top = drastic.slice(0, options.top);
    const controlPool = mild.length >= options.control
        ? mild
        : valid.slice().sort((a, b) => a.combinedReduction - b.combinedReduction);
    const control = seededShuffle(controlPool, options.seed).slice(0, options.control);
    return { valid, drastic, top, control };
}

function summarizeBench(label, summary) {
    const t = summary.totals;
    return {
        label,
        games: summary.games,
        wall_speedup: t.wall_speedup,
        search_speedup: t.search_speedup,
        compile_speedup: t.compile_speedup,
        expanded_ratio: t.expanded_ratio,
        orig_wall_ms: t.orig_wall_ms,
        canon_wall_ms: t.canon_wall_ms,
        solved_mismatches: t.solved_mismatches,
    };
}

function printScan(rows, samples) {
    process.stdout.write(`Canonical reduction scan: ${samples.valid.length} games\n`);
    process.stdout.write(`  drastic (>=50% rules or >=30% objects): ${samples.drastic.length}\n\n`);
    process.stdout.write('Top reducers:\n');
    for (const row of samples.top) {
        process.stdout.write(
            `  ${row.game}: rules ${row.orig.rules}->${row.canon.rules} (${(row.ruleRatio * 100).toFixed(1)}%), ` +
            `objects ${row.orig.objects}->${row.canon.objects} (${(row.objectRatio * 100).toFixed(1)}%), ` +
            `combined -${(row.combinedReduction * 100).toFixed(1)}%\n`
        );
    }
    if (!samples.top.length) {
        process.stdout.write('  (none)\n');
    }
}

function printBenchResult(label, bench) {
    process.stdout.write(
        `\n${label} (${bench.games.length} games): wall ${bench.totals.wall_speedup.toFixed(2)}x, ` +
        `search ${bench.totals.search_speedup.toFixed(2)}x, ` +
        `expanded ratio ${bench.totals.expanded_ratio.toFixed(2)}x orig/canonical, ` +
        `solved mismatches ${bench.totals.solved_mismatches}\n`
    );
    for (const row of bench.rows) {
        process.stdout.write(
            `  ${row.game}: wall ${row.wall_speedup.toFixed(2)}x, search ${row.search_speedup.toFixed(2)}x, ` +
            `rules ${row.orig.rules || '?'}->${row.canon.rules || '?'}, ` +
            `expanded ${row.orig.expanded}->${row.canon.expanded}\n`
        );
    }
}

function attachReduction(rows, bench) {
    const byGame = new Map(rows.map((row) => [row.game, row]));
    for (const entry of bench.rows) {
        const row = byGame.get(entry.game);
        if (row) {
            entry.orig.rules = row.orig.rules;
            entry.canon.rules = row.canon.rules;
            entry.orig.objects = row.orig.objects;
            entry.canon.objects = row.canon.objects;
            entry.combined_reduction = row.combinedReduction;
        }
    }
    return bench;
}

function main() {
    const options = parseArgs(process.argv);
    const rows = scanCorpus();
    const samples = pickSamples(rows, options);
    if (options.scanOnly) {
        printScan(rows, samples);
        if (options.json) {
            process.stdout.write(`${JSON.stringify({ rows, samples }, null, 2)}\n`);
        }
        return;
    }
    printScan(rows, samples);
    if (samples.top.length === 0) {
        throw new Error('No drastic-reduction games found for benchmark');
    }
    const topBench = attachReduction(rows, benchOrigVsCanonical({
        games: samples.top.map((row) => row.game),
        timeoutMs: options.timeoutMs,
        seed: options.seed,
    }));
    const controlBench = attachReduction(rows, benchOrigVsCanonical({
        games: samples.control.map((row) => row.game),
        timeoutMs: options.timeoutMs,
        seed: options.seed,
    }));
    printBenchResult('High-reduction sample', topBench);
    printBenchResult('Low-reduction control', controlBench);
    const payload = {
        scan: rows,
        top: samples.top,
        control: samples.control,
        topBench: summarizeBench('top', topBench),
        controlBench: summarizeBench('control', controlBench),
    };
    if (options.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
        process.stdout.write(
            `\nContrast: high-reduction wall ${payload.topBench.wall_speedup.toFixed(2)}x vs ` +
            `control ${payload.controlBench.wall_speedup.toFixed(2)}x\n`
        );
    }
}

module.exports = {
    parseArgs,
    scanCorpus,
    measureGame,
    pickSamples,
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        process.exit(2);
    }
}
