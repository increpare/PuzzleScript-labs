#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const index = process.argv.indexOf('--compiler');
assert.ok(index >= 0 && process.argv[index + 1], 'Usage: node compiled_solver_profiles_node.js --compiler PATH');
const compiler = path.resolve(process.argv[index + 1]);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-solver-profile-'));
const source = [
    'title Solver Profile', '', 'OBJECTS', '', 'Background .', 'black', '', 'Player P', 'white', '',
    'Target T', 'green', '', 'Decoration', 'red', '', 'LEGEND', '', 'SOUNDS', '', 'COLLISIONLAYERS',
    'Background', 'Player', 'Target', 'Decoration', '', 'RULES', '[ Player ] -> [ Player Decoration ]', '',
    'WINCONDITIONS', 'all Player on Target', '', 'LEVELS', 'P.T', '',
].join('\n');
function run(args, expected = 0) {
    const result = spawnSync(compiler, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert.strictEqual(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result;
}
try {
    const game = path.join(directory, 'game.txt'), hints = path.join(directory, 'hints.json');
    fs.writeFileSync(game, source);
    const line = source.split('\n').indexOf('[ Player ] -> [ Player Decoration ]') + 1;
    const report = { status: 'ok', ps_tagged: { rule_sections: [{ groups: [{ rules: [{ id: 'rule', source_line: line }] }] }] },
        facts: { win_relevance: [{ id: 'win_relevance', status: 'proved', value: { irrelevant_rule_ids: ['rule'] } }] } };
    const writeHints = () => fs.writeFileSync(hints, JSON.stringify({ games: { 'game.txt': report } }));
    writeHints();
    const single = path.join(directory, 'profile.cpp');
    run(['compile-rules', game, '--emit-cpp', single, '--solver-static-analysis-hints', hints]);
    let text = fs.readFileSync(single, 'utf8');
    assert.ok(text.includes('ps_solver_compiled_rules_find_profile'));
    assert.ok(text.includes('removed[] = {0U, 0U, 0U}'));
    assert.ok(text.includes('ps_specialized_rulegroups_find_backend'), 'Keep the ordinary player backend');
    const profileText = () => fs.readFileSync(single, 'utf8').split('namespace ps_solver_profiles {')[1];
    assert.ok(!profileText().includes('ps_specialized_rulegroups_find_backend'), 'Solver profiles must not register as player backends');
    assert.ok(!profileText().includes('bool apply_rule_s0_e_g0_r0('), 'Prune before generating solver rules');
    assert.ok(text.split('namespace ps_solver_profiles {')[0].includes('bool apply_rule_s0_e_g0_r0('), 'Preserve the cosmetic rule for players');
    const shards = path.join(directory, 'shards'), list = path.join(directory, 'sources.txt');
    run(['compile-rules', game, '--emit-cpp-dir', shards, '--emit-sources-list', list, '--solver-static-analysis-hints', hints]);
    text = fs.readFileSync(path.join(shards, 'solver_profile_registry.cpp'), 'utf8');
    assert.ok(text.includes('ps_solver_compiled_rules_find_profile'));
    assert.ok(!text.includes('ps_specialized_rulegroups_find_backend'));
    assert.ok(fs.readFileSync(list, 'utf8').includes('solver_profile_'));
    assert.ok(fs.readFileSync(list, 'utf8').includes('source_'));
    assert.ok(fs.existsSync(path.join(shards, 'registry.cpp')));
    const unchanged = run(['compile-rules', game, '--emit-cpp-dir', shards, '--emit-sources-list', list, '--solver-static-analysis-hints', hints]);
    assert.ok(unchanged.stderr.includes('wrote=0'), 'Unchanged combined generation must preserve file timestamps');
    const lineCap = run(['compile-rules', game, '--emit-cpp-dir', shards, '--emit-sources-list', list,
        '--solver-static-analysis-hints', hints, '--max-generated-lines-per-source', '200000']);
    assert.ok(lineCap.stderr.includes('groups=1 rules=1'), 'A line cap alone must not invent a zero compiled-rule cap');
    report.facts.win_relevance[0].status = 'candidate'; writeHints();
    run(['compile-rules', game, '--emit-cpp', single, '--solver-static-analysis-hints', hints]);
    assert.ok(!profileText().includes('case '), 'Candidate proofs cannot create a pruning profile');
    report.facts.win_relevance[0].status = 'proved';
    report.ps_tagged.rule_sections[0].groups[0].rules.push({ id: 'relevant-expansion', source_line: line });
    writeHints();
    run(['compile-rules', game, '--emit-cpp', single, '--solver-static-analysis-hints', hints]);
    assert.ok(!profileText().includes('case '), 'Every expansion of a pruned source line must be irrelevant');
    report.ps_tagged.rule_sections[0].groups[0].rules.pop();
    report.facts.win_relevance[0].value.irrelevant_rule_ids = ['missing']; writeHints();
    run(['compile-rules', game, '--emit-cpp', single, '--solver-static-analysis-hints', hints]);
    assert.ok(!profileText().includes('case '), 'Unmapped rule ids fail closed');
    run(['compile-rules', game, '--emit-cpp', single, '--solver-static-analysis-hints', hints,
        '--emit-runtime-ir-cache', path.join(directory, 'unsafe.json')], 1);
    assert.ok(!fs.existsSync(path.join(directory, 'unsafe.json')), 'Pruned metadata must not masquerade as an ordinary runtime cache');
    console.log('Compiled solver profiles: generation, proof gates and registry isolation passed');
} finally {
    assert.strictEqual(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
}
