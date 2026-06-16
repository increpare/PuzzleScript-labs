#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    firstReplayTraceDifference,
    loadRuntimeContractFixtures,
    replayInputSpecializationTrace,
} = require('./run_static_analysis_runtime_contracts_node');

function parseArgs(argv) {
    const options = { filter: null, help: false };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--filter') {
            assert.ok(index + 1 < argv.length, '--filter requires a value');
            options.filter = argv[++index];
        } else if (!arg.startsWith('-') && options.filter === null) {
            options.filter = arg;
        } else {
            throw new Error(`Unexpected argument: ${arg}`);
        }
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/input_specialization_parity_node.js [--filter NAME]',
        '',
        'Replays src/tests/resources/testdata.js with input specialization off and on,',
        'then compares the boundary trace after every input.',
    ].join('\n');
}

function formatDiff(testName, diff) {
    return [
        `${testName}: input-specialization parity trace differs at index ${diff.index}`,
        `  off: ${JSON.stringify(diff.left)}`,
        `  on:  ${JSON.stringify(diff.right)}`,
    ].join('\n');
}

function runAll(options = {}) {
    const fixtures = loadRuntimeContractFixtures(options.filter || null);
    if (fixtures.length === 0) {
        throw new Error(options.filter
            ? `No simulation tests matched filter ${JSON.stringify(options.filter)}`
            : 'No simulation tests were loaded');
    }

    const failures = [];
    for (const fixture of fixtures) {
        const offTrace = replayInputSpecializationTrace(
            fixture.testName,
            fixture.source,
            fixture.inputs,
            {
                enabled: false,
                targetLevel: fixture.targetLevel,
                randomSeed: fixture.randomSeed,
            }
        );
        const onTrace = replayInputSpecializationTrace(
            fixture.testName,
            fixture.source,
            fixture.inputs,
            {
                enabled: true,
                targetLevel: fixture.targetLevel,
                randomSeed: fixture.randomSeed,
            }
        );
        const diff = firstReplayTraceDifference(offTrace, onTrace);
        if (diff !== null) {
            failures.push(formatDiff(fixture.testName, diff));
        }
    }
    return {
        ok: failures.length === 0,
        caseCount: fixtures.length,
        failures,
    };
}

function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.log(usage());
        return 0;
    }

    const result = runAll(options);
    if (!result.ok) {
        console.error('input_specialization_parity_node: failed');
        for (const failure of result.failures) {
            console.error(failure);
        }
        return 1;
    }
    console.log(`input_specialization_parity_node: ok (${result.caseCount} cases)`);
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    parseArgs,
    runAll,
};
