#!/usr/bin/env node
'use strict';

// Static-analysis contract fuzzer.
//
// The runtime-contract suite (run_static_analysis_runtime_contracts_node.js)
// verifies static-analysis claims along the recorded testdata traces. The
// most claims are universal ("never increases", "static"), so this tool
// re-verifies them along randomized input sequences the recordings never
// exercised. Solver-only projection/suppression claims are checked by the
// runtime-contract runner on undo-free traces. This fuzzer found the
// cosmetic/undo scope issue and the Karamell merge regression candidates within
// two corpus runs.
//
// Usage: node src/tests/fuzz_static_contracts.js [options]
//   --corpus PATH      corpus directory                    (default src/tests/solver_tests)
//   --iterations N     random sequences per (game, level)   (default 2)
//   --input-length N   max inputs per sequence              (default 40)
//   --max-levels N     playable levels fuzzed per game      (default 2)
//   --game SUBSTRING   only fuzz matching corpus games
//   --start N --end N  corpus index window (for sharding)
//   --strict           treat known limitations (see TODO.md) as failures
//
// Inputs are generated adaptively: a sequence stops as soon as the game
// leaves a playable board (message level / title / end of game), because
// processInput must never be called in text mode — the browser input layer
// guards this, so node harnesses must too.
//
// Known-limitation classification (non-strict mode):
// - again-drain overflow during input generation: corpus games with
//   non-terminating `again` animation cycles (robot arm). Reported as a
//   skip.

const fs = require('fs');
const path = require('path');

const contracts = require('./run_static_analysis_runtime_contracts_node');
const {
    ensureRuntimeLoaded,
    MAX_AGAIN_DRAIN_STEPS,
    runSimulationWithStaticChecks,
    replayFinalSerializedLevel,
    staticContractForSource,
} = contracts;

ensureRuntimeLoaded();

/* eslint-disable no-undef */
function boardIsPlayable() {
    if (typeof level === 'undefined' || !level || !Number.isInteger(level.n_tiles)) return false;
    if (textMode || titleScreen) return false;
    if (typeof curlevel === 'number' && state && state.levels) {
        const leveldat = state.levels[curlevel];
        if (!leveldat || leveldat.message !== undefined) return false;
    }
    return true;
}

function drainAgainLocal(context) {
    let steps = 0;
    while (againing) {
        steps++;
        if (steps > MAX_AGAIN_DRAIN_STEPS) throw new Error(`${context}: again drain overflow`);
        againing = false;
        processInput(-1);
    }
}

// Generate an input sequence by actually playing it, so we never send
// input on a non-playable board.
function generateSafeInputs(label, source, targetLevel, engineSeed, rand, maxLength) {
    const previousUnitTesting = unitTesting;
    const previousLazy = lazyFunctionGeneration;
    unitTesting = true;
    lazyFunctionGeneration = false;
    const inputs = [];
    try {
        levelString = source;
        compile(['loadLevel', targetLevel], source, engineSeed);
        drainAgainLocal(`${label}: initial compile`);
        for (let i = 0; i < maxLength; i++) {
            if (!boardIsPlayable()) break;
            const roll = rand();
            let token;
            if (roll < 0.82) token = Math.floor(rand() * 5);
            else if (roll < 0.90) token = 'tick';
            else if (roll < 0.97) token = 'undo';
            else token = 'restart';

            if (token === 'undo') DoUndo(false, true);
            else if (token === 'restart') DoRestart();
            else if (token === 'tick') processInput(-1);
            else processInput(token);
            drainAgainLocal(`${label}: input ${i}`);
            inputs.push(token);
        }
    } finally {
        unitTesting = previousUnitTesting;
        lazyFunctionGeneration = previousLazy;
    }
    return inputs;
}

function playableLevelIndexes(source, label, maxLevels) {
    // Compile once (no inputs) so state.levels is populated.
    replayFinalSerializedLevel(label, source, [], { targetLevel: 0, randomSeed: 1 });
    const indexes = [];
    for (let i = 0; i < state.levels.length && indexes.length < maxLevels; i++) {
        if (state.levels[i] && state.levels[i].message === undefined) indexes.push(i);
    }
    return indexes;
}
/* eslint-enable no-undef */

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function classifyFailure(failure) {
    if ((failure.phase === 'input_generation' || failure.phase === 'level_discovery')
        && /(again drain overflow|exceeded \d+ again-drain steps)/.test(failure.error)) {
        return 'known_again_overflow';
    }
    return 'unexpected';
}

function parseArgs(argv) {
    const options = {
        corpusPath: path.join(__dirname, 'solver_tests'),
        iterations: 2,
        inputLength: 40,
        maxLevels: 2,
        gameFilter: null,
        startIndex: 0,
        endIndex: Infinity,
        strict: false,
        help: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--corpus') options.corpusPath = path.resolve(argv[++i]);
        else if (arg === '--iterations') options.iterations = Number(argv[++i]);
        else if (arg === '--input-length') options.inputLength = Number(argv[++i]);
        else if (arg === '--max-levels') options.maxLevels = Number(argv[++i]);
        else if (arg === '--game') options.gameFilter = argv[++i];
        else if (arg === '--start') options.startIndex = Number(argv[++i]);
        else if (arg === '--end') options.endIndex = Number(argv[++i]);
        else if (arg === '--strict') options.strict = true;
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/fuzz_static_contracts.js [--corpus PATH] [--iterations N]',
        '  [--input-length N] [--max-levels N] [--game SUBSTRING] [--start N --end N] [--strict]',
    ].join('\n');
}

function runStaticContractsFuzzer(options) {
    const corpusDir = path.resolve(options.corpusPath);
    const games = fs.readdirSync(corpusDir)
        .filter(name => name.endsWith('.txt'))
        .filter(name => !options.gameFilter || name.includes(options.gameFilter))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    const failures = [];
    let casesRun = 0;
    let casesSkipped = 0;

    games.forEach((game, gameIndex) => {
        if (gameIndex < options.startIndex || gameIndex >= options.endIndex) return;
        const source = fs.readFileSync(path.join(corpusDir, game), 'utf8');

        let contract;
        try {
            contract = staticContractForSource(source, game);
        } catch (error) {
            casesSkipped++;
            return;
        }
        if (contract.unavailableReason) {
            casesSkipped++;
            return;
        }

        let levels;
        try {
            levels = playableLevelIndexes(source, `levels:${game}`, options.maxLevels);
        } catch (error) {
            failures.push({ label: `levels:${game}`, phase: 'level_discovery', error: String(error && error.message).slice(0, 500) });
            return;
        }

        for (const levelIndex of levels) {
            for (let iteration = 0; iteration < options.iterations; iteration++) {
                const seed = hashString(`${game}#${levelIndex}#${iteration}`);
                const rand = mulberry32(seed);
                const engineSeed = seed % 100000;
                const label = `fuzz:${game}#L${levelIndex}#i${iteration}`;
                let inputs;
                try {
                    inputs = generateSafeInputs(label, source, levelIndex, engineSeed, rand, options.inputLength);
                } catch (error) {
                    failures.push({ label, phase: 'input_generation', error: String(error && error.message).slice(0, 500) });
                    continue;
                }
                if (inputs.length === 0) { casesSkipped++; continue; }
                let expected;
                try {
                    expected = replayFinalSerializedLevel(label, source, inputs, {
                        targetLevel: levelIndex,
                        randomSeed: engineSeed,
                    });
                } catch (error) {
                    failures.push({ label, phase: 'plain_replay', inputs: JSON.stringify(inputs), error: String(error && error.message).slice(0, 500) });
                    continue;
                }
                try {
                    runSimulationWithStaticChecks(label, [source, inputs, expected, levelIndex, engineSeed, null]);
                    casesRun++;
                } catch (error) {
                    failures.push({
                        label,
                        phase: 'contract_check',
                        inputs: JSON.stringify(inputs),
                        error: String(error && error.message).slice(0, 900),
                    });
                }
            }
        }
        if (typeof options.onGameComplete === 'function') {
            options.onGameComplete({
                game,
                gameIndex,
                gamesTotal: games.length,
                casesRun,
                casesSkipped,
                failures: failures.slice(),
            });
        } else {
            process.stderr.write(`fuzz_static_contracts: [${gameIndex + 1}/${games.length}] ${game} (run=${casesRun} fail=${failures.length})\n`);
        }
    });

    const unexpected = [];
    const known = [];
    for (const failure of failures) {
        const kind = classifyFailure(failure);
        if (kind === 'unexpected' || options.strict) unexpected.push({ kind, ...failure });
        else known.push({ kind, ...failure });
    }

    return {
        gamesTotal: games.length,
        casesRun,
        casesSkipped,
        failures,
        known,
        unexpected,
    };
}

function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.error(usage());
        process.exit(1);
    }

    const result = runStaticContractsFuzzer(options);

    for (const failure of result.known) {
        process.stderr.write(`fuzz_static_contracts: known limitation (${failure.kind}, see TODO.md): ${failure.label}\n`);
    }
    for (const failure of result.unexpected) {
        process.stderr.write(`fuzz_static_contracts: FAILURE ${failure.label} [${failure.phase}]\n  inputs: ${failure.inputs || 'n/a'}\n  ${failure.error}\n`);
    }

    process.stderr.write(`fuzz_static_contracts: cases=${result.casesRun} skipped=${result.casesSkipped} known_issues=${result.known.length} failures=${result.unexpected.length}\n`);
    if (result.unexpected.length > 0) {
        process.stderr.write('fuzz_static_contracts: failed\n');
        process.exit(1);
    }
    console.log('fuzz_static_contracts: ok');
}

if (require.main === module) {
    main();
}

module.exports = {
    classifyFailure,
    generateSafeInputs,
    playableLevelIndexes,
    runStaticContractsFuzzer,
};
