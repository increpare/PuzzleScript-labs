#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    firstReplayTraceDifference,
    loadRuntimeContractFixtures,
    replayInputSpecializationTrace,
} = require('./run_static_analysis_runtime_contracts_node');

function randomdirFixtures() {
    const directions = [
        ['up', 'P\nC\n.', 'random-rule-sound-0'],
        ['left', 'PC.', 'random-rule-sound-3'],
        ['down', 'C\nP\n.', 'random-rule-sound-5'],
        ['right', 'CP.', 'random-rule-sound-6'],
    ];
    return [0, 4].flatMap(extraLayers => directions.map(([direction, board, randomSeed]) => {
        const padding = Array.from({ length: extraLayers }, (_, index) => `Padding${index}`);
        return {
            testName: `randomdir command ${direction}${extraLayers ? ' across movement words' : ''}`,
            source: `title Random direction command

OBJECTS
Background
black

Player
yellow

Crate
brown

${padding.map(name => `${name}\ngrey\n`).join('\n')}
LEGEND
. = Background
P = Player
C = Crate

SOUNDS

COLLISIONLAYERS
Background
Player
${padding.join('\n')}
Crate

RULES
[ stationary Crate ] -> [ randomdir Crate ]
${direction} [ > Crate | Player ] -> sfx0

WINCONDITIONS

LEVELS
${board}
`,
            inputs: [0],
            randomSeed,
            expectedCommandQueue: ['sfx0'],
        };
    }));
}

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
        'plus randomdir regressions. Compares boards, sounds, rule-phase commands and RNG state.',
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
    const fixtures = [
        ...randomdirFixtures().filter(fixture => !options.filter
            || fixture.testName.toLowerCase().includes(options.filter.toLowerCase())),
        ...loadRuntimeContractFixtures(options.filter || null),
    ];
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
        if (fixture.expectedCommandQueue) {
            assert.deepStrictEqual(
                offTrace.find(entry => entry.phase === 'main').commandQueue,
                fixture.expectedCommandQueue,
                `${fixture.testName}: reference must queue the sound command`,
            );
        }
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
