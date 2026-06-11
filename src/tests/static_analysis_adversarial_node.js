#!/usr/bin/env node
'use strict';

// Adversarial micro-fixtures for the static analyzer.
//
// Each fixture has a hand-reasoned ground truth targeting a known analysis
// trap (ellipsis destruction, synonym/aggregate reads, property movement,
// randomDir, conditional late clears, command-only rules, undo interaction).
// We assert the analyzer never over-claims, then run the runtime contract
// checker on a targeted input sequence as a second opinion.
//
// Two fixtures are characterizations of open bugs (see TODO.md). They assert
// the CURRENT buggy behavior on purpose: when the underlying bug is fixed,
// the characterization fails loudly and should be flipped into a regular
// soundness assertion.

const assert = require('assert');

const {
    ensureRuntimeLoaded,
    runSimulationWithStaticChecks,
    replayFinalSerializedLevel,
    staticContractForSource,
} = require('./run_static_analysis_runtime_contracts_node');

ensureRuntimeLoaded();

function game(parts) {
    return [
        'title fixture',
        '========',
        'OBJECTS',
        '========',
        'Background', 'black', '',
        'Player', 'white', '',
        'Wall', 'gray', '',
        parts.objects || '',
        '=======',
        'LEGEND',
        '=======',
        '. = Background',
        'P = Player',
        '# = Wall',
        parts.legend || '',
        '=======',
        'SOUNDS',
        '=======',
        '================',
        'COLLISIONLAYERS',
        '================',
        'Background',
        parts.layers || 'Player, Wall',
        '======',
        'RULES',
        '======',
        parts.rules || '',
        '==============',
        'WINCONDITIONS',
        '==============',
        parts.wins || '',
        '=======',
        'LEVELS',
        '=======',
        parts.levels || '',
    ].join('\n');
}

function runContract(name, source, inputs, randomSeed) {
    const expected = replayFinalSerializedLevel(name, source, inputs, { targetLevel: 0, randomSeed });
    runSimulationWithStaticChecks(name, [source, inputs, expected, 0, randomSeed, null]);
}

function quantityFor(contract, objectName) {
    return contract.quantityContracts.find(entry => entry.objectName === objectName) || null;
}

let checks = 0;
function ok(condition, message) {
    checks++;
    assert.ok(condition, message);
}

// --- Ellipsis destruction: Crate destroyed at a distance. -------------------
{
    const source = game({
        objects: 'Crate\norange\n',
        legend: 'C = Crate',
        layers: 'Player, Wall, Crate',
        rules: 'right [ action Player | ... | Crate ] -> [ Player | ... | ]',
        levels: '######\n#P..C#\n######',
    });
    const c = staticContractForSource(source, 'adversarial:ellipsis_destroy');
    ok(!c.unavailableReason, 'ellipsis_destroy should analyze');
    ok(!c.constantQuantityObjectNames.includes('Crate'), 'Crate must not be constant-count under ellipsis destruction');
    const q = quantityFor(c, 'Crate');
    ok(!(q && q.neverDecreases), 'Crate must not be never-decreases under ellipsis destruction');
    ok(!c.objectNames.includes('Crate'), 'Crate must not be static under ellipsis destruction');
    runContract('adversarial:ellipsis_destroy', source, [4, 3, 4], 9);
}

// --- Synonym destruction: K = Crate read individually. -----------------------
{
    const source = game({
        objects: 'Crate\norange\n\nBoulder\nbrown\n',
        legend: 'C = Crate\nB = Boulder\nK = Crate',
        layers: 'Player, Wall, Crate, Boulder',
        rules: '[ action Player ] [ K ] -> [ Player ] [ ]',
        levels: '######\n#P.CB#\n######',
    });
    const c = staticContractForSource(source, 'adversarial:synonym_destroy');
    const q = quantityFor(c, 'Crate');
    ok(!(q && q.neverDecreases), 'Crate must not be never-decreases under synonym destruction');
    ok(!c.objectNames.includes('Crate'), 'Crate must not be static under synonym destruction');
    ok(!c.mergeCandidatePairs.some(pair => pair.includes('Crate') && pair.includes('Boulder')),
        'Crate/Boulder must not be merge candidates: Crate is read individually via synonym');
    runContract('adversarial:synonym_destroy', source, [4, 3, 4], 9);
}

// --- Aggregate destruction: G = Crate and Mark across layers. ----------------
{
    const source = game({
        objects: 'Crate\norange\n\nMark\nblue\n',
        legend: 'C = Crate\nM = Mark\nG = Crate and Mark',
        layers: 'Player, Wall, Crate\nMark',
        rules: '[ action Player ] [ G ] -> [ Player ] [ ]',
        levels: '######\n#P.G.#\n######',
    });
    const c = staticContractForSource(source, 'adversarial:aggregate_destroy');
    for (const name of ['Crate', 'Mark']) {
        const q = quantityFor(c, name);
        ok(!(q && q.neverDecreases), `${name} must not be never-decreases under aggregate destruction`);
        ok(!c.objectNames.includes(name), `${name} must not be static under aggregate destruction`);
    }
    runContract('adversarial:aggregate_destroy', source, [4, 3], 9);
}

// --- Property push: Obstacle = Crate or Boulder. ------------------------------
{
    const source = game({
        objects: 'Crate\norange\n\nBoulder\nbrown\n',
        legend: 'C = Crate\nB = Boulder\nO = Crate or Boulder',
        layers: 'Player, Wall, Crate, Boulder',
        rules: '[ > Player | O ] -> [ > Player | > O ]',
        levels: '########\n#P.C.B.#\n########',
    });
    const c = staticContractForSource(source, 'adversarial:property_push');
    ok(!c.objectNames.includes('Crate') && !c.objectNames.includes('Boulder'),
        'pushable property members must not be static');
    runContract('adversarial:property_push', source, [3, 3, 3, 3, 1, 1], 9);
}

// --- action_unnecessary is relative to the cosmetic projection. --------------
// With no win conditions every effect is cosmetic, so action may be proved
// unnecessary even though raw states differ. Adding win conditions makes the
// turn-counter solver-visible and the claim must flip to rejected, because
// action is the only "wait" move.
{
    const base = {
        objects: 'T1\nred\n\nT2\ngreen\n\nT3\nblue\n\nT4\nyellow\n\nGoal\npurple\n',
        legend: '1 = T1\nG = Goal',
        layers: 'Goal\nPlayer, Wall\nT1, T2, T3, T4',
        rules: '[ T3 ] -> [ T4 ]\n[ T2 ] -> [ T3 ]\n[ T1 ] -> [ T2 ]',
        levels: '#######\n#.....#\n#..P..#\n#..1.G#\n#######',
    };
    const cosmeticOnly = staticContractForSource(game(base), 'adversarial:counter_no_wins');
    ok(cosmeticOnly.actionUnnecessaryProved === true,
        'without win conditions the turn counter is cosmetic, so action may be proved unnecessary');
    const solverVisible = staticContractForSource(
        game({ ...base, wins: 'Some T4\nAll Player on Goal' }),
        'adversarial:counter_with_wins'
    );
    ok(solverVisible.actionUnnecessaryProved === false,
        'with win conditions the turn counter is solver-visible and action (the only wait move) must not be proved unnecessary');
    runContract('adversarial:counter_with_wins', game({ ...base, wins: 'Some T4\nAll Player on Goal' }), [3, 4], 9);
}

// --- Conditionally cleared trail must not be temporary. -----------------------
{
    const source = game({
        objects: 'Trail\nblue\n',
        legend: 'T = Trail',
        layers: 'Player, Wall\nTrail',
        rules: '[ > Player | ] -> [ > Player | Trail ]\nlate [ Trail Player ] -> [ Player ]',
        levels: '######\n#P...#\n######',
    });
    const c = staticContractForSource(source, 'adversarial:conditional_late_clear');
    ok(!c.temporaryObjectNames.includes('Trail'),
        'Trail must not be temporary: it persists at end of turn away from the player');
    runContract('adversarial:conditional_late_clear', source, [3, 3, 1], 9);
}

// --- again loop must clear the no-again claim. --------------------------------
{
    const source = game({
        objects: 'Gem\ngreen\n',
        legend: 'G = Gem',
        layers: 'Player, Wall, Gem',
        rules: 'right [ Gem | ] -> [ | Gem ] again',
        levels: '#######\n#PG...#\n#######',
    });
    const c = staticContractForSource(source, 'adversarial:again_conveyor');
    ok(c.noAgainProved === false, 'a game with an again command must not prove no-again');
    runContract('adversarial:again_conveyor', source, [0, 0], 9);
}

// --- Command-only rules: sfx may be inert; checkpoint must not be. ------------
{
    const source = game({
        objects: 'Flag\nred\n',
        legend: 'F = Flag',
        layers: 'Player, Wall, Flag',
        rules: [
            '[ > Player | Flag ] -> [ > Player | Flag ] sfx0',
            '[ action Player Flag ] -> [ action Player Flag ] checkpoint',
        ].join('\n'),
        levels: '######\n#P.F.#\n######',
    });
    const c = staticContractForSource(source, 'adversarial:command_rules');
    const lines = source.split('\n');
    for (const line of c.inertCommandRuleSourceLines) {
        ok(!/checkpoint/.test(lines[line - 1] || ''), 'checkpoint rules must never be tagged inert command-only');
    }
    runContract('adversarial:command_rules', source, [3, 3, 4, 3, 'restart'], 9);
}

// --- randomDir movement consumes the RNG: no-random must be rejected. ---------
{
    const source = game({
        objects: 'Marker\nblue\n',
        legend: 'M = Marker',
        layers: 'Player, Wall, Marker',
        rules: '[ action Player ] [ stationary Marker ] -> [ Player ] [ randomDir Marker ]',
        levels: '#######\n#P..M.#\n#######',
    });
    const c = staticContractForSource(source, 'adversarial:randomdir');
    ok(c.noRandomProved === false,
        'a game with randomDir RHS movement is seed dependent and must not prove no-random');
    runContract('adversarial:randomdir', source, [4, 4], 9);
}

// --- KNOWN BUG characterization: cosmetic claims are not undo-safe (TODO.md). -
// A turn whose only effect is a cosmetic change still pushes an undo state,
// so suppressing cosmetic rules changes undo-stack depth and a later undo
// restores a different turn. When the contract scope (or engine behavior) is
// fixed, this characterization fails: turn it into a plain runContract call.
{
    const source = game({
        objects: 'DustA\nred\n\nDustB\ngreen\n\nDustC\nblue\n',
        legend: 'a = DustA',
        layers: 'Player, Wall\nDustA, DustB, DustC',
        rules: '[ DustB ] -> [ DustC ]\n[ DustA ] -> [ DustB ]',
        levels: '#####\n#P.a#\n#####',
    });
    const c = staticContractForSource(source, 'adversarial:cosmetic_undo_known_bug');
    ok(c.cosmeticObjectNames.includes('DustA'), 'dust decay chain should be cosmetic');
    let divergence = null;
    try {
        runContract('adversarial:cosmetic_undo_known_bug', source, [3, 0, 'undo'], 9);
    } catch (error) {
        divergence = String(error && error.message);
    }
    ok(divergence !== null && /cosmetic rule suppression replay diverged/.test(divergence),
        'characterization of open bug changed: cosmetic rule suppression now survives undo — update this fixture (see TODO.md)');
    process.stderr.write('static_analysis_adversarial_node: KNOWN BUG (TODO.md): cosmetic rule suppression diverges under undo\n');
}

console.log(`static_analysis_adversarial_node: ok (${checks} checks)`);
