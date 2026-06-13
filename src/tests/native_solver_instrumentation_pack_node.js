#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    buildStrategySpecs,
    selectInstrumentationTargets,
    summarizeStaticAnalysisReport,
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

const staticAnalysisProfile = summarizeStaticAnalysisReport({
    status: 'ok',
    summary: { proved: 1, candidate: 1, rejected: 1 },
    facts: {
        movement_action: [
            { status: 'proved', proof: ['conservative_movement_reachability_fixpoint'], blockers: [] },
            { status: 'rejected', proof: [], blockers: ['semantic_command'] },
        ],
        winflow: [
            { status: 'candidate', proof: ['wake_graph'], blockers: ['late_rule'] },
        ],
    },
    ps_tagged: {
        objects: [
            { tags: { static: true, present_in_all_levels: true, present_in_no_levels: false } },
        ],
        winconditions: [
            { tags: { plain: true, objects_matched: ['Crate', 'Target'] } },
        ],
        rule_sections: [
            {
                groups: [
                    {
                        tags: { movement_only: true, object_mutating: false, solver_state_active: true },
                        rules: [
                            {
                                late: false,
                                rigid: false,
                                random_rule: false,
                                tags: {
                                    movement_only: true,
                                    objects_required: ['Player'],
                                    objects_written: [],
                                    cosmetic: false,
                                },
                            },
                            {
                                late: true,
                                rigid: true,
                                random_rule: true,
                                tags: {
                                    object_mutating: true,
                                    has_again: true,
                                    objects_written: ['Crate'],
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    },
});

assert.strictEqual(staticAnalysisProfile.status, 'ok');
assert.strictEqual(staticAnalysisProfile.counts.rulegroups, 1);
assert.strictEqual(staticAnalysisProfile.counts.rules, 2);
assert.strictEqual(staticAnalysisProfile.counts.late_rules, 1);
assert.strictEqual(staticAnalysisProfile.counts.rigid_rules, 1);
assert.strictEqual(staticAnalysisProfile.counts.random_rules, 1);
assert.deepStrictEqual(staticAnalysisProfile.families.movement_action, { proved: 1, rejected: 1 });
assert(staticAnalysisProfile.tags.includes('static:proved:movement_action'));
assert(staticAnalysisProfile.tags.includes('static:rejected:movement_action'));
assert(staticAnalysisProfile.tags.includes('static:blocker:semantic_command'));
assert(staticAnalysisProfile.tags.includes('static:proof:wake_graph'));
assert(staticAnalysisProfile.tags.includes('static:rule:object_mutating'));
assert(staticAnalysisProfile.tags.includes('static:rule:movement_only'));
assert(staticAnalysisProfile.tags.includes('static:group:solver_state_active'));
assert(staticAnalysisProfile.tags.includes('static:object:static'));
assert(staticAnalysisProfile.tags.includes('static:win:plain'));

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
    'portfolio_full',
    'bfs',
    'wa2',
    'wa3',
    'wad2',
    'wa8',
    'greedy',
]);
assert.deepStrictEqual(strategies.find((strategy) => strategy.id === 'portfolio_full'), {
    id: 'portfolio_full',
    label: 'portfolio full-node',
    strategy: 'portfolio',
    solverArgs: ['--full-node-storage'],
});
assert.deepStrictEqual(strategies.find((strategy) => strategy.id === 'wa3'), {
    id: 'wa3',
    label: 'weighted-astar w=3',
    strategy: 'weighted-astar',
    solverArgs: ['--astar-weight', '3'],
});
assert.deepStrictEqual(strategies.find((strategy) => strategy.id === 'wad2'), {
    id: 'wad2',
    label: 'weighted-astar-deep w=2',
    strategy: 'weighted-astar-deep',
    solverArgs: ['--astar-weight', '2'],
});

const summary = summarizeStrategyOutputs({
    strategies,
    manifestTargets: selected.targets.map((target) =>
        target.game === 'js-miss.txt'
            ? Object.assign({}, target, { static_analysis: staticAnalysisProfile })
            : target
    ),
    outputsByStrategy: new Map([
        ['portfolio', {
            targets: [
                { game: 'js-miss.txt', level: 0, status_counts: { timeout: 1 }, median: { elapsed_ms: 1000, expanded: 100, materialize_ms: 12, state_capture_ms: 7 } },
                {
                    game: 'plain-timeout.txt',
                    level: 1,
                    status_counts: { timeout: 1 },
                    median: {
                        elapsed_ms: 1000,
                        expanded: 200,
                        portfolio_profile: 'balanced',
                        portfolio_rule_count: 17,
                        portfolio_has_again: true,
                    },
                },
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
const summaryMiss = summary.targets.find((target) => target.game === 'js-miss.txt');
assert.strictEqual(summaryMiss.best_strategy, 'bfs');
assert.strictEqual(summaryMiss.strategies.portfolio.materialize_ms, 12);
assert.strictEqual(summaryMiss.strategies.portfolio.state_capture_ms, 7);
assert.deepStrictEqual(summaryMiss.static_analysis.summary, { proved: 1, candidate: 1, rejected: 1 });
assert(summaryMiss.static_analysis.tags.includes('static:rule:object_mutating'));
assert.strictEqual(summary.static_analysis_tag_counts['static:rule:object_mutating'], 1);
const plainTimeout = summary.targets.find((target) => target.game === 'plain-timeout.txt');
assert.strictEqual(plainTimeout.strategies.portfolio.portfolio_profile, 'balanced');
assert.strictEqual(plainTimeout.strategies.portfolio.portfolio_rule_count, 17);
assert.strictEqual(plainTimeout.strategies.portfolio.portfolio_has_again, true);

console.log('native_solver_instrumentation_pack_node passed');
