#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = path.resolve(__dirname, '..');
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const files = [
    'js/mis/mis_shims.js', 'js/storagewrapper.js', 'js/bitvec.js', 'js/level.js',
    'js/languageConstants.js', 'js/globalVariables.js', 'js/debug.js', 'js/plugin_header_on.js',
    'js/font.js', 'js/rng.js', 'js/riffwave.js', 'js/sfxr.js', 'js/codemirror/stringstream.js',
    'js/colorhelpers.js', 'js/colors.js', 'js/engine.js', 'js/parser.js', 'js/compiler.js',
    'js/soundbar.js',
];
vm.runInThisContext(files.map(file => fs.readFileSync(path.join(src, file), 'utf8')).join('\n')
    + '\nmisAfterEngineLoaded();\n'
    + fs.readFileSync(path.join(src, 'js/mis/mis_core.js'), 'utf8')
    + '\nglobalThis.MISCore = MISCore; globalThis.misCompile = misCompile;');

assert.equal(typeof MISCore.validateSolution, 'function', 'solved results must be checked in the original game');
const staticOptimizer = require('./solver_static_opt');
const provenanceState = { objects: { player: {}, wall: {} } };
staticOptimizer.createSolverOptimizationHook(null, {})(provenanceState);
assert.equal(provenanceState.solverOptimizationObjectMap?.get('wall'), 'wall', 'optimizer must retain original object provenance');
const partialProof = { status: 'ok', ps_tagged: { rule_sections: [{ groups: [{ rules: [
    { id: 'one', source_line: 10 }, { id: 'two', source_line: 10 },
] }] }] }, facts: { win_relevance: [{ id: 'win_relevance', status: 'proved', value: { irrelevant_rule_ids: ['one'] } }] } };
assert.equal(staticOptimizer.winRelevanceIrrelevantRuleSourceLines(partialProof).size, 0, 'every expansion on a removed source line needs a proof');

const game = fs.readFileSync(path.join(__dirname, 'fixtures/mis-optimization/game.txt'), 'utf8');

function load(text = game) {
    assert(misCompile(text).ok);
    const model = MISCore.extractModel(text);
    return { model, board: model.levels.find(level => level.board).board };
}

const original = load();
assert(MISCore.validateSolution(original.model, original.board, [3, 3]));
assert(!MISCore.validateSolution(original.model, original.board, [1]));

async function main() {
    const { buildMisOptimizer } = await import('../../scripts/build-mis-optimizer.mjs');
    await buildMisOptimizer();
    vm.runInThisContext(fs.readFileSync(path.join(src, 'js/semantic_compile.js'), 'utf8'));
    vm.runInThisContext(fs.readFileSync(path.join(src, 'js/mis/mis_optimizer_bundle.js'), 'utf8'));
    const prepare = () => {
        const { model, board } = load();
        return { model, board, prepared: MISOptimizer.prepare(game, model) };
    };
    const { model, board, prepared } = prepare();
    assert.equal(prepared.telemetry.enabled, true, prepared.telemetry.reason);
    assert(prepared.telemetry.removed_cosmetic_objects > 0);
    assert(prepared.telemetry.merged_object_aliases > 0, 'walls absent from authored levels are still mergeable');
    assert(prepared.model.objectCount < model.objectCount);
    assert.equal(prepared.idMap[model.names.walla.ids[0]], prepared.idMap[model.names.wallb.ids[0]]);
    assert.equal(prepared.idMap[model.names.decoration.ids[0]], -1);
    assert.deepEqual(Array.from(prepared.telemetry.analysisFamilies).sort(), ['mergeability', 'movement_action', 'win_relevance']);

    // The generator can introduce objects never present in an authored board.
    const injected = MISCore.cloneBoard(board);
    MISCore.placeObject(model, injected.cells, 1, model.names.wallb.ids[0]);
    const snapshot = Array.from(injected.cells);
    const projected = prepared.project(injected);
    assert(MISCore.hasBit(projected.cells, 1, prepared.idMap[model.names.wallb.ids[0]], prepared.model.stride));
    assert.deepEqual(Array.from(injected.cells), snapshot);

    const backend = MISOptimizer.createBackend(prepared);
    assert.equal(backend.solve(board, { strategy: 'bfs', timeMs: 3000 }).status, 'solved');
    assert.equal(backend.solve(injected, { strategy: 'bfs', timeMs: 3000 }).status, 'unsolvable');
    const plain = MISCore.cloneBoard(board);
    MISCore.placeObject(model, plain.cells, 0, model.names.decoration.ids[0]);
    const simplified = backend.simplify(plain, { timeMs: 3000 });
    assert(simplified.ok);
    assert(!MISCore.hasBit(simplified.board.cells, 0, model.names.decoration.ids[0], model.stride));
    assert.equal(simplified.board.cells.length, plain.cells.length);
    const tightened = backend.simplify(board, { mode: 'tighten', objectId: model.names.walla.ids[0], timeMs: 3000 });
    assert(tightened.ok);
    assert.equal(backend.solve(tightened.board, { strategy: 'bfs', timeMs: 3000 }).solution.length, 2);

    const aggregateSource = game.replace('Player, WallA, WallB', 'Player\nWallA\nWallB')
        .replace('D = Decoration', 'D = Decoration\nAB = WallA and WallB')
        .replace('all Player on Goal', 'no AB');
    const aggregateGame = load(aggregateSource);
    MISCore.placeObject(aggregateGame.model, aggregateGame.board.cells, 1, aggregateGame.model.names.walla.ids[0]);
    const aggregatePrepared = MISOptimizer.prepare(aggregateSource, aggregateGame.model);
    assert(aggregatePrepared.telemetry.enabled, aggregatePrepared.telemetry.reason);
    assert.equal(MISOptimizer.createBackend(aggregatePrepared).solve(aggregateGame.board, { strategy: 'bfs' }).status, 'solved', 'an aggregate requires both objects on one tile');

    const blockers = Array.from({ length: 40 }, (_, index) => 'Block' + index);
    const wideSource = game.replace('LEGEND', blockers.map(name => name + '\nred\n').join('\n') + '\nLEGEND')
        .replace('Player, WallA, WallB', ['Player', 'WallA', 'WallB', ...blockers].join(', '));
    const wide = load(wideSource);
    assert(wide.model.names.goal.ids[0] > 31);
    const widePrepared = MISOptimizer.prepare(wideSource, wide.model);
    assert(widePrepared.telemetry.enabled, widePrepared.telemetry.reason);
    assert.equal(widePrepared.model.stride, 1);
    const wideBackend = MISOptimizer.createBackend(widePrepared);
    assert.equal(wideBackend.solve(wide.board, { strategy: 'bfs' }).status, 'solved');
    MISCore.placeObject(wide.model, wide.board.cells, 1, wide.model.names.block39.ids[0]);
    assert.equal(wideBackend.solve(wide.board, { strategy: 'bfs' }).status, 'unsolvable');

    const errorGame = load();
    const errorFallback = MISOptimizer.prepare(game, errorGame.model, { hasErrors: true });
    assert.equal(errorFallback.telemetry.enabled, false);
    assert.equal(MISOptimizer.createBackend(errorFallback).solve(errorGame.board, { strategy: 'bfs' }).status, 'solved');

    const requiredAction = game.replace('[ Decoration ] -> [ ]', '[ action Player ] -> [ Player ] win').replace('all Player on Goal', 'no Player');
    const actionGame = load(requiredAction);
    assert.equal(MISCore.solve(actionGame.model, actionGame.board, { strategy: 'bfs', timeMs: 3000 }).status, 'solved', 'WIN without a board mutation must survive the visited-state check');
    const actionPrepared = MISOptimizer.prepare(requiredAction, actionGame.model);
    assert.equal(actionPrepared.model.noaction, false);
    const action = MISOptimizer.createBackend(actionPrepared).solve(actionGame.board, { strategy: 'bfs', timeMs: 3000 });
    assert.equal(action.status, 'solved');
    assert(action.solution.includes(4));

    const randomSource = game.replace('[ Decoration ] -> [ ]', 'random [ Decoration ] -> [ ]');
    const randomGame = load(randomSource);
    const random = MISOptimizer.prepare(randomSource, randomGame.model);
    assert.equal(random.telemetry.enabled, false);
    assert.match(random.telemetry.reason, /random/i);

    // An invalid optimized result is retried with the original rules, and the
    // offending profile remains disabled for the rest of this worker's life.
    const fresh = prepare();
    const rejectingNative = { solve() { return { status: 'solved', solution: [], expanded: 0 }; } };
    const guarded = MISOptimizer.createBackend(fresh.prepared, rejectingNative);
    const retried = guarded.solve(fresh.board, { strategy: 'bfs', timeMs: 3000 });
    assert.equal(retried.status, 'solved');
    assert(retried.solution.length > 0);
    assert.equal(fresh.prepared.telemetry.enabled, false);
    assert.match(fresh.prepared.telemetry.reason, /replay/i);

    const editing = prepare();
    const lyingNative = { solve() { return { status: 'solved', solution: [], expanded: 0 }; }, validateOriginalSolution() { return true; } };
    const edited = MISOptimizer.createBackend(editing.prepared, lyingNative).simplify(editing.board, { timeMs: 3000 });
    assert(edited.ok);
    editing.prepared.activateOriginal();
    assert.equal(MISCore.solve(editing.model, edited.board, { strategy: 'bfs' }).solution?.length, 2, 'user-visible simplification must validate in original JS too');

    const admission = prepare();
    const falseAssessment = { assess() { return { status: 'solved', solution: [0], effort: 999, expanded: 999 }; }, validateOriginalSolution() { return true; } };
    const assessedForGenerator = MISOptimizer.createBackend(admission.prepared, falseAssessment).assess(admission.board, { timeMs: 3000, refine: false });
    assert.equal(admission.prepared.telemetry.enabled, false, 'reject a false solve before the generator can admit it or update its budget');
    assert.equal(assessedForGenerator.solution.length, 2);

    const { create } = require('../js/mis/mis_native.js');
    const module = await require('../js/mis/wasm/mis_native.js')();
    const nativeGame = prepare();
    const native = create(module);
    assert(native.attach(nativeGame.prepared.source, nativeGame.prepared.model).ok);
    assert.equal(typeof native.actionUnnecessary, 'function', 'native reuse needs its own game-wide ACTION proof');
    assert.equal(typeof native.attachOriginal, 'function', 'native replay must use original rules without JS replay overhead');
    assert(native.attachOriginal(game, nativeGame.model).ok);
    assert(native.validateOriginalSolution(nativeGame.board, [3, 3]));
    assert(!native.validateOriginalSolution(nativeGame.board, [0]));
    assert(!native.attachOriginal(game, Object.assign({}, nativeGame.model, { objectCount: 999 })).ok);
    assert.equal(native.validateOriginalSolution(nativeGame.board, [3, 3]), null, 'mismatched original tables must use JS validation');
    assert(native.attachOriginal(game, nativeGame.model).ok);
    const nativeBackend = MISOptimizer.createBackend(nativeGame.prepared, native);
    for (const strategy of ['bfs', 'astar']) {
        const result = nativeBackend.solve(nativeGame.board, { strategy, timeMs: 3000 });
        assert.equal(result.status, 'solved');
        assert.equal(result.solution.length, 2);
    }
    const assessed = nativeBackend.assess(nativeGame.board, { timeMs: 3000 });
    assert.equal(assessed.status, 'solved');

    const messageSource = game.replace('[ Decoration ] -> [ ]', '[ action Player Goal ] -> [ Player Goal ] win')
        .replace('[ Player ] -> [ Player ] sfx0', '[ Player no Goal ] -> [ Player ] message hello')
        .replace('all Player on Goal', 'no Player');
    const messageGame = load(messageSource);
    assert(MISCore.validateSolution(messageGame.model, messageGame.board, [3, 3, 4]));
    const messagePrepared = MISOptimizer.prepare(messageSource, messageGame.model);
    assert(native.attach(messagePrepared.source, messagePrepared.model).ok);
    assert(native.attachOriginal(messageSource, messageGame.model).ok);
    assert(native.validateOriginalSolution(messageGame.board, [3, 3, 4]), 'inert MESSAGE commands must not consume solver inputs during original replay');
    const messageResult = MISOptimizer.createBackend(messagePrepared, native).solve(messageGame.board, { strategy: 'bfs', timeMs: 3000 });
    assert.equal(messageResult.status, 'solved');
    assert.equal(messagePrepared.telemetry.replayRejected, 0);

    const sokoSource = fs.readFileSync(path.join(src, 'demo/sokoban_basic.txt'), 'utf8');
    const sokoGame = load(sokoSource);
    const sokoPrepared = MISOptimizer.prepare(sokoSource, sokoGame.model);
    assert(!MISOptimizer.hasRuleReductions(sokoPrepared));
    assert(native.attach(sokoSource, sokoGame.model).ok);
    assert(native.actionUnnecessary());
    const nativeReuse = MISOptimizer.createBackend(sokoPrepared, native, { originalNative: true });
    assert.equal(nativeReuse.solve(sokoGame.board, { strategy: 'bfs', timeMs: 3000 }).solution.length, 33);
    assert.equal(sokoPrepared.telemetry.replayChecks, 0, 'an unchanged native ruleset retains its existing replay path');
    assert(native.attach(requiredAction, actionGame.model).ok);
    assert(!native.actionUnnecessary(), 'native reuse cannot bypass required ACTION');
    console.log('mis_optimization_node: ok (projection, JS/WASM, injected boards, ACTION, simplify, replay fallback)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
