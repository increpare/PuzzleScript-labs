#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_RUNS = 1;
const DEFAULT_MAX_TARGETS = 40;
const DEFAULT_OUT_DIR = path.resolve('build/native/solver_instrumentation_pack');
const MAX_PER_BUCKET = 12;

const seedTargets = [
    { game: 'ALL GREEN TO BLUE.txt', level: 11 },
    { game: 'pushit.txt', level: 5 },
    { game: 'crate guardian.txt', level: 9 },
    { game: 'Match-Maker.txt', level: 9 },
    { game: 'BIAXIAL INVASION OF SATURN.txt', level: 13 },
    { game: 'The sponge what lights up the seafloor.txt', level: 5 },
    { game: 'manic_ammo.txt', level: 26 },
    { game: 'Van-to-Mobile-Living-Space-Conversion Window.txt', level: 21 },
    { game: 'Vexatious Match 3.txt', level: 4 },
    { game: 'a clear view of the sky.txt', level: 24 },
    { game: 'color chained.txt', level: 5 },
    { game: 'whaleworld.txt', level: 15 },
    { game: 'paint everything everywhere.txt', level: 17 },
    { game: 'expand also avoid the flames.txt', level: 1 },
    { game: 'alternatey.txt', level: 6 },
    { game: 'karamell.txt', level: 1 },
];

function usage() {
    console.error(
        'Usage: node src/tests/run_native_solver_instrumentation_pack.js <puzzlescript_solver> <solver_tests_dir> ' +
        '[--out-dir DIR] [--timeout-ms N] [--runs N] [--max-targets N] [--js-results PATH] ' +
        '[--native-results PATH] [--manifest PATH ...] [--profile-runtime-counters] [--dry-run]'
    );
    process.exit(1);
}

function parsePositiveInt(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer: ${value}`);
    }
    return parsed;
}

function resultKey(result) {
    return `${result.game}\u0000${result.level}`;
}

function displayKey(target) {
    return `${target.game}#${target.level}`;
}

function byKey(results) {
    return new Map((results || []).map((result) => [resultKey(result), result]));
}

function readJsonFile(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`could not read ${label} ${filePath}: ${error.message}`);
    }
}

function writeJsonFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value);
}

function buildStrategySpecs() {
    return [
        { id: 'portfolio', label: 'portfolio', strategy: 'portfolio', solverArgs: [] },
        { id: 'portfolio_full', label: 'portfolio full-node', strategy: 'portfolio', solverArgs: ['--full-node-storage'] },
        { id: 'bfs', label: 'bfs', strategy: 'bfs', solverArgs: [] },
        { id: 'wa2', label: 'weighted-astar w=2', strategy: 'weighted-astar', solverArgs: ['--astar-weight', '2'] },
        { id: 'wa3', label: 'weighted-astar w=3', strategy: 'weighted-astar', solverArgs: ['--astar-weight', '3'] },
        { id: 'wa8', label: 'weighted-astar w=8', strategy: 'weighted-astar', solverArgs: ['--astar-weight', '8'] },
        { id: 'greedy', label: 'greedy', strategy: 'greedy', solverArgs: [] },
    ];
}

function normalizeTarget(target, timeoutMs) {
    return {
        game: target.game,
        level: Number(target.level),
        first_solved_timeout_ms: target.first_solved_timeout_ms || target.timeout_ms || timeoutMs,
    };
}

function createTargetStore(timeoutMs) {
    const targets = new Map();
    function ensure(target) {
        if (!target || typeof target.game !== 'string' || !Number.isFinite(Number(target.level))) {
            return null;
        }
        const normalized = normalizeTarget(target, timeoutMs);
        const key = resultKey(normalized);
        if (!targets.has(key)) {
            targets.set(key, {
                game: normalized.game,
                level: normalized.level,
                first_solved_timeout_ms: normalized.first_solved_timeout_ms,
                categories: [],
            });
        }
        return targets.get(key);
    }
    function add(target, category, fields = {}) {
        const entry = ensure(target);
        if (!entry) {
            return;
        }
        if (!entry.categories.includes(category)) {
            entry.categories.push(category);
        }
        for (const [name, value] of Object.entries(fields)) {
            if (value !== undefined && entry[name] === undefined) {
                entry[name] = value;
            }
        }
    }
    return { add, values: () => Array.from(targets.values()) };
}

function resultFields(jsResult, nativeResult) {
    return {
        js_status: jsResult ? jsResult.status : undefined,
        js_elapsed_ms: jsResult ? jsResult.elapsed_ms : undefined,
        js_solution_length: jsResult ? jsResult.solution_length : undefined,
        native_status: nativeResult ? nativeResult.status : undefined,
        native_elapsed_ms: nativeResult ? nativeResult.elapsed_ms : undefined,
        native_solution_length: nativeResult ? nativeResult.solution_length : undefined,
        native_expanded: nativeResult ? nativeResult.expanded : undefined,
        native_generated: nativeResult ? nativeResult.generated : undefined,
        native_unique_states: nativeResult ? nativeResult.unique_states : undefined,
        native_max_frontier: nativeResult ? nativeResult.max_frontier : undefined,
        native_step_ms: nativeResult ? nativeResult.step_ms : undefined,
    };
}

function takeTop(results, count, score) {
    return results
        .slice()
        .sort((a, b) => score(b) - score(a))
        .slice(0, count);
}

function selectInstrumentationTargets({
    jsRun = null,
    nativeRun = null,
    extraManifests = [],
    maxTargets = DEFAULT_MAX_TARGETS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const store = createTargetStore(timeoutMs);
    const jsByKey = byKey(jsRun ? jsRun.results : []);
    const nativeResults = nativeRun ? (nativeRun.results || []) : [];
    const nativeByKey = byKey(nativeResults);

    if (jsRun && nativeRun) {
        for (const jsResult of jsRun.results || []) {
            if (jsResult.status !== 'solved') {
                continue;
            }
            const nativeResult = nativeByKey.get(resultKey(jsResult));
            if (!nativeResult || nativeResult.status !== 'solved') {
                store.add(jsResult, 'js_solved_native_missed', resultFields(jsResult, nativeResult));
            }
        }
    }

    const usableNativeResults = nativeResults.filter((result) =>
        result.status !== 'skipped_message' &&
        result.status !== 'error' &&
        result.status !== 'level_error'
    );
    const timeoutResults = usableNativeResults.filter((result) => result.status === 'timeout');
    for (const result of takeTop(timeoutResults, MAX_PER_BUCKET, (item) => Number(item.expanded || item.generated || 0))) {
        store.add(result, 'native_timeout_high_expansion', resultFields(jsByKey.get(resultKey(result)), result));
    }
    for (const result of takeTop(timeoutResults, MAX_PER_BUCKET, (item) => Number(item.step_ms || 0))) {
        if (Number(result.step_ms || 0) > 0) {
            store.add(result, 'runtime_hotspot_step_ms', resultFields(jsByKey.get(resultKey(result)), result));
        }
    }
    const nearSolved = usableNativeResults.filter((result) =>
        result.status === 'solved' &&
        Number(result.elapsed_ms || 0) >= timeoutMs * 0.75
    );
    for (const result of takeTop(nearSolved, MAX_PER_BUCKET, (item) => Number(item.elapsed_ms || 0))) {
        store.add(result, 'near_timeout_solved', resultFields(jsByKey.get(resultKey(result)), result));
    }

    for (const seeded of seedTargets) {
        const jsResult = jsByKey.get(resultKey(seeded));
        const nativeResult = nativeByKey.get(resultKey(seeded));
        store.add(seeded, 'seed_regression', resultFields(jsResult, nativeResult));
    }

    for (const extra of extraManifests) {
        const category = `extra:${extra.name}`;
        for (const target of extra.manifest.targets || []) {
            const normalized = normalizeTarget(target, timeoutMs);
            store.add(normalized, category, resultFields(jsByKey.get(resultKey(normalized)), nativeByKey.get(resultKey(normalized))));
        }
    }

    const priority = {
        js_solved_native_missed: 0,
        seed_regression: 1,
        native_timeout_high_expansion: 2,
        runtime_hotspot_step_ms: 3,
        near_timeout_solved: 4,
    };
    const targets = store.values().sort((a, b) => {
        const aPriority = Math.min(...a.categories.map((category) => priority[category] ?? 5));
        const bPriority = Math.min(...b.categories.map((category) => priority[category] ?? 5));
        if (aPriority !== bPriority) {
            return aPriority - bPriority;
        }
        const aWork = Number(a.native_expanded || a.native_generated || a.native_elapsed_ms || 0);
        const bWork = Number(b.native_expanded || b.native_generated || b.native_elapsed_ms || 0);
        if (aWork !== bWork) {
            return bWork - aWork;
        }
        return displayKey(a).localeCompare(displayKey(b));
    });

    return {
        targets: targets.slice(0, Math.max(maxTargets, 1)),
        total_candidates: targets.length,
        category_counts: countCategories(targets),
    };
}

function countCategories(targets) {
    const counts = {};
    for (const target of targets) {
        for (const category of target.categories || []) {
            counts[category] = (counts[category] || 0) + 1;
        }
    }
    return counts;
}

function majorityStatus(statusCounts) {
    let bestStatus = null;
    let bestCount = -1;
    for (const [status, count] of Object.entries(statusCounts || {})) {
        if (count > bestCount || (count === bestCount && status === 'solved')) {
            bestStatus = status;
            bestCount = count;
        }
    }
    return bestStatus;
}

function medianNumber(values) {
    const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (numbers.length === 0) {
        return null;
    }
    return numbers[Math.floor(numbers.length / 2)];
}

function summarizeStrategyOutputs({ strategies, manifestTargets, outputsByStrategy }) {
    const targetRows = new Map();
    for (const target of manifestTargets) {
        targetRows.set(resultKey(target), {
            game: target.game,
            level: target.level,
            categories: target.categories || [],
            first_solved_timeout_ms: target.first_solved_timeout_ms,
            strategies: {},
            best_strategy: null,
            best_elapsed_ms: null,
        });
    }

    const strategySummary = {};
    for (const spec of strategies) {
        const output = outputsByStrategy.get(spec.id);
        const rows = output ? (output.targets || []) : [];
        let solved = 0;
        let timeout = 0;
        let exhausted = 0;
        let other = 0;
        const elapsedValues = [];
        const expandedValues = [];
        for (const row of rows) {
            const status = majorityStatus(row.status_counts);
            if (status === 'solved') solved++;
            else if (status === 'timeout') timeout++;
            else if (status === 'exhausted') exhausted++;
            else other++;
            if (row.median) {
                elapsedValues.push(row.median.elapsed_ms);
                expandedValues.push(row.median.expanded);
            }
            const targetRow = targetRows.get(resultKey(row));
            if (targetRow) {
                targetRow.strategies[spec.id] = {
                    status,
                    status_counts: row.status_counts || {},
                    elapsed_ms: row.median ? row.median.elapsed_ms : null,
                    wall_ms: row.median ? row.median.wall_ms : null,
                    expanded: row.median ? row.median.expanded : null,
                    generated: row.median ? row.median.generated : null,
                    step_ms: row.median ? row.median.step_ms : null,
                    materialize_ms: row.median ? row.median.materialize_ms : null,
                    hash_ms: row.median ? row.median.hash_ms : null,
                    state_capture_ms: row.median ? row.median.state_capture_ms : null,
                    heuristic_ms: row.median ? row.median.heuristic_ms : null,
                    max_frontier: row.median ? row.median.max_frontier : null,
                    solution_length: row.median ? row.median.solution_length : null,
                };
            }
        }
        strategySummary[spec.id] = {
            label: spec.label,
            strategy: spec.strategy,
            solver_args: spec.solverArgs,
            targets: rows.length,
            solved,
            timeout,
            exhausted,
            other,
            median_elapsed_ms: medianNumber(elapsedValues),
            median_expanded: medianNumber(expandedValues),
        };
    }

    for (const row of targetRows.values()) {
        for (const spec of strategies) {
            const result = row.strategies[spec.id];
            if (!result || result.status !== 'solved' || !Number.isFinite(result.elapsed_ms)) {
                continue;
            }
            if (row.best_elapsed_ms === null || result.elapsed_ms < row.best_elapsed_ms) {
                row.best_elapsed_ms = result.elapsed_ms;
                row.best_strategy = spec.id;
            }
        }
    }

    return {
        strategies: strategySummary,
        targets: Array.from(targetRows.values()),
    };
}

function parseArgs(argv) {
    if (argv.length < 2) {
        usage();
    }
    const options = {
        solverPath: path.resolve(argv[0]),
        corpusDir: path.resolve(argv[1]),
        outDir: DEFAULT_OUT_DIR,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        runs: DEFAULT_RUNS,
        maxTargets: DEFAULT_MAX_TARGETS,
        jsResultsPath: null,
        nativeResultsPath: null,
        manifestPaths: [],
        profileRuntimeCounters: false,
        dryRun: false,
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--out-dir' && index + 1 < argv.length) {
            options.outDir = path.resolve(argv[++index]);
        } else if (arg === '--timeout-ms' && index + 1 < argv.length) {
            options.timeoutMs = parsePositiveInt(argv[++index], '--timeout-ms');
        } else if (arg === '--runs' && index + 1 < argv.length) {
            options.runs = parsePositiveInt(argv[++index], '--runs');
        } else if (arg === '--max-targets' && index + 1 < argv.length) {
            options.maxTargets = parsePositiveInt(argv[++index], '--max-targets');
        } else if (arg === '--js-results' && index + 1 < argv.length) {
            options.jsResultsPath = path.resolve(argv[++index]);
        } else if (arg === '--native-results' && index + 1 < argv.length) {
            options.nativeResultsPath = path.resolve(argv[++index]);
        } else if (arg === '--manifest' && index + 1 < argv.length) {
            options.manifestPaths.push(path.resolve(argv[++index]));
        } else if (arg === '--profile-runtime-counters') {
            options.profileRuntimeCounters = true;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else {
            throw new Error(`Unsupported argument: ${arg}`);
        }
    }
    return options;
}

function buildManifest(options, selected) {
    return {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        source: 'run_native_solver_instrumentation_pack.js',
        corpus: options.corpusDir,
        timeout_ms: options.timeoutMs,
        selection: {
            max_targets: options.maxTargets,
            total_candidates: selected.total_candidates,
            category_counts: selected.category_counts,
            js_results: options.jsResultsPath,
            native_results: options.nativeResultsPath,
            extra_manifests: options.manifestPaths,
        },
        targets: selected.targets,
    };
}

function runBenchmarkForStrategy(options, manifestPath, spec) {
    const benchmarkScript = path.join(__dirname, 'run_solver_level_benchmark.js');
    const outPath = path.join(options.outDir, `${spec.id}.json`);
    const args = [
        benchmarkScript,
        options.solverPath,
        options.corpusDir,
        manifestPath,
        '--runs', String(options.runs),
        '--timeout-ms', String(options.timeoutMs),
        '--strategy', spec.strategy,
        '--out', outPath,
    ];
    if (options.profileRuntimeCounters) {
        args.push('--profile-runtime-counters');
    }
    for (const solverArg of spec.solverArgs) {
        args.push('--solver-arg', solverArg);
    }

    process.stderr.write(`instrumentation_pack strategy=${spec.id} targets_manifest=${manifestPath}\n`);
    const result = spawnSync(process.execPath, args, {
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
    });
    if (result.error) {
        throw new Error(`benchmark ${spec.id} failed to run: ${result.error.message}`);
    }
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) {
        throw new Error(`benchmark ${spec.id} exited ${result.status}`);
    }
    return readJsonFile(outPath, `${spec.id} benchmark`);
}

function renderReadme({ options, manifestPath, summaryPath, strategies }) {
    const lines = [
        '# Native Solver Instrumentation Pack',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        'This directory contains a reusable target manifest plus one benchmark JSON per strategy.',
        'The target set is selected from saved JS/native corpus results, known regressions, and optional extra manifests.',
        '',
        'Files:',
        `- manifest: ${path.basename(manifestPath)}`,
        `- summary: ${path.basename(summaryPath)}`,
        ...strategies.map((strategy) => `- ${strategy.id}: ${strategy.id}.json`),
        '',
        'Command shape:',
        '```sh',
        `node src/tests/run_native_solver_instrumentation_pack.js ${options.solverPath} ${options.corpusDir} --out-dir ${options.outDir} --timeout-ms ${options.timeoutMs} --runs ${options.runs} --max-targets ${options.maxTargets}`,
        '```',
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function main(argv) {
    const options = parseArgs(argv);
    const jsRun = options.jsResultsPath ? readJsonFile(options.jsResultsPath, 'JS results') : null;
    const nativeRun = options.nativeResultsPath ? readJsonFile(options.nativeResultsPath, 'native results') : null;
    const extraManifests = options.manifestPaths.map((manifestPath) => ({
        name: path.basename(manifestPath),
        manifest: readJsonFile(manifestPath, 'extra manifest'),
    }));
    const selected = selectInstrumentationTargets({
        jsRun,
        nativeRun,
        extraManifests,
        maxTargets: options.maxTargets,
        timeoutMs: options.timeoutMs,
    });
    if (selected.targets.length === 0) {
        throw new Error('no instrumentation targets selected; pass --native-results or --manifest');
    }

    fs.mkdirSync(options.outDir, { recursive: true });
    const manifestPath = path.join(options.outDir, 'manifest.json');
    const manifest = buildManifest(options, selected);
    writeJsonFile(manifestPath, manifest);

    const strategies = buildStrategySpecs();
    const outputsByStrategy = new Map();
    if (!options.dryRun) {
        for (const spec of strategies) {
            outputsByStrategy.set(spec.id, runBenchmarkForStrategy(options, manifestPath, spec));
        }
    }

    const summary = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        solver: options.solverPath,
        corpus: options.corpusDir,
        out_dir: options.outDir,
        timeout_ms: options.timeoutMs,
        runs: options.runs,
        profile_runtime_counters: options.profileRuntimeCounters,
        manifest: manifestPath,
        target_count: selected.targets.length,
        total_candidates: selected.total_candidates,
        category_counts: selected.category_counts,
        dry_run: options.dryRun,
        ...summarizeStrategyOutputs({
            strategies,
            manifestTargets: selected.targets,
            outputsByStrategy,
        }),
    };
    const summaryPath = path.join(options.outDir, 'summary.json');
    writeJsonFile(summaryPath, summary);
    writeTextFile(path.join(options.outDir, 'README.md'), renderReadme({ options, manifestPath, summaryPath, strategies }));

    process.stdout.write(
        `native_solver_instrumentation_pack wrote ${options.outDir} ` +
        `targets=${selected.targets.length} candidates=${selected.total_candidates} dry_run=${options.dryRun}\n`
    );
    if (!options.dryRun) {
        const solvedLine = strategies
            .map((strategy) => `${strategy.id}=${summary.strategies[strategy.id].solved}`)
            .join(' ');
        process.stdout.write(`native_solver_instrumentation_pack solved ${solvedLine}\n`);
    }
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.stack || error.message);
        process.exit(1);
    }
}

module.exports = {
    buildStrategySpecs,
    selectInstrumentationTargets,
    summarizeStrategyOutputs,
    resultKey,
};
