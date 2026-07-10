#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyzeFile } = require('./ps_static_analysis');

function usage() {
    console.error(
        'Usage: node src/tests/run_native_solver_js_coverage.js <puzzlescript_solver> <solver_tests_dir> ' +
        '[--timeout-ms N] [--strategy NAME] [--jobs N] [--js-results PATH] [--native-results PATH] ' +
        '[--write-js-results PATH] [--write-native-results PATH]'
    );
    process.exit(1);
}

function resultKey(result) {
    return `${result.game}\u0000${result.level}`;
}

function byKey(results) {
    return new Map((results || []).map((result) => [resultKey(result), result]));
}

function findJsSolvedNativeMisses(jsRun, nativeRun) {
    const nativeByKey = byKey(nativeRun.results);
    return (jsRun.results || [])
        .filter((result) => result.status === 'solved')
        .filter((result) => {
            const native = nativeByKey.get(resultKey(result));
            return !native || native.status !== 'solved';
        })
        .map((result) => {
            const native = nativeByKey.get(resultKey(result));
            return {
                game: result.game,
                level: result.level,
                js_ms: result.elapsed_ms,
                js_len: result.solution_length,
                native_status: native ? native.status : 'missing',
                native_ms: native ? native.elapsed_ms : undefined,
                native_len: native ? native.solution_length : undefined,
            };
        });
}

function summarizeCoverage(jsRun, nativeRun, misses) {
    const jsSolvedKeys = new Set(
        (jsRun.results || [])
            .filter((result) => result.status === 'solved')
            .map(resultKey)
    );
    const nativeSolved = (nativeRun.results || [])
        .filter((result) => result.status === 'solved' && jsSolvedKeys.has(resultKey(result)))
        .length;
    const nativeErrors = (nativeRun.results || [])
        .filter((result) => result.status === 'error' || result.status === 'level_error')
        .length;
    return {
        jsSolved: jsSolvedKeys.size,
        nativeSolved,
        misses: misses.length,
        nativeErrors,
    };
}

function parseJson(text, label) {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} did not contain JSON: ${error.message}`);
    }
}

function readJsonFile(filePath, label) {
    return parseJson(fs.readFileSync(filePath, 'utf8'), label);
}

function writeJsonFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function discoverSolverGameFiles(corpusDir) {
    const stat = fs.statSync(corpusDir);
    if (stat.isFile()) {
        return [corpusDir];
    }
    const files = [];
    function visit(dir) {
        for (const entry of fs.readdirSync(dir).sort()) {
            if (entry.startsWith('.')) {
                continue;
            }
            const fullPath = path.join(dir, entry);
            const entryStat = fs.statSync(fullPath);
            if (entryStat.isDirectory()) {
                visit(fullPath);
            } else if (entryStat.isFile() && entry.toLowerCase().endsWith('.txt')) {
                files.push(fullPath);
            }
        }
    }
    visit(corpusDir);
    return files;
}

function relativeGamePath(corpusDir, filePath) {
    const stat = fs.statSync(corpusDir);
    const rel = stat.isFile()
        ? path.basename(filePath)
        : path.relative(corpusDir, filePath);
    return rel.split(path.sep).join('/');
}

function staticHintObjectsFromReport(report) {
    const objects = report && report.ps_tagged && Array.isArray(report.ps_tagged.objects)
        ? report.ps_tagged.objects
        : [];
    return objects.map((object) => ({
        name: object.name,
        canonical_name: object.canonical_name,
        tags: {
            static: Boolean(object.tags && object.tags.static === true),
        },
    }));
}

function stringArray(values) {
    return Array.isArray(values)
        ? values.filter((value) => typeof value === 'string')
        : [];
}

function numberArray(values) {
    return Array.isArray(values)
        ? values.filter((value) => Number.isInteger(value))
        : [];
}

function solverHashProjectionFactsFromReport(report) {
    const facts = report && report.facts && Array.isArray(report.facts.solver_hash_projection)
        ? report.facts.solver_hash_projection
        : [];
    return facts
        .filter((fact) => fact && fact.id === 'solver_hash_projection' && fact.value)
        .map((fact) => ({
            id: 'solver_hash_projection',
            status: fact.status || 'candidate',
            value: {
                projected_objects: stringArray(fact.value.projected_objects),
                projected_layers: numberArray(fact.value.projected_layers),
                transient_objects: stringArray(fact.value.transient_objects),
                blockers: stringArray(fact.value.blockers),
                scope: fact.value.scope || null,
            },
            blockers: stringArray(fact.blockers),
        }));
}

function taggedRuleSectionsForWinRelevance(report) {
    const sections = report && report.ps_tagged && Array.isArray(report.ps_tagged.rule_sections)
        ? report.ps_tagged.rule_sections
        : [];
    return sections.map((section) => ({
        groups: (Array.isArray(section.groups) ? section.groups : []).map((group) => ({
            rules: (Array.isArray(group.rules) ? group.rules : [])
                .filter((rule) => rule && typeof rule.id === 'string' && Number.isInteger(rule.source_line))
                .map((rule) => ({
                    id: rule.id,
                    source_line: rule.source_line,
                })),
        })),
    }));
}

function winRelevanceFactsFromReport(report) {
    const facts = report && report.facts && Array.isArray(report.facts.win_relevance)
        ? report.facts.win_relevance
        : [];
    return facts
        .filter((fact) => fact && fact.id === 'win_relevance' && fact.value)
        .map((fact) => ({
            id: 'win_relevance',
            status: fact.status || 'candidate',
            value: {
                rule_ids: stringArray(fact.value.rule_ids),
                root_rule_ids: stringArray(fact.value.root_rule_ids),
                semantic_root_rule_ids: stringArray(fact.value.semantic_root_rule_ids),
                movement_root_rule_ids: stringArray(fact.value.movement_root_rule_ids),
                relevant_rule_ids: stringArray(fact.value.relevant_rule_ids),
                irrelevant_rule_ids: stringArray(fact.value.irrelevant_rule_ids),
            },
        }));
}

function buildStaticAnalysisHintsManifest(corpusDir, analyze = analyzeFile) {
    const games = {};
    for (const filePath of discoverSolverGameFiles(corpusDir)) {
        const report = analyze(filePath, { sourcePath: filePath });
        const gameEntry = {
            status: report && report.status === 'ok' ? 'ok' : 'compile_error',
            objects: staticHintObjectsFromReport(report),
        };
        const solverHashProjection = solverHashProjectionFactsFromReport(report);
        const winRelevance = winRelevanceFactsFromReport(report);
        if (solverHashProjection.length > 0) {
            gameEntry.facts = {
                solver_hash_projection: solverHashProjection,
            };
        }
        if (winRelevance.length > 0) {
            gameEntry.facts = gameEntry.facts || {};
            gameEntry.facts.win_relevance = winRelevance;
            gameEntry.ps_tagged = {
                rule_sections: taggedRuleSectionsForWinRelevance(report),
            };
        }
        games[relativeGamePath(corpusDir, filePath)] = gameEntry;
    }
    return {
        schema: 'native-solver-static-analysis-hints-v1',
        games,
    };
}

function runJson(command, args, label) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
    });
    if (result.error) {
        throw new Error(`${label} failed to run: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    return parseJson(result.stdout, label);
}

function parseArgs(argv) {
    if (argv.length < 2) {
        usage();
    }
    const options = {
        solverPath: path.resolve(argv[0]),
        corpusDir: path.resolve(argv[1]),
        timeoutMs: 1000,
        strategy: 'portfolio',
        jobs: 1,
        jsResults: null,
        nativeResults: null,
        writeJsResults: null,
        writeNativeResults: null,
    };
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--timeout-ms' && index + 1 < argv.length) {
            options.timeoutMs = Number.parseInt(argv[++index], 10);
        } else if (arg === '--strategy' && index + 1 < argv.length) {
            options.strategy = argv[++index];
        } else if (arg === '--jobs' && index + 1 < argv.length) {
            options.jobs = Number.parseInt(argv[++index], 10);
        } else if (arg === '--js-results' && index + 1 < argv.length) {
            options.jsResults = path.resolve(argv[++index]);
        } else if (arg === '--native-results' && index + 1 < argv.length) {
            options.nativeResults = path.resolve(argv[++index]);
        } else if (arg === '--write-js-results' && index + 1 < argv.length) {
            options.writeJsResults = path.resolve(argv[++index]);
        } else if (arg === '--write-native-results' && index + 1 < argv.length) {
            options.writeNativeResults = path.resolve(argv[++index]);
        } else {
            throw new Error(`Unsupported argument: ${arg}`);
        }
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error(`Invalid --timeout-ms: ${options.timeoutMs}`);
    }
    if (!Number.isFinite(options.jobs) || options.jobs <= 0) {
        throw new Error(`Invalid --jobs: ${options.jobs}`);
    }
    return options;
}

function loadOrRunJs(options) {
    if (options.jsResults) {
        return readJsonFile(options.jsResults, 'JS results');
    }
    const jsSolverPath = path.join(__dirname, 'run_solver_tests_js.js');
    const result = runJson(process.execPath, [
        jsSolverPath,
        options.corpusDir,
        '--timeout-ms', String(options.timeoutMs),
        '--strategy', options.strategy,
        '--no-solutions',
        '--quiet',
        '--json',
    ], 'JS solver');
    if (options.writeJsResults) {
        writeJsonFile(options.writeJsResults, result);
    }
    return result;
}

function loadOrRunNative(options) {
    if (options.nativeResults) {
        return readJsonFile(options.nativeResults, 'native results');
    }
    const staticAnalysisDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-solver-static-analysis-'));
    const staticAnalysisPath = path.join(staticAnalysisDir, 'static-analysis-hints.json');
    writeJsonFile(staticAnalysisPath, buildStaticAnalysisHintsManifest(options.corpusDir));
    const result = runJson(options.solverPath, [
        options.corpusDir,
        '--timeout-ms', String(options.timeoutMs),
        '--jobs', String(options.jobs),
        '--strategy', options.strategy,
        '--static-analysis-hints', staticAnalysisPath,
        '--no-solutions',
        '--quiet',
        '--json',
    ], 'native solver');
    if (options.writeNativeResults) {
        writeJsonFile(options.writeNativeResults, result);
    }
    return result;
}

function main(argv) {
    const options = parseArgs(argv);
    const jsRun = loadOrRunJs(options);
    const nativeRun = loadOrRunNative(options);
    const misses = findJsSolvedNativeMisses(jsRun, nativeRun);
    const summary = summarizeCoverage(jsRun, nativeRun, misses);

    if (misses.length > 0) {
        const lines = misses
            .slice(0, 25)
            .map((miss) => JSON.stringify(miss))
            .join('\n');
        const suffix = misses.length > 25 ? `\n... ${misses.length - 25} more` : '';
        throw new Error(
            `native solver missed ${misses.length} JS-solved levels ` +
            `(js_solved=${summary.jsSolved}, native_solved=${summary.nativeSolved})\n${lines}${suffix}`
        );
    }

    process.stdout.write(
        `native_solver_js_coverage passed js_solved=${summary.jsSolved} ` +
        `native_solved=${summary.nativeSolved} native_errors=${summary.nativeErrors} ` +
        `timeout_ms=${options.timeoutMs} strategy=${options.strategy} jobs=${options.jobs}\n`
    );
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
    buildStaticAnalysisHintsManifest,
    findJsSolvedNativeMisses,
    summarizeCoverage,
    resultKey,
    solverHashProjectionFactsFromReport,
};
