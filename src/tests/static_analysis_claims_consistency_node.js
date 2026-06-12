#!/usr/bin/env node
'use strict';

// Cross-family consistency audit for static-analysis reports.
//
// Analyzes every game in a corpus and fails on claim combinations that are
// internally contradictory. See static_analysis_consistency_audit.js.

const fs = require('fs');
const path = require('path');

const { analyzeSource } = require('./ps_static_analysis');
const {
    analyzeAndAudit,
    emptyInfoStats,
    mergeInfoStats,
} = require('./static_analysis_consistency_audit');

function parseArgs(argv) {
    const options = {
        corpusPath: path.join(__dirname, 'solver_tests'),
        help: false,
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--corpus') options.corpusPath = path.resolve(argv[++index]);
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    return options;
}

function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.error('Usage: node src/tests/static_analysis_claims_consistency_node.js [--corpus PATH]');
        process.exit(1);
    }

    const corpusDir = path.resolve(options.corpusPath);
    const games = fs.readdirSync(corpusDir).filter(name => name.endsWith('.txt')).sort();
    const violations = [];
    const stats = {
        analyzed: 0,
        compileErrors: 0,
        ...emptyInfoStats(),
    };

    for (const game of games) {
        const source = fs.readFileSync(path.join(corpusDir, game), 'utf8');
        const result = analyzeAndAudit(source, game, analyzeSource);
        if (result.skipped === 'compile_error') {
            stats.compileErrors++;
        } else if (result.skipped !== 'threw') {
            stats.analyzed++;
            mergeInfoStats(stats, result.info);
        }
        violations.push(...result.violations);
    }

    process.stderr.write(
        `static_analysis_claims_consistency_node: analyzed=${stats.analyzed} compile_errors=${stats.compileErrors}`
        + ` created_but_never_increases=${stats.createdButNeverIncreases}`
        + ` destroyed_but_never_decreases=${stats.destroyedButNeverDecreases}`
        + ` inert_count_disagreements=${stats.inertCountChangeDisagreements}\n`
    );

    if (violations.length > 0) {
        for (const violation of violations) {
            process.stderr.write(`static_analysis_claims_consistency_node: VIOLATION ${violation}\n`);
        }
        process.stderr.write('static_analysis_claims_consistency_node: failed\n');
        process.exit(1);
    }
    console.log('static_analysis_claims_consistency_node: ok');
}

main();
