#!/usr/bin/env node
'use strict';

// Original-vs-canonical static analysis tag parity audit (#9).
//
// Uses the canonicalizer object map to compare static tags on each original object
// against the mapped object in the round-trip decanonicalized source.

const fs = require('fs');
const path = require('path');

const { analyzeSource } = require('./ps_static_analysis');
const { auditCanonicalParity } = require('./static_analysis_canonical_parity_audit');

const FIXTURE_GAME = '15 push pull levels.txt';

function parseArgs(argv) {
    const options = {
        corpusPath: path.join(__dirname, 'solver_tests'),
        fixtureOnly: false,
        warnOnly: false,
        help: false,
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--corpus') options.corpusPath = path.resolve(argv[++index]);
        else if (arg === '--fixture-only') options.fixtureOnly = true;
        else if (arg === '--warn-only') options.warnOnly = true;
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    return options;
}

function emptyStats() {
    return {
        gamesCompared: 0,
        skipped: 0,
        compileErrors: 0,
        mappedCompared: 0,
        droppedCosmetic: 0,
        droppedUnexpected: 0,
        tagMismatches: 0,
        missingCanonicalTarget: 0,
    };
}

function mergeStats(target, source) {
    if (!source) return;
    for (const key of Object.keys(target)) {
        target[key] += source[key] || 0;
    }
}

function runFixtureSmokeTest() {
    const fixturePath = path.join(__dirname, 'solver_tests', FIXTURE_GAME);
    const source = fs.readFileSync(fixturePath, 'utf8');
    const result = auditCanonicalParity(source, FIXTURE_GAME, analyzeSource);
    if (result.skipped) {
        throw new Error(`fixture ${FIXTURE_GAME} unexpectedly skipped: ${result.skipped}`);
    }
    if (result.violations.length > 0) {
        throw new Error(`fixture ${FIXTURE_GAME} parity failed: ${result.violations.join('; ')}`);
    }
}

function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.error('Usage: node src/tests/static_analysis_canonical_parity_node.js [--corpus PATH] [--fixture-only] [--warn-only]');
        process.exit(1);
    }

    runFixtureSmokeTest();
    if (options.fixtureOnly) {
        console.log('static_analysis_canonical_parity_node: ok (fixture only)');
        return;
    }

    const corpusDir = path.resolve(options.corpusPath);
    const games = fs.readdirSync(corpusDir).filter(name => name.endsWith('.txt')).sort();
    const violations = [];
    const stats = emptyStats();

    for (const game of games) {
        const source = fs.readFileSync(path.join(corpusDir, game), 'utf8');
        const result = auditCanonicalParity(source, game, analyzeSource);
        if (result.skipped === 'compile_error') {
            stats.compileErrors++;
        } else if (result.skipped) {
            stats.skipped++;
        } else {
            stats.gamesCompared++;
            mergeStats(stats, result.stats);
        }
        violations.push(...result.violations);
    }

    process.stderr.write(
        `static_analysis_canonical_parity_node: games=${stats.gamesCompared} skipped=${stats.skipped}`
        + ` compile_errors=${stats.compileErrors}`
        + ` mapped=${stats.mappedCompared} dropped_cosmetic=${stats.droppedCosmetic}`
        + ` dropped_unexpected=${stats.droppedUnexpected}`
        + ` tag_mismatches=${stats.tagMismatches}`
        + ` violations=${violations.length}\n`
    );

    if (violations.length > 0) {
        for (const violation of violations) {
            process.stderr.write(`static_analysis_canonical_parity_node: VIOLATION ${violation}\n`);
        }
        if (options.warnOnly) {
            process.stderr.write('static_analysis_canonical_parity_node: corpus violations logged (--warn-only)\n');
            console.log('static_analysis_canonical_parity_node: ok (fixture passed; corpus violations warn-only)');
            return;
        }
        process.stderr.write('static_analysis_canonical_parity_node: failed\n');
        process.exit(1);
    }
    console.log('static_analysis_canonical_parity_node: ok');
}

main();
