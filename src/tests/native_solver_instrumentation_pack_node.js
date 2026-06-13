#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    buildStrategySpecs,
    selectInstrumentationTargets,
    summarizeStrategyOutputs,
} = require('./run_native_solver_instrumentation_pack.js');

const jsRun = {
    results: [
        { game: 'js-miss.txt', level: 0, status: 'solved', elapsed_ms: 40, solution_length: 6 },
        { game: 'plain-timeout.txt', level: 1, status: 'timeout', elapsed_ms: 1000 },
        { game: 'near-solved.txt', level: 2, status: 'solved', elapsed_ms: 80, solution_length: 3 },
    ],
};

const nativeRun = {
    results: [
        { game: 'js-miss.txt', level: 0, status: 'timeout', elapsed_ms: 1000, expanded: 900, generated: 1800 },
        { game: 'plain-timeout.txt', level: 1, status: 'timeout', elapsed_ms: 1000, expanded: 5000, generated: 9000, step_ms: 700 },
        { game: 'near-solved.txt', level: 2, status: 'solved', elapsed_ms: 930, expanded: 1200, generated: 2400, solution_length: 4 },
        { game: 'ignored-skip.txt', level: 3, status: 'skipped_message', elapsed_ms: 0 },
    ],
};

const extraManifest = {
    targets: [
        { game: 'plain-timeout.txt', level: 1, first_solved_timeout_ms: 1000 },
        { game: 'extra.txt', level: 7, first_solved_timeout_ms: 1000 },
    ],
};

const selected = selectInstrumentationTargets({
    jsRun,
    nativeRun,
    extraManifests: [{ name: 'focus.json', manifest: extraManifest }],
    maxTargets: 20,
    timeoutMs: 1000,
});

function findTarget(game, level) {
    return selected.targets.find((target) => target.game === game && target.level === level);
}

const jsMiss = findTarget('js-miss.txt', 0);
assert(jsMiss);
assert(jsMiss.categories.includes('js_solved_native_missed'));
assert.strictEqual(jsMiss.js_status, 'solved');
assert.strictEqual(jsMiss.native_status, 'timeout');

const highExpansionTimeout = findTarget('plain-timeout.txt', 1);
assert(highExpansionTimeout);
assert(highExpansionTimeout.categories.includes('native_timeout_high_expansion'));
assert(highExpansionTimeout.categories.includes('runtime_hotspot_step_ms'));
assert(highExpansionTimeout.categories.includes('extra:focus.json'));

const nearSolved = findTarget('near-solved.txt', 2);
assert(nearSolved);
assert(nearSolved.categories.includes('near_timeout_solved'));

const seeded = findTarget('ALL GREEN TO BLUE.txt', 11);
assert(seeded);
assert(seeded.categories.includes('seed_regression'));

const extraOnly = findTarget('extra.txt', 7);
assert(extraOnly);
assert(extraOnly.categories.includes('extra:focus.json'));

const capped = selectInstrumentationTargets({
    jsRun,
    nativeRun,
    extraManifests: [{ name: 'focus.json', manifest: extraManifest }],
    maxTargets: 2,
    timeoutMs: 1000,
});
assert.strictEqual(capped.targets.length, 2);
assert(capped.targets.some((target) => target.game === 'js-miss.txt' && target.level === 0));

const strategies = buildStrategySpecs();
assert.deepStrictEqual(strategies.map((strategy) => strategy.id), [
    'portfolio',
    'bfs',
    'wa2',
    'wa3',
    'wa8',
    'greedy',
]);
assert.deepStrictEqual(strategies.find((strategy) => strategy.id === 'wa3'), {
    id: 'wa3',
    label: 'weighted-astar w=3',
    strategy: 'weighted-astar',
    solverArgs: ['--astar-weight', '3'],
});

const summary = summarizeStrategyOutputs({
    strategies,
    manifestTargets: selected.targets,
    outputsByStrategy: new Map([
        ['portfolio', {
            targets: [
                { game: 'js-miss.txt', level: 0, status_counts: { timeout: 1 }, median: { elapsed_ms: 1000, expanded: 100 } },
                { game: 'plain-timeout.txt', level: 1, status_counts: { timeout: 1 }, median: { elapsed_ms: 1000, expanded: 200 } },
            ],
        }],
        ['bfs', {
            targets: [
                { game: 'js-miss.txt', level: 0, status_counts: { solved: 1 }, median: { elapsed_ms: 100, expanded: 50 } },
                { game: 'plain-timeout.txt', level: 1, status_counts: { timeout: 1 }, median: { elapsed_ms: 1000, expanded: 200 } },
            ],
        }],
    ]),
});
assert.strictEqual(summary.strategies.portfolio.solved, 0);
assert.strictEqual(summary.strategies.bfs.solved, 1);
assert.strictEqual(summary.targets.find((target) => target.game === 'js-miss.txt').best_strategy, 'bfs');

console.log('native_solver_instrumentation_pack_node passed');
