#!/usr/bin/env node
'use strict';

// Semantic-canonicalization replay fuzzer.
//
// Checks that replaying the same input trace on a game and on its semantic
// canonical/decanonicalized form yields the same projected level states:
//
//   canonicalize_level_state(game, simulate(game, level, inputs))
//     ===
//   canonicalize_level_state(canonicalize(game),
//       simulate(canonicalize(game), canonicalize_level_state(game, level), inputs))
//
// Usage: node src/tests/fuzz_canonicalization.js [options]
//   --corpus PATH      corpus directory                    (default src/tests/solver_tests)
//   --iterations N     random sequences per (game, level)  (default 1)
//   --input-length N   max inputs per sequence             (default 30)
//   --max-levels N     playable levels fuzzed per game     (default 2)
//   --game SUBSTRING   only fuzz matching corpus games
//   --start N --end N  corpus index window for sharding
//   --include-meta-inputs  include undo/restart in generated traces

const fs = require('fs');
const path = require('path');

const {
    canonicalizeSource,
    compileSemanticSource,
    createCompiledLevelStateProjector,
} = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');

const MAX_AGAIN_DRAIN_STEPS = 10000;
const INPUT_NAMES = Object.freeze({
    up: 0,
    left: 1,
    down: 2,
    right: 3,
    action: 4,
});

let runtimeLoaded = false;

function ensureRuntimeLoaded() {
    if (!runtimeLoaded) {
        loadPuzzleScript({ messageSink: [] });
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

function stripCompilerMessages() {
    if (!Array.isArray(errorStrings)) {
        return '';
    }
    return errorStrings.map(message => {
        if (typeof stripHTMLTags === 'function') {
            return stripHTMLTags(message);
        }
        return String(message).replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
    }).join('\n');
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

function canSnapshotBoard() {
    return typeof level !== 'undefined'
        && level
        && Number.isInteger(level.width)
        && Number.isInteger(level.height)
        && Number.isInteger(level.n_tiles)
        && typeof level.getCell === 'function'
        && typeof state !== 'undefined'
        && state
        && state.objects;
}

function boardIsPlayable() {
    if (!canSnapshotBoard()) return false;
    if (textMode || titleScreen) return false;
    if (typeof curlevel === 'number' && state && state.levels) {
        const leveldat = state.levels[curlevel];
        if (!leveldat || leveldat.message !== undefined) return false;
    }
    return true;
}

function compileSimulationSource(label, source, targetLevel, randomSeed) {
    levelString = source;
    resetParserErrors();
    compile(['loadLevel', targetLevel], source, randomSeed);
    if (errorCount > 0) {
        throw new Error(`${label}: compile failed\n${stripCompilerMessages()}`);
    }
    drainAgain(`${label}: initial compile`);
}

function normalizeInputToken(inputToken) {
    if (typeof inputToken === 'number') {
        return inputToken;
    }
    const lowered = String(inputToken).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(INPUT_NAMES, lowered)) {
        return INPUT_NAMES[lowered];
    }
    if (lowered === 'tick' || lowered === 'undo' || lowered === 'restart') {
        return lowered;
    }
    throw new Error(`Unsupported input token: ${JSON.stringify(inputToken)}`);
}

function tokenLabel(inputToken) {
    return typeof inputToken === 'string' ? inputToken : String(inputToken);
}

function executeInputToken(inputToken) {
    const normalized = normalizeInputToken(inputToken);
    if (normalized === 'undo') {
        DoUndo(false, true);
        return;
    }
    if (normalized === 'restart') {
        DoRestart();
        return;
    }
    if (normalized === 'tick') {
        processInput(-1);
        return;
    }
    processInput(normalized);
}

function createProjectorForSource(source, label) {
    const compiled = compileSemanticSource(source);
    if (compiled.errorCount > 0 || !compiled.state || compiled.state.invalid) {
        throw new Error(`${label}: unable to compile semantic projector`);
    }
    return createCompiledLevelStateProjector(compiled.state, 'semantic');
}

function collectEntryObjects(entry) {
    if (entry.obj) return [entry.obj];
    if (entry.objs) return entry.objs.slice();
    return [];
}

function collectCanonicalObjectNames(canonical) {
    const names = new Set();
    for (const layer of canonical.collisionLayers || []) {
        layer.forEach(name => names.add(name));
    }
    for (const name of canonical.playerObjects || []) names.add(name);
    for (const name of canonical.backgroundObjects || []) names.add(name);
    for (const rule of canonical.rules || []) {
        for (const side of [rule.lhs || [], rule.rhs || []]) {
            for (const row of side) {
                for (const cell of row) {
                    if (cell.ellipsis) continue;
                    for (const entry of cell) {
                        collectEntryObjects(entry).forEach(name => names.add(name));
                    }
                }
            }
        }
    }
    for (const condition of canonical.winConditions || []) {
        for (const name of condition.a || []) names.add(name);
        for (const name of condition.b || []) names.add(name);
    }
    for (const levelData of canonical.levels || []) {
        if (levelData.type !== 'map') continue;
        for (const row of levelData.rows) {
            for (const cell of row) {
                for (const name of cell) names.add(name);
            }
        }
    }
    return names;
}

function createIdentityProjectorForCanonical(canonical) {
    const canonicalNames = collectCanonicalObjectNames(canonical);
    return {
        canonicalizeLevelState(runtimeState, runtimeLevel) {
            if (runtimeLevel.message !== undefined) {
                return { type: 'message', text: '' };
            }
            const objectEntries = Object.entries(runtimeState.objects || {})
                .filter(([name, object]) => canonicalNames.has(name) && object && Number.isInteger(object.id))
                .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true }));
            const rows = [];
            for (let y = 0; y < runtimeLevel.height; y++) {
                const row = [];
                for (let x = 0; x < runtimeLevel.width; x++) {
                    const cellIndex = x * runtimeLevel.height + y;
                    const cell = runtimeLevel.getCell(cellIndex);
                    const names = [];
                    for (const [name, object] of objectEntries) {
                        if (cell.get(object.id)) {
                            names.push(name);
                        }
                    }
                    row.push(names);
                }
                rows.push(row);
            }
            return { type: 'map', rows };
        },
    };
}

function canonicalLevelSnapshot(label, projector) {
    const snapshot = {
        playable: boardIsPlayable(),
        textMode: Boolean(textMode),
        titleScreen: Boolean(titleScreen),
        curlevel: typeof curlevel === 'number' ? curlevel : null,
        winning: Boolean(winning),
        againing: Boolean(againing),
        level: null,
    };
    if (canSnapshotBoard()) {
        snapshot.level = projector.canonicalizeLevelState(state, level);
    }
    if (!snapshot.level && snapshot.playable) {
        throw new Error(`${label}: playable board could not be canonicalized`);
    }
    return snapshot;
}

function runReplaySnapshots({ label, source, targetLevel = 0, randomSeed = null, inputs = [], projector }) {
    ensureRuntimeLoaded();
    const previousUnitTesting = unitTesting;
    const previousLazyFunctionGeneration = lazyFunctionGeneration;
    const snapshots = [];
    let stoppedAt = null;

    unitTesting = true;
    lazyFunctionGeneration = false;
    try {
        compileSimulationSource(label, source, targetLevel, randomSeed);
        snapshots.push(canonicalLevelSnapshot(`${label}: initial`, projector));
        for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            if (!boardIsPlayable()) {
                stoppedAt = inputIndex;
                break;
            }
            const inputToken = inputs[inputIndex];
            executeInputToken(inputToken);
            drainAgain(`${label}: input ${inputIndex} ${tokenLabel(inputToken)}`);
            snapshots.push(canonicalLevelSnapshot(`${label}: input ${inputIndex}`, projector));
        }
    } finally {
        unitTesting = previousUnitTesting;
        lazyFunctionGeneration = previousLazyFunctionGeneration;
    }

    return { snapshots, stoppedAt };
}

function firstSnapshotDifference(leftSnapshots, rightSnapshots) {
    const count = Math.max(leftSnapshots.length, rightSnapshots.length);
    for (let index = 0; index < count; index++) {
        const left = leftSnapshots[index] || null;
        const right = rightSnapshots[index] || null;
        if (JSON.stringify(left) !== JSON.stringify(right)) {
            return { index, left, right };
        }
    }
    return null;
}

function canonicalHasRandomSemantics(canonical) {
    return (canonical.rules || []).some(rule => {
        if (rule.randomRule) return true;
        const ruleText = JSON.stringify(rule).toLowerCase();
        return ruleText.includes('"random"') || ruleText.includes('"randomdir"');
    });
}

function firstDuplicateCollisionLayerObject(canonical) {
    const seen = new Map();
    for (let layerIndex = 0; layerIndex < (canonical.collisionLayers || []).length; layerIndex++) {
        for (const name of canonical.collisionLayers[layerIndex] || []) {
            if (seen.has(name)) {
                return { name, firstLayer: seen.get(name), secondLayer: layerIndex };
            }
            seen.set(name, layerIndex);
        }
    }
    return null;
}

function canonicalSourceForReplay(source, label) {
    let canonical;
    try {
        canonical = canonicalizeSource(source, 'semantic', { sourcePath: label });
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (!/^Unable to canonicalize invalid PuzzleScript source\./.test(message)) {
            throw error;
        }
        return {
            skipped: true,
            reason: 'canonicalize_unavailable',
            error: message,
        };
    }
    if (canonicalHasRandomSemantics(canonical)) {
        return { skipped: true, reason: 'random_rule_semantics' };
    }
    const duplicateLayerObject = firstDuplicateCollisionLayerObject(canonical);
    if (duplicateLayerObject) {
        return {
            skipped: true,
            reason: 'unrepresentable_duplicate_collision_layers',
            duplicateLayerObject,
        };
    }
    return {
        skipped: false,
        canonical,
        source: decanonicalizeSemantic(canonical),
    };
}

function runCanonicalizationFuzzCase({ label, source, targetLevel = 0, randomSeed = null, inputs = [] }) {
    const replaySource = canonicalSourceForReplay(source, label);
    if (replaySource.skipped) {
        return {
            status: 'skipped',
            reason: replaySource.reason,
            mismatches: [],
            snapshotsChecked: 0,
        };
    }

    const originalProjector = createProjectorForSource(source, `${label}: original`);
    const canonicalProjector = createIdentityProjectorForCanonical(replaySource.canonical);

    const original = runReplaySnapshots({
        label: `${label}: original`,
        source,
        targetLevel,
        randomSeed,
        inputs,
        projector: originalProjector,
    });
    const canonical = runReplaySnapshots({
        label: `${label}: canonical`,
        source: replaySource.source,
        targetLevel,
        randomSeed,
        inputs,
        projector: canonicalProjector,
    });
    const diff = firstSnapshotDifference(original.snapshots, canonical.snapshots);
    const mismatches = diff ? [diff] : [];
    return {
        status: mismatches.length === 0 ? 'ok' : 'mismatch',
        mismatches,
        snapshotsChecked: Math.min(original.snapshots.length, canonical.snapshots.length),
        originalStoppedAt: original.stoppedAt,
        canonicalStoppedAt: canonical.stoppedAt,
    };
}

function mulberry32(seed) {
    let value = seed >>> 0;
    return function () {
        value = (value + 0x6D2B79F5) | 0;
        let t = Math.imul(value ^ (value >>> 15), 1 | value);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString(text) {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function randomInputToken(rand, includeMetaInputs = false) {
    const roll = rand();
    if (!includeMetaInputs) {
        if (roll < 0.88) return Math.floor(rand() * 5);
        return 'tick';
    }
    if (roll < 0.82) return Math.floor(rand() * 5);
    if (roll < 0.90) return 'tick';
    if (roll < 0.97) return 'undo';
    return 'restart';
}

function generateSafeInputs(label, source, targetLevel, randomSeed, rand, maxLength, options = {}) {
    ensureRuntimeLoaded();
    const previousUnitTesting = unitTesting;
    const previousLazyFunctionGeneration = lazyFunctionGeneration;
    const inputs = [];

    unitTesting = true;
    lazyFunctionGeneration = false;
    try {
        compileSimulationSource(`${label}: input generation`, source, targetLevel, randomSeed);
        for (let index = 0; index < maxLength; index++) {
            if (!boardIsPlayable()) break;
            const inputToken = randomInputToken(rand, options.includeMetaInputs);
            executeInputToken(inputToken);
            drainAgain(`${label}: input generation ${index}`);
            if (!boardIsPlayable()) break;
            inputs.push(inputToken);
        }
    } finally {
        unitTesting = previousUnitTesting;
        lazyFunctionGeneration = previousLazyFunctionGeneration;
    }

    return inputs;
}

function playableLevelIndexes(source, label, maxLevels) {
    ensureRuntimeLoaded();
    const previousUnitTesting = unitTesting;
    const previousLazyFunctionGeneration = lazyFunctionGeneration;
    const indexes = [];

    unitTesting = true;
    lazyFunctionGeneration = false;
    try {
        compileSimulationSource(`${label}: level discovery`, source, 0, 'canonicalization-level-discovery');
        for (let index = 0; index < state.levels.length && indexes.length < maxLevels; index++) {
            if (state.levels[index] && state.levels[index].message === undefined) {
                indexes.push(index);
            }
        }
    } finally {
        unitTesting = previousUnitTesting;
        lazyFunctionGeneration = previousLazyFunctionGeneration;
    }

    return indexes;
}

function parseArgs(argv) {
    const options = {
        corpusPath: path.join(__dirname, 'solver_tests'),
        iterations: 1,
        inputLength: 30,
        maxLevels: 2,
        gameFilter: null,
        startIndex: 0,
        endIndex: Infinity,
        includeMetaInputs: false,
        help: false,
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--corpus') options.corpusPath = path.resolve(argv[++index]);
        else if (arg === '--iterations') options.iterations = Number(argv[++index]);
        else if (arg === '--input-length') options.inputLength = Number(argv[++index]);
        else if (arg === '--max-levels') options.maxLevels = Number(argv[++index]);
        else if (arg === '--game') options.gameFilter = argv[++index];
        else if (arg === '--start') options.startIndex = Number(argv[++index]);
        else if (arg === '--end') options.endIndex = Number(argv[++index]);
        else if (arg === '--include-meta-inputs') options.includeMetaInputs = true;
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    return options;
}

function usage() {
    return [
        'Usage: node src/tests/fuzz_canonicalization.js [--corpus PATH] [--iterations N]',
        '  [--input-length N] [--max-levels N] [--game SUBSTRING] [--start N --end N]',
        '  [--include-meta-inputs]',
    ].join('\n');
}

function runCanonicalizationFuzzer(options) {
    const corpusDir = path.resolve(options.corpusPath);
    const games = fs.readdirSync(corpusDir)
        .filter(name => name.endsWith('.txt'))
        .filter(name => !options.gameFilter || name.includes(options.gameFilter))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    const failures = [];
    let casesRun = 0;
    let casesSkipped = 0;

    games.forEach((game, gameIndex) => {
        if (gameIndex < options.startIndex || gameIndex >= options.endIndex) return;
        const sourcePath = path.join(corpusDir, game);
        const source = fs.readFileSync(sourcePath, 'utf8');
        let levels;
        try {
            const replaySource = canonicalSourceForReplay(source, game);
            if (replaySource.skipped) {
                casesSkipped++;
                process.stderr.write(`fuzz_canonicalization: [${gameIndex + 1}/${games.length}] ${game} skipped=${replaySource.reason}\n`);
                return;
            }
            levels = playableLevelIndexes(source, game, options.maxLevels);
        } catch (error) {
            failures.push({ label: game, phase: 'setup', error: String(error && error.message).slice(0, 900) });
            return;
        }

        for (const levelIndex of levels) {
            for (let iteration = 0; iteration < options.iterations; iteration++) {
                const seed = hashString(`${game}#${levelIndex}#${iteration}`);
                const randomSeed = seed % 100000;
                const rand = mulberry32(seed);
                const label = `canonical-fuzz:${game}#L${levelIndex}#i${iteration}`;
                let inputs;
                try {
                    inputs = generateSafeInputs(label, source, levelIndex, randomSeed, rand, options.inputLength, {
                        includeMetaInputs: options.includeMetaInputs,
                    });
                } catch (error) {
                    const message = String(error && error.message);
                    if (/again-drain|exceeded 10000 again-drain/.test(message)) {
                        casesSkipped++;
                    } else {
                        failures.push({ label, phase: 'input_generation', error: message.slice(0, 900) });
                    }
                    continue;
                }
                if (inputs.length === 0) {
                    casesSkipped++;
                    continue;
                }
                try {
                    const result = runCanonicalizationFuzzCase({
                        label,
                        source,
                        targetLevel: levelIndex,
                        randomSeed,
                        inputs,
                    });
                    if (result.status === 'skipped') {
                        casesSkipped++;
                    } else if (result.status !== 'ok') {
                        failures.push({
                            label,
                            phase: 'canonical_replay',
                            inputs: JSON.stringify(inputs),
                            error: JSON.stringify(result.mismatches[0], null, 2).slice(0, 4000),
                        });
                    } else {
                        casesRun++;
                    }
                } catch (error) {
                    failures.push({
                        label,
                        phase: 'canonical_replay',
                        inputs: JSON.stringify(inputs),
                        error: String(error && error.stack ? error.stack : error).slice(0, 4000),
                    });
                }
            }
        }
        if (typeof options.onGameComplete === 'function') {
            options.onGameComplete({
                game,
                gameIndex,
                gamesTotal: games.length,
                casesRun,
                casesSkipped,
                failures: failures.slice(),
            });
        } else {
            process.stderr.write(`fuzz_canonicalization: [${gameIndex + 1}/${games.length}] ${game} (run=${casesRun} skipped=${casesSkipped} fail=${failures.length})\n`);
        }
    });

    return { gamesTotal: games.length, casesRun, casesSkipped, failures };
}

function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.error(usage());
        process.exit(1);
    }

    const result = runCanonicalizationFuzzer(options);
    for (const failure of result.failures) {
        process.stderr.write(`fuzz_canonicalization: FAILURE ${failure.label} [${failure.phase}]\n`);
        process.stderr.write(`  inputs: ${failure.inputs || 'n/a'}\n`);
        process.stderr.write(`  ${failure.error}\n`);
    }
    process.stderr.write(`fuzz_canonicalization: cases=${result.casesRun} skipped=${result.casesSkipped} failures=${result.failures.length}\n`);
    if (result.failures.length > 0) {
        process.stderr.write('fuzz_canonicalization: failed\n');
        process.exit(1);
    }
    console.log('fuzz_canonicalization: ok');
}

if (require.main === module) {
    main();
}

module.exports = {
    canonicalLevelSnapshot,
    generateSafeInputs,
    playableLevelIndexes,
    runCanonicalizationFuzzCase,
    runCanonicalizationFuzzer,
    runReplaySnapshots,
};
