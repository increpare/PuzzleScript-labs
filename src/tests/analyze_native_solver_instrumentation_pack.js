#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MIN_SUPPORT = 3;
const DEFAULT_SLOW_LOSS_MS = 100;
const DEFAULT_TOP_TAGS = 20;

function usage() {
    console.error([
        'Usage: node src/tests/analyze_native_solver_instrumentation_pack.js <summary.json>',
        '  [--out PATH] [--format text|json] [--min-support N] [--slow-loss-ms N] [--top-tags N]',
    ].join('\n'));
    process.exit(1);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeText(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value);
}

function finite(value) {
    return Number.isFinite(value) ? value : null;
}

function targetKey(target) {
    return `${target.game}#${target.level}`;
}

function strategyOrderForSummary(summary) {
    const fromSummary = Object.keys((summary && summary.strategies) || {});
    if (fromSummary.length > 0) {
        return fromSummary;
    }
    const names = new Set();
    for (const target of (summary && summary.targets) || []) {
        for (const name of Object.keys(target.strategies || {})) {
            names.add(name);
        }
    }
    return Array.from(names).sort();
}

function strategyResult(target, strategy) {
    return (target.strategies && target.strategies[strategy]) || {};
}

function isSolvedBy(target, strategy) {
    return strategyResult(target, strategy).status === 'solved';
}

function elapsedFor(target, strategy) {
    return finite(strategyResult(target, strategy).elapsed_ms);
}

function solvedBy(target, strategyOrder) {
    return strategyOrder
        .filter((strategy) => isSolvedBy(target, strategy))
        .map((strategy) => ({ strategy, elapsed_ms: elapsedFor(target, strategy) }))
        .sort((left, right) => {
            if (left.elapsed_ms === null && right.elapsed_ms === null) return left.strategy.localeCompare(right.strategy);
            if (left.elapsed_ms === null) return 1;
            if (right.elapsed_ms === null) return -1;
            return left.elapsed_ms - right.elapsed_ms || left.strategy.localeCompare(right.strategy);
        });
}

function bestSolvedStrategy(target, strategyOrder) {
    const rows = solvedBy(target, strategyOrder);
    return rows.length > 0 ? rows[0] : null;
}

function staticTagsForTarget(target) {
    return Array.from(new Set((target.static_analysis && target.static_analysis.tags) || [])).sort();
}

function staticCountsForTarget(target) {
    return (target.static_analysis && target.static_analysis.counts) || {};
}

function rate(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : 0;
}

function countByStrategy(targets, strategyOrder, predicate) {
    const counts = {};
    for (const strategy of strategyOrder) {
        counts[strategy] = 0;
    }
    for (const target of targets) {
        for (const strategy of strategyOrder) {
            if (predicate(target, strategy)) {
                counts[strategy]++;
            }
        }
    }
    return counts;
}

function countBestStrategies(targets, strategyOrder) {
    const counts = {};
    for (const strategy of strategyOrder) {
        counts[strategy] = 0;
    }
    for (const target of targets) {
        const best = bestSolvedStrategy(target, strategyOrder);
        if (best) {
            counts[best.strategy] = (counts[best.strategy] || 0) + 1;
        }
    }
    return counts;
}

function compactTargetRow(target, strategyOrder) {
    const best = bestSolvedStrategy(target, strategyOrder);
    const portfolio = strategyResult(target, 'portfolio');
    return {
        key: targetKey(target),
        game: target.game,
        level: target.level,
        best_strategy: best ? best.strategy : null,
        best_elapsed_ms: best ? best.elapsed_ms : null,
        portfolio_status: portfolio.status || null,
        portfolio_elapsed_ms: elapsedFor(target, 'portfolio'),
        solved_by: solvedBy(target, strategyOrder),
        counts: staticCountsForTarget(target),
        tags: staticTagsForTarget(target),
    };
}

function buildTagStats(targets, strategyOrder, options) {
    const minSupport = options.minSupport;
    const tagSet = new Set();
    for (const target of targets) {
        for (const tag of staticTagsForTarget(target)) {
            tagSet.add(tag);
        }
    }

    const rows = [];
    for (const tag of Array.from(tagSet).sort()) {
        const withTag = targets.filter((target) => staticTagsForTarget(target).includes(tag));
        if (withTag.length < minSupport) {
            continue;
        }
        const withoutTag = targets.filter((target) => !staticTagsForTarget(target).includes(tag));
        const portfolioSolved = withTag.filter((target) => isSolvedBy(target, 'portfolio')).length;
        const anySolved = withTag.filter((target) => solvedBy(target, strategyOrder).length > 0).length;
        const portfolioMissedButOtherSolved = withTag.filter((target) =>
            !isSolvedBy(target, 'portfolio') &&
            solvedBy(target, strategyOrder).some((row) => row.strategy !== 'portfolio')
        ).length;
        const allTimeout = withTag.length - anySolved;
        rows.push({
            tag,
            support: withTag.length,
            portfolio_solved: portfolioSolved,
            portfolio_rate: rate(portfolioSolved, withTag.length),
            no_tag_portfolio_rate: rate(
                withoutTag.filter((target) => isSolvedBy(target, 'portfolio')).length,
                withoutTag.length
            ),
            any_solved: anySolved,
            any_rate: rate(anySolved, withTag.length),
            all_timeout: allTimeout,
            portfolio_missed_but_other_solved: portfolioMissedButOtherSolved,
            strategy_solved_counts: countByStrategy(withTag, strategyOrder, isSolvedBy),
            best_strategy_counts: countBestStrategies(withTag, strategyOrder),
            example_targets: withTag.slice(0, 8).map(targetKey),
        });
    }

    return rows.sort((left, right) =>
        left.tag.localeCompare(right.tag)
    );
}

function runtimeRatios(target, strategy) {
    const result = strategyResult(target, strategy);
    const elapsed = elapsedFor(target, strategy);
    const ratioFor = (field) => elapsed && Number.isFinite(result[field]) ? result[field] / elapsed : null;
    return {
        step_ratio: ratioFor('step_ms'),
        materialize_ratio: ratioFor('materialize_ms'),
        hash_ratio: ratioFor('hash_ms'),
        state_capture_ratio: ratioFor('state_capture_ms'),
        heuristic_ratio: ratioFor('heuristic_ms'),
    };
}

function buildPortfolioRuntimeRows(targets) {
    return targets
        .filter((target) => isSolvedBy(target, 'portfolio'))
        .map((target) => {
            const result = strategyResult(target, 'portfolio');
            return Object.assign(compactTargetRow(target, ['portfolio']), {
                expanded: finite(result.expanded),
                generated: finite(result.generated),
                max_frontier: finite(result.max_frontier),
                step_ms: finite(result.step_ms),
                materialize_ms: finite(result.materialize_ms),
                hash_ms: finite(result.hash_ms),
                state_capture_ms: finite(result.state_capture_ms),
                heuristic_ms: finite(result.heuristic_ms),
                ratios: runtimeRatios(target, 'portfolio'),
            });
        })
        .sort((left, right) =>
            (right.portfolio_elapsed_ms || 0) - (left.portfolio_elapsed_ms || 0)
        );
}

function buildCompactFullDeltas(targets) {
    return targets
        .filter((target) => isSolvedBy(target, 'portfolio') && isSolvedBy(target, 'portfolio_full'))
        .map((target) => {
            const compact = strategyResult(target, 'portfolio');
            const full = strategyResult(target, 'portfolio_full');
            return {
                key: targetKey(target),
                game: target.game,
                level: target.level,
                compact_elapsed_ms: elapsedFor(target, 'portfolio'),
                full_elapsed_ms: elapsedFor(target, 'portfolio_full'),
                full_minus_compact_ms: elapsedFor(target, 'portfolio_full') - elapsedFor(target, 'portfolio'),
                compact_materialize_ms: finite(compact.materialize_ms),
                full_materialize_ms: finite(full.materialize_ms),
                compact_state_capture_ms: finite(compact.state_capture_ms),
                full_state_capture_ms: finite(full.state_capture_ms),
            };
        })
        .sort((left, right) => right.full_minus_compact_ms - left.full_minus_compact_ms);
}

function buildInstrumentationAnalysis(summary, rawOptions = {}) {
    const options = {
        minSupport: rawOptions.minSupport === undefined ? DEFAULT_MIN_SUPPORT : rawOptions.minSupport,
        slowLossMs: rawOptions.slowLossMs === undefined ? DEFAULT_SLOW_LOSS_MS : rawOptions.slowLossMs,
        topTags: rawOptions.topTags === undefined ? DEFAULT_TOP_TAGS : rawOptions.topTags,
    };
    const targets = (summary && summary.targets) || [];
    const strategyOrder = strategyOrderForSummary(summary);
    const anySolvedTargets = targets.filter((target) => solvedBy(target, strategyOrder).length > 0);
    const allTimeoutTargets = targets.filter((target) => solvedBy(target, strategyOrder).length === 0);
    const portfolioMissedButOtherSolved = targets
        .filter((target) =>
            !isSolvedBy(target, 'portfolio') &&
            solvedBy(target, strategyOrder).some((row) => row.strategy !== 'portfolio')
        )
        .map((target) => compactTargetRow(target, strategyOrder))
        .sort((left, right) =>
            (left.best_elapsed_ms || 0) - (right.best_elapsed_ms || 0) || left.key.localeCompare(right.key)
        );
    const portfolioSolvedButSlower = targets
        .filter((target) => {
            if (!isSolvedBy(target, 'portfolio')) {
                return false;
            }
            const best = bestSolvedStrategy(target, strategyOrder);
            const portfolioElapsed = elapsedFor(target, 'portfolio');
            return best &&
                best.strategy !== 'portfolio' &&
                portfolioElapsed !== null &&
                best.elapsed_ms !== null &&
                portfolioElapsed - best.elapsed_ms >= options.slowLossMs;
        })
        .map((target) => {
            const row = compactTargetRow(target, strategyOrder);
            row.loss_ms = row.portfolio_elapsed_ms - row.best_elapsed_ms;
            return row;
        })
        .sort((left, right) =>
            right.loss_ms - left.loss_ms || left.key.localeCompare(right.key)
        );
    const tagStats = buildTagStats(targets, strategyOrder, options);

    return {
        generated_from: summary && summary.manifest ? summary.manifest : null,
        timeout_ms: summary && summary.timeout_ms !== undefined ? summary.timeout_ms : null,
        runs: summary && summary.runs !== undefined ? summary.runs : null,
        min_support: options.minSupport,
        slow_loss_ms: options.slowLossMs,
        strategy_order: strategyOrder,
        strategy_solved_counts: countByStrategy(targets, strategyOrder, isSolvedBy),
        best_strategy_counts: countBestStrategies(targets, strategyOrder),
        coverage: {
            targets: targets.length,
            any_solved: anySolvedTargets.length,
            all_timeout: allTimeoutTargets.length,
            portfolio_solved: targets.filter((target) => isSolvedBy(target, 'portfolio')).length,
            portfolio_missed_but_other_solved: portfolioMissedButOtherSolved.length,
            portfolio_solved_but_slower: portfolioSolvedButSlower.length,
        },
        portfolio_missed_but_other_solved: portfolioMissedButOtherSolved,
        portfolio_solved_but_slower: portfolioSolvedButSlower,
        all_timeout_targets: allTimeoutTargets.map((target) => compactTargetRow(target, strategyOrder)),
        tag_stats: tagStats,
        tags_most_portfolio_solved: tagStats
            .slice()
            .sort((left, right) =>
                right.portfolio_rate - left.portfolio_rate ||
                right.support - left.support ||
                left.tag.localeCompare(right.tag)
            )
            .slice(0, options.topTags),
        tags_most_portfolio_missed: tagStats
            .slice()
            .sort((left, right) =>
                left.portfolio_rate - right.portfolio_rate ||
                right.support - left.support ||
                left.tag.localeCompare(right.tag)
            )
            .slice(0, options.topTags),
        portfolio_runtime_rows: buildPortfolioRuntimeRows(targets),
        compact_full_deltas: buildCompactFullDeltas(targets),
    };
}

function formatRate(value) {
    return value.toFixed(2);
}

function renderTargetLine(row) {
    const solved = row.solved_by.map((entry) => `${entry.strategy}:${entry.elapsed_ms}`).join(' ');
    const counts = row.counts || {};
    return `- ${row.key} best=${row.best_strategy || 'none'}:${row.best_elapsed_ms} ` +
        `portfolio=${row.portfolio_status || 'none'}:${row.portfolio_elapsed_ms} ` +
        `rules=${counts.rules || 0} groups=${counts.rulegroups || 0} late=${counts.late_rules || 0} ` +
        `solved_by=[${solved}]`;
}

function renderTagLine(row) {
    return `- ${row.tag} n=${row.support} ` +
        `portfolio=${row.portfolio_solved}/${row.support} (${formatRate(row.portfolio_rate)}) ` +
        `any=${row.any_solved}/${row.support} (${formatRate(row.any_rate)}) ` +
        `noTagPortfolio=${formatRate(row.no_tag_portfolio_rate)} ` +
        `best=${JSON.stringify(row.best_strategy_counts)}`;
}

function renderTextReport(analysis) {
    const lines = [];
    lines.push('Native solver instrumentation analysis');
    lines.push(`targets: ${analysis.coverage.targets}`);
    lines.push(`any solved: ${analysis.coverage.any_solved}`);
    lines.push(`all timeout: ${analysis.coverage.all_timeout}`);
    lines.push(`portfolio solved: ${analysis.coverage.portfolio_solved}`);
    lines.push(`portfolio missed but other strategy solved: ${analysis.coverage.portfolio_missed_but_other_solved}`);
    lines.push(`portfolio solved but slower by >= ${analysis.slow_loss_ms}ms: ${analysis.coverage.portfolio_solved_but_slower}`);
    lines.push(`strategy solved counts: ${analysis.strategy_order.map((strategy) => `${strategy}=${analysis.strategy_solved_counts[strategy] || 0}`).join(' ')}`);
    lines.push('');
    lines.push('Portfolio missed but another strategy solved:');
    for (const row of analysis.portfolio_missed_but_other_solved.slice(0, 20)) {
        lines.push(renderTargetLine(row));
        lines.push(`  tags=${row.tags.slice(0, 16).join(' ')}`);
    }
    lines.push('');
    lines.push('Portfolio solved but slower than best:');
    for (const row of analysis.portfolio_solved_but_slower.slice(0, 20)) {
        lines.push(`${renderTargetLine(row)} loss_ms=${row.loss_ms}`);
        lines.push(`  tags=${row.tags.slice(0, 16).join(' ')}`);
    }
    lines.push('');
    lines.push('Tags most associated with portfolio solved:');
    for (const row of analysis.tags_most_portfolio_solved) {
        lines.push(renderTagLine(row));
    }
    lines.push('');
    lines.push('Tags most associated with portfolio misses:');
    for (const row of analysis.tags_most_portfolio_missed) {
        lines.push(renderTagLine(row));
    }
    lines.push('');
    lines.push('Portfolio compact vs full-node elapsed deltas:');
    for (const row of analysis.compact_full_deltas.slice(0, 20)) {
        lines.push(`- ${row.key} compact=${row.compact_elapsed_ms} full=${row.full_elapsed_ms} delta=${row.full_minus_compact_ms}`);
    }
    return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
    if (argv.length < 1 || argv.includes('--help') || argv.includes('-h')) {
        usage();
    }
    const options = {
        summaryPath: path.resolve(argv[0]),
        outPath: null,
        format: 'text',
        minSupport: DEFAULT_MIN_SUPPORT,
        slowLossMs: DEFAULT_SLOW_LOSS_MS,
        topTags: DEFAULT_TOP_TAGS,
    };
    for (let index = 1; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--out' && index + 1 < argv.length) {
            options.outPath = path.resolve(argv[++index]);
        } else if (arg === '--format' && index + 1 < argv.length) {
            options.format = argv[++index];
        } else if (arg === '--min-support' && index + 1 < argv.length) {
            options.minSupport = Number(argv[++index]);
        } else if (arg === '--slow-loss-ms' && index + 1 < argv.length) {
            options.slowLossMs = Number(argv[++index]);
        } else if (arg === '--top-tags' && index + 1 < argv.length) {
            options.topTags = Number(argv[++index]);
        } else {
            throw new Error(`Unsupported argument: ${arg}`);
        }
    }
    if (!['text', 'json'].includes(options.format)) {
        throw new Error(`Unsupported format: ${options.format}`);
    }
    return options;
}

function main(argv) {
    const options = parseArgs(argv);
    const summary = readJson(options.summaryPath);
    const analysis = buildInstrumentationAnalysis(summary, options);
    const output = options.format === 'json'
        ? `${JSON.stringify(analysis, null, 2)}\n`
        : renderTextReport(analysis);
    if (options.outPath) {
        writeText(options.outPath, output);
    } else {
        process.stdout.write(output);
    }
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.stack || error.message);
        process.exit(1);
    }
}

module.exports = {
    buildInstrumentationAnalysis,
    renderTextReport,
    targetKey,
};
