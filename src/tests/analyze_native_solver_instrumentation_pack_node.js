#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    buildInstrumentationAnalysis,
    renderTextReport,
} = require('./analyze_native_solver_instrumentation_pack.js');

function target(game, level, strategies, staticAnalysis) {
    const solved = Object.entries(strategies)
        .filter(([, result]) => result.status === 'solved' && Number.isFinite(result.elapsed_ms))
        .sort((left, right) => left[1].elapsed_ms - right[1].elapsed_ms);
    return {
        game,
        level,
        best_strategy: solved.length > 0 ? solved[0][0] : null,
        best_elapsed_ms: solved.length > 0 ? solved[0][1].elapsed_ms : null,
        strategies,
        static_analysis: staticAnalysis,
    };
}

const summary = {
    strategies: {
        portfolio: { solved: 2 },
        bfs: { solved: 1 },
        wa3: { solved: 1 },
        greedy: { solved: 0 },
    },
    targets: [
        target('bfs-only.txt', 0, {
            portfolio: { status: 'timeout', elapsed_ms: 1000 },
            bfs: { status: 'solved', elapsed_ms: 200 },
            wa3: { status: 'timeout', elapsed_ms: 1000 },
            greedy: { status: 'timeout', elapsed_ms: 1000 },
        }, {
            tags: ['static:rule:has_again', 'static:win:plain'],
            counts: { rules: 10, rulegroups: 4, late_rules: 0, levels: 3 },
        }),
        target('wa3-faster.txt', 1, {
            portfolio: { status: 'solved', elapsed_ms: 500 },
            bfs: { status: 'timeout', elapsed_ms: 1000 },
            wa3: { status: 'solved', elapsed_ms: 100 },
            greedy: { status: 'timeout', elapsed_ms: 1000 },
        }, {
            tags: ['static:proof:no_reachable_action_effects', 'static:win:targets_matched'],
            counts: { rules: 4, rulegroups: 2, late_rules: 0, levels: 8 },
        }),
        target('all-timeout.txt', 2, {
            portfolio: { status: 'timeout', elapsed_ms: 1000 },
            bfs: { status: 'timeout', elapsed_ms: 1000 },
            wa3: { status: 'timeout', elapsed_ms: 1000 },
            greedy: { status: 'timeout', elapsed_ms: 1000 },
        }, {
            tags: ['static:object:temporary', 'static:rule:has_again'],
            counts: { rules: 30, rulegroups: 12, late_rules: 4, levels: 9 },
        }),
        target('portfolio-best.txt', 3, {
            portfolio: { status: 'solved', elapsed_ms: 150 },
            bfs: { status: 'timeout', elapsed_ms: 1000 },
            wa3: { status: 'timeout', elapsed_ms: 1000 },
            greedy: { status: 'timeout', elapsed_ms: 1000 },
        }, {
            tags: ['static:win:targets_matched'],
            counts: { rules: 6, rulegroups: 3, late_rules: 0, levels: 2 },
        }),
    ],
};

const analysis = buildInstrumentationAnalysis(summary, {
    minSupport: 2,
    slowLossMs: 50,
});

assert.deepStrictEqual(analysis.strategy_order, ['portfolio', 'bfs', 'wa3', 'greedy']);
assert.deepStrictEqual(analysis.strategy_solved_counts, {
    portfolio: 2,
    bfs: 1,
    wa3: 1,
    greedy: 0,
});
assert.deepStrictEqual(analysis.strategy_unique_solve_counts, {
    portfolio: 1,
    bfs: 1,
    wa3: 0,
    greedy: 0,
});
assert.deepStrictEqual(analysis.strategy_unique_solve_examples.bfs, ['bfs-only.txt#0']);
assert.deepStrictEqual(analysis.coverage, {
    targets: 4,
    any_solved: 3,
    all_timeout: 1,
    portfolio_solved: 2,
    portfolio_missed_but_other_solved: 1,
    portfolio_solved_but_slower: 1,
});

assert.deepStrictEqual(analysis.portfolio_missed_but_other_solved.map((row) => row.key), ['bfs-only.txt#0']);
assert.deepStrictEqual(analysis.portfolio_missed_but_other_solved[0].solved_by, [
    { strategy: 'bfs', elapsed_ms: 200 },
]);

assert.deepStrictEqual(analysis.portfolio_solved_but_slower.map((row) => ({
    key: row.key,
    best_strategy: row.best_strategy,
    loss_ms: row.loss_ms,
})), [
    { key: 'wa3-faster.txt#1', best_strategy: 'wa3', loss_ms: 400 },
]);

assert.deepStrictEqual(analysis.all_timeout_targets.map((row) => row.key), ['all-timeout.txt#2']);

const hasAgain = analysis.tag_stats.find((row) => row.tag === 'static:rule:has_again');
assert(hasAgain);
assert.strictEqual(hasAgain.support, 2);
assert.strictEqual(hasAgain.portfolio_solved, 0);
assert.strictEqual(hasAgain.any_solved, 1);
assert.strictEqual(hasAgain.best_strategy_counts.bfs, 1);

const targetsMatched = analysis.tag_stats.find((row) => row.tag === 'static:win:targets_matched');
assert(targetsMatched);
assert.strictEqual(targetsMatched.support, 2);
assert.strictEqual(targetsMatched.portfolio_solved, 2);
assert.strictEqual(targetsMatched.no_tag_portfolio_rate, 0);

const report = renderTextReport(analysis);
assert(report.includes('portfolio missed but other strategy solved: 1'));
assert(report.includes('bfs-only.txt#0'));
assert(report.includes('static:rule:has_again'));

console.log('analyze_native_solver_instrumentation_pack_node passed');
