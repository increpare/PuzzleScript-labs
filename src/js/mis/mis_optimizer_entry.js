'use strict';

// Bundled for classic Web Workers by scripts/build-mis-optimizer.mjs. The
// compiler-global semantic prefix is loaded alongside the normal JS engine.
const { createCanonicalizer } = require('../canonicalize_core');
const { analyzeCompiledState } = require('../static_analysis');
const { decanonicalizeSemantic } = require('../decanonicalize_core');
const optimizer = require('../../tests/solver_static_opt');
const canonicalizer = createCanonicalizer();

function activate(runtime, force) {
    if (force || state !== runtime || STRIDE_OBJ !== runtime.STRIDE_OBJ || STRIDE_MOV !== runtime.STRIDE_MOV) {
        setGameState(runtime, ['rebuild'], 'mis');
    }
}

function prepare(source, originalModel, options = {}) {
    const start = performance.now();
    const originalState = state;
    let solverState = originalState, solverModel = originalModel, solverSource = source;
    let idMap = Int32Array.from({ length: originalModel.objectCount }, (_, id) => id);
    const telemetry = { enabled: false, scope: 'arbitrary_boards', replayChecks: 0, replayRejected: 0 };
    let ruleTags = null;
    try {
        if (options.enabled === false) throw new Error('disabled');
        if (options.hasErrors) throw new Error('source has compile errors');
        const semantic = psCompileSemantic(source, true);
        if (semantic.errorCount || !semantic.state || semantic.state.invalid) throw new Error('semantic compile failed');
        const report = analyzeCompiledState(semantic.state, {
            arbitraryBoards: true,
            familyFilter: ['mergeability', 'movement_action', 'win_relevance'],
        });
        if (report.status !== 'ok') throw new Error('static analysis failed');
        // Cosmetic/merge projection is only replay-validated for deterministic
        // forward search. Preserve the existing random-game backend unchanged.
        if (report.ps_tagged.game.tags.has_random) throw new Error('random mechanics');
        ruleTags = ruleLineTags(report.ps_tagged);
        const passes = optimizer.effectiveSolverPassesForHook(report, optimizer.parseSolverOptPassList('all'));
        const optimized = psCompileSemantic(source, true, { staticAnalysisReport: report, passes }, optimizer);
        if (optimized.errorCount || !optimized.state || optimized.state.invalid) throw new Error('optimized semantic compile failed');
        const reduced = canonicalizer.canonicalizeSemanticStateWithObjectMap(optimized.state, {
            includeLevels: false,
            // The static optimizer already merges only eligible, immutable
            // objects. Corpus/dedup equivalence is a broader operation.
            collapseEquivalentObjects: false,
        });
        // Only the ruleset is prepared. Each actual board is injected later,
        // so the compiler receives a small valid placeholder level.
        const cell = [...new Set([reduced.canonical.backgroundObjects[0], reduced.canonical.playerObjects[0]].filter(Boolean))];
        reduced.canonical.levels = [{ type: 'map', rows: [[cell]] }];
        const canonicalSource = decanonicalizeSemantic(reduced.canonical);
        const compiled = misCompile(canonicalSource);
        if (!compiled.ok || compiled.hasErrors) throw new Error('canonical source compile failed');
        const canonicalModel = MISCore.extractModel(canonicalSource);
        const mapping = new Int32Array(originalModel.objectCount).fill(-1);
        for (const object of originalModel.objects) {
            if (!object) continue;
            const surviving = optimized.state.solverOptimizationObjectMap.get(object.name);
            if (surviving === null) continue;
            const canonicalName = reduced.objectMap.get(surviving);
            const target = canonicalName && canonicalModel.names[canonicalName];
            if (!target || target.ids.length !== 1) throw new Error('incomplete object provenance: ' + object.name);
            mapping[object.id] = target.ids[0];
        }
        solverState = state;
        solverModel = canonicalModel;
        solverSource = canonicalSource;
        idMap = mapping;
        Object.assign(telemetry, optimized.state.solverOptimizationTelemetry, {
            enabled: true,
            originalObjects: originalModel.objectCount,
            solverObjects: solverModel.objectCount,
            originalLayers: originalModel.layerCount,
            solverLayers: solverModel.layerCount,
            analysisFamilies: Object.keys(report.facts),
        });
    } catch (error) {
        telemetry.reason = error.message || String(error);
    } finally {
        activate(originalState, true);
        telemetry.prepareMs = performance.now() - start;
    }

    function project(board) {
        const cells = new Int32Array(board.w * board.h * solverModel.stride);
        for (let tile = 0; tile < board.w * board.h; tile++) {
            for (let word = 0; word < originalModel.stride; word++) {
                let bits = board.cells[tile * originalModel.stride + word] | 0;
                while (bits) {
                    const bit = 31 - Math.clz32(bits & -bits);
                    const mapped = idMap[(word << 5) + bit];
                    if (mapped >= 0) cells[tile * solverModel.stride + (mapped >> 5)] |= 1 << (mapped & 31);
                    bits &= bits - 1;
                }
            }
        }
        return { w: board.w, h: board.h, cells };
    }

    return {
        source: solverSource, model: solverModel, originalModel, idMap, telemetry, project, ruleTags,
        activateOriginal() { activate(originalState); },
        activateSolver() { activate(solverState); },
    };
}

// Source lines whose rules can't affect play: { line: 'cosmetic' | 'inert' }.
// A line is listed only when every rule compiled from it is tagged.
function ruleLineTags(tagged) {
    const tags = {}, mixed = new Set();
    for (const section of tagged.rule_sections) {
        for (const group of section.groups) {
            for (const rule of group.rules) {
                const line = rule.source_line;
                const tag = rule.tags.cosmetic ? 'cosmetic' : rule.tags.inert_command_only ? 'inert' : null;
                if (!tag) mixed.add(line);
                else if (!tags[line] || tag === 'inert') tags[line] = tag;
            }
        }
    }
    for (const line of mixed) delete tags[line];
    return tags;
}

function hasRuleReductions(prepared) {
    return ['removed_inert_rules', 'removed_cosmetic_objects', 'removed_collision_layers',
        'removed_cosmetic_rules', 'removed_win_irrelevant_rules', 'merged_object_aliases']
        .some(key => prepared.telemetry[key] > 0);
}

function createBackend(prepared, native, options = {}) {
    let activeNative = native || null;
    // If the original native solver proves the sole reduction redundant, keep
    // its existing validated path and avoid canonical projection/replay work.
    let projected = prepared.telemetry.enabled && !options.originalNative;
    prepared.telemetry.nativePassthrough = !!options.originalNative;
    function run(method, board, options) {
        const started = performance.now();
        const input = projected ? prepared.project(board) : board;
        if (projected) prepared.activateSolver();
        else prepared.activateOriginal();
        const model = projected ? prepared.model : prepared.originalModel;
        let result = activeNative ? activeNative[method](input, options)
            : MISCore[method](model, input, options);
        if (result.status === 'solved' && projected) {
            prepared.telemetry.replayChecks++;
            let valid = activeNative && activeNative.validateOriginalSolution
                ? activeNative.validateOriginalSolution(board, result.solution) : null;
            if (valid === null || (valid && options.verifyOriginalJS !== false)) {
                prepared.activateOriginal();
                valid = MISCore.validateSolution(prepared.originalModel, board, result.solution);
            }
            if (!valid) {
                prepared.telemetry.replayRejected++;
                prepared.telemetry.enabled = false;
                prepared.telemetry.reason = 'original-game replay failed; using original rules';
                projected = false;
                activeNative = null;
                prepared.activateOriginal();
                result = MISCore[method](prepared.originalModel, board, options);
            }
        }
        result.ms = performance.now() - started;
        return result;
    }
    const backend = {
        solve(board, options) { return run('solve', board, options || {}); },
        assess(board, options) { return run('assess', board, options || {}); },
        simplify(board, options) {
            // Keep edits in original IDs, including distinctions folded by the
            // solver. Each removal/addition is assessed through the same map.
            prepared.activateOriginal();
            return MISCore.simplify(prepared.originalModel, board, Object.assign({}, options, {
                solve: (trial, limits) => backend.solve(trial, Object.assign({}, limits, { verifyOriginalJS: true })),
            }));
        },
    };
    return backend;
}

module.exports = { prepare, createBackend, hasRuleReductions };
