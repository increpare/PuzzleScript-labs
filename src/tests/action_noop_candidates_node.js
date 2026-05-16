#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const {
    buildActionUnnecessaryCandidateReport,
    classificationForTarget,
} = require('./report_action_noop_candidates');

const report = buildActionUnnecessaryCandidateReport({
    corpusPath: path.join(__dirname, 'solver_tests'),
    manifestPath: path.join(__dirname, 'solver_focus_group.json'),
});

assert.strictEqual(report.summary.target_count, 50);
assert.ok(report.summary.proved_insertable_games >= 4, 'focus report should find games where noaction can be inserted');
assert.ok(report.summary.rejected_candidate_targets > 0, 'focus report should expose rejected candidate targets to vet');

const dollyban = report.targets.find(target => target.game === 'dollyban.txt' && target.level === 3);
assert.ok(dollyban, 'report should include dollyban focus target');
assert.strictEqual(dollyban.action_unnecessary.status, 'proved');
assert.strictEqual(dollyban.classification, 'proved_insertable');

const elephant = report.targets.find(target => target.game === 'Put the logs in the water, elephant.txt' && target.level === 7);
assert.ok(elephant, 'report should include elephant focus target');
assert.strictEqual(elephant.action_unnecessary.status, 'rejected');
assert.ok(elephant.hypotheses.includes('direct_action_reader_requires_runtime_or_level_proof'));
assert.ok(elephant.blocker_rules.some(rule => rule.reasons.includes('reads_action')));

assert.strictEqual(
    classificationForTarget(false, { status: 'rejected' }, [], {
        baseline_status: 'solved',
        forced_status: 'solved',
    }),
    'runtime_vetted_target_solved',
    'A/B forced-noaction solving should classify a rejected static proof as target-vetted',
);
assert.strictEqual(
    classificationForTarget(false, { status: 'rejected' }, [], {
        baseline_status: 'solved',
        forced_status: 'timeout',
    }),
    'rejected',
    'runtime-vetted target classification should require the forced-noaction target to solve',
);
assert.strictEqual(
    classificationForTarget(false, { status: 'rejected' }, ['only_autonomous_object_mutation'], {
        baseline_status: 'solved',
        forced_status: 'solved',
    }),
    'candidate_autonomous_object_mutation',
    'pure autonomous mutation should remain a wait-button candidate instead of being promoted by one solved target',
);

process.stdout.write('action_unnecessary_candidates_node: ok\n');
