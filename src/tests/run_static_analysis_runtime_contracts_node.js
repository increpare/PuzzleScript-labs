#!/usr/bin/env node
'use strict';

const assert = require('assert');

const { analyzeSource } = require('./ps_static_analysis');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');
const {
    buildMergeAliasMap,
    cosmeticRuleSourceLines: optimizerCosmeticRuleSourceLines,
    createSolverOptimizationHook,
    mergeabilityCandidatePairs,
    mergeMutationObjectNames,
} = require('./solver_static_opt');

let runtimeLoaded = false;
const MAX_AGAIN_DRAIN_STEPS = 10000;

const ANALYSIS_UNAVAILABLE_TESTS = new Map([
    ['by your side', { status: 'compile_error', diagnostic: 'Object "TARGET" included in multiple collision layers' }],
    ['test testing starting at level N', { status: 'compile_error', diagnostic: 'Object "TARGET" included in multiple collision layers' }],
    ['collapse simple', { status: 'compile_error', diagnostic: 'YouTube support' }],
    ['collapse long', { status: 'compile_error', diagnostic: 'YouTube support' }],
    ['damn I\'m huge', { status: 'compile_error', diagnostic: 'YouTube support' }],
    ['rule application hat test', { status: 'compile_error', diagnostic: 'Object "WALL" included in multiple collision layers' }],
    ['too many rigid bodies', { status: 'compile_error', diagnostic: 'Name "1" already in use' }],
    ['dang I\'m huge', { status: 'compile_error', diagnostic: 'YouTube support' }],
    ['Drop Swap', { status: 'compile_error', diagnostic: 'Name "P" already in use' }],
    ['Drop Swap 2', { status: 'compile_error', diagnostic: 'Name "P" already in use' }],
    ['Drop Swap 3', { status: 'compile_error', diagnostic: 'Name "P" already in use' }],
    ['a = b and b #393', { status: 'compile_error', diagnostic: 'Trying to create an aggregate object' }],
    ['gallery:cyber-lasso', { status: 'compile_error', diagnostic: 'You named an object "|", but this is a keyword' }],
    ['Putting Bicycle Helmets on Young Children', { status: 'compile_error', diagnostic: 'strap occurs multiple times' }],
    ['[testing for recording through level-changes A]  Level-Change test', { status: 'compile_error', diagnostic: 'unexpected sound token "un"' }],
    ['parser rigid in strange place highlighting test', { status: 'compile_error', diagnostic: 'malformed cell rule' }],
]);

function parseArgs(argv) {
    const options = { filter: null, help: false };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--filter') {
            assert.ok(index + 1 < argv.length, '--filter requires a value');
            options.filter = argv[++index];
        } else if (!arg.startsWith('-') && options.filter === null) {
            options.filter = arg;
        } else {
            throw new Error(`Unexpected argument: ${arg}`);
        }
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/run_static_analysis_runtime_contracts_node.js [--filter NAME]',
        '',
        'Replays src/tests/resources/testdata.js and checks static-analysis runtime contracts.',
    ].join('\n');
}

function ensureRuntimeLoaded() {
    if (!runtimeLoaded) {
        loadPuzzleScript({ includeTests: true, messageSink: [] });
        runtimeLoaded = true;
    }
}

function resetParserErrors() {
    if (typeof resetParserErrorState === 'function') {
        resetParserErrorState();
    } else {
        errorStrings = [];
        errorCount = 0;
    }
}

function diagnosticText(errors) {
    return (errors || []).map(error => String(error).replace(/<[^>]*>/g, ' ')).join('\n');
}

function drainAgain(context) {
    let stepCount = 0;
    while (againing) {
        stepCount++;
        if (stepCount > MAX_AGAIN_DRAIN_STEPS) {
            throw new Error(`${context}: exceeded ${MAX_AGAIN_DRAIN_STEPS} again-drain steps`);
        }
        againing = false;
        processInput(-1);
    }
    return stepCount;
}

function expectedAnalysisUnavailable(report, testName, sourcePath) {
    if (report.status === 'ok') return null;

    const expected = ANALYSIS_UNAVAILABLE_TESTS.get(testName);
    if (!expected) {
        throw new Error(`${sourcePath}: static analysis status ${report.status}`);
    }
    if (report.status !== expected.status) {
        throw new Error(`${sourcePath}: static analysis status ${report.status}, expected ${expected.status}`);
    }
    const diagnostics = diagnosticText(report.errors);
    if (!diagnostics.includes(expected.diagnostic)) {
        throw new Error(`${sourcePath}: static analysis diagnostic changed; expected ${JSON.stringify(expected.diagnostic)}`);
    }
    return `${report.status}: ${expected.diagnostic}`;
}

function emptyStaticContract(unavailableReason) {
    return {
        objectNames: [],
        staticLayerIds: [],
        inertLayerIds: [],
        constantQuantityObjectNames: [],
        quantityContracts: [],
        temporaryObjectNames: [],
        neverAppearsObjectNames: [],
        cosmeticObjectNames: [],
        cosmeticRuleSourceLines: [],
        optimizerCosmeticRuleSourceLines: [],
        inertCommandRuleSourceLines: [],
        mergeCandidatePairs: [],
        winflowFact: null,
        staticAnalysisReport: null,
        referencedObjectNames: [],
        actionUnnecessaryProved: false,
        tickNoopProved: false,
        noAgainProved: false,
        noRandomProved: false,
        unavailableReason,
    };
}

function addRuleTagObjects(rule, out) {
    if (!rule || !rule.tags) return;
    for (const key of [
        'objects_required',
        'objects_matched',
        'object_absences_matched',
        'objects_written',
        'objects_erased',
    ]) {
        for (const objectName of rule.tags[key] || []) {
            out.add(objectName);
        }
    }
}

function ruleReferencedObjectNames(psTagged) {
    const out = new Set();
    for (const section of (psTagged && psTagged.rule_sections) || []) {
        for (const group of section.groups || []) {
            for (const rule of group.rules || []) {
                addRuleTagObjects(rule, out);
            }
        }
    }
    return Array.from(out).sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true })
    );
}

function movementKeyObjectName(key) {
    const text = String(key);
    const separator = text.lastIndexOf(':');
    return separator === -1 ? text : text.slice(0, separator);
}

function movementTouchedObjectSet(rule) {
    const out = new Set();
    const tags = (rule && rule.tags) || {};
    for (const key of tags.movements_written || []) {
        out.add(movementKeyObjectName(key));
    }
    for (const key of tags.movements_removed || []) {
        out.add(movementKeyObjectName(key));
    }
    return out;
}

function isCosmeticRuleContractEligible(rule, cosmeticObjects) {
    const mutatedObjects = new Set([
        ...((rule && rule.tags && rule.tags.objects_written) || []),
        ...((rule && rule.tags && rule.tags.objects_erased) || []),
    ]);
    const mutatesOnlyCosmeticObjects = mutatedObjects.size > 0
        && [...mutatedObjects].every(objectName => cosmeticObjects.has(objectName));
    const movementOnlyTouchesMutatedObjects = [...movementTouchedObjectSet(rule || { tags: {} })]
        .every(objectName => mutatedObjects.has(objectName));
    return rule
        && rule.tags
        && rule.tags.cosmetic === true
        && rule.tags.object_mutating === true
        && rule.random_rule !== true
        && mutatesOnlyCosmeticObjects
        && movementOnlyTouchesMutatedObjects
        && (!rule.summary || (
            rule.summary.semantic_commands.length === 0
            && rule.summary.rhs_random_objects.length === 0
        ));
}

function cosmeticRuleSourceLines(psTagged) {
    const byLine = new Map();
    const cosmeticObjects = new Set(((psTagged && psTagged.objects) || [])
        .filter(object => object.tags && object.tags.cosmetic === true)
        .map(object => object.name));
    for (const section of (psTagged && psTagged.rule_sections) || []) {
        for (const group of section.groups || []) {
            for (const rule of group.rules || []) {
                if (!Number.isFinite(rule && rule.source_line)) continue;
                if (!byLine.has(rule.source_line)) {
                    byLine.set(rule.source_line, { total: 0, eligible: 0 });
                }
                const entry = byLine.get(rule.source_line);
                entry.total++;
                if (isCosmeticRuleContractEligible(rule, cosmeticObjects)) entry.eligible++;
            }
        }
    }
    return Array.from(byLine.entries())
        .filter(([_line, entry]) => entry.total > 0 && entry.total === entry.eligible)
        .map(([line]) => line)
        .sort((left, right) => left - right);
}

function isSfxCommand(command) {
    return /^sfx\d+$/.test(String(command));
}

function isInertCommandRuleContractEligible(rule) {
    const commandNames = ((rule && rule.commands) || []).map(command => command[0]);
    return rule
        && rule.tags
        && rule.tags.inert_command_only === true
        && rule.random_rule !== true
        && commandNames.length > 0
        && commandNames.every(isSfxCommand);
}

function inertCommandRuleSourceLines(psTagged) {
    const byLine = new Map();
    for (const section of (psTagged && psTagged.rule_sections) || []) {
        for (const group of section.groups || []) {
            for (const rule of group.rules || []) {
                if (!Number.isFinite(rule && rule.source_line)) continue;
                if (!byLine.has(rule.source_line)) {
                    byLine.set(rule.source_line, { total: 0, eligible: 0 });
                }
                const entry = byLine.get(rule.source_line);
                entry.total++;
                if (isInertCommandRuleContractEligible(rule)) entry.eligible++;
            }
        }
    }
    return Array.from(byLine.entries())
        .filter(([_line, entry]) => entry.total > 0 && entry.total === entry.eligible)
        .map(([line]) => line)
        .sort((left, right) => left - right);
}

function staticContractForSource(source, testName) {
    const sourcePath = `testdata:${testName}`;
    const report = analyzeSource(source, {
        sourcePath,
        familyFilter: ['count_layer_invariants', 'transient_boundary', 'movement_action', 'mergeability', 'winflow'],
    });
    const unavailableReason = expectedAnalysisUnavailable(report, testName, sourcePath);
    if (unavailableReason) {
        return emptyStaticContract(unavailableReason);
    }

    const objects = ((report.ps_tagged && report.ps_tagged.objects) || []);
    const layers = ((report.ps_tagged && report.ps_tagged.collision_layers) || []);
    const gameTags = (report.ps_tagged && report.ps_tagged.game && report.ps_tagged.game.tags) || {};
    const movementFacts = (report.facts && report.facts.movement_action) || [];
    const winflowFact = ((report.facts && report.facts.winflow) || [])
        .find(fact => fact && fact.id === 'winflow' && fact.status === 'proved') || null;
    const referencedObjectNames = ruleReferencedObjectNames(report.ps_tagged);
    const quantityContracts = objects
        .filter(object => object.tags && object.tags.quantity)
        .map(object => ({
            objectName: object.name,
            neverIncreases: object.tags.quantity.never_increases === true,
            neverDecreases: object.tags.quantity.never_decreases === true,
        }))
        .filter(contract => contract.neverIncreases || contract.neverDecreases);
    return {
        objectNames: objects
            .filter(object => object.tags && object.tags.static === true)
            .map(object => object.name),
        staticLayerIds: layers
            .filter(layer => layer.tags && layer.tags.static === true)
            .map(layer => layer.id),
        inertLayerIds: layers
            .filter(layer => layer.tags && layer.tags.inert === true)
            .map(layer => layer.id),
        constantQuantityObjectNames: quantityContracts
            .filter(contract => contract.neverIncreases && contract.neverDecreases)
            .map(contract => contract.objectName),
        quantityContracts,
        temporaryObjectNames: objects
            .filter(object => object.tags && object.tags.temporary === true)
            .map(object => object.name),
        neverAppearsObjectNames: objects
            .filter(object => object.tags && object.tags.present_in_no_levels === true && object.tags.may_be_created === false)
            .map(object => object.name),
        cosmeticObjectNames: objects
            .filter(object => object.tags && object.tags.cosmetic === true)
            .map(object => object.name),
        cosmeticRuleSourceLines: cosmeticRuleSourceLines(report.ps_tagged),
        optimizerCosmeticRuleSourceLines: Array.from(optimizerCosmeticRuleSourceLines(report)).sort((left, right) => left - right),
        inertCommandRuleSourceLines: inertCommandRuleSourceLines(report.ps_tagged),
        mergeCandidatePairs: mergeabilityCandidatePairs(report),
        winflowFact,
        staticAnalysisReport: report,
        referencedObjectNames,
        actionUnnecessaryProved: movementFacts.some(fact => fact.id === 'action_unnecessary' && fact.status === 'proved'),
        tickNoopProved: gameTags.has_autonomous_tick_rules !== true,
        noAgainProved: gameTags.has_again !== true,
        noRandomProved: gameTags.has_random !== true,
        unavailableReason: null,
    };
}

function engineObjectName(displayName) {
    const target = String(displayName).toLowerCase();
    const match = Object.keys(state.objects || {}).find(name =>
        name === target
        || (state.original_case_names && state.original_case_names[name] === displayName)
    );
    if (!match) {
        const available = Object.keys(state.objects || {}).sort().join(', ');
        throw new Error(`runtime object not found for static analyser object ${JSON.stringify(displayName)}; available: ${available}`);
    }
    return match;
}

function canSnapshotBoard() {
    return level && Number.isInteger(level.n_tiles);
}

function boardIdentity() {
    if (!canSnapshotBoard()) {
        return {
            available: false,
            textMode: Boolean(textMode),
            titleScreen: Boolean(titleScreen),
        };
    }
    return {
        available: true,
        curlevel: typeof curlevel === 'number' ? curlevel : null,
        curlevelTarget: typeof curlevelTarget === 'number' ? curlevelTarget : null,
        width: level.width,
        height: level.height,
        nTiles: level.n_tiles,
        textMode: Boolean(textMode),
        titleScreen: Boolean(titleScreen),
    };
}

function sameBoardIdentity(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function objectOccupancySnapshot(displayName) {
    if (!canSnapshotBoard()) {
        throw new Error(`cannot snapshot ${displayName}: no active board level`);
    }
    const runtimeName = engineObjectName(displayName);
    const object = state.objects[runtimeName];
    const cells = [];
    for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
        cells.push(level.getCell(cellIndex).get(object.id) ? 1 : 0);
    }
    return cells;
}

function snapshotStaticObjects(objectNames) {
    const snapshots = new Map();
    if (!canSnapshotBoard()) return snapshots;
    for (const objectName of objectNames) {
        snapshots.set(objectName, objectOccupancySnapshot(objectName));
    }
    return snapshots;
}

function layerOccupancySnapshot(layerId) {
    if (!canSnapshotBoard()) {
        throw new Error(`cannot snapshot layer ${layerId}: no active board level`);
    }
    const objectNames = Array.from(state.collisionLayers[layerId] || []);
    const snapshots = [];
    for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
        const cell = level.getCell(cellIndex);
        snapshots.push(objectNames
            .filter(objectName => cell.get(state.objects[objectName].id))
            .sort()
            .join('|'));
    }
    return snapshots;
}

function snapshotLayers(layerIds) {
    const snapshots = new Map();
    if (!canSnapshotBoard()) return snapshots;
    for (const layerId of layerIds) {
        snapshots.set(layerId, layerOccupancySnapshot(layerId));
    }
    return snapshots;
}

function objectCountSnapshot(displayName) {
    return objectOccupancySnapshot(displayName).reduce((sum, present) => sum + present, 0);
}

function snapshotObjectCounts(objectNames) {
    const snapshots = new Map();
    if (!canSnapshotBoard()) return snapshots;
    for (const objectName of objectNames) {
        snapshots.set(objectName, objectCountSnapshot(objectName));
    }
    return snapshots;
}

function structuralObjectNames() {
    const names = new Set(['player']);
    if (!state || !state.objects) return names;
    if (state.objects.background) names.add('background');
    if (Number.isInteger(state.backgroundid) && state.idDict && state.idDict[state.backgroundid]) {
        names.add(state.idDict[state.backgroundid]);
    }
    if (Number.isInteger(state.backgroundlayer) && Array.isArray(state.collisionLayers)) {
        for (const name of state.collisionLayers[state.backgroundlayer] || []) {
            names.add(name);
        }
    }
    return names;
}

function isRuleObjectNameToken(name) {
    return typeof name === 'string' && name !== '' && name !== '...' && name !== 'random';
}

function addConcreteObjectNames(name, out, seen = new Set()) {
    if (!isRuleObjectNameToken(name) || seen.has(name)) return;
    seen.add(name);
    if (state.objects && state.objects[name]) {
        out.add(name);
        return;
    }
    if (state.synonymsDict && Object.prototype.hasOwnProperty.call(state.synonymsDict, name)) {
        addConcreteObjectNames(state.synonymsDict[name], out, seen);
    }
    if (state.propertiesDict && Object.prototype.hasOwnProperty.call(state.propertiesDict, name)) {
        for (const member of state.propertiesDict[name]) {
            addConcreteObjectNames(member, out, seen);
        }
    }
    if (state.aggregatesDict && Object.prototype.hasOwnProperty.call(state.aggregatesDict, name)) {
        for (const member of state.aggregatesDict[name]) {
            addConcreteObjectNames(member, out, seen);
        }
    }
}

function collectRuleReferencedObjectNames(rules, out) {
    if (!Array.isArray(rules)) return;
    for (const rule of rules) {
        for (const side of ['lhs', 'rhs']) {
            const rows = rule && rule[side];
            if (!Array.isArray(rows)) continue;
            for (const row of rows) {
                for (const cell of row) {
                    if (!Array.isArray(cell)) continue;
                    for (let index = 1; index < cell.length; index += 2) {
                        addConcreteObjectNames(cell[index], out);
                    }
                }
            }
        }
    }
}

function referencedObjectNames() {
    const out = new Set();
    collectRuleReferencedObjectNames(state.rules, out);
    collectRuleReferencedObjectNames(state.lateRules, out);
    for (const sound of state.sounds || []) {
        if (Array.isArray(sound) && Array.isArray(sound[0]) && typeof sound[0][0] === 'string') {
            addConcreteObjectNames(sound[0][0], out);
        }
    }
    return out;
}

function addRuntimeObjectName(displayName, out) {
    try {
        out.add(engineObjectName(displayName));
    } catch (_error) {
        // Static references can include names unavailable after a compile error path.
    }
}

function projectableCosmeticObjectNames(objectNames, staticReferencedObjectNames = []) {
    const structural = structuralObjectNames();
    const referenced = referencedObjectNames();
    for (const objectName of staticReferencedObjectNames) {
        addRuntimeObjectName(objectName, referenced);
    }
    return objectNames.filter(objectName => {
        const runtimeName = engineObjectName(objectName);
        return !structural.has(runtimeName) && !referenced.has(runtimeName);
    });
}

function cosmeticRuleProjectionObjectNames(objectNames) {
    return objectNames.filter(objectName => {
        engineObjectName(objectName);
        return true;
    });
}

function objectMaskForNames(objectNames) {
    const mask = new BitVec(STRIDE_OBJ);
    for (const objectName of objectNames) {
        const runtimeName = engineObjectName(objectName);
        mask.ibitset(state.objects[runtimeName].id);
    }
    return mask;
}

function movementMaskForObjectLayers(objectNames) {
    const mask = new BitVec(STRIDE_MOV);
    const layerIds = new Set();
    for (const objectName of objectNames) {
        const runtimeName = engineObjectName(objectName);
        layerIds.add(state.objects[runtimeName].layer);
    }
    for (const layerId of layerIds) {
        mask.ishiftor(0x1f, 5 * layerId);
    }
    return mask;
}

function clearMovementMaskFromRuntime(movementMask) {
    if (!level || !level.movements) return;
    for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
        const offset = cellIndex * STRIDE_MOV;
        for (let word = 0; word < STRIDE_MOV; word++) {
            level.movements[offset + word] &= ~movementMask.data[word];
        }
        if (state.rigid && Array.isArray(level.rigidGroupIndexMask)) {
            level.rigidGroupIndexMask[cellIndex].iclear(movementMask);
            level.rigidMovementAppliedMask[cellIndex].iclear(movementMask);
        }
    }
}

function projectStoredLevelState(storedLevel, objectMask) {
    if (!storedLevel || !storedLevel.dat) return;
    for (let cellIndex = 0; cellIndex < storedLevel.width * storedLevel.height; cellIndex++) {
        const offset = cellIndex * STRIDE_OBJ;
        for (let word = 0; word < STRIDE_OBJ; word++) {
            storedLevel.dat[offset + word] &= ~objectMask.data[word];
        }
    }
}

function applyCosmeticProjection(objectNames, options = {}) {
    if (!canSnapshotBoard() || objectNames.length === 0) return;

    const objectMask = objectMaskForNames(objectNames);
    const movementMask = movementMaskForObjectLayers(objectNames);
    for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
        const cell = level.getCell(cellIndex);
        cell.iclear(objectMask);
        level.setCell(cellIndex, cell);
    }
    clearMovementMaskFromRuntime(movementMask);
    if (typeof state.calculateRowColMasks === 'function') {
        state.calculateRowColMasks(level);
    }
    if (level.solverZobristRecompute) {
        level.solverZobristRecompute();
    }

    if (options.stored) {
        projectStoredLevelState(restartTarget, objectMask);
        for (const backup of backups || []) {
            projectStoredLevelState(backup, objectMask);
        }
    }
}

function cosmeticProjectionSnapshot(objectNames) {
    const runtimeState = captureRuntimeProbeState();
    try {
        applyCosmeticProjection(objectNames);
        return {
            available: canSnapshotBoard(),
            curlevel: typeof curlevel === 'number' ? curlevel : null,
            curlevelTarget: typeof curlevelTarget === 'number' ? curlevelTarget : null,
            width: canSnapshotBoard() ? level.width : null,
            height: canSnapshotBoard() ? level.height : null,
            nTiles: canSnapshotBoard() ? level.n_tiles : null,
            winning: Boolean(winning),
            againing: Boolean(againing),
            serializedLevel: canSnapshotBoard() ? convertLevelToString() : null,
        };
    } finally {
        restoreRuntimeProbeState(runtimeState);
    }
}

function runProjectedReplayFinalProjection(testName, source, inputs, targetLevel, randomSeed, objectNames) {
    compileSimulationSource(`${testName}: cosmetic projected`, source, targetLevel, randomSeed);
    applyCosmeticProjection(objectNames, { stored: true });
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        const inputToken = inputs[inputIndex];
        executeInputToken(inputToken);
        drainAgain(`${testName}: cosmetic projected input ${inputIndex} ${tokenLabel(inputToken)}`);
    }
    return cosmeticProjectionSnapshot(objectNames);
}

function suppressRulesFromGroups(ruleGroups, sourceLines) {
    if (!Array.isArray(ruleGroups)) return 0;
    const sourceLineSet = new Set(sourceLines);
    let removed = 0;
    for (const group of ruleGroups) {
        if (!Array.isArray(group)) continue;
        for (const rule of group) {
            if (!sourceLineSet.has(rule && rule.lineNumber)) continue;
            rule.tryApply = () => false;
            rule.findMatches = () => [];
            rule.applyAt = () => false;
            rule.queueCommands = () => {};
            rule.commands = [];
            rule.hasReplacements = false;
            removed++;
        }
    }
    return removed;
}

function suppressRulesBySourceLine(sourceLines) {
    return suppressRulesFromGroups(state.rules, sourceLines)
        + suppressRulesFromGroups(state.lateRules, sourceLines);
}

function suppressCosmeticRulesBySourceLine(sourceLines) {
    return suppressRulesBySourceLine(sourceLines);
}

function suppressInertCommandRulesBySourceLine(sourceLines) {
    return suppressRulesBySourceLine(sourceLines);
}

function runCosmeticRuleSuppressedReplayFinalProjection(testName, source, inputs, targetLevel, randomSeed, sourceLines, objectNames) {
    compileSimulationSource(`${testName}: cosmetic rules suppressed`, source, targetLevel, randomSeed);
    suppressCosmeticRulesBySourceLine(sourceLines);
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        const inputToken = inputs[inputIndex];
        executeInputToken(inputToken);
        drainAgain(`${testName}: cosmetic rules suppressed input ${inputIndex} ${tokenLabel(inputToken)}`);
    }
    return cosmeticRuleProjectionSnapshot(objectNames);
}

function runCosmeticRuleOptimizedReplayFinalProjection(testName, source, inputs, targetLevel, randomSeed, staticAnalysisReport, objectNames) {
    const hook = createSolverOptimizationHook(staticAnalysisReport, {
        inert: false,
        cosmetic: false,
        cosmeticRules: true,
        merge: false,
    });
    compileSimulationSource(`${testName}: cosmetic rules optimized`, source, targetLevel, randomSeed, hook);
    const telemetry = (state && state.solverOptimizationTelemetry) || {};
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        const inputToken = inputs[inputIndex];
        executeInputToken(inputToken);
        drainAgain(`${testName}: cosmetic rules optimized input ${inputIndex} ${tokenLabel(inputToken)}`);
    }
    return {
        projection: cosmeticRuleProjectionSnapshot(objectNames),
        telemetry,
    };
}

function runInertCommandSuppressedReplayFinalState(testName, source, inputs, targetLevel, randomSeed, sourceLines) {
    compileSimulationSource(`${testName}: inert command rules suppressed`, source, targetLevel, randomSeed);
    suppressInertCommandRulesBySourceLine(sourceLines);
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        const inputToken = inputs[inputIndex];
        executeInputToken(inputToken);
        drainAgain(`${testName}: inert command rules suppressed input ${inputIndex} ${tokenLabel(inputToken)}`);
    }
    return solverCoreStateSnapshot();
}

function runMergeOptimizedReplayFinalProjection(testName, source, inputs, targetLevel, randomSeed, staticAnalysisReport, aliasMap) {
    const hook = createSolverOptimizationHook(staticAnalysisReport, { inert: false, cosmetic: false, merge: true });
    compileSimulationSource(`${testName}: merge optimized`, source, targetLevel, randomSeed, hook);
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        const inputToken = inputs[inputIndex];
        executeInputToken(inputToken);
        drainAgain(`${testName}: merge optimized input ${inputIndex} ${tokenLabel(inputToken)}`);
    }
    return {
        snapshot: mergeCanonicalStateSnapshot(aliasMap),
        telemetry: (state && state.solverOptimizationTelemetry) || {},
    };
}

function firstSnapshotDifference(beforeSnapshots, objectNames) {
    for (const objectName of objectNames) {
        const before = beforeSnapshots.get(objectName) || [];
        const after = objectOccupancySnapshot(objectName);
        const length = Math.max(before.length, after.length);
        for (let cellIndex = 0; cellIndex < length; cellIndex++) {
            const beforeValue = before[cellIndex] || 0;
            const afterValue = after[cellIndex] || 0;
            if (beforeValue !== afterValue) {
                return {
                    objectName,
                    cellIndex,
                    before: beforeValue,
                    after: afterValue,
                };
            }
        }
    }
    return null;
}

function firstLayerSnapshotDifference(beforeSnapshots, layerIds) {
    for (const layerId of layerIds) {
        const before = beforeSnapshots.get(layerId) || [];
        const after = layerOccupancySnapshot(layerId);
        const length = Math.max(before.length, after.length);
        for (let cellIndex = 0; cellIndex < length; cellIndex++) {
            const beforeValue = before[cellIndex] || '';
            const afterValue = after[cellIndex] || '';
            if (beforeValue !== afterValue) {
                return {
                    layerId,
                    cellIndex,
                    before: beforeValue,
                    after: afterValue,
                };
            }
        }
    }
    return null;
}

function firstQuantityDifference(beforeCounts, quantityContracts) {
    for (const contract of quantityContracts) {
        const before = beforeCounts.get(contract.objectName) || 0;
        const after = objectCountSnapshot(contract.objectName);
        if (contract.neverIncreases && after > before) {
            return {
                objectName: contract.objectName,
                before,
                after,
                claim: 'quantity.never_increases',
            };
        }
        if (contract.neverDecreases && after < before) {
            return {
                objectName: contract.objectName,
                before,
                after,
                claim: 'quantity.never_decreases',
            };
        }
    }
    return null;
}

function firstTemporaryPresence(objectNames) {
    for (const objectName of objectNames) {
        const count = objectCountSnapshot(objectName);
        if (count !== 0) {
            return { objectName, count };
        }
    }
    return null;
}

function quantityClaimCount(quantityContracts) {
    let count = 0;
    for (const contract of quantityContracts) {
        if (contract.neverIncreases) count++;
        if (contract.neverDecreases) count++;
    }
    return count;
}

function quantityObjectNames(quantityContracts) {
    return quantityContracts.map(contract => contract.objectName);
}

function bitVecArraySnapshot(items) {
    return Array.from(items || [], item => {
        if (item && item.data) {
            return Array.from(item.data);
        }
        return item;
    });
}

function solverVisibleStateSnapshot() {
    // These noop facts are solver-state claims, not UI-message cleanup claims.
    return {
        board: boardIdentity(),
        curlevel: typeof curlevel === 'number' ? curlevel : null,
        curlevelTarget: curlevelTarget === null ? null : JSON.stringify(curlevelTarget),
        winning: Boolean(winning),
        againing: Boolean(againing),
        textMode: Boolean(textMode),
        titleScreen: Boolean(titleScreen),
        objects: Array.from(level.objects || []),
        movements: Array.from(level.movements || []),
        rigidGroupIndexMask: bitVecArraySnapshot(level.rigidGroupIndexMask),
        rigidMovementAppliedMask: bitVecArraySnapshot(level.rigidMovementAppliedMask),
    };
}

function projectedSolverVisibleStateSnapshot(objectNames) {
    if (!Array.isArray(objectNames) || objectNames.length === 0) {
        return solverVisibleStateSnapshot();
    }
    const runtimeState = captureRuntimeProbeState();
    try {
        applyCosmeticProjection(objectNames);
        return solverVisibleStateSnapshot();
    } finally {
        restoreRuntimeProbeState(runtimeState);
    }
}

function solverCoreBoardIdentity() {
    const identity = boardIdentity();
    return {
        available: identity.available,
        curlevel: identity.curlevel,
        curlevelTarget: identity.curlevelTarget,
        width: identity.width,
        height: identity.height,
        nTiles: identity.nTiles,
    };
}

function solverCoreStateSnapshot() {
    return {
        board: solverCoreBoardIdentity(),
        curlevel: typeof curlevel === 'number' ? curlevel : null,
        curlevelTarget: curlevelTarget === null ? null : JSON.stringify(curlevelTarget),
        winning: Boolean(winning),
        againing: Boolean(againing),
        objects: canSnapshotBoard() ? Array.from(level.objects || []) : [],
        movements: canSnapshotBoard() ? Array.from(level.movements || []) : [],
        rigidGroupIndexMask: canSnapshotBoard() ? bitVecArraySnapshot(level.rigidGroupIndexMask) : [],
        rigidMovementAppliedMask: canSnapshotBoard() ? bitVecArraySnapshot(level.rigidMovementAppliedMask) : [],
    };
}

function evaluateWincondition(wincondition) {
    const filter1 = wincondition[1];
    const filter2 = wincondition[2];
    const aggregate1 = wincondition[4];
    const aggregate2 = wincondition[5];
    const matchesFirst = aggregate1
        ? cell => filter1.bitsSetInArray(cell)
        : cell => !filter1.bitsClearInArray(cell);
    const matchesSecond = aggregate2
        ? cell => filter2.bitsSetInArray(cell)
        : cell => !filter2.bitsClearInArray(cell);

    switch (wincondition[0]) {
        case -1:
            for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
                const cell = level.getCell(cellIndex);
                if (matchesFirst(cell.data) && matchesSecond(cell.data)) return false;
            }
            return true;
        case 0:
            for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
                const cell = level.getCell(cellIndex);
                if (matchesFirst(cell.data) && matchesSecond(cell.data)) return true;
            }
            return false;
        case 1:
            for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
                const cell = level.getCell(cellIndex);
                if (matchesFirst(cell.data) && !matchesSecond(cell.data)) return false;
            }
            return true;
        default:
            throw new Error(`unknown wincondition quantifier ${JSON.stringify(wincondition[0])}`);
    }
}

function winconditionTruthSnapshot() {
    if (!canSnapshotBoard() || !state || !Array.isArray(state.winconditions)) return [];
    return state.winconditions.map(evaluateWincondition);
}

function winflowContractFromFact(fact) {
    const value = (fact && fact.value) || {};
    const winIds = Array.isArray(value.win_ids) ? value.win_ids.slice() : [];
    const ruleIds = new Set(Array.isArray(value.rule_ids) ? value.rule_ids : []);
    const wakeByRuleId = new Map();
    for (const ruleId of ruleIds) {
        wakeByRuleId.set(ruleId, new Set());
    }
    for (const edge of value.wake_edges || []) {
        if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
        if (!wakeByRuleId.has(edge.from)) wakeByRuleId.set(edge.from, new Set());
        wakeByRuleId.get(edge.from).add(edge.to);
    }
    return { winIds, ruleIds, wakeByRuleId };
}

function staticRuleGroupsByRuntimePhase(staticAnalysisReport) {
    const phases = { early: [], late: [] };
    const sections = staticAnalysisReport
        && staticAnalysisReport.ps_tagged
        && staticAnalysisReport.ps_tagged.rule_sections;
    for (const section of sections || []) {
        const target = section.name === 'late' ? phases.late : phases.early;
        for (const group of section.groups || []) {
            target.push(group.rules || []);
        }
    }
    return phases;
}

function wrapRuleApplyAtForWinflow(rule, ruleId, appliedRuleIds) {
    if (!rule || typeof rule.applyAt !== 'function') return false;
    if (rule.__staticAnalysisWinflowWrapped) return true;
    const originalApplyAt = rule.applyAt;
    rule.__staticAnalysisRuleId = ruleId;
    rule.__staticAnalysisWinflowWrapped = true;
    rule.applyAt = function (...args) {
        const modified = originalApplyAt.apply(this, args);
        if (modified) appliedRuleIds.add(ruleId);
        return modified;
    };
    return true;
}

function installWinflowRuleRecorder(staticAnalysisReport, appliedRuleIds) {
    const staticGroups = staticRuleGroupsByRuntimePhase(staticAnalysisReport);
    let runtimeRuleCount = 0;
    let staticRuleCount = 0;
    let mappedRuleCount = 0;

    function annotatePhase(runtimeGroups, phaseGroups) {
        runtimeRuleCount += (runtimeGroups || []).reduce((sum, group) => sum + group.length, 0);
        staticRuleCount += (phaseGroups || []).reduce((sum, group) => sum + group.length, 0);
        const groupCount = Math.min((runtimeGroups || []).length, (phaseGroups || []).length);
        for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
            const runtimeGroup = runtimeGroups[groupIndex] || [];
            const staticGroup = phaseGroups[groupIndex] || [];
            const ruleCount = Math.min(runtimeGroup.length, staticGroup.length);
            for (let ruleIndex = 0; ruleIndex < ruleCount; ruleIndex++) {
                const staticRule = staticGroup[ruleIndex];
                if (staticRule && wrapRuleApplyAtForWinflow(runtimeGroup[ruleIndex], staticRule.id, appliedRuleIds)) {
                    mappedRuleCount++;
                }
            }
        }
    }

    annotatePhase(state.rules, staticGroups.early);
    annotatePhase(state.lateRules, staticGroups.late);
    return {
        mappedRuleCount,
        runtimeRuleCount,
        staticRuleCount,
        complete: runtimeRuleCount === staticRuleCount && mappedRuleCount === runtimeRuleCount,
    };
}

function inputMayMoveWithoutRule(inputToken) {
    return Number.isInteger(inputToken) && inputToken >= 0 && inputToken <= 4;
}

function checkWinflowCache(testName, label, contract, cache, appliedRuleIds, options = {}) {
    const actual = winconditionTruthSnapshot();
    if (actual.length === 0 || contract.winIds.length === 0) {
        return { cache: actual, cleanChecks: 0, diff: null };
    }
    if (actual.length !== contract.winIds.length) {
        throw new Error(`${testName}: winflow wincondition count changed at ${label}; static ${contract.winIds.length}, runtime ${actual.length}`);
    }
    if (!Array.isArray(cache) || cache.length !== actual.length) {
        cache = actual.slice();
    }

    const dirtyWinIds = new Set();
    if (options.dirtyAll) {
        for (const winId of contract.winIds) dirtyWinIds.add(winId);
    } else {
        for (const ruleId of appliedRuleIds) {
            const winIds = contract.wakeByRuleId.get(ruleId);
            for (const winId of winIds || []) dirtyWinIds.add(winId);
        }
    }

    let cleanChecks = 0;
    for (let index = 0; index < actual.length; index++) {
        const winId = contract.winIds[index] || `win_${index}`;
        if (dirtyWinIds.has(winId)) {
            cache[index] = actual[index];
            continue;
        }
        cleanChecks++;
        if (cache[index] !== actual[index]) {
            return {
                cache,
                cleanChecks,
                diff: {
                    winId,
                    index,
                    cached: cache[index],
                    actual: actual[index],
                    appliedRuleIds: Array.from(appliedRuleIds).sort(),
                    dirtyWinIds: Array.from(dirtyWinIds).sort(),
                },
            };
        }
    }
    return { cache, cleanChecks, diff: null };
}

function canonicalMergeName(runtimeName, aliasMap) {
    let name = runtimeName;
    const seen = new Set();
    while (aliasMap.has(name) && !seen.has(name)) {
        seen.add(name);
        name = aliasMap.get(name);
    }
    return name;
}

function mergeCanonicalStateSnapshot(aliasMap) {
    const snapshot = {
        board: solverCoreBoardIdentity(),
        curlevel: typeof curlevel === 'number' ? curlevel : null,
        curlevelTarget: curlevelTarget === null ? null : JSON.stringify(curlevelTarget),
        winning: Boolean(winning),
        againing: Boolean(againing),
        cells: [],
    };
    if (!canSnapshotBoard()) return snapshot;

    const objectEntries = Object.entries(state.objects || {})
        .filter(([_name, object]) => object && Number.isInteger(object.id))
        .sort((left, right) => left[1].id - right[1].id);
    for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
        const cell = level.getCell(cellIndex);
        const names = [];
        for (const [name, object] of objectEntries) {
            if (cell.get(object.id)) names.push(canonicalMergeName(name, aliasMap));
        }
        snapshot.cells.push(Array.from(new Set(names)).sort());
    }
    return snapshot;
}

function namedBoardStateSnapshot() {
    const snapshot = {
        board: solverCoreBoardIdentity(),
        curlevel: typeof curlevel === 'number' ? curlevel : null,
        curlevelTarget: curlevelTarget === null ? null : JSON.stringify(curlevelTarget),
        winning: Boolean(winning),
        againing: Boolean(againing),
        cells: [],
        movements: canSnapshotBoard() ? Array.from(level.movements || []) : [],
        rigidGroupIndexMask: canSnapshotBoard() ? bitVecArraySnapshot(level.rigidGroupIndexMask) : [],
        rigidMovementAppliedMask: canSnapshotBoard() ? bitVecArraySnapshot(level.rigidMovementAppliedMask) : [],
    };
    if (!canSnapshotBoard()) return snapshot;

    const objectEntries = Object.entries(state.objects || {})
        .filter(([_name, object]) => object && Number.isInteger(object.id))
        .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true }));
    for (let cellIndex = 0; cellIndex < level.n_tiles; cellIndex++) {
        const cell = level.getCell(cellIndex);
        const names = [];
        for (const [name, object] of objectEntries) {
            if (cell.get(object.id)) names.push(name);
        }
        snapshot.cells.push(names);
    }
    return snapshot;
}

function cosmeticRuleProjectionSnapshot(objectNames) {
    const runtimeState = captureRuntimeProbeState();
    try {
        applyCosmeticProjection(objectNames);
        return namedBoardStateSnapshot();
    } finally {
        restoreRuntimeProbeState(runtimeState);
    }
}

function cloneRandomGenerator(generator) {
    if (!generator) return generator;
    const clone = new RNG(generator.seed);
    clone._normal = generator._normal;
    if (generator._state) {
        clone._state = new RC4('');
        clone._state.s = generator._state.s.slice();
        clone._state.i = generator._state.i;
        clone._state.j = generator._state.j;
    } else {
        clone._state = null;
        clone.uniform = generator.uniform;
        clone.nextByte = generator.nextByte;
    }
    return clone;
}

function captureRuntimeProbeState() {
    return {
        levelState: backupLevel(),
        commandQueue: (level.commandQueue || []).slice(),
        commandQueueSourceRules: (level.commandQueueSourceRules || []).slice(),
        backups: backups.slice(),
        restartTarget,
        RandomGen: cloneRandomGenerator(RandomGen),
        curlevel,
        curlevelTarget,
        hasUsedCheckpoint,
        levelEditorOpened,
        ignoreNotJustPressedAction,
        textMode,
        winning,
        againing,
        timer,
        autotick,
        oldflickscreendat: oldflickscreendat.concat([]),
        restarting,
        messageselected,
        messagetext,
        titleScreen,
        soundHistory: soundHistory.slice(),
    };
}

function restoreRuntimeProbeState(snapshot) {
    restoreLevel(snapshot.levelState);
    level.commandQueue = snapshot.commandQueue.slice();
    level.commandQueueSourceRules = snapshot.commandQueueSourceRules.slice();
    backups = snapshot.backups;
    restartTarget = snapshot.restartTarget;
    RandomGen = snapshot.RandomGen;
    curlevel = snapshot.curlevel;
    curlevelTarget = snapshot.curlevelTarget;
    hasUsedCheckpoint = snapshot.hasUsedCheckpoint;
    levelEditorOpened = snapshot.levelEditorOpened;
    ignoreNotJustPressedAction = snapshot.ignoreNotJustPressedAction;
    textMode = snapshot.textMode;
    winning = snapshot.winning;
    againing = snapshot.againing;
    timer = snapshot.timer;
    autotick = snapshot.autotick;
    oldflickscreendat = snapshot.oldflickscreendat.concat([]);
    restarting = snapshot.restarting;
    messageselected = snapshot.messageselected;
    messagetext = snapshot.messagetext;
    titleScreen = snapshot.titleScreen;
    soundHistory = snapshot.soundHistory;
}

function firstArrayDifference(before, after) {
    if (!Array.isArray(before) || !Array.isArray(after)) return null;
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index++) {
        const beforeValue = before[index];
        const afterValue = after[index];
        if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
            return { index, before: beforeValue, after: afterValue };
        }
    }
    return null;
}

function firstProbeDifference(before, after, modified, options = {}) {
    for (const key of Object.keys(before)) {
        if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
        const arrayDiff = firstArrayDifference(before[key], after[key]);
        if (arrayDiff) {
            return {
                field: key,
                index: arrayDiff.index,
                before: arrayDiff.before,
                after: arrayDiff.after,
            };
        }
        return {
            field: key,
            before: before[key],
            after: after[key],
        };
    }
    if (modified !== false && options.ignoreModifiedWhenStateEqual !== true) {
        return {
            field: 'modified',
            before: false,
            after: modified,
        };
    }
    return null;
}

function firstActionUnnecessaryProbeDifference(testName, label, projectionObjectNames = []) {
    if (state && state.metadata && Object.prototype.hasOwnProperty.call(state.metadata, 'noaction')) {
        return null;
    }
    const before = projectedSolverVisibleStateSnapshot(projectionObjectNames);
    const runtimeState = captureRuntimeProbeState();
    try {
        const actionRuntimeState = captureRuntimeProbeState();
        let actionModified;
        let actionAfter;
        try {
            actionModified = processInput(4);
            drainAgain(`${testName}: action-unnecessary probe ${label}`);
            actionAfter = projectedSolverVisibleStateSnapshot(projectionObjectNames);
        } finally {
            restoreRuntimeProbeState(actionRuntimeState);
        }
        const noopDiff = firstProbeDifference(
            before,
            actionAfter,
            actionModified,
            { ignoreModifiedWhenStateEqual: true }
        );
        if (noopDiff === null) return null;

        for (const directionInput of [0, 1, 2, 3]) {
            const directionRuntimeState = captureRuntimeProbeState();
            try {
                const directionModified = processInput(directionInput);
                drainAgain(`${testName}: action-unnecessary direction probe ${label}/${directionInput}`);
                const directionDiff = firstProbeDifference(
                    actionAfter,
                    projectedSolverVisibleStateSnapshot(projectionObjectNames),
                    directionModified,
                    { ignoreModifiedWhenStateEqual: true }
                );
                if (directionDiff === null) return null;
            } finally {
                restoreRuntimeProbeState(directionRuntimeState);
            }
        }
        return noopDiff;
    } finally {
        restoreRuntimeProbeState(runtimeState);
    }
}

function firstTickNoopProbeDifference(testName, label) {
    const before = solverVisibleStateSnapshot();
    const runtimeState = captureRuntimeProbeState();
    let modified;
    try {
        modified = processInput(-1);
        drainAgain(`${testName}: tick-noop probe ${label}`);
        return firstProbeDifference(before, solverVisibleStateSnapshot(), modified);
    } finally {
        restoreRuntimeProbeState(runtimeState);
    }
}

function replayBoundarySnapshot(boundary) {
    return {
        boundary,
        identity: boardIdentity(),
        serializedLevel: canSnapshotBoard() ? convertLevelToString() : null,
        sounds: soundHistory.join(';'),
    };
}

function alternateRandomSeed(testName) {
    return `static-analysis-no-random:${testName}`;
}

function replayBoundaryTrace(testName, source, inputs, targetLevel, randomSeed, label) {
    const trace = [];
    compileSimulationSource(`${testName}: ${label}`, source, targetLevel, randomSeed);
    trace.push(replayBoundarySnapshot('initial'));
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
        const inputToken = inputs[inputIndex];
        executeInputToken(inputToken);
        drainAgain(`${testName}: ${label} input ${inputIndex} ${tokenLabel(inputToken)}`);
        trace.push(replayBoundarySnapshot(`input ${inputIndex} ${tokenLabel(inputToken)}`));
    }
    return trace;
}

function firstReplayTraceDifference(leftTrace, rightTrace) {
    const length = Math.max(leftTrace.length, rightTrace.length);
    for (let index = 0; index < length; index++) {
        const left = leftTrace[index] || null;
        const right = rightTrace[index] || null;
        if (JSON.stringify(left) !== JSON.stringify(right)) {
            return { index, left, right };
        }
    }
    return null;
}

function executeInputToken(inputToken) {
    if (inputToken === 'undo') {
        DoUndo(false, true);
        return { resetsSnapshot: true };
    }
    if (inputToken === 'restart') {
        DoRestart();
        return { resetsSnapshot: true };
    }
    if (inputToken === 'tick') {
        processInput(-1);
        return { resetsSnapshot: false };
    }
    processInput(inputToken);
    return { resetsSnapshot: false };
}

function compileSimulationSource(testName, source, targetLevel, randomSeed, optimizationHook = null) {
    levelString = source;
    resetParserErrors();
    if (optimizationHook && typeof setPluginOptimizationHook !== 'function') {
        throw new Error(`${testName}: plugin optimization hooks are unavailable`);
    }
    if (optimizationHook) setPluginOptimizationHook(optimizationHook);
    try {
        compile(['loadLevel', targetLevel], source, randomSeed);
        return drainAgain(`${testName}: initial compile`);
    } finally {
        if (optimizationHook) setPluginOptimizationHook(null);
    }
}

function tokenLabel(inputToken) {
    return typeof inputToken === 'string' ? inputToken : String(inputToken);
}

function assertFinalReplayParity(testName, expectedSerializedLevel, expectedSounds) {
    const actualSerializedLevel = convertLevelToString();
    if (actualSerializedLevel !== expectedSerializedLevel) {
        throw new Error(`${testName}: final serialized level differs from simulation expectation`);
    }

    if (expectedSounds !== null) {
        const actualSounds = soundHistory.join(';');
        const expectedSoundText = expectedSounds.join(';');
        if (actualSounds !== expectedSoundText) {
            throw new Error(`${testName}: sound output expected ${JSON.stringify(expectedSoundText)}, got ${JSON.stringify(actualSounds)}`);
        }
    }
}

function replayFinalSerializedLevel(testName, source, inputs, options = {}) {
    ensureRuntimeLoaded();
    const targetLevel = options.targetLevel === undefined ? 0 : options.targetLevel;
    const randomSeed = options.randomSeed === undefined ? null : options.randomSeed;
    const previousUnitTesting = unitTesting;
    const previousLazyFunctionGeneration = lazyFunctionGeneration;
    unitTesting = true;
    lazyFunctionGeneration = false;
    try {
        compileSimulationSource(testName, source, targetLevel, randomSeed);
        for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            const inputToken = inputs[inputIndex];
            executeInputToken(inputToken);
            drainAgain(`${testName}: fixture generation input ${inputIndex} ${tokenLabel(inputToken)}`);
        }
        return convertLevelToString();
    } finally {
        unitTesting = previousUnitTesting;
        lazyFunctionGeneration = previousLazyFunctionGeneration;
    }
}

function throwProbeError(testName, kind, inputIndex, inputToken, diff) {
    const location = diff.index === undefined ? '' : `  index: ${diff.index}\n`;
    throw new Error([
        `${testName}: ${kind} claim violated`,
        `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
        `  field: ${diff.field}`,
        location + `  before: ${JSON.stringify(diff.before)}`,
        `  after: ${JSON.stringify(diff.after)}`,
    ].join('\n'));
}

function runSimulationWithStaticChecks(testName, dataarray) {
    ensureRuntimeLoaded();
    const source = dataarray[0];
    const inputs = dataarray[1];
    const expectedSerializedLevel = dataarray[2];
    const targetLevel = dataarray[3] === undefined ? 0 : dataarray[3];
    const randomSeed = dataarray[4] === undefined ? null : dataarray[4];
    const expectedSounds = dataarray[5] === undefined ? null : dataarray[5];
    const staticContract = staticContractForSource(source, testName);
    const staticObjects = staticContract.objectNames;
    const staticLayers = staticContract.staticLayerIds;
    const inertLayers = staticContract.inertLayerIds;
    const constantQuantityObjects = staticContract.constantQuantityObjectNames;
    const quantityContracts = staticContract.quantityContracts;
    const temporaryObjects = staticContract.temporaryObjectNames;
    const neverAppearsObjects = staticContract.neverAppearsObjectNames;
    let cosmeticObjects = staticContract.cosmeticObjectNames;
    const cosmeticRuleSourceLines = staticContract.cosmeticRuleSourceLines;
    const optimizerCosmeticRuleSourceLines = staticContract.optimizerCosmeticRuleSourceLines;
    const inertCommandRuleSourceLines = staticContract.inertCommandRuleSourceLines;
    const mergeCandidatePairs = staticContract.mergeCandidatePairs;
    let cosmeticRuleProjectionObjects = [];
    let mergeAliasMap = new Map();
    let mergeGroupCount = 0;
    const winflowContract = winflowContractFromFact(staticContract.winflowFact);
    const winflowAppliedRuleIds = new Set();
    let winflowCache = [];
    let winflowRecorderComplete = false;
    const countedObjects = quantityObjectNames(quantityContracts);
    const actionUnnecessaryProved = staticContract.actionUnnecessaryProved;
    const tickNoopProved = staticContract.tickNoopProved;
    const noAgainProved = staticContract.noAgainProved;
    const noRandomProved = staticContract.noRandomProved;
    const checkNoRandomReplay = noRandomProved && randomSeed === null;

    const previousUnitTesting = unitTesting;
    const previousLazyFunctionGeneration = lazyFunctionGeneration;
    unitTesting = true;
    lazyFunctionGeneration = false;

    let objectBoundaryChecks = 0;
    let staticLayerBoundaryChecks = 0;
    let inertLayerBoundaryChecks = 0;
    let quantityBoundaryChecks = 0;
    let temporaryBoundaryChecks = 0;
    let neverAppearsBoundaryChecks = 0;
    let actionUnnecessaryBoundaryChecks = 0;
    let tickNoopBoundaryChecks = 0;
    let noAgainBoundaryChecks = 0;
    let noRandomReplayChecks = 0;
    let cosmeticProjectionChecks = 0;
    let cosmeticRuleProjectionChecks = 0;
    let cosmeticRuleOptimizerProjectionChecks = 0;
    let inertCommandRuleSuppressionChecks = 0;
    let mergeProjectionChecks = 0;
    let winflowBoundaryChecks = 0;
    let winflowCleanWinconditionChecks = 0;
    let restartBoundaryTriggered = false;
    const previousDoRestart = global.DoRestart;
    if (typeof previousDoRestart === 'function') {
        global.DoRestart = function (...args) {
            restartBoundaryTriggered = true;
            return previousDoRestart.apply(this, args);
        };
    }
    try {
        const initialAgainSteps = compileSimulationSource(testName, source, targetLevel, randomSeed);
        cosmeticRuleProjectionObjects = cosmeticRuleProjectionObjectNames(cosmeticObjects);
        cosmeticObjects = projectableCosmeticObjectNames(cosmeticObjects, staticContract.referencedObjectNames);
        const mergeAliases = buildMergeAliasMap(mergeCandidatePairs, new Set(staticContract.cosmeticObjectNames), state, {
            excludedNames: mergeMutationObjectNames(staticContract.staticAnalysisReport),
        });
        mergeAliasMap = mergeAliases.alias;
        mergeGroupCount = mergeAliases.groups;
        const winflowRecorder = installWinflowRuleRecorder(staticContract.staticAnalysisReport, winflowAppliedRuleIds);
        winflowRecorderComplete = winflowRecorder.complete;
        winflowCache = winconditionTruthSnapshot();
        if (noAgainProved) {
            noAgainBoundaryChecks++;
            if (initialAgainSteps !== 0) {
                throw new Error([
                    `${testName}: no-again claim violated`,
                    '  boundary: initial compile',
                    `  again steps: ${initialAgainSteps}`,
                ].join('\n'));
            }
        }

        let currentIdentity = boardIdentity();
        let objectSnapshots = snapshotStaticObjects(staticObjects);
        let staticLayerSnapshots = snapshotLayers(staticLayers);
        let inertLayerSnapshots = snapshotLayers(inertLayers);
        let countSnapshots = snapshotObjectCounts(countedObjects);
        const noRandomTrace = checkNoRandomReplay
            ? [replayBoundarySnapshot('initial')]
            : [];

        for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            const inputToken = inputs[inputIndex];
            restartBoundaryTriggered = false;
            winflowAppliedRuleIds.clear();
            const result = executeInputToken(inputToken);
            const againSteps = drainAgain(`${testName}: input ${inputIndex} ${tokenLabel(inputToken)}`);
            if (noAgainProved) {
                noAgainBoundaryChecks++;
                if (againSteps !== 0) {
                    throw new Error([
                        `${testName}: no-again claim violated`,
                        `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
                        `  again steps: ${againSteps}`,
                    ].join('\n'));
                }
            }
            if (checkNoRandomReplay) {
                noRandomTrace.push(replayBoundarySnapshot(`input ${inputIndex} ${tokenLabel(inputToken)}`));
            }

            const nextIdentity = boardIdentity();
            const resetBoundary =
                result.resetsSnapshot
                || restartBoundaryTriggered
                || !sameBoardIdentity(currentIdentity, nextIdentity)
                || !canSnapshotBoard();

            if (canSnapshotBoard()) {
                const temporaryDiff = firstTemporaryPresence(temporaryObjects);
                if (temporaryDiff) {
                    throw new Error([
                        `${testName}: temporary object survived stable boundary`,
                        `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
                        `  object: ${temporaryDiff.objectName}`,
                        `  count: ${temporaryDiff.count}`,
                    ].join('\n'));
                }
                temporaryBoundaryChecks += temporaryObjects.length;
                const neverAppearsDiff = firstTemporaryPresence(neverAppearsObjects);
                if (neverAppearsDiff) {
                    throw new Error([
                        `${testName}: never-appears object appeared at stable boundary`,
                        `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
                        `  object: ${neverAppearsDiff.objectName}`,
                        `  count: ${neverAppearsDiff.count}`,
                    ].join('\n'));
                }
                neverAppearsBoundaryChecks += neverAppearsObjects.length;
            }

            if (resetBoundary) {
                currentIdentity = nextIdentity;
                objectSnapshots = snapshotStaticObjects(staticObjects);
                staticLayerSnapshots = snapshotLayers(staticLayers);
                inertLayerSnapshots = snapshotLayers(inertLayers);
                countSnapshots = snapshotObjectCounts(countedObjects);
                winflowCache = winconditionTruthSnapshot();
                continue;
            }

            const diff = firstSnapshotDifference(objectSnapshots, staticObjects);
            if (diff) {
                throw new Error([
                    `${testName}: static object occupancy changed`,
                    `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
                    `  object: ${diff.objectName}`,
                    `  cell: ${diff.cellIndex}`,
                    `  before: ${diff.before}`,
                    `  after: ${diff.after}`,
                ].join('\n'));
            }

            const staticLayerDiff = firstLayerSnapshotDifference(staticLayerSnapshots, staticLayers);
            if (staticLayerDiff) {
                throw new Error([
                    `${testName}: static layer occupancy changed`,
                    `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
                    `  layer: ${staticLayerDiff.layerId}`,
                    `  cell: ${staticLayerDiff.cellIndex}`,
                    `  before: ${staticLayerDiff.before}`,
                    `  after: ${staticLayerDiff.after}`,
                ].join('\n'));
            }

            const inertLayerDiff = firstLayerSnapshotDifference(inertLayerSnapshots, inertLayers);
            if (inertLayerDiff) {
                throw new Error([
                    `${testName}: inert layer occupancy changed`,
                    `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
                    `  layer: ${inertLayerDiff.layerId}`,
                    `  cell: ${inertLayerDiff.cellIndex}`,
                    `  before: ${inertLayerDiff.before}`,
                    `  after: ${inertLayerDiff.after}`,
                ].join('\n'));
            }

            const countDiff = firstQuantityDifference(countSnapshots, quantityContracts);
            if (countDiff) {
                throw new Error([
                    `${testName}: quantity monotonicity claim violated`,
                    `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
                    `  claim: ${countDiff.claim}`,
                    `  object: ${countDiff.objectName}`,
                    `  before: ${countDiff.before}`,
                    `  after: ${countDiff.after}`,
                ].join('\n'));
            }

            const winflowCheck = checkWinflowCache(
                testName,
                `input ${inputIndex} ${tokenLabel(inputToken)}`,
                winflowContract,
                winflowCache,
                winflowAppliedRuleIds,
                { dirtyAll: !winflowRecorderComplete || inputMayMoveWithoutRule(inputToken) }
            );
            winflowCache = winflowCheck.cache;
            winflowCleanWinconditionChecks += winflowCheck.cleanChecks;
            if (winflowCheck.cleanChecks > 0) winflowBoundaryChecks++;
            if (winflowCheck.diff) {
                throw new Error([
                    `${testName}: winflow cache claim violated`,
                    `  input ${inputIndex}: ${tokenLabel(inputToken)}`,
                    `  win: ${winflowCheck.diff.winId}`,
                    `  cached: ${JSON.stringify(winflowCheck.diff.cached)}`,
                    `  actual: ${JSON.stringify(winflowCheck.diff.actual)}`,
                    `  applied rules: ${JSON.stringify(winflowCheck.diff.appliedRuleIds)}`,
                    `  dirty wins: ${JSON.stringify(winflowCheck.diff.dirtyWinIds)}`,
                ].join('\n'));
            }

            objectBoundaryChecks += staticObjects.length;
            staticLayerBoundaryChecks += staticLayers.length;
            inertLayerBoundaryChecks += inertLayers.length;
            quantityBoundaryChecks += quantityClaimCount(quantityContracts);
            if (actionUnnecessaryProved) {
                const restartBoundaryBeforeProbe = restartBoundaryTriggered;
                const actionDiff = firstActionUnnecessaryProbeDifference(
                    testName,
                    `input ${inputIndex} ${tokenLabel(inputToken)}`,
                    cosmeticRuleProjectionObjects
                );
                restartBoundaryTriggered = restartBoundaryBeforeProbe;
                if (actionDiff) {
                    throwProbeError(testName, 'action-unnecessary', inputIndex, inputToken, actionDiff);
                }
                actionUnnecessaryBoundaryChecks++;
            }
            if (tickNoopProved) {
                const restartBoundaryBeforeProbe = restartBoundaryTriggered;
                const tickDiff = firstTickNoopProbeDifference(testName, `input ${inputIndex} ${tokenLabel(inputToken)}`);
                restartBoundaryTriggered = restartBoundaryBeforeProbe;
                if (tickDiff) {
                    throwProbeError(testName, 'tick-noop', inputIndex, inputToken, tickDiff);
                }
                tickNoopBoundaryChecks++;
            }
            countSnapshots = snapshotObjectCounts(countedObjects);
            currentIdentity = nextIdentity;
        }

        assertFinalReplayParity(testName, expectedSerializedLevel, expectedSounds);

        const normalInertCommandCoreState = inertCommandRuleSourceLines.length > 0
            ? solverCoreStateSnapshot()
            : null;
        const normalCosmeticProjection = cosmeticObjects.length > 0
            ? cosmeticProjectionSnapshot(cosmeticObjects)
            : null;
        const normalCosmeticRuleProjection = (cosmeticRuleSourceLines.length > 0 || optimizerCosmeticRuleSourceLines.length > 0)
            ? cosmeticRuleProjectionSnapshot(cosmeticRuleProjectionObjects)
            : null;
        const normalMergeProjection = mergeAliasMap.size > 0
            ? mergeCanonicalStateSnapshot(mergeAliasMap)
            : null;

        if (inertCommandRuleSourceLines.length > 0) {
            const suppressedCoreState = runInertCommandSuppressedReplayFinalState(
                testName,
                source,
                inputs,
                targetLevel,
                randomSeed,
                inertCommandRuleSourceLines
            );
            const coreStateDiff = firstReplayTraceDifference([normalInertCommandCoreState], [suppressedCoreState]);
            if (coreStateDiff) {
                throw new Error([
                    `${testName}: inert command rule suppression replay diverged`,
                    `  normal solver state: ${JSON.stringify(coreStateDiff.left)}`,
                    `  suppressed solver state: ${JSON.stringify(coreStateDiff.right)}`,
                ].join('\n'));
            }
            inertCommandRuleSuppressionChecks++;
        }

        if (mergeAliasMap.size > 0) {
            const optimizedReplay = runMergeOptimizedReplayFinalProjection(
                testName,
                source,
                inputs,
                targetLevel,
                randomSeed,
                staticContract.staticAnalysisReport,
                mergeAliasMap
            );
            const telemetryAliases = optimizedReplay.telemetry.merged_object_aliases || 0;
            if (telemetryAliases !== mergeAliasMap.size) {
                throw new Error([
                    `${testName}: merge optimizer folded ${telemetryAliases} aliases, expected ${mergeAliasMap.size}`,
                ].join('\n'));
            }
            const mergeDiff = firstReplayTraceDifference([normalMergeProjection], [optimizedReplay.snapshot]);
            if (mergeDiff) {
                throw new Error([
                    `${testName}: merge-optimized replay diverged after canonical projection`,
                    `  normal projected: ${JSON.stringify(mergeDiff.left)}`,
                    `  optimized projected: ${JSON.stringify(mergeDiff.right)}`,
                ].join('\n'));
            }
            mergeProjectionChecks++;
        }

        if (cosmeticObjects.length > 0) {
            const projectedReplayProjection = runProjectedReplayFinalProjection(
                testName,
                source,
                inputs,
                targetLevel,
                randomSeed,
                cosmeticObjects
            );
            const projectionDiff = firstReplayTraceDifference([normalCosmeticProjection], [projectedReplayProjection]);
            if (projectionDiff) {
                throw new Error([
                    `${testName}: cosmetic projection replay diverged`,
                    `  normal projected: ${JSON.stringify(projectionDiff.left)}`,
                    `  projected replay: ${JSON.stringify(projectionDiff.right)}`,
                ].join('\n'));
            }
            cosmeticProjectionChecks++;
        }

        if (cosmeticRuleSourceLines.length > 0) {
            const suppressedReplayProjection = runCosmeticRuleSuppressedReplayFinalProjection(
                testName,
                source,
                inputs,
                targetLevel,
                randomSeed,
                cosmeticRuleSourceLines,
                cosmeticRuleProjectionObjects
            );
            const projectionDiff = firstReplayTraceDifference([normalCosmeticRuleProjection], [suppressedReplayProjection]);
            if (projectionDiff) {
                throw new Error([
                    `${testName}: cosmetic rule suppression replay diverged`,
                    `  normal projected: ${JSON.stringify(projectionDiff.left)}`,
                    `  suppressed projected: ${JSON.stringify(projectionDiff.right)}`,
                ].join('\n'));
            }
            cosmeticRuleProjectionChecks++;
        }

        if (optimizerCosmeticRuleSourceLines.length > 0) {
            const optimizedReplay = runCosmeticRuleOptimizedReplayFinalProjection(
                testName,
                source,
                inputs,
                targetLevel,
                randomSeed,
                staticContract.staticAnalysisReport,
                cosmeticRuleProjectionObjects
            );
            const removedRules = optimizedReplay.telemetry.removed_cosmetic_rules || 0;
            if (removedRules <= 0) {
                throw new Error([
                    `${testName}: cosmetic rule optimizer removed no rules`,
                    `  optimizer source lines: ${JSON.stringify(optimizerCosmeticRuleSourceLines)}`,
                ].join('\n'));
            }
            const projectionDiff = firstReplayTraceDifference([normalCosmeticRuleProjection], [optimizedReplay.projection]);
            if (projectionDiff) {
                throw new Error([
                    `${testName}: cosmetic-rule-optimized replay diverged after projection`,
                    `  normal projected: ${JSON.stringify(projectionDiff.left)}`,
                    `  optimized projected: ${JSON.stringify(projectionDiff.right)}`,
                ].join('\n'));
            }
            cosmeticRuleOptimizerProjectionChecks++;
        }

        if (checkNoRandomReplay) {
            const alternateTrace = replayBoundaryTrace(
                testName,
                source,
                inputs,
                targetLevel,
                alternateRandomSeed(testName),
                'alternate'
            );
            const traceDiff = firstReplayTraceDifference(noRandomTrace, alternateTrace);
            if (traceDiff) {
                throw new Error([
                    `${testName}: no-random replay changed under alternate seed`,
                    `  boundary index: ${traceDiff.index}`,
                    `  primary: ${JSON.stringify(traceDiff.left)}`,
                    `  alternate: ${JSON.stringify(traceDiff.right)}`,
                ].join('\n'));
            }
            noRandomReplayChecks = noRandomTrace.length;
        }

        return {
            staticObjectCount: staticObjects.length,
            staticLayerCount: staticLayers.length,
            inertLayerCount: inertLayers.length,
            constantQuantityObjectCount: constantQuantityObjects.length,
            temporaryObjectCount: temporaryObjects.length,
            neverAppearsObjectCount: neverAppearsObjects.length,
            cosmeticRuleCount: cosmeticRuleSourceLines.length,
            inertCommandRuleCount: inertCommandRuleSourceLines.length,
            objectBoundaryChecks,
            staticLayerBoundaryChecks,
            layerBoundaryChecks: staticLayerBoundaryChecks,
            inertLayerBoundaryChecks,
            quantityBoundaryChecks,
            temporaryBoundaryChecks,
            neverAppearsBoundaryChecks,
            cosmeticObjectCount: cosmeticObjects.length,
            cosmeticProjectionChecks,
            cosmeticRuleProjectionChecks,
            cosmeticRuleOptimizerProjectionChecks,
            inertCommandRuleSuppressionChecks,
            mergeAliasCount: mergeAliasMap.size,
            mergeGroupCount,
            mergeProjectionChecks,
            actionUnnecessaryProved,
            actionUnnecessaryBoundaryChecks,
            tickNoopProved,
            tickNoopBoundaryChecks,
            noAgainProved,
            noAgainBoundaryChecks,
            noRandomProved,
            noRandomReplayChecks,
            winflowWinconditionCount: winflowContract.winIds.length,
            winflowBoundaryChecks,
            winflowCleanWinconditionChecks,
            analysisUnavailableReason: staticContract.unavailableReason,
        };
    } finally {
        if (typeof previousDoRestart === 'function') {
            global.DoRestart = previousDoRestart;
        }
        unitTesting = previousUnitTesting;
        lazyFunctionGeneration = previousLazyFunctionGeneration;
    }
}

function testMatchesFilter(testName, filter) {
    return !filter || testName.toLowerCase().includes(filter.toLowerCase());
}

function progressLog(options, message) {
    if (options.progress) {
        console.error(message);
    }
}

function runAll(options = {}) {
    ensureRuntimeLoaded();
    assert.ok(Array.isArray(global.testdata), 'global.testdata should be loaded');

    const failures = [];
    let caseCount = 0;
    let casesWithStaticObjects = 0;
    let casesWithStaticLayers = 0;
    let casesWithInertLayers = 0;
    let casesWithConstantQuantityObjects = 0;
    let casesWithTemporaryObjects = 0;
    let casesWithNeverAppearsObjects = 0;
    let casesWithCosmeticObjects = 0;
    let casesWithCosmeticRules = 0;
    let casesWithInertCommandRules = 0;
    let casesWithMergeAliases = 0;
    let casesWithActionUnnecessary = 0;
    let casesWithTickNoop = 0;
    let casesWithNoAgain = 0;
    let casesWithNoRandomReplayChecks = 0;
    let casesWithWinflowCleanChecks = 0;
    let objectBoundaryChecks = 0;
    let staticLayerBoundaryChecks = 0;
    let inertLayerBoundaryChecks = 0;
    let quantityBoundaryChecks = 0;
    let temporaryBoundaryChecks = 0;
    let neverAppearsBoundaryChecks = 0;
    let cosmeticProjectionChecks = 0;
    let cosmeticRuleProjectionChecks = 0;
    let cosmeticRuleOptimizerProjectionChecks = 0;
    let inertCommandRuleSuppressionChecks = 0;
    let mergeProjectionChecks = 0;
    let actionUnnecessaryBoundaryChecks = 0;
    let tickNoopBoundaryChecks = 0;
    let noAgainBoundaryChecks = 0;
    let noRandomReplayChecks = 0;
    let winflowBoundaryChecks = 0;
    let winflowCleanWinconditionChecks = 0;
    let analysisUnavailableCount = 0;
    const entries = global.testdata.filter(entry => testMatchesFilter(entry[0], options.filter || null));

    if (entries.length === 0) {
        throw new Error(options.filter
            ? `No simulation tests matched filter ${JSON.stringify(options.filter)}`
            : 'No simulation tests were loaded');
    }

    progressLog(options, `static_analysis_runtime_contracts: running ${entries.length} simulation cases`);

    for (const [entryIndex, entry] of entries.entries()) {
        const testName = entry[0];
        const dataarray = entry[1];

        caseCount++;
        progressLog(options, `static_analysis_runtime_contracts: [${entryIndex + 1}/${entries.length}] ${testName}`);
        try {
            const result = runSimulationWithStaticChecks(testName, dataarray);
            if (result.staticObjectCount > 0) {
                casesWithStaticObjects++;
            }
            if (result.staticLayerCount > 0) {
                casesWithStaticLayers++;
            }
            if (result.inertLayerCount > 0) {
                casesWithInertLayers++;
            }
            if (result.constantQuantityObjectCount > 0) {
                casesWithConstantQuantityObjects++;
            }
            if (result.temporaryObjectCount > 0) {
                casesWithTemporaryObjects++;
            }
            if (result.neverAppearsObjectCount > 0) {
                casesWithNeverAppearsObjects++;
            }
            if (result.cosmeticObjectCount > 0) {
                casesWithCosmeticObjects++;
            }
            if (result.cosmeticRuleCount > 0) {
                casesWithCosmeticRules++;
            }
            if (result.inertCommandRuleCount > 0) {
                casesWithInertCommandRules++;
            }
            if (result.mergeAliasCount > 0) {
                casesWithMergeAliases++;
            }
            if (result.actionUnnecessaryProved) {
                casesWithActionUnnecessary++;
            }
            if (result.tickNoopProved) {
                casesWithTickNoop++;
            }
            if (result.noAgainProved) {
                casesWithNoAgain++;
            }
            if (result.noRandomReplayChecks > 0) {
                casesWithNoRandomReplayChecks++;
            }
            if (result.winflowCleanWinconditionChecks > 0) {
                casesWithWinflowCleanChecks++;
            }
            objectBoundaryChecks += result.objectBoundaryChecks;
            staticLayerBoundaryChecks += result.staticLayerBoundaryChecks;
            inertLayerBoundaryChecks += result.inertLayerBoundaryChecks;
            quantityBoundaryChecks += result.quantityBoundaryChecks;
            temporaryBoundaryChecks += result.temporaryBoundaryChecks;
            neverAppearsBoundaryChecks += result.neverAppearsBoundaryChecks;
            cosmeticProjectionChecks += result.cosmeticProjectionChecks;
            cosmeticRuleProjectionChecks += result.cosmeticRuleProjectionChecks;
            cosmeticRuleOptimizerProjectionChecks += result.cosmeticRuleOptimizerProjectionChecks;
            inertCommandRuleSuppressionChecks += result.inertCommandRuleSuppressionChecks;
            mergeProjectionChecks += result.mergeProjectionChecks;
            actionUnnecessaryBoundaryChecks += result.actionUnnecessaryBoundaryChecks;
            tickNoopBoundaryChecks += result.tickNoopBoundaryChecks;
            noAgainBoundaryChecks += result.noAgainBoundaryChecks;
            noRandomReplayChecks += result.noRandomReplayChecks;
            winflowBoundaryChecks += result.winflowBoundaryChecks;
            winflowCleanWinconditionChecks += result.winflowCleanWinconditionChecks;
            if (result.analysisUnavailableReason) {
                analysisUnavailableCount++;
                progressLog(options, `static_analysis_runtime_contracts:   static analysis unavailable: ${result.analysisUnavailableReason}`);
            }
        } catch (error) {
            failures.push(`ERROR: ${testName}: ${error.message}`);
        }
    }

    return {
        ok: failures.length === 0,
        caseCount,
        casesWithStaticObjects,
        casesWithStaticLayers,
        casesWithInertLayers,
        casesWithConstantQuantityObjects,
        casesWithTemporaryObjects,
        casesWithNeverAppearsObjects,
        casesWithCosmeticObjects,
        casesWithCosmeticRules,
        casesWithInertCommandRules,
        casesWithMergeAliases,
        casesWithActionUnnecessary,
        casesWithTickNoop,
        casesWithNoAgain,
        casesWithNoRandomReplayChecks,
        casesWithWinflowCleanChecks,
        objectBoundaryChecks,
        staticLayerBoundaryChecks,
        layerBoundaryChecks: staticLayerBoundaryChecks,
        inertLayerBoundaryChecks,
        quantityBoundaryChecks,
        temporaryBoundaryChecks,
        neverAppearsBoundaryChecks,
        cosmeticProjectionChecks,
        cosmeticRuleProjectionChecks,
        cosmeticRuleOptimizerProjectionChecks,
        inertCommandRuleSuppressionChecks,
        mergeProjectionChecks,
        actionUnnecessaryBoundaryChecks,
        tickNoopBoundaryChecks,
        noAgainBoundaryChecks,
        noRandomReplayChecks,
        winflowBoundaryChecks,
        winflowCleanWinconditionChecks,
        analysisUnavailableCount,
        failures,
    };
}

function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.log(usage());
        return 0;
    }

    const result = runAll({ ...options, progress: true });
    if (!result.ok) {
        console.error('static_analysis_runtime_contracts: failed');
        for (const failure of result.failures) {
            console.error(failure);
        }
        return 1;
    }

    console.log(
        `static_analysis_runtime_contracts: ok (${result.caseCount} cases, ${result.analysisUnavailableCount} analysis-unavailable, ${result.casesWithStaticObjects} with static objects, ${result.casesWithStaticLayers} with static layers, ${result.casesWithInertLayers} with inert layers, ${result.casesWithConstantQuantityObjects} with constant-quantity objects, ${result.casesWithTemporaryObjects} with temporary objects, ${result.casesWithNeverAppearsObjects} with never-appears objects, ${result.casesWithCosmeticObjects} with projectable cosmetic objects, ${result.casesWithCosmeticRules} with cosmetic rules, ${result.casesWithInertCommandRules} with inert command rules, ${result.casesWithMergeAliases} with merge aliases, ${result.casesWithActionUnnecessary} with action-unnecessary, ${result.casesWithTickNoop} with tick-noop, ${result.casesWithNoAgain} with no-again, ${result.casesWithNoRandomReplayChecks} with no-random replay checks, ${result.casesWithWinflowCleanChecks} with winflow clean checks, ${result.objectBoundaryChecks} object-boundary checks, ${result.staticLayerBoundaryChecks} static-layer-boundary checks, ${result.inertLayerBoundaryChecks} inert-layer-boundary checks, ${result.quantityBoundaryChecks} quantity-boundary checks, ${result.temporaryBoundaryChecks} temporary-boundary checks, ${result.neverAppearsBoundaryChecks} never-appears-boundary checks, ${result.cosmeticProjectionChecks} cosmetic-projection checks, ${result.cosmeticRuleProjectionChecks} cosmetic-rule-projection checks, ${result.cosmeticRuleOptimizerProjectionChecks} cosmetic-rule-optimizer checks, ${result.inertCommandRuleSuppressionChecks} inert-command-rule-suppression checks, ${result.mergeProjectionChecks} merge-projection checks, ${result.winflowBoundaryChecks} winflow-boundary checks, ${result.winflowCleanWinconditionChecks} winflow-clean-wincondition checks, ${result.actionUnnecessaryBoundaryChecks} action-unnecessary-boundary checks, ${result.tickNoopBoundaryChecks} tick-noop-boundary checks, ${result.noAgainBoundaryChecks} no-again checks, ${result.noRandomReplayChecks} no-random replay checks)`
    );
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    ANALYSIS_UNAVAILABLE_TESTS,
    MAX_AGAIN_DRAIN_STEPS,
    boardIdentity,
    engineObjectName,
    firstLayerSnapshotDifference,
    firstProbeDifference,
    firstQuantityDifference,
    firstReplayTraceDifference,
    firstSnapshotDifference,
    firstTemporaryPresence,
    layerOccupancySnapshot,
    objectCountSnapshot,
    parseArgs,
    replayFinalSerializedLevel,
    runAll,
    runSimulationWithStaticChecks,
    snapshotLayers,
    snapshotObjectCounts,
    snapshotStaticObjects,
    staticContractForSource,
};
