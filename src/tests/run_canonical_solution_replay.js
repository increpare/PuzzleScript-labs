#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { canonicalizeSource } = require('../canonicalize');
const { decanonicalizeSemantic } = require('../decanonicalize');
const { loadPuzzleScript } = require('./js_oracle/lib/puzzlescript_node_env');
const { parseSolverOptPassList } = require('./solver_static_opt');

const INPUT_BY_TOKEN = new Map([
    ['up', 0],
    ['left', 1],
    ['down', 2],
    ['right', 3],
    ['action', 4],
]);

let runtimeLoaded = false;

function loadPuzzleScriptRuntime() {
    if (!runtimeLoaded) {
        loadPuzzleScript();
        runtimeLoaded = true;
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

function compileReplaySource(source, game) {
    loadPuzzleScriptRuntime();
    if (typeof resetParserErrorState === 'function') {
        resetParserErrorState();
    }
    unitTesting = true;
    lazyFunctionGeneration = false;
    compile(['loadLevel', 0], source, `canonical-replay:${game}:0`);
    if (errorCount > 0) {
        throw new Error(stripCompilerMessages());
    }
}

function settleAgainForReplay() {
    for (let pass = 0; pass < 500 && againing; pass++) {
        againing = false;
        processInput(-1, undefined, undefined, true);
    }
}

function stepReplayToken(token) {
    if (!INPUT_BY_TOKEN.has(token)) {
        throw new Error(`Unsupported solution token: ${token}`);
    }
    const beforeLevel = curlevel;
    const beforeTitle = titleScreen;
    const input = INPUT_BY_TOKEN.get(token);
    if (input === 4 && textMode && !titleScreen) {
        if (state.levels[curlevel] && state.levels[curlevel].message !== undefined) {
            nextLevel();
        } else {
            textMode = false;
            messagetext = '';
            messageselected = false;
        }
    } else {
        processInput(input, undefined, undefined, true);
    }
    settleAgainForReplay();
    return curlevel !== beforeLevel || (!beforeTitle && titleScreen);
}

function replaySolutionOnOriginal({ source, game, level, solution }) {
    try {
        compileReplaySource(source, game);
        if (!state.levels[level]) {
            return {
                game,
                level,
                solution,
                status: 'invalid_level',
                steps: 0,
                error: `Missing level ${level}`,
            };
        }
        if (state.levels[level].message !== undefined) {
            return {
                game,
                level,
                solution,
                status: 'skipped_message',
                steps: 0,
                error: `Level ${level} is a message level`,
            };
        }
        loadLevelFromState(state, level, `canonical-replay:${game}:${level}`);
        for (let index = 0; index < solution.length; index++) {
            if (stepReplayToken(solution[index])) {
                return {
                    game,
                    level,
                    solution,
                    status: 'solved',
                    steps: index + 1,
                };
            }
        }
        return {
            game,
            level,
            solution,
            status: 'not_solved',
            steps: solution.length,
            error: `Replay ended without satisfying the win condition`,
        };
    } catch (error) {
        return {
            game,
            level,
            solution,
            status: 'replay_error',
            steps: 0,
            error: error && error.stack ? error.stack : String(error),
        };
    }
}

function formatReplayFailure(result) {
    const solution = Array.isArray(result.solution) ? result.solution.join(',') : '';
    return [
        `canonical replay failed game=${result.game} level=${result.level}`,
        `  solution=${solution}`,
        `  replay_status=${result.status}`,
        `  error=${result.error || ''}`,
    ].join('\n');
}

function usage(exitCode) {
    const message = [
        'Usage: node src/tests/run_canonical_solution_replay.js <corpus>',
        '  [--solver-focus-manifest PATH] [--timeout-ms N] [--static-optimizations PASSLIST]',
        '  [--strategy bfs|weighted-astar|greedy|portfolio|phase-split] [--work-dir DIR] [--quiet] [--json]',
    ].join('\n');
    (exitCode === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exit(exitCode);
}

function parsePositiveTimeoutMs(value, label) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${label} must be a positive integer: ${value}`);
    }
    return parsed;
}

function parseArgs(argv) {
    const options = {
        corpusPath: null,
        manifestPath: path.resolve('src/tests/solver_focus_group.json'),
        timeoutMs: 500,
        staticOptimizations: 'all',
        strategy: 'portfolio',
        quiet: false,
        json: false,
        workDir: null,
    };
    const args = argv.slice(2);
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--solver-focus-manifest' && index + 1 < args.length) {
            options.manifestPath = path.resolve(args[++index]);
        } else if (arg === '--timeout-ms' && index + 1 < args.length) {
            options.timeoutMs = parsePositiveTimeoutMs(args[++index], '--timeout-ms');
        } else if (arg === '--static-optimizations' && index + 1 < args.length) {
            options.staticOptimizations = args[++index];
            parseSolverOptPassList(options.staticOptimizations);
        } else if (arg === '--strategy' && index + 1 < args.length) {
            options.strategy = args[++index];
            if (!['portfolio', 'bfs', 'weighted-astar', 'greedy', 'phase-split'].includes(options.strategy)) {
                throw new Error(`Unsupported strategy: ${options.strategy}`);
            }
        } else if (arg === '--work-dir' && index + 1 < args.length) {
            options.workDir = path.resolve(args[++index]);
        } else if (arg === '--quiet') {
            options.quiet = true;
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--help' || arg === '-h') {
            usage(0);
        } else if (options.corpusPath === null) {
            options.corpusPath = path.resolve(arg);
        } else {
            usage(1);
        }
    }
    if (!options.corpusPath) {
        usage(1);
    }
    return options;
}

function readManifest(manifestPath) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || !Array.isArray(manifest.targets) || manifest.targets.length === 0) {
        throw new Error(`Expected non-empty targets[] in ${manifestPath}`);
    }
    return manifest;
}

function safeTargetPath(root, game) {
    const full = path.resolve(root, game);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Target escapes corpus: ${game}`);
    }
    return full;
}

function ensureCleanDir(dirPath) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeCanonicalCorpus(options, manifest, canonicalCorpusDir) {
    ensureCleanDir(canonicalCorpusDir);
    const games = Array.from(new Set(manifest.targets.map(target => target.game))).sort();
    for (const game of games) {
        const originalPath = safeTargetPath(options.corpusPath, game);
        if (!fs.existsSync(originalPath)) {
            throw new Error(`Missing focus game: ${game}`);
        }
        const originalSource = fs.readFileSync(originalPath, 'utf8');
        const canonical = canonicalizeSource(originalSource, 'semantic', {
            staticOptimizations: options.staticOptimizations,
            sourcePath: game,
        });
        const rehydrated = decanonicalizeSemantic(canonical);
        const outputPath = safeTargetPath(canonicalCorpusDir, game);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, rehydrated, 'utf8');
    }
}

function solveCanonicalCorpus(options, canonicalCorpusDir) {
    const solverPath = path.join(__dirname, 'run_solver_tests_js.js');
    const args = [
        solverPath,
        canonicalCorpusDir,
        '--solver-focus-manifest',
        options.manifestPath,
        '--timeout-ms',
        String(options.timeoutMs),
        '--strategy',
        options.strategy,
        '--quiet',
        '--json',
        '--no-solutions',
    ];
    const child = spawnSync(process.execPath, args, {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
    });
    if (child.status !== 0) {
        throw new Error([
            `Canonical solver failed with status ${child.status}`,
            child.stdout.trim(),
            child.stderr.trim(),
        ].filter(Boolean).join('\n'));
    }
    return JSON.parse(child.stdout);
}

function originalSourceCache(corpusPath) {
    const cache = new Map();
    return function sourceForGame(game) {
        if (!cache.has(game)) {
            cache.set(game, fs.readFileSync(safeTargetPath(corpusPath, game), 'utf8'));
        }
        return cache.get(game);
    };
}

function resultKey(result) {
    return `${result.game}#${result.level}`;
}

function replayCanonicalSolutions(options, solverPayload) {
    const sourceForGame = originalSourceCache(options.corpusPath);
    const rows = [];
    const failures = [];
    for (const result of solverPayload.results || []) {
        const canonicalSolution = Array.isArray(result.solution) ? result.solution.slice() : [];
        const row = {
            game: result.game,
            level: result.level,
            canonical_status: result.status,
            canonical_solution: canonicalSolution,
            canonical_solution_length: Number.isFinite(result.solution_length) ? result.solution_length : canonicalSolution.length,
            original_replay_status: 'not_checked',
        };
        if (result.error) {
            row.error = result.error;
        }
        if (result.status === 'solved') {
            const replay = replaySolutionOnOriginal({
                source: sourceForGame(result.game),
                game: result.game,
                level: result.level,
                solution: row.canonical_solution,
            });
            row.original_replay_status = replay.status;
            row.error = replay.error;
            if (replay.status !== 'solved') {
                failures.push(Object.assign({}, replay, {
                    canonical_status: result.status,
                    key: resultKey(result),
                }));
            }
        }
        rows.push(row);
    }
    return { results: rows, failures };
}

function runCanonicalReplay(options) {
    const merged = Object.assign({
        manifestPath: path.resolve('src/tests/solver_focus_group.json'),
        timeoutMs: 500,
        staticOptimizations: 'all',
        strategy: 'portfolio',
        quiet: false,
        json: false,
        workDir: null,
    }, options || {});
    if (!merged.corpusPath) {
        throw new Error('runCanonicalReplay requires corpusPath');
    }
    if (!['portfolio', 'bfs', 'weighted-astar', 'greedy', 'phase-split'].includes(merged.strategy)) {
        throw new Error(`Unsupported strategy: ${merged.strategy}`);
    }
    merged.timeoutMs = parsePositiveTimeoutMs(merged.timeoutMs, 'timeoutMs');
    const resolved = Object.assign({}, merged, {
        corpusPath: path.resolve(merged.corpusPath),
        manifestPath: path.resolve(merged.manifestPath),
        workDir: merged.workDir
            ? path.resolve(merged.workDir)
            : fs.mkdtempSync(path.join(os.tmpdir(), 'ps-canonical-replay-')),
    });
    parseSolverOptPassList(resolved.staticOptimizations);
    const manifest = readManifest(resolved.manifestPath);
    const canonicalCorpusDir = path.join(resolved.workDir, 'canonical-corpus');
    writeCanonicalCorpus(resolved, manifest, canonicalCorpusDir);
    const solverPayload = solveCanonicalCorpus(resolved, canonicalCorpusDir);
    const replay = replayCanonicalSolutions(resolved, solverPayload);
    return Object.assign({
        canonicalCorpusDir,
        totals: {
            targets: replay.results.length,
            solved: replay.results.filter(row => row.canonical_status === 'solved').length,
            replay_failures: replay.failures.length,
        },
    }, replay);
}

function printHuman(summary) {
    for (const failure of summary.failures) {
        process.stdout.write(`${formatReplayFailure(failure)}\n`);
    }
    process.stdout.write(`canonical_solution_replay targets=${summary.totals.targets} canonical_solved=${summary.totals.solved} replay_failures=${summary.totals.replay_failures}\n`);
}

function main() {
    let options = null;
    try {
        options = parseArgs(process.argv);
        const summary = runCanonicalReplay(options);
        if (options.json) {
            process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        } else if (!options.quiet || summary.failures.length > 0) {
            printHuman(summary);
        }
        process.exit(summary.failures.length === 0 ? 0 : 1);
    } catch (error) {
        if (options && options.json) {
            process.stdout.write(`${JSON.stringify({ error: error && error.stack ? error.stack : String(error) }, null, 2)}\n`);
        } else {
            process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
        }
        process.exit(1);
    }
}

module.exports = {
    formatReplayFailure,
    loadPuzzleScriptRuntime,
    parseArgs,
    replaySolutionOnOriginal,
    runCanonicalReplay,
};

if (require.main === module) {
    main();
}
