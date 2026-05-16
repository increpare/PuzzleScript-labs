#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { analyzeSource } = require('./ps_static_analysis');

const REPORT_SCHEMA = 'action-noop-candidates-v1';

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function targetKey(game, level) {
    return `${game}#${level}`;
}

function sourceHasNoaction(source) {
    return /^\s*noaction\b/im.test(source);
}

function resultMap(jsonPath) {
    if (!jsonPath) return null;
    const payload = readJson(jsonPath);
    return new Map((payload.results || []).map(result => [targetKey(result.game, result.level), result]));
}

function factById(report, family, id) {
    return ((report.facts && report.facts[family]) || []).find(fact => fact.id === id) || null;
}

function forcedComparisonVetsNoactionTarget(forcedComparison) {
    return !!forcedComparison
        && forcedComparison.forced_status === 'solved'
        && ['solved', 'timeout', 'exhausted'].includes(forcedComparison.baseline_status);
}

function classificationForTarget(existingNoaction, actionNoop, hypotheses, forcedComparison = null) {
    if (existingNoaction) return 'existing_noaction';
    if (actionNoop && actionNoop.status === 'proved') return 'proved_insertable';
    if (hypotheses.includes('direct_action_reader_requires_runtime_or_level_proof')) return 'rejected_direct_action_reader';
    if (hypotheses.includes('only_autonomous_object_mutation')) return 'candidate_autonomous_object_mutation';
    if (hypotheses.includes('object_mutation_limited_to_transient_objects')) return 'candidate_transient_object_mutation';
    if (forcedComparisonVetsNoactionTarget(forcedComparison)) return 'runtime_vetted_target_solved';
    if (hypotheses.includes('no_direct_action_reader')) return 'candidate_no_direct_action_reader';
    return 'rejected';
}

function summarizeTargets(targets, games) {
    const hypotheses = {};
    const classifications = {};
    for (const target of targets) {
        classifications[target.classification] = (classifications[target.classification] || 0) + 1;
        for (const hypothesis of target.hypotheses) {
            hypotheses[hypothesis] = (hypotheses[hypothesis] || 0) + 1;
        }
    }
    return {
        target_count: targets.length,
        unique_game_count: games.length,
        existing_noaction_games: games.filter(game => game.existing_noaction).length,
        proved_insertable_games: games.filter(game => !game.existing_noaction && game.action_noop.status === 'proved').length,
        runtime_vetted_target_solved_targets: targets.filter(target => target.classification === 'runtime_vetted_target_solved').length,
        rejected_games: games.filter(game => game.action_noop.status === 'rejected').length,
        rejected_candidate_targets: targets.filter(target => target.classification.startsWith('candidate_')).length,
        classifications,
        hypotheses,
    };
}

function compareResultPair(baseline, forced) {
    if (!baseline || !forced) return null;
    return {
        baseline_status: baseline.status,
        forced_status: forced.status,
        baseline_solution_length: baseline.solution_length || 0,
        forced_solution_length: forced.solution_length || 0,
        baseline_elapsed_ms: baseline.elapsed_ms || 0,
        forced_elapsed_ms: forced.elapsed_ms || 0,
        baseline_generated: baseline.generated || 0,
        forced_generated: forced.generated || 0,
        same_status: baseline.status === forced.status,
        same_solution_length: baseline.status === forced.status
            && (baseline.status !== 'solved' || baseline.solution_length === forced.solution_length),
    };
}

function buildActionNoopCandidateReport(options) {
    const corpusPath = options.corpusPath;
    const manifestPath = options.manifestPath;
    if (!corpusPath) throw new Error('buildActionNoopCandidateReport: corpusPath is required');
    if (!manifestPath) throw new Error('buildActionNoopCandidateReport: manifestPath is required');

    const manifest = readJson(manifestPath);
    if (!Array.isArray(manifest.targets)) {
        throw new Error(`${manifestPath}: expected targets[]`);
    }
    const baselineResults = resultMap(options.baselineJsonPath);
    const forcedResults = resultMap(options.forcedNoactionJsonPath);
    const uniqueGames = Array.from(new Set(manifest.targets.map(target => target.game)));
    const games = uniqueGames.map(game => {
        const sourcePath = path.join(corpusPath, game);
        const source = fs.readFileSync(sourcePath, 'utf8');
        const report = analyzeSource(source, {
            sourcePath: game,
            familyFilter: 'movement_action',
        });
        const actionNoop = factById(report, 'movement_action', 'action_noop') || {};
        const diagnostics = factById(report, 'movement_action', 'action_noop_diagnostics') || {};
        const value = diagnostics.value || {};
        return {
            game,
            source_path: sourcePath,
            existing_noaction: sourceHasNoaction(source),
            action_noop: {
                status: actionNoop.status || report.status,
                value: actionNoop.value === true,
                blockers: (actionNoop.blockers || []).slice().sort(),
            },
            hypotheses: (value.hypotheses || []).slice().sort(),
            blocker_rules: (value.blocker_rules || []).map(rule => ({
                rule_id: rule.rule_id,
                group_id: rule.group_id,
                source_line: rule.source_line,
                late: !!rule.late,
                reasons: (rule.reasons || []).slice().sort(),
                changed_objects: (rule.changed_objects || []).slice().sort(),
                transient_changed_objects: (rule.transient_changed_objects || []).slice().sort(),
                movement_effects: (rule.movement_effects || []).slice().sort(),
            })),
        };
    });
    const gameByName = new Map(games.map(game => [game.game, game]));
    const targets = manifest.targets.map(target => {
        const game = gameByName.get(target.game);
        const key = targetKey(target.game, target.level);
        const forced_comparison = compareResultPair(
            baselineResults && baselineResults.get(key),
            forcedResults && forcedResults.get(key)
        );
        return {
            game: target.game,
            level: target.level,
            existing_noaction: game.existing_noaction,
            classification: classificationForTarget(
                game.existing_noaction,
                game.action_noop,
                game.hypotheses,
                forced_comparison
            ),
            action_noop: game.action_noop,
            hypotheses: game.hypotheses,
            blocker_rules: game.blocker_rules,
            forced_comparison,
        };
    });
    return {
        schema: REPORT_SCHEMA,
        corpus_path: corpusPath,
        manifest_path: manifestPath,
        summary: summarizeTargets(targets, games),
        games,
        targets,
    };
}

function usage() {
    process.stderr.write([
        'Usage: node src/tests/report_action_noop_candidates.js <corpus-dir>',
        '  --solver-focus-manifest PATH [--baseline-json PATH] [--forced-noaction-json PATH] [--out PATH]',
    ].join('\n') + '\n');
    process.exit(2);
}

function parseArgs(argv) {
    const options = {
        corpusPath: null,
        manifestPath: null,
        baselineJsonPath: null,
        forcedNoactionJsonPath: null,
        outPath: null,
    };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--solver-focus-manifest' && index + 1 < argv.length) {
            options.manifestPath = argv[++index];
        } else if (arg === '--baseline-json' && index + 1 < argv.length) {
            options.baselineJsonPath = argv[++index];
        } else if (arg === '--forced-noaction-json' && index + 1 < argv.length) {
            options.forcedNoactionJsonPath = argv[++index];
        } else if (arg === '--out' && index + 1 < argv.length) {
            options.outPath = argv[++index];
        } else if (arg === '--help' || arg === '-h') {
            usage();
        } else if (arg.startsWith('--')) {
            throw new Error(`Unsupported argument: ${arg}`);
        } else if (!options.corpusPath) {
            options.corpusPath = arg;
        } else {
            throw new Error(`Unexpected argument: ${arg}`);
        }
    }
    if (!options.corpusPath || !options.manifestPath) usage();
    return options;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const report = buildActionNoopCandidateReport(options);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.outPath) {
        fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
        fs.writeFileSync(options.outPath, json);
    } else {
        process.stdout.write(json);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    buildActionNoopCandidateReport,
    classificationForTarget,
};
