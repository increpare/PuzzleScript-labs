#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const compilerIndex = process.argv.indexOf('--compiler');
assert.ok(compilerIndex >= 0 && process.argv[compilerIndex + 1], 'Usage: node src/tests/compiled_rules_scheduling_node.js --compiler PATH');
const compiler = path.resolve(process.argv[compilerIndex + 1]);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-rule-scheduling-'));

function source(rules, wide = false) {
    const fillers = wide ? Array.from({ length: 68 }, (_, index) => `Filler${index}`) : [];
    return [
        'title Compiled Rule Scheduling', '', 'OBJECTS', '',
        'Background', 'black', '', 'Player', 'white', '',
        ...fillers.flatMap(name => [name, 'gray', '']),
        'A', 'red', '', 'B', 'blue', '', 'C', 'green', '', 'Mark', 'yellow', '',
        'LEGEND', '. = Background', 'P = Player', 'a = A', 'b = B', 'c = C', 'm = Mark', 'Thing = A or B', '',
        'SOUNDS', '', 'COLLISIONLAYERS', 'Background', 'Player', [...fillers, 'A', 'B', 'C'].join(', '), 'Mark', '',
        'RULES', rules, '', 'WINCONDITIONS', 'no A', '', 'LEVELS', 'Paabcm', '',
    ].join('\n');
}

function compile(name, rules, wide = false) {
    const game = path.join(directory, `${name}.txt`);
    const output = path.join(directory, `${name}.cpp`);
    fs.writeFileSync(game, source(rules, wide));
    const result = spawnSync(compiler, ['compile-rules', game, '--emit-cpp', output, '--max-rows', '99'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert.strictEqual(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
    return fs.readFileSync(output, 'utf8');
}

function body(text, name) {
    const start = text.indexOf(` ${name}(`);
    assert.notStrictEqual(start, -1, `Missing ${name}`);
    const open = text.indexOf('{', start);
    let depth = 1;
    for (let index = open + 1; index < text.length; ++index) {
        if (text[index] === '{') ++depth;
        if (text[index] === '}' && --depth === 0) return text.slice(open + 1, index);
    }
    throw new Error(`Unterminated ${name}`);
}

function phase(text) { return body(text, 'apply_early_groups_source_0'); }
function group(text) { return body(text, 'apply_group_s0_e_g0'); }
function rule(text) { return body(text, 'apply_rule_s0_e_g0_r0'); }
function syncCount(text) { return (text.match(/compiledRuleRebuildMasks\(session\)/g) || []).length; }

try {
    const singleton = compile('singleton', '[ A ] -> [ B ]');
    assert.ok(!group(singleton).includes('while ('), 'Independent singleton must run once');
    assert.ok(!rule(singleton).includes('matchIndex > 0'), 'Single-cell matches cannot invalidate other matches');
    assert.ok(singleton.includes('compiledRuleSetCellObjectsFromWords(session, tile, newObjects, created, destroyed)'), 'Generated setters must use existing arrays');
    assert.ok(!singleton.includes('compiledRuleSetCellObjectsWord1('), 'No allocating word-one setter');
    assert.ok(!body(singleton, 'match_s0_e_g0_r0_row0').includes('compiledRuleCellMovements'), 'Object-only predicate must not load movements');

    const independent = compile('independent', '[ A ] -> [ B ]\n[ Mark ] -> [ ]');
    assert.strictEqual(syncCount(phase(independent)), 2, 'Independent groups share initial and final mask synchronization');

    for (const wide of [false, true]) {
        const dependent = compile(wide ? 'wide-dependent' : 'dependent', '[ A ] -> [ B ]\n[ B ] -> [ C ]', wide);
        const p = phase(dependent);
        const first = p.indexOf('apply_rule_s0_e_g0_r0(session, commands)');
        const second = p.indexOf('apply_rule_s0_e_g1_r0(session, commands)');
        assert.ok(first >= 0 && second > first, 'Dependent groups keep authored order');
        assert.ok(p.slice(first, second).includes('compiledRuleRebuildMasks'), 'Cross-group dependency must flush masks');
        if (wide) assert.ok(dependent.includes('MaskWord newObjects[2]'), 'Exercise masks beyond the first object word');
    }

    const cosmetic = compile('cosmetic-row', '[ A | A ] -> [ A Mark | A Mark ]');
    assert.ok(!group(cosmetic).includes('while ('), 'Independent decorations need no rescan');
    assert.ok(!rule(cosmetic).includes('matchIndex > 0'), 'Decorations preserve overlapping matches');

    const invalidating = compile('invalidating-row', '[ A | A ] -> [ B | B ]');
    assert.ok(group(invalidating).includes('while ('), 'Invalidating rows retain conservative scheduling');
    assert.ok(rule(invalidating).includes('matchIndex > 0'), 'Overlapping invalidated matches must be rechecked');

    const enabling = compile('enabling-row', '[ A | B ] -> [ A | A ]');
    assert.ok(group(enabling).includes('while ('), 'New matches require another pass');

    const interacting = compile('interacting-group', '[ A ] -> [ B ]\n+ [ B ] -> [ A ]');
    assert.ok(group(interacting).includes('while ('), 'Self certificates do not prove cross-rule independence');

    const command = compile('command', '[ ] -> again');
    assert.ok(!rule(command).includes('matches_'), 'Unconditional command queues once without collecting cells');
    assert.ok(rule(command).includes('currentLevelWidth(session) <= 0'), 'Empty boards still do not match');
    assert.ok(rule(command).includes('CompiledRuleCommandKind::Again'), 'Keep command queue semantics');

    const random = compile('random', 'random [ A ] -> [ B ]');
    assert.ok(group(random).includes('compiledRuleApplyRandomGroup(session, session.game->rules[0], commands)'), 'Random groups keep runtime scheduling and a constant group index');

    const rigid = compile('rigid', 'rigid [ A | ] -> [ | A ]');
    assert.ok(phase(rigid).includes('bannedGroups == nullptr'), 'Rigid groups keep rollback and banning');
    const loop = compile('loop', 'startloop\n[ A ] -> [ B ]\nendloop');
    assert.ok(phase(loop).includes('loopPropagated'), 'Explicit loops keep loop-point propagation');
    const dynamic = compile('dynamic', '[ Thing ] -> [ B ]');
    assert.ok(group(dynamic).includes('while ('), 'Dynamic bindings are not certified');
    const ellipsis = compile('ellipsis', '[ A | ... | B ] -> [ B | ... | A ]');
    assert.ok(rule(ellipsis).includes('compiledRuleRowMatchStillMatches'), 'Ellipsis matches keep runtime rechecks');
    console.log('Compiled rule scheduling: 14 fixtures passed');
} finally {
    assert.strictEqual(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()), 'Only remove the isolated fixture directory');
    fs.rmSync(directory, { recursive: true, force: true });
}
