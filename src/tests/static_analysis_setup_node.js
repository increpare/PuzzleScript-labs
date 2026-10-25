#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { analyzeSource } = require('./ps_static_analysis');

function game(rules, options = {}) {
    return [
        'title Setup rule analysis', options.metadata || '',
        '========', 'OBJECTS', '========',
        'Background', 'black', '', 'Player', 'white', '',
        'Floor', 'gray', '', 'Mark', 'red', '', 'Other', 'blue', '',
        'Seed', 'yellow', '', 'Stage', 'orange', '', 'Crate', 'green', '',
        'Target', 'pink', '',
        '========', 'LEGEND', '========',
        '. = Background', 'P = Player', 'F = Floor', 'M = Mark', 'O = Other',
        'S = Seed', 'G = Stage', 'C = Crate', 'T = Target',
        'Alias = Floor', 'Choice = Mark or Other', options.legend || '',
        '========', 'SOUNDS', '========',
        '================', 'COLLISIONLAYERS', '================',
        'Background', options.actorLayer || 'Player, Crate',
        'Floor', 'Mark, Other', 'Seed', 'Stage', 'Target',
        '========', 'RULES', '========', rules,
        '=============', 'WINCONDITIONS', '=============', 'Some Player on Target',
        '========', 'LEVELS', '========', options.levels || 'PFSC...', '',
    ].join('\n');
}

function rulesOf(report) {
    return report.ps_tagged.rule_sections.flatMap(section => section.groups.flatMap(group => group.rules));
}

const tagNames = ['self_disabling', 'persistent_guard', 'idempotent_effect', 'setup_only'];
let checks = 0;
const cases = [
    ['guarded marker', '[ floor no mark ] -> [ floor mark ]', [true, true, true, true]],
    ['unguarded marker', '[ floor ] -> [ floor mark ]', [false, true, true, true]],
    ['consumed seed', '[ seed ] -> [ stage ]', [true, true, true, true]],
    ['erased seed', '[ seed ] -> [ ]', [true, true, true, true]],
    ['implicit layer replacement', '[ mark ] -> [ other ]', [true, true, true, true]],
    ['identity', '[ floor ] -> [ floor ]', [false, false, true, false]],
    ['command-only identity', '[ floor ] -> sfx0', [false, false, false, false]],
    ['moving eligibility', '[ player no mark ] -> [ player mark ]', [true, true, true, false]],
    ['moving unguarded eligibility', '[ player ] -> [ player mark ]', [false, true, true, false]],
    ['movable consumed seed', '[ crate ] -> [ stage ]\n[ > player | crate ] -> [ > player | > crate ]', [true, true, true, false]],
    ['explicit marker erasure', '[ floor no mark ] -> [ floor mark ]\nlate [ mark ] -> [ ]', [true, false, true, false]],
    ['unguarded marker erasure', '[ floor ] -> [ floor mark ]\nlate [ mark ] -> [ ]', [false, false, true, false]],
    ['implicit marker overwrite', '[ floor no mark ] -> [ floor mark ]\n[ action player ] [ mark ] -> [ player ] [ other ]', [true, false, true, false]],
    ['unguarded marker overwrite', '[ floor ] -> [ floor mark ]\n[ action player ] [ ] -> [ player ] [ other ]', [false, false, true, false]],
    ['cardinal marker movement', '[ floor no mark ] -> [ floor mark ]\n[ mark ] -> [ > mark ]', [true, false, true, false]],
    ['randomdir marker movement', '[ floor no mark ] -> [ floor mark ]\n[ mark ] -> [ randomdir mark ]', [true, false, true, false]],
    ['marker relocation', '[ floor no mark ] -> [ floor mark ]\nright [ mark | ] -> [ | mark ]', [true, false, true, false]],
    ['seed recreation', '[ seed ] -> [ stage ]\n[ action player ] -> [ player seed ]', [true, true, true, false]],
    ['recreated seed and removable output', '[ seed ] -> [ stage ]\n[ action player ] -> [ player seed ]\nlate [ stage ] -> [ ]', [true, false, true, false]],
    ['dynamic anchor creation', '[ floor no mark ] -> [ floor mark ]\n[ action player ] -> [ player floor ]', [true, true, true, false]],
    ['dynamic negative eligibility', '[ floor no stage no mark ] -> [ floor mark ]\n[ action player stage ] -> [ player ]', [true, true, true, false]],
    ['static negative eligibility', '[ floor no target no mark ] -> [ floor mark ]', [true, true, true, true]],
    ['wrong cell guard', 'right [ floor no mark | floor ] -> [ floor | floor mark ]', [false, true, true, false]],
    ['adjacent fixed anchors', 'right [ floor | floor no mark ] -> [ floor | floor mark ]', [true, true, true, true]],
    ['adjacent unguarded effect', 'right [ floor | floor ] -> [ floor mark | floor ]', [false, true, true, true]],
    ['self propagating effect', 'right [ stage | no stage ] -> [ stage | stage ]', [true, true, false, false]],
    ['self propagating unguarded effect', 'right [ stage | ] -> [ stage | stage ]', [false, true, false, false]],
    ['multiple independent rows', '[ floor ] [ no mark ] -> [ floor ] [ mark ]', [false, false, false, false]],
    ['ellipsis', 'right [ floor | ... | no mark ] -> [ floor | ... | mark ]', [false, false, false, false]],
    ['synonym anchor', '[ alias no mark ] -> [ alias mark ]', [true, true, true, true]],
    ['ambiguous property guard', '[ floor no choice ] -> [ floor mark ]', [false, false, false, false]],
    ['random object write', '[ floor ] -> [ floor random choice ]', [false, false, false, false]],
    ['random group', 'random [ floor no mark ] -> [ floor mark ]', [true, true, false, false]],
    ['rigid rule', 'rigid [ floor no mark ] -> [ floor mark ]', [true, true, false, false]],
    ['movement requirement', '[ action player no mark ] -> [ player mark ]', [false, false, false, false]],
    ['stationary requirement', '[ stationary floor no mark ] -> [ floor mark ]', [false, false, false, false]],
    ['movement effect', '[ floor no mark ] -> [ floor > mark ]', [false, false, false, false]],
    ['sound command', '[ floor no mark ] -> [ floor mark ] sfx0', [true, true, false, false]],
    ['again command', '[ floor no mark ] -> [ floor mark ] again', [true, true, false, false]],
    ['cancel command', '[ floor no mark ] -> [ floor mark ] cancel', [true, true, false, false]],
    ['restart command', '[ floor no mark ] -> [ floor mark ] restart', [true, true, false, false]],
    ['win command', '[ floor no mark ] -> [ floor mark ] win', [true, true, false, false]],
    ['checkpoint command', '[ floor no mark ] -> [ floor mark ] checkpoint', [true, true, false, false]],
    ['late setup', 'late [ floor no mark ] -> [ floor mark ]', [true, true, true, true]],
    ['no initial anchors', '[ floor no mark ] -> [ floor mark ]', [true, true, true, true], { levels: 'P......' }],
    ['prepopulated board', '[ floor no mark ] -> [ floor mark ]', [true, true, true, true], { levels: 'PMF....' }],
    ['level start metadata', '[ floor no mark ] -> [ floor mark ]', [true, true, true, true], { metadata: 'run_rules_on_level_start' }],
    ['partial persistent effects', '[ floor ] -> [ floor mark stage ]\nlate [ stage ] -> [ ]', [false, true, true, false]],
    ['persistent guard with temporary extra effect', '[ floor no mark ] -> [ floor mark stage ]\nlate [ stage ] -> [ ]', [true, true, true, true]],
    ['cosmetic eraser still interferes', '[ floor no mark ] -> [ floor mark ]\n[ mark ] -> [ ]', [true, false, true, false]],
    ['consumption with dynamic extra guard', '[ seed no mark ] -> [ mark ]\nlate [ mark ] -> [ ]', [true, true, true, false]],
    ['player marker role', '[ floor no player ] -> [ floor player ]', [true, false, true, false]],
    ['explicit stationary output', '[ floor ] -> [ floor stationary mark ]', [false, true, true, true]],
    ['permanent deletion with moving output', '[ seed ] -> [ mark ]\n[ mark ] -> [ > mark ]', [true, true, true, true]],
    ['negative-only saturation', '[ floor ] -> [ floor no mark ]', [false, true, true, true]],
    ['negative saturation reopens', '[ floor ] -> [ floor no mark ]\n[ action player ] -> [ player mark ]', [false, false, true, false]],
    ['reversible anchor deletion', '[ floor no mark ] -> [ floor mark ]\n[ action player floor ] -> [ player ]', [true, true, true, false]],
    ['overlapping consumed tuples', 'right [ seed | seed ] -> [ stage | stage ]', [true, true, true, true]],
    ['two permanent guards', '[ floor no mark no stage ] -> [ floor mark stage ]', [true, true, true, true]],
    ['one permanent guard and one static negative', '[ floor no mark no target ] -> [ floor mark ]', [true, true, true, true]],
    ['rigid group companion', '[ floor no mark ] -> [ floor mark ]\n+ rigid [ > player ] -> [ > player ]', [true, true, false, false]],
    ['inherited layer movement', '[ other ] -> [ mark ]\n[ other ] -> [ right other ]', [true, false, true, false]],
    ['movement carried by layer sibling', '[ floor no mark ] -> [ floor mark ]\n[ other ] -> [ right other ]', [true, false, true, false]],
    ['unguarded output clears action', '[ floor ] -> [ floor mark ]\n[ mark ] -> [ action mark ]', [false, true, true, false]],
    ['unguarded preserved object clears action', '[ floor seed ] -> [ floor stationary seed mark ]\n[ seed ] -> [ action seed ]', [false, true, true, false]],
    ['guarded output with action state', '[ floor no mark ] -> [ floor mark ]\n[ mark ] -> [ action mark ]', [true, true, true, true]],
];

for (const [name, sourceRules, expected, options] of cases) {
    const report = analyzeSource(game(sourceRules, options), { sourcePath: `setup:${name}` });
    assert.strictEqual(report.status, 'ok', `${name}: ${JSON.stringify(report.errors)}`);
    const rule = rulesOf(report)[0];
    for (const [index, tag] of tagNames.entries()) {
        assert.strictEqual(rule.tags[tag], expected[index], `${name}: ${tag}`);
        checks++;
    }
}

{
    const source = game('[ floor no mark ] -> [ floor mark ]')
        .replaceAll('Player', 'Hero').replace('Alias = Floor', 'Player = Crate or Mark\nAlias = Floor');
    const report = analyzeSource(source);
    assert.strictEqual(report.status, 'ok');
    assert.strictEqual(rulesOf(report)[0].tags.persistent_guard, false, 'player property members receive input movement');
    assert.strictEqual(rulesOf(report)[0].tags.setup_only, false);
    checks += 3;
}

// Dependency proofs must be independent of source ordering and family filters.
for (const sourceRules of [
    '[ floor ] -> [ floor stage ]\n[ stage no mark ] -> [ stage mark ]',
    '[ stage no mark ] -> [ stage mark ]\n[ floor ] -> [ floor stage ]',
]) {
    const source = game(sourceRules);
    for (const familyFilter of [undefined, 'rule_setup', 'count_layer_invariants', 'mergeability']) {
        const report = analyzeSource(source, { familyFilter });
        assert.strictEqual(report.status, 'ok');
        for (const rule of rulesOf(report)) {
            assert.strictEqual(rule.tags.setup_only, true, `setup dependency ${rule.source_line}`);
            checks++;
        }
        if (familyFilter === undefined || familyFilter === 'rule_setup') {
            const certs = report.facts.rule_setup;
            assert.strictEqual(certs.length, 2);
            const dependent = certs.find(cert => cert.subjects.rules.some(id => {
                const rule = rulesOf(report).find(item => item.id === id);
                return rule.tags.objects_matched.includes('Stage');
            }));
            assert.strictEqual(dependent.status, 'proved');
            assert.strictEqual(dependent.value.setup_dependencies.length, 1);
            assert.strictEqual(dependent.value.retirement, 'after_setup_quiescence');
            assert.strictEqual(dependent.value.scope, 'forward_play_between_state_restorations');
            checks += 4;
        }
    }
}

// A mutually dependent monotone cycle is deliberately left unproved.
{
    const report = analyzeSource(game('[ stage ] -> [ stage seed ]\n[ seed ] -> [ seed stage ]'));
    for (const rule of rulesOf(report)) {
        assert.strictEqual(rule.tags.setup_only, false);
        checks++;
    }
}

// Explain failures with the actual interfering rule, not a bare false tag.
{
    const report = analyzeSource(game('[ floor no mark ] -> [ floor mark ]\nlate [ mark ] -> [ ]'));
    const [setup, clearer] = rulesOf(report);
    const cert = report.facts.rule_setup.find(item => item.subjects.rules.includes(setup.id));
    assert.strictEqual(cert.status, 'rejected');
    assert.ok(cert.blockers.includes('no_persistent_retirement_condition'));
    assert.ok(cert.evidence.includes(clearer.id));
    assert.deepStrictEqual(cert.value.guards, [{ row: 0, cell: 0, object: 'Mark', present: true, persistent: false }]);
    checks += 4;
}

// A longer dependency chain must settle in dependency order, even when source
// order is reversed and dependencies have both positive and negative effects.
{
    const report = analyzeSource(game('[ stage no mark ] -> [ stage mark ]\n[ floor no seed ] -> [ floor stage ]\n[ seed ] -> [ ]'));
    assert.ok(rulesOf(report).every(rule => rule.tags.setup_only));
    assert.strictEqual(report.facts.rule_setup[0].value.setup_dependencies.length, 1);
    assert.strictEqual(report.facts.rule_setup[1].value.setup_dependencies.length, 1);
    checks += 3;
}

// Proven facts and tag-only requests use exactly the same derivation.
{
    const source = game('[ floor no mark ] -> [ floor mark ]');
    const report = analyzeSource(source);
    const fact = report.facts.rule_setup[0];
    assert.strictEqual(fact.status, 'proved');
    assert.deepStrictEqual(tagNames.map(name => fact.tags[name]), [true, true, true, true]);
    assert.deepStrictEqual(fact.value.guards, [{ row: 0, cell: 0, object: 'Mark', present: true, persistent: true }]);
    assert.deepStrictEqual(fact.blockers, []);
    assert.ok(fact.proof.includes('retirement_requires_committed_setup_quiescence'));
    assert.deepStrictEqual(analyzeSource(source, { includePsTagged: false }).facts.rule_setup, report.facts.rule_setup);
    const invalid = analyzeSource('invalid source');
    assert.strictEqual(invalid.status, 'compile_error');
    assert.deepStrictEqual(invalid.facts.rule_setup, []);
    checks += 8;
}

// Real matcher/replacer checks over all 1,728 three-cell configurations of
// Floor x Seed x (empty/Mark/Other), with and without transient movement. They exercise overlapping tuples, optional
// occupants, implicit overwrites, inferred stationary writes, and consumed LHS.
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');
if (typeof global.compile !== 'function') loadPuzzleScript();
global.unitTesting = false;
global.lazyFunctionGeneration = false;

function compileGame(source) {
    global.errorCount = 0;
    global.errorStrings = [];
    global.levelString = source;
    compile(['loadLevel', 0], source, 'setup-test');
    assert.strictEqual(errorCount, 0, errorStrings.join('\n'));
}

function countObject(name) {
    const id = state.objects[name.toLowerCase()].id;
    let count = 0;
    for (let cell = 0; cell < level.n_tiles; cell++) count += Number(level.getCell(cell).get(id));
    return count;
}

let enumeratedBoards = 0;
for (const text of [
    '[ floor no mark ] -> [ floor mark ]',
    '[ floor ] -> [ floor mark ]',
    '[ seed ] -> [ stage ]',
    '[ seed ] -> [ ]',
    'right [ floor | floor no mark ] -> [ floor | floor mark ]',
    'right [ floor no mark | floor ] -> [ floor | floor mark ]',
    'right [ mark | mark ] -> [ other | other ]',
    '[ floor mark ] -> [ floor ]',
    '[ floor ] -> [ floor no mark ]',
    '[ floor seed ] -> [ floor stationary seed mark ]',
]) {
    const source = game(text, { levels: 'P..' });
    const analyzed = rulesOf(analyzeSource(source))[0];
    assert.strictEqual(analyzed.tags.idempotent_effect, true, text);
    compileGame(source);
    const rule = state.rules[0][0];
    const delta = ({ 1: -1, 2: 1, 4: -level.height, 8: level.height })[rule.direction];
    for (let encoding = 0; encoding < 2 * 12 ** 3; encoding++) {
        level.objects.fill(0);
        level.movements.fill(0);
        let remaining = encoding;
        for (let cell = 0; cell < 3; cell++) {
            const variant = remaining % 12;
            remaining = Math.floor(remaining / 12);
            const objects = new BitVec(STRIDE_OBJ);
            objects.ibitset(state.objects.background.id);
            if (variant & 1) objects.ibitset(state.objects.floor.id);
            if (variant & 2) objects.ibitset(state.objects.seed.id);
            const marker = Math.floor(variant / 4);
            if (marker > 0) objects.ibitset(state.objects[marker === 1 ? 'mark' : 'other'].id);
            level.setCell(cell, objects);
            if (encoding >= 12 ** 3) {
                const movements = new BitVec(STRIDE_MOV);
                if (variant & 2) movements.ishiftor(0x10, 5 * state.objects.seed.layer);
                if (marker > 0) movements.ishiftor(0x08, 5 * state.objects.mark.layer);
                level.setMovements(cell, movements);
            }
        }
        state.calculateRowColMasks(level);
        const matches = Array.from(rule.findMatches(level)[0] || []);
        if (matches.length > 0 && analyzed.tags.self_disabling) {
            rule.applyAt(level, [matches[0]], false, delta);
            state.calculateRowColMasks(level);
            assert.ok(!Array.from(rule.findMatches(level)[0] || []).includes(matches[0]), `${text}: own tuple remains enabled on board ${encoding}`);
            checks++;
        }
        rule.tryApply(level);
        const objectsAfter = Array.from(level.objects);
        const movementsAfter = Array.from(level.movements);
        rule.tryApply(level);
        assert.deepStrictEqual(Array.from(level.objects), objectsAfter, `${text}: second invocation changes board ${encoding}`);
        assert.deepStrictEqual(Array.from(level.movements), movementsAfter, `${text}: second invocation changes movement ${encoding}`);
        checks += 2;
        enumeratedBoards++;
    }
}

// Clearing transient action can remain useful after every object has settled.
// Suppressing the suspected rule is intentionally a counterexample probe only.
for (const [sourceRules, options] of [
    ['[ mark ] -> [ action mark ]\n[ floor ] -> [ floor mark ]\n[ action mark ] -> [ mark stage ]', {}],
    ['[ seed ] -> [ action seed ]\n[ floor seed ] -> [ floor stationary seed mark ]\n[ action seed ] -> [ seed stage ]', { legend: 'X = Floor and Seed', levels: 'X...P..' }],
]) {
    const source = game(sourceRules, options);
    const report = analyzeSource(source);
    const candidate = rulesOf(report)[1];
    assert.strictEqual(candidate.tags.setup_only, false);
    const cert = report.facts.rule_setup.find(item => item.subjects.rules.includes(candidate.id));
    assert.ok(cert.blockers.some(reason => reason.startsWith('stationary_effect_may_be_rewritten:')));
    assert.ok(cert.evidence.includes(rulesOf(report)[0].id));
    compileGame(source);
    processInput(-1);
    processInput(-1);
    assert.strictEqual(countObject('Stage'), 0, 'ordinary execution keeps clearing the action state');
    state.rules[1][0].tryApply = () => false;
    processInput(-1);
    assert.strictEqual(countObject('Stage'), 1, 'retiring this rule would change gameplay');
    checks += 5;
}

// Timing and restoration are observable engine behavior, independent of tags.
{
    const rules = '[ floor no mark ] -> [ floor mark ]';
    compileGame(game(rules));
    assert.strictEqual(countObject('Mark'), 0, 'raw load does not implicitly run setup');
    processInput(4);
    assert.strictEqual(countObject('Mark'), 1, 'first input performs setup');
    const once = Array.from(level.objects);
    for (let tick = 0; tick < 5; tick++) processInput(-1);
    assert.deepStrictEqual(Array.from(level.objects), once, 'settled setup remains inert');
    DoUndo(true, false);
    assert.strictEqual(countObject('Mark'), 0, 'undo can return before setup');
    processInput(-1);
    assert.strictEqual(countObject('Mark'), 1, 'restored state must run setup again');
    DoRestart(true);
    assert.strictEqual(countObject('Mark'), 0, 'restart restores raw state without startup metadata');
    compileGame(game(rules, { metadata: 'run_rules_on_level_start' }));
    assert.strictEqual(countObject('Mark'), 1, 'startup metadata performs setup at load');
    checks += 7;
}

// A replacement on an occupied layer can inherit previously written movement.
{
    const source = game('[ other ] -> [ right other ]\n[ other ] -> [ mark ]', { levels: 'O...P..' });
    const report = analyzeSource(source);
    assert.strictEqual(rulesOf(report)[1].tags.persistent_guard, false);
    compileGame(source);
    processInput(-1);
    assert.strictEqual(level.getCell(0).get(state.objects.mark.id), false);
    assert.strictEqual(level.getCell(1).get(state.objects.mark.id), true);
    checks += 3;
}

// Reverse-ordered groups need a later turn. The proof must never imply a
// single pass, nor depend on the source-order direction of the dependency.
{
    compileGame(game('[ stage no mark ] -> [ stage mark ]\n[ floor ] -> [ floor stage ]'));
    processInput(-1);
    assert.strictEqual(countObject('Stage'), 1);
    assert.strictEqual(countObject('Mark'), 0);
    processInput(-1);
    assert.strictEqual(countObject('Mark'), 1);
    const settled = Array.from(level.objects);
    processInput(-1);
    assert.deepStrictEqual(Array.from(level.objects), settled);
    checks += 4;
}

// A moving anchor is a direct counterexample to treating per-cell saturation
// as initialization: a later input produces another useful application.
{
    compileGame(game('[ player no mark ] -> [ player mark ]', { levels: 'P....' }));
    processInput(-1);
    assert.strictEqual(countObject('Mark'), 1);
    processInput(3);
    processInput(-1);
    assert.strictEqual(countObject('Mark'), 2);
    checks += 2;
}

// Independently compare ordinary play against retiring all certified setup
// rules after their closure has had time to settle. Use actual input and rule
// execution, not a reimplementation of the static proof.
let retirementReplays = 0;
for (const [, sourceRules, expected, options] of cases) {
    if (!expected[3]) continue;
    const source = game(sourceRules, options);
    const report = analyzeSource(source);
    const retiredLines = new Set(rulesOf(report).filter(rule => rule.tags.setup_only).map(rule => rule.source_line));
    const replay = suppress => {
        compileGame(source);
        for (let tick = 0; tick < 6; tick++) processInput(-1);
        if (suppress) {
            for (const group of state.rules.concat(state.lateRules)) {
                for (const rule of group) {
                    if (retiredLines.has(rule.lineNumber)) rule.tryApply = () => false;
                }
            }
        }
        const snapshots = [];
        for (const input of [0, 3, 4, 2, 1, -1, 3, 4, 1, 0]) {
            processInput(input);
            snapshots.push({ objects: Array.from(level.objects), movements: Array.from(level.movements) });
        }
        return snapshots;
    };
    const baseline = replay(false);
    const retired = replay(true);
    assert.deepStrictEqual(retired, baseline, `${sourceRules}: retiring certified setup changes future play`);
    checks++;
    retirementReplays++;
}

console.log(`static_analysis_setup_node: ok (${cases.length} cases, ${enumeratedBoards} boards, ${retirementReplays} retirement replays, ${checks} checks)`);

module.exports = { game, rulesOf };
