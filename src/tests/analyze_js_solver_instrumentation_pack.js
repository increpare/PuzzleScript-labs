#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { summarizeTotals } = require('./run_js_solver_instrumentation_pack');

function usage() {
    process.stderr.write(
        'Usage: node src/tests/analyze_js_solver_instrumentation_pack.js <summary.json> [--markdown PATH]\n',
    );
    process.exit(1);
}

function pct(part, whole) {
    if (!whole) return '0.0%';
    return `${((100 * part) / whole).toFixed(1)}%`;
}

function fmtMs(value) {
    return Number(value || 0).toFixed(3);
}

function analyzeSummary(summary) {
    const baseline = summary.configs && summary.configs.baseline
        ? summary.configs.baseline.totals
        : null;
    const stepProfile = summary.configs && summary.configs.step_profile
        ? summary.configs.step_profile.totals
        : null;
    const noopProbe = summary.configs && summary.configs.noop_probe
        ? summary.configs.noop_probe.totals
        : null;
    const cpuReady = summary.configs && summary.configs.cpu_profile_ready
        ? summary.configs.cpu_profile_ready.totals
        : null;

    const lines = [];
    lines.push('# JS solver instrumentation analysis');
    lines.push('');
    lines.push(`Corpus: \`${summary.corpus_dir}\``);
    lines.push(`Timeout: ${summary.timeout_ms}ms`);
    if (summary.game_filter) {
        lines.push(`Game filter: \`${summary.game_filter}\``);
    }
    lines.push('');

    if (baseline) {
        lines.push('## Baseline');
        lines.push('');
        lines.push(`- solved: ${baseline.solved}/${baseline.levels}`);
        lines.push(`- expanded per solved: ${baseline.expanded_per_solved.toFixed(1)}`);
        lines.push(`- step cost: ${baseline.us_per_step.toFixed(2)} µs/step`);
        lines.push(`- no-op steps: ${baseline.step_no_op_pct.toFixed(1)}%`);
        lines.push(`- heuristic split: score ${fmtMs(baseline.heuristic_score_ms)} ms, classify ${fmtMs(baseline.heuristic_classify_ms)} ms`);
        lines.push('');
    }

    if (stepProfile && baseline) {
        const ruleTotal = stepProfile.step_profile_rule_match_ms + stepProfile.step_profile_rule_apply_ms;
        lines.push('## Step profile');
        lines.push('');
        lines.push(`- early rules: ${fmtMs(stepProfile.step_profile_early_rules_ms)} ms (${pct(stepProfile.step_profile_early_rules_ms, stepProfile.step_ms)})`);
        lines.push(`- rule match: ${fmtMs(stepProfile.step_profile_rule_match_ms)} ms (${pct(stepProfile.step_profile_rule_match_ms, stepProfile.step_ms)})`);
        lines.push(`- rule apply: ${fmtMs(stepProfile.step_profile_rule_apply_ms)} ms (${pct(stepProfile.step_profile_rule_apply_ms, stepProfile.step_ms)})`);
        lines.push(`- match+apply: ${fmtMs(ruleTotal)} ms (${pct(ruleTotal, stepProfile.step_ms)})`);
        lines.push(`- movement: ${fmtMs(stepProfile.step_profile_movement_ms)} ms`);
        lines.push(`- command queue: ${fmtMs(stepProfile.step_profile_command_ms)} ms`);
        lines.push(`- win check: ${fmtMs(stepProfile.step_profile_win_ms)} ms`);
        lines.push(`- solve parity vs baseline: ${stepProfile.solved} vs ${baseline.solved}`);
        lines.push('');
    }

    if (noopProbe) {
        lines.push('## No-op probe');
        lines.push('');
        lines.push(`- direction steps probed: ${noopProbe.probe_dir_steps}`);
        lines.push(`- actual no-ops: ${noopProbe.probe_noops}`);
        lines.push(`- blocked-target predicate fires: ${noopProbe.probe_blocked}`);
        lines.push(`- false positives (blocked but changed): ${noopProbe.probe_blocked_changed}`);
        lines.push(`- true blocked no-ops: ${noopProbe.probe_blocked_noop}`);
        if (noopProbe.probe_blocked > 0) {
            lines.push(
                `- false-positive rate: ${pct(noopProbe.probe_blocked_changed, noopProbe.probe_blocked)}`,
            );
        }
        lines.push('');
    }

    if (cpuReady && baseline) {
        lines.push('## CPU-profile-ready run');
        lines.push('');
        lines.push(`- solved: ${cpuReady.solved} (baseline ${baseline.solved})`);
        lines.push(`- step cost: ${cpuReady.us_per_step.toFixed(2)} µs/step (baseline ${baseline.us_per_step.toFixed(2)} µs/step)`);
        lines.push('- detail timing disabled; pair with `node --cpu-prof` on the same args.');
        lines.push('');
    }

    const configs = Object.entries(summary.configs || {})
        .map(([id, row]) => ({
            id,
            label: row.label || id,
            expanded_per_solved: row.totals.expanded_per_solved,
            solved: row.totals.solved,
        }))
        .sort((a, b) => a.expanded_per_solved - b.expanded_per_solved);
    if (configs.length > 1) {
        lines.push('## Expanded-per-solved ranking');
        lines.push('');
        for (const row of configs) {
            lines.push(`- ${row.label}: ${row.expanded_per_solved.toFixed(1)} (${row.solved} solved)`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function main() {
    const summaryPath = process.argv[2];
    if (!summaryPath) usage();
    const markdownPath = process.argv.includes('--markdown')
        ? path.resolve(process.argv[process.argv.indexOf('--markdown') + 1])
        : null;
    const summary = JSON.parse(fs.readFileSync(path.resolve(summaryPath), 'utf8'));
    const report = analyzeSummary(summary);
    process.stdout.write(`${report}\n`);
    if (markdownPath) {
        fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
        fs.writeFileSync(markdownPath, `${report}\n`);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    analyzeSummary,
    pct,
};
