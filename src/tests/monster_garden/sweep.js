#!/usr/bin/env node
'use strict';

// Opt-in whole-corpus equivalence sweep.
//
// tests.js only exercises the semantics-preserving mutators against
// RICH_SAMPLE and a handful of hand-picked corpus fixtures; run.js's random
// campaigns pick one random fixture per trial and only reach a comparison
// on the trials where a mutator actually applies (about 43% of trials
// historically). Both false equivalence-breaks fixed alongside this script
// (unbalanced OBJECTS comments in reorder-objects, case-sensitive aliasing
// in inline-legend-synonym) were invisible to both: a 150-trial random
// campaign restricted to semantics-preserving mutators had roughly a 20%
// chance of showing zero breaks even with both defects present, given a
// measured rate of 2 breaks per 1758 comparisons.
//
// This script instead deterministically applies every semantics-preserving
// mutator to every non-random simulation fixture in the corpus, across
// several seeds per (fixture, mutator) pair, and reports how many
// comparisons were actually made (only attempts where the mutator produced
// a real change reach a comparison; report the comparison count, not the
// attempt count) and how many broke equivalence. It is deliberately NOT part
// of the default `node tests.js` suite -- exhaustively covering the corpus
// takes minutes, not seconds.
//
// Usage:
//   node src/tests/monster_garden/sweep.js
//   node src/tests/monster_garden/sweep.js --seeds-per-pair 20 --concurrency 16
//   node src/tests/monster_garden/sweep.js --fixture "Neoprenanzieher" --mutator inline-legend-synonym
//
// Exit code is 0 iff the sweep found zero equivalence-breaks. A non-zero
// break count is printed as JSON detail on stdout and is either a remaining
// false positive in the oracle/mutators (a bug in this tooling) or a real
// compiler bug caught by the tool doing its job -- see garden.compareEquivalence
// and its callers for how to tell the two apart; do not suppress a genuine
// finding to make this script pass.

const path = require('path');
const garden = require('./garden');

const workerPath = path.join(__dirname, 'worker.js');
const resourceDir = path.join(__dirname, '..', 'resources');

const RANDOMNESS_RE = /\brandom(dir)?\b/i;

function needValue(argv, i, name) {
    const value = argv[i + 1];
    if (value === undefined) {
        throw new Error('--' + name + ' needs a value');
    }
    return value;
}

function needPositiveInt(argv, i, name) {
    const raw = needValue(argv, i, name);
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--' + name + ' must be a positive integer');
    }
    return value;
}

function parseSweepArguments(argv) {
    const options = {
        seedsPerPair: 10,
        timeoutMs: 8000,
        concurrency: 12,
        fixture: null,
        mutator: null
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--seeds-per-pair':
                options.seedsPerPair = needPositiveInt(argv, i, 'seeds-per-pair');
                i++;
                break;
            case '--timeout-ms':
                options.timeoutMs = needPositiveInt(argv, i, 'timeout-ms');
                i++;
                break;
            case '--concurrency':
                options.concurrency = needPositiveInt(argv, i, 'concurrency');
                i++;
                break;
            case '--fixture':
                options.fixture = needValue(argv, i, 'fixture');
                i++;
                break;
            case '--mutator':
                options.mutator = needValue(argv, i, 'mutator');
                i++;
                break;
            default:
                throw new Error('Unknown option: ' + arg);
        }
    }
    return options;
}

function eligibleFixtures(options) {
    const corpus = garden.loadCorpus(resourceDir);
    return corpus.filter(function(item) {
        if (item.kind !== 'simulation') {
            return false;
        }
        if (RANDOMNESS_RE.test(item.source || '')) {
            return false;
        }
        if (options.fixture && item.name.toLowerCase().indexOf(options.fixture.toLowerCase()) < 0) {
            return false;
        }
        return true;
    });
}

function equivalenceMutators(options) {
    return garden.mutators.filter(function(mutator) {
        if (!mutator.equivalence) {
            return false;
        }
        if (options.mutator && mutator.name !== options.mutator) {
            return false;
        }
        return true;
    });
}

function buildTasks(fixtures, mutatorDefs, seedsPerPair) {
    const tasks = [];
    for (let f = 0; f < fixtures.length; f++) {
        for (let m = 0; m < mutatorDefs.length; m++) {
            for (let seed = 0; seed < seedsPerPair; seed++) {
                tasks.push({ fixture: fixtures[f], mutatorDef: mutatorDefs[m], seed: seed });
            }
        }
    }
    return tasks;
}

function jobFor(fixture, source) {
    return {
        source: source,
        inputs: fixture.inputs,
        level: fixture.level,
        randomSeed: fixture.randomSeed,
        replay: true,
        maxInputs: 8
    };
}

async function main() {
    let options;
    try {
        options = parseSweepArguments(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(error.message + '\n');
        process.exitCode = 1;
        return;
    }

    const fixtures = eligibleFixtures(options);
    const mutatorDefs = equivalenceMutators(options);
    if (fixtures.length === 0) {
        process.stderr.write('No fixtures matched --fixture\n');
        process.exitCode = 1;
        return;
    }
    if (mutatorDefs.length === 0) {
        process.stderr.write('No semantics-preserving mutators matched --mutator\n');
        process.exitCode = 1;
        return;
    }

    const tasks = buildTasks(fixtures, mutatorDefs, options.seedsPerPair);

    // One baseline evaluation per fixture, memoized as a promise so
    // concurrent workers that reach the same fixture first await the same
    // in-flight child process rather than spawning duplicates.
    const baselinePromises = new Map();
    function getBaseline(fixture) {
        if (!baselinePromises.has(fixture.corpusIndex)) {
            baselinePromises.set(
                fixture.corpusIndex,
                garden.runChild(process.execPath, [workerPath], JSON.stringify(jobFor(fixture, fixture.source)), options.timeoutMs)
            );
        }
        return baselinePromises.get(fixture.corpusIndex);
    }

    let attempted = 0;
    let applied = 0;
    let comparisons = 0;
    let breaks = 0;
    const breakDetails = [];

    async function runTask(task) {
        attempted++;
        const rng = new garden.Random(task.seed);
        let result;
        try {
            result = task.mutatorDef.apply(task.fixture.source, rng, task.fixture);
        } catch (error) {
            breakDetails.push({
                fixture: task.fixture.name,
                mutator: task.mutatorDef.name,
                seed: task.seed,
                detail: 'mutator threw: ' + (error && error.message)
            });
            breaks++;
            return;
        }
        if (!result || result.source === task.fixture.source) {
            return;
        }
        applied++;
        const baseline = await getBaseline(task.fixture);
        if (baseline.kind !== 'ok') {
            // compareEquivalence itself bails out here too; nothing to compare.
            return;
        }
        const mutantResult = await garden.runChild(
            process.execPath,
            [workerPath],
            JSON.stringify(jobFor(task.fixture, result.source)),
            options.timeoutMs
        );
        if (mutantResult.kind === 'ok' || mutantResult.kind === 'compiler-error') {
            comparisons++;
        }
        const equivalence = garden.compareEquivalence(task.mutatorDef, baseline, mutantResult, result.equivalenceContext || null);
        if (equivalence) {
            breaks++;
            breakDetails.push({
                fixture: task.fixture.name,
                mutator: task.mutatorDef.name,
                seed: task.seed,
                detail: equivalence.detail,
                mutantKind: mutantResult.kind,
                mutationDetail: result.detail
            });
            process.stderr.write(
                'BREAK ' + task.fixture.name + ' / ' + task.mutatorDef.name +
                ' seed=' + task.seed + ' -- ' + equivalence.detail + ' (' + result.detail + ')\n'
            );
        }
    }

    let nextIndex = 0;
    async function worker() {
        while (nextIndex < tasks.length) {
            const task = tasks[nextIndex++];
            await runTask(task);
            if (process.stderr.isTTY && (nextIndex % 100 === 0 || nextIndex === tasks.length)) {
                process.stderr.write(
                    '\r' + nextIndex + '/' + tasks.length + ' attempted, ' +
                    applied + ' applied, ' + comparisons + ' comparisons, ' + breaks + ' breaks'
                );
            }
        }
    }

    const pool = [];
    for (let i = 0; i < options.concurrency; i++) {
        pool.push(worker());
    }
    await Promise.all(pool);
    if (process.stderr.isTTY) {
        process.stderr.write('\n');
    }

    const summary = {
        fixtures: fixtures.length,
        mutators: mutatorDefs.length,
        seedsPerPair: options.seedsPerPair,
        attempted: attempted,
        applied: applied,
        comparisons: comparisons,
        breaks: breaks
    };
    process.stdout.write(JSON.stringify(summary) + '\n');
    if (breaks > 0) {
        process.stdout.write(JSON.stringify(breakDetails, null, 2) + '\n');
        process.exitCode = 1;
    }
}

main().catch(function(error) {
    process.stderr.write(error.stack + '\n');
    process.exitCode = 1;
});
