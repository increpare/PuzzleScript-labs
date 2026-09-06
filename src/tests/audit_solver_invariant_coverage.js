#!/usr/bin/env node
'use strict';

// Static coverage survey, not an optimizer or a performance benchmark.
// Usage from repository root: node src/tests/audit_solver_invariant_coverage.js [output.json]
// Keep per-source hashes and per-level eligibility so a future consumer can be
// measured against the same inputs. A fact's presence does not prove that using
// it is cheap, nor that a candidate projection preserves every runtime mode.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { execFileSync } = require('child_process');
const { analyzeFile, discoverInputFiles } = require('./ps_static_analysis');
const outputPath = process.argv[2] || 'build/solver-invariant-coverage.json';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();

const rows = [];
const started = performance.now();
const files = discoverInputFiles(['src/tests/solver_tests']);
for (const file of files) {
    const start = performance.now();
    const r = analyzeFile(file);
    const row = { file: path.relative(process.cwd(), file).replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), status: r.status, analysisMs: performance.now() - start };
    if (r.status === 'ok') {
        const p = r.ps_tagged;
        const f = r.facts;
        const objects = p.objects;
        const levels = p.levels.filter(l => l.kind === 'level');
        const rules = p.rule_sections.flatMap(s => s.groups.flatMap(g => g.rules));
        const dynamic = objects.filter(o => !o.tags.static);
        const projection = f.solver_hash_projection[0]?.value;
        const relevant = f.win_relevance[0]?.value;
        const action = f.movement_action.find(f => f.id === 'action_unnecessary');
        row.objects = objects.length;
        row.rules = rules.length;
        row.levels = levels.length;
        row.staticObjects = objects.filter(o => o.tags.static).length;
        row.dynamicConstantCountObjects = dynamic.filter(o => o.tags.quantity.never_increases && o.tags.quantity.never_decreases).map(o => o.name);
        row.dynamicOneWayCountObjects = dynamic.filter(o => o.tags.quantity.never_increases !== o.tags.quantity.never_decreases).map(o => o.name);
        row.linearSums = f.linear_count_invariants.filter(f => f.status === 'proved').map(f => f.value.objects);
        row.transientObjects = f.transient_boundary.filter(f => f.status === 'proved').flatMap(f => f.subjects.objects);
        row.actionUnnecessary = action?.status === 'proved';
        row.actionAlreadyDisabled = !p.game.tags.has_action_input;
        row.random = p.game.tags.has_random;
        row.rigid = p.game.tags.has_rigid;
        row.again = p.game.tags.has_again;
        row.projectionObjects = projection?.projected_objects || [];
        row.projectionBlockers = projection?.blockers || [];
        row.mergeCandidates = f.mergeability.filter(f => f.status === 'candidate').length;
        row.irrelevantRules = relevant?.irrelevant_rule_ids.length || 0;
        row.movementRootRules = relevant?.movement_root_rule_ids.length || 0;
        row.collisionRootRules = relevant?.movement_collision_root_rule_ids.length || 0;
        row.singlePassGroups = f.rulegroup_flow.filter(f => f.value.single_pass_safe).length;
        row.multiRuleGroups = f.rulegroup_flow.length;
        row.perLevelAbsent = f.per_level_object_universe.map(f => ({ level: f.value.level_index, absent: f.value.unreachable_objects, dynamicAbsent: f.value.unreachable_objects.filter(n => dynamic.some(o => o.name === n)), jsWordsBefore: Math.ceil(objects.length / 32), jsWordsAfter: Math.ceil(f.value.reachable_objects.length / 32), native64WordsBefore: Math.ceil(objects.length / 64), native64WordsAfter: Math.ceil(f.value.reachable_objects.length / 64) }));
    } else {
        row.errors = r.errors || r.diagnostics || null;
    }
    rows.push(row);
    if (rows.length % 20 === 0) console.log(`Analyzed ${rows.length}/${files.length}`);
}
const ok = rows.filter(r => r.status === 'ok');
const levels = ok.flatMap(r => r.perLevelAbsent);
const count = fn => ok.filter(fn).length;
const result = {
    schema: 'invariant-consumer-survey-v1',
    revision,
    scope: 'Bundled src/tests/solver_tests; static coverage only, not runtime validation or a speed benchmark. Word counts assume all impossible object IDs can be removed and remapped; eligibility upper bound only.',
    elapsedMs: performance.now() - started,
    totals: {
        sources: rows.length, ok: ok.length, other: rows.length-ok.length,
        levels: levels.length,
        gamesWithStaticObjects: count(r => r.staticObjects > 0),
        gamesWithDynamicConservedCounts: count(r => r.dynamicConstantCountObjects.length > 0),
        gamesWithOneWayCounts: count(r => r.dynamicOneWayCountObjects.length > 0),
        gamesWithLinearSums: count(r => r.linearSums.length > 0),
        gamesWithTransientObjects: count(r => r.transientObjects.length > 0),
        gamesWithActionUnnecessary: count(r => r.actionUnnecessary),
        gamesWithNewActionElimination: count(r => r.actionUnnecessary && !r.actionAlreadyDisabled),
        gamesWithUnblockedCosmeticProjection: count(r => r.projectionObjects.length > 0 && !r.projectionBlockers.length),
        gamesWithMergeCandidates: count(r => r.mergeCandidates > 0),
        gamesWithIrrelevantRules: count(r => r.irrelevantRules > 0),
        irrelevantRules: ok.reduce((n,r) => n+r.irrelevantRules,0),
        gamesWithPerLevelAbsentObjects: count(r => r.perLevelAbsent.some(l => l.absent.length)),
        levelsWithAbsentObjects: levels.filter(l => l.absent.length).length,
        levelsWithDynamicAbsentObjects: levels.filter(l => l.dynamicAbsent.length).length,
        levelsPotentiallyReducingJsWords: levels.filter(l => l.jsWordsAfter < l.jsWordsBefore).length,
        levelsPotentiallyReducingNative64Words: levels.filter(l => l.native64WordsAfter < l.native64WordsBefore).length,
        singlePassGroups: ok.reduce((n,r) => n+r.singlePassGroups,0),
        multiRuleGroups: ok.reduce((n,r) => n+r.multiRuleGroups,0)
    },
    rows
};
fs.mkdirSync(path.dirname(outputPath), {recursive:true});
fs.writeFileSync(outputPath, JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.totals,null,2));
