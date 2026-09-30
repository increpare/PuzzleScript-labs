#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
if (process.argv.length !== 4) throw Error('Usage: summarize_rule_goal_bench.js RESULTS_DIR OUTPUT_JSON');
const [directory, output] = process.argv.slice(2);
const read = name => fs.readFileSync(path.join(directory, name + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const survey = read('survey-0');
const pairs = [1, 2, 3].map(repeat => [read('auto-' + repeat), read('rule-goals-' + repeat)]);
const solved = row => row.status === 'solved' && row.elapsed_ms < 250;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = {
    schema: 1, deadline_ms: 250, source_level_indices: 'zero-based, including message entries',
    corpus_games: survey.length,
    eligible_games: survey.filter(r => r.supported).length,
    eligible_levels: survey.filter(r => r.supported).reduce((s, r) => s + r.levels, 0),
    portfolio_active_games: survey.filter(r => r.portfolio_active).length,
    portfolio_active_levels: survey.filter(r => r.portfolio_active).reduce((s, r) => s + r.levels, 0),
    total_ruleset_setup_ms: survey.reduce((s, r) => s + r.setup_ms, 0),
    maximum_ruleset_setup_ms: Math.max(...survey.map(r => r.setup_ms)),
    compaction_score_checks: survey.reduce((s, r) => s + r.score_checks, 0),
    pairs: pairs.map(([a, b]) => ({before: a.filter(solved).length, after: b.filter(solved).length})),
    consistent_gains: [], consistent_losses: [], cases: []
};
for (let i = 0; i < pairs[0][0].length; ++i) {
    const a = pairs.map(pair => pair[0][i]), b = pairs.map(pair => pair[1][i]);
    assert([...a, ...b].every(row => row.game === a[0].game && row.level === a[0].level));
    const project = rows => ({status: rows.map(r => r.status), elapsed_ms: rows.map(r => r.elapsed_ms),
        expanded: rows.map(r => r.expanded), generated: rows.map(r => r.generated),
        solution_length: rows.map(r => r.solution_length),
        heuristic_ms: rows.map(r => r.heuristic_ms), median_ms: median(rows.map(r => r.elapsed_ms))});
    const record = {game: a[0].game, level: a[0].level,
        profile: a[0].portfolio_profile, before: project(a), after: project(b)};
    summary.cases.push(record);
    if (a.every(r => !solved(r)) && b.every(solved)) summary.consistent_gains.push({game: record.game, level: record.level});
    if (a.every(solved) && b.every(r => !solved(r))) summary.consistent_losses.push({game: record.game, level: record.level});
}
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({...summary, cases: undefined}, null, 2));
