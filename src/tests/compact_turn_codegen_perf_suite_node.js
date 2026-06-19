#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 1000;
const REQUIRED_RUNTIME_COUNTER_KEYS = Object.freeze([
    'compact_turn_setup_ns',
    'compact_turn_early_rules_ns',
    'compact_turn_movement_ns',
    'compact_turn_late_rules_ns',
    'compact_turn_win_ns',
    'compact_turn_canonicalize_ns',
    'compact_turn_rule_mask_precheck_passes',
    'compact_turn_rule_mask_precheck_failures',
    'compact_turn_rule_apply_calls',
    'compact_turn_rule_apply_no_match',
    'compact_turn_rule_apply_changed',
    'compact_turn_rebuild_rule_derived_state_calls',
    'compact_turn_rebuild_rule_derived_state_objects_dirty',
    'compact_turn_rebuild_rule_derived_state_movements_dirty',
    'compact_turn_simple_replacement_fast_path_calls',
    'compact_turn_simple_replacement_fast_path_noops',
    'compact_turn_simple_replacement_fast_path_changes',
]);
const ALLOWED_EXPECTATION_FIELDS = Object.freeze([
    'compiledUsPerGeneratedMax',
    'compiledGeneratedMin',
    'compiledLateRulesMsMax',
    'compiledRuleApplyCallsMax',
]);
const CASE_THRESHOLD_FIELDS = Object.freeze([
    'compiledStepRatioMax',
    'compiledGeneratedRatioMin',
    'compiledUsPerGeneratedRatioMax',
]);
const ALLOWED_CASE_FIELDS = Object.freeze([
    'game',
    'level',
    'kind',
    ...CASE_THRESHOLD_FIELDS,
]);

function usage() {
    console.log([
        'Usage: node src/tests/compact_turn_codegen_perf_suite_node.js',
        '  --interpreter-solver PATH --compiled-solver PATH --cases PATH',
        '  [--corpus DIR] [--timeout-ms N] [--expectations PATH] [--out PATH]',
    ].join('\n'));
}

function parseArgs(argv) {
    const options = {
        corpus: path.join(__dirname, 'solver_tests'),
        interpreterSolver: null,
        compiledSolver: null,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        casesPath: null,
        expectationsPath: null,
        outPath: null,
    };
    for (let index = 2; index < argv.length; ++index) {
        const arg = argv[index];
        const next = () => {
            assert.ok(index + 1 < argv.length, `missing value for ${arg}`);
            return argv[++index];
        };
        if (arg === '--corpus') {
            options.corpus = next();
        } else if (arg === '--interpreter-solver') {
            options.interpreterSolver = next();
        } else if (arg === '--compiled-solver') {
            options.compiledSolver = next();
        } else if (arg === '--timeout-ms') {
            options.timeoutMs = Number(next());
        } else if (arg === '--cases') {
            options.casesPath = next();
        } else if (arg === '--expectations') {
            options.expectationsPath = next();
        } else if (arg === '--out') {
            options.outPath = next();
        } else if (arg === '--help' || arg === '-h') {
            usage();
            process.exit(0);
        } else {
            throw new Error(`unknown argument ${arg}`);
        }
    }
    if (!options.interpreterSolver || !options.compiledSolver) {
        throw new Error('expected --interpreter-solver and --compiled-solver');
    }
    if (!options.casesPath) {
        throw new Error('expected --cases');
    }
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error(`invalid --timeout-ms ${options.timeoutMs}`);
    }
    return options;
}

function readJson(jsonPath) {
    return JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function valueType(value) {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    return typeof value;
}

function valueDescription(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return String(value);
    }
    const description = JSON.stringify(value);
    return description === undefined ? String(value) : description;
}

function validateFiniteSchemaNumber(value, context, fieldName) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
            `${context}: ${fieldName} must be a finite number; `
            + `actual=${valueDescription(value)} type=${valueType(value)}`,
        );
    }
}

function parseCounters(output, context) {
    const match = output.match(/^solver_runtime_counters\s+(.+)$/m);
    if (!match) {
        throw new Error(`${context}: missing solver_runtime_counters line`);
    }
    const counters = {};
    for (const part of match[1].trim().split(/\s+/)) {
        const [key, value] = part.split('=');
        const numericValue = Number(value);
        if (!key || !Number.isFinite(numericValue)) {
            throw new Error(`${context}: invalid runtime counter ${part}`);
        }
        counters[key] = numericValue;
    }
    return counters;
}

function validateRuntimeCounters(counters, context) {
    const missing = REQUIRED_RUNTIME_COUNTER_KEYS.filter((key) => (
        !hasOwn(counters, key)
    ));
    if (missing.length > 0) {
        throw new Error(`${context}: missing runtime counter key(s): ${missing.join(', ')}`);
    }
}

function extractFirstJsonObject(output) {
    const jsonStart = output.indexOf('{');
    assert.notStrictEqual(jsonStart, -1, `solver output did not contain JSON:\n${output}`);
    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let index = jsonStart; index < output.length; ++index) {
        const char = output[index];
        if (inString) {
            if (escaping) {
                escaping = false;
            } else if (char === '\\') {
                escaping = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
        } else if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0) {
                return output.slice(jsonStart, index + 1);
            }
        }
    }
    throw new Error(`solver output contained unterminated JSON:\n${output}`);
}

function parseJson(output) {
    return JSON.parse(extractFirstJsonObject(output));
}

function runSolver(options, solver, testCase, extraArgs, runName) {
    const args = [
        options.corpus,
        '--timeout-ms', String(options.timeoutMs),
        '--jobs', '1',
        '--strategy', 'portfolio',
        '--game', testCase.game,
        '--level', String(testCase.level),
        '--json',
        '--no-solutions',
        '--quiet',
        '--profile-runtime-counters',
        ...extraArgs,
    ];
    const result = spawnSync(solver, args, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 64,
    });
    if (result.status !== 0) {
        throw new Error([
            `solver exited ${result.status}: ${solver}`,
            `args: ${args.join(' ')}`,
            'stdout:',
            result.stdout,
            'stderr:',
            result.stderr,
        ].join('\n'));
    }
    const key = caseKey(testCase);
    const json = parseJson(result.stdout);
    assert.strictEqual(json.results.length, 1, `expected one result for ${key}`);
    const counters = parseCounters(`${result.stdout}\n${result.stderr}`, `${key} ${runName}`);
    validateRuntimeCounters(counters, `${key} ${runName}`);
    return {
        args,
        result: json.results[0],
        totals: json.totals || {},
        counters,
    };
}

function caseKey(testCase) {
    return `${testCase.game}#${testCase.level}`;
}

function nsToMs(value, key) {
    const numericValue = Number(value);
    assert.ok(Number.isFinite(numericValue), `expected finite runtime counter ${key}`);
    return numericValue / 1000000;
}

function counterValue(counters, key) {
    const numericValue = Number(counters[key]);
    assert.ok(Number.isFinite(numericValue), `expected finite runtime counter ${key}`);
    return numericValue;
}

function finiteResultNumber(value, context, fieldName) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${context}: expected finite numeric ${fieldName}`);
    }
    return value;
}

function stepTimeUsFor(result, context) {
    if (hasOwn(result, 'step_time_us')) {
        return finiteResultNumber(result.step_time_us, context, 'step_time_us');
    }
    if (hasOwn(result, 'step_ms')) {
        const stepMs = finiteResultNumber(result.step_ms, context, 'step_ms');
        return stepMs * 1000;
    }
    throw new Error(`${context}: missing step_time_us or step_ms`);
}

function generatedFor(result, context) {
    if (!hasOwn(result, 'generated')) {
        throw new Error(`${context}: missing generated`);
    }
    return finiteResultNumber(result.generated, context, 'generated');
}

function metricsFor(run, context) {
    const generated = generatedFor(run.result, context);
    const stepTimeUs = stepTimeUsFor(run.result, context);
    const stepMs = Number.isFinite(Number(run.result.step_ms))
        ? Number(run.result.step_ms)
        : stepTimeUs / 1000;
    return {
        generated,
        stepMs,
        stepTimeUs,
        usPerGenerated: generated > 0 ? stepTimeUs / generated : Number.POSITIVE_INFINITY,
        compactTurnSetupMs: nsToMs(run.counters.compact_turn_setup_ns, 'compact_turn_setup_ns'),
        compactTurnEarlyRulesMs: nsToMs(run.counters.compact_turn_early_rules_ns, 'compact_turn_early_rules_ns'),
        compactTurnMovementMs: nsToMs(run.counters.compact_turn_movement_ns, 'compact_turn_movement_ns'),
        compactTurnLateRulesMs: nsToMs(run.counters.compact_turn_late_rules_ns, 'compact_turn_late_rules_ns'),
        compactTurnWinMs: nsToMs(run.counters.compact_turn_win_ns, 'compact_turn_win_ns'),
        compactTurnCanonicalizeMs: nsToMs(run.counters.compact_turn_canonicalize_ns, 'compact_turn_canonicalize_ns'),
        compactTurnRuleMaskPrecheckPasses: counterValue(run.counters, 'compact_turn_rule_mask_precheck_passes'),
        compactTurnRuleMaskPrecheckFailures: counterValue(run.counters, 'compact_turn_rule_mask_precheck_failures'),
        compactTurnRuleApplyCalls: counterValue(run.counters, 'compact_turn_rule_apply_calls'),
        compactTurnRuleApplyNoMatch: counterValue(run.counters, 'compact_turn_rule_apply_no_match'),
        compactTurnRuleApplyChanged: counterValue(run.counters, 'compact_turn_rule_apply_changed'),
        compactTurnRebuildRuleDerivedStateCalls: counterValue(run.counters, 'compact_turn_rebuild_rule_derived_state_calls'),
        compactTurnRebuildRuleDerivedStateObjectsDirty: counterValue(run.counters, 'compact_turn_rebuild_rule_derived_state_objects_dirty'),
        compactTurnRebuildRuleDerivedStateMovementsDirty: counterValue(run.counters, 'compact_turn_rebuild_rule_derived_state_movements_dirty'),
        compactTurnSimpleReplacementFastPathCalls: counterValue(run.counters, 'compact_turn_simple_replacement_fast_path_calls'),
        compactTurnSimpleReplacementFastPathNoops: counterValue(run.counters, 'compact_turn_simple_replacement_fast_path_noops'),
        compactTurnSimpleReplacementFastPathChanges: counterValue(run.counters, 'compact_turn_simple_replacement_fast_path_changes'),
    };
}

function validateExpectations(cases, expectations, expectationsPath) {
    assert.ok(
        expectations && typeof expectations === 'object' && !Array.isArray(expectations),
        '--expectations must contain an object',
    );
    const knownKeys = new Set(cases.map(caseKey));
    const unknownKeys = Object.keys(expectations).filter((key) => !knownKeys.has(key)).sort();
    if (unknownKeys.length > 0) {
        throw new Error([
            `${expectationsPath}: unknown expectation key(s): ${unknownKeys.join(', ')}`,
            `known case key(s): ${Array.from(knownKeys).sort().join(', ')}`,
        ].join('\n'));
    }
    for (const key of Object.keys(expectations).sort()) {
        const expectation = expectations[key];
        assert.ok(
            expectation && typeof expectation === 'object' && !Array.isArray(expectation),
            `${expectationsPath}: ${key}: expectation must be an object`,
        );
        const unknownFields = Object.keys(expectation).filter((field) => (
            !ALLOWED_EXPECTATION_FIELDS.includes(field)
        )).sort();
        if (unknownFields.length > 0) {
            throw new Error([
                `${expectationsPath}: ${key}: unknown expectation field(s): ${unknownFields.join(', ')}`,
                `allowed field(s): ${ALLOWED_EXPECTATION_FIELDS.join(', ')}`,
            ].join('\n'));
        }
        for (const field of ALLOWED_EXPECTATION_FIELDS) {
            if (hasOwn(expectation, field)) {
                validateFiniteSchemaNumber(expectation[field], `${expectationsPath}: ${key}`, field);
            }
        }
    }
}

function validateCases(cases, casesPath) {
    for (let index = 0; index < cases.length; ++index) {
        const testCase = cases[index];
        const context = testCase && typeof testCase === 'object' && !Array.isArray(testCase)
            ? `${casesPath}: ${caseKey(testCase)}`
            : `${casesPath}: case[${index}]`;
        assert.ok(
            testCase && typeof testCase === 'object' && !Array.isArray(testCase),
            `${context}: case must be an object`,
        );
        const unknownFields = Object.keys(testCase).filter((field) => (
            !ALLOWED_CASE_FIELDS.includes(field)
        )).sort();
        if (unknownFields.length > 0) {
            throw new Error([
                `${context}: unknown case field(s): ${unknownFields.join(', ')}`,
                `allowed field(s): ${ALLOWED_CASE_FIELDS.join(', ')}`,
            ].join('\n'));
        }
        for (const field of CASE_THRESHOLD_FIELDS) {
            if (hasOwn(testCase, field)) {
                validateFiniteSchemaNumber(testCase[field], context, field);
            }
        }
    }
}

function ratio(numerator, denominator) {
    if (denominator === 0) {
        return numerator === 0 ? 0 : Number.POSITIVE_INFINITY;
    }
    return numerator / denominator;
}

function fmt(value, digits) {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    return value.toFixed(digits);
}

function metricFailure(key, metricName, actual, op, expected) {
    return `${key}: ${metricName} ${fmt(actual, 3)} ${op} ${fmt(expected, 3)}`;
}

function evaluateControls(testCase, row) {
    const key = caseKey(testCase);
    const failures = [];
    const interpreter = row.interpreter.metrics;
    const compiled = row.compiled.metrics;

    if (testCase.compiledStepRatioMax !== undefined) {
        const actual = ratio(compiled.stepTimeUs, interpreter.stepTimeUs);
        row.controlMetrics.compiledStepRatio = actual;
        if (!(actual <= testCase.compiledStepRatioMax)) {
            failures.push(metricFailure(key, 'compiledStepRatio', actual, '>', testCase.compiledStepRatioMax));
        }
    }
    if (testCase.compiledGeneratedRatioMin !== undefined && testCase.compiledUsPerGeneratedRatioMax !== undefined) {
        const generatedRatio = ratio(compiled.generated, interpreter.generated);
        const usPerGeneratedRatio = ratio(compiled.usPerGenerated, interpreter.usPerGenerated);
        row.controlMetrics.compiledGeneratedRatio = generatedRatio;
        row.controlMetrics.compiledUsPerGeneratedRatio = usPerGeneratedRatio;
        if (!(generatedRatio >= testCase.compiledGeneratedRatioMin || usPerGeneratedRatio <= testCase.compiledUsPerGeneratedRatioMax)) {
            failures.push([
                `${key}: expected compiledGeneratedRatio >= ${fmt(testCase.compiledGeneratedRatioMin, 3)}`,
                `or compiledUsPerGeneratedRatio <= ${fmt(testCase.compiledUsPerGeneratedRatioMax, 3)};`,
                `actual generatedRatio=${fmt(generatedRatio, 3)}`,
                `usPerGeneratedRatio=${fmt(usPerGeneratedRatio, 3)}`,
            ].join(' '));
        }
    } else if (testCase.compiledGeneratedRatioMin !== undefined) {
        const actual = ratio(compiled.generated, interpreter.generated);
        row.controlMetrics.compiledGeneratedRatio = actual;
        if (!(actual >= testCase.compiledGeneratedRatioMin)) {
            failures.push(metricFailure(key, 'compiledGeneratedRatio', actual, '<', testCase.compiledGeneratedRatioMin));
        }
    } else if (testCase.compiledUsPerGeneratedRatioMax !== undefined) {
        const actual = ratio(compiled.usPerGenerated, interpreter.usPerGenerated);
        row.controlMetrics.compiledUsPerGeneratedRatio = actual;
        if (!(actual <= testCase.compiledUsPerGeneratedRatioMax)) {
            failures.push(metricFailure(key, 'compiledUsPerGeneratedRatio', actual, '>', testCase.compiledUsPerGeneratedRatioMax));
        }
    }

    return failures;
}

function evaluateExpectations(testCase, row, expectations) {
    const key = caseKey(testCase);
    const expectation = expectations[key];
    const failures = [];
    if (!expectation) {
        return failures;
    }
    const compiled = row.compiled.metrics;
    if (expectation.compiledUsPerGeneratedMax !== undefined
            && !(compiled.usPerGenerated <= expectation.compiledUsPerGeneratedMax)) {
        failures.push(metricFailure(key, 'compiledUsPerGenerated', compiled.usPerGenerated, '>', expectation.compiledUsPerGeneratedMax));
    }
    if (expectation.compiledGeneratedMin !== undefined
            && !(compiled.generated >= expectation.compiledGeneratedMin)) {
        failures.push(metricFailure(key, 'compiledGenerated', compiled.generated, '<', expectation.compiledGeneratedMin));
    }
    if (expectation.compiledLateRulesMsMax !== undefined
            && !(compiled.compactTurnLateRulesMs <= expectation.compiledLateRulesMsMax)) {
        failures.push(metricFailure(key, 'compiledLateRulesMs', compiled.compactTurnLateRulesMs, '>', expectation.compiledLateRulesMsMax));
    }
    if (expectation.compiledRuleApplyCallsMax !== undefined
            && !(compiled.compactTurnRuleApplyCalls <= expectation.compiledRuleApplyCallsMax)) {
        failures.push(metricFailure(key, 'compiledRuleApplyCalls', compiled.compactTurnRuleApplyCalls, '>', expectation.compiledRuleApplyCallsMax));
    }
    return failures;
}

function printRow(row) {
    const i = row.interpreter.metrics;
    const c = row.compiled.metrics;
    console.log(
        `${row.key} kind=${row.kind}`
        + ` interpreter generated=${i.generated} us/generated=${fmt(i.usPerGenerated, 2)} step_ms=${fmt(i.stepMs, 3)}`
        + ` compiled generated=${c.generated} us/generated=${fmt(c.usPerGenerated, 2)} step_ms=${fmt(c.stepMs, 3)}`
        + ` late_rules_ms=${fmt(c.compactTurnLateRulesMs, 3)}`
    );
}

function main() {
    const options = parseArgs(process.argv);
    const cases = readJson(options.casesPath, 'cases');
    const expectations = options.expectationsPath ? readJson(options.expectationsPath, 'expectations') : null;
    assert.ok(Array.isArray(cases), '--cases must contain an array');
    validateCases(cases, options.casesPath);
    if (options.expectationsPath) {
        validateExpectations(cases, expectations, options.expectationsPath);
    }

    const report = {
        generated_at: new Date().toISOString(),
        corpus: options.corpus,
        timeout_ms: options.timeoutMs,
        cases_path: options.casesPath,
        expectations_path: options.expectationsPath || null,
        solvers: {
            interpreter: options.interpreterSolver,
            compiled: options.compiledSolver,
        },
        cases: [],
        failures: [],
    };

    for (const testCase of cases) {
        const interpreter = runSolver(options, options.interpreterSolver, testCase, [], 'interpreter');
        const compiled = runSolver(options, options.compiledSolver, testCase, ['--compact-node-storage'], 'compiled');
        const row = {
            key: caseKey(testCase),
            game: testCase.game,
            level: testCase.level,
            kind: testCase.kind || 'case',
            thresholds: { ...testCase },
            controlMetrics: {},
            interpreter: {
                result: interpreter.result,
                totals: interpreter.totals,
                counters: interpreter.counters,
                metrics: metricsFor(interpreter, `${caseKey(testCase)} interpreter`),
            },
            compiled: {
                result: compiled.result,
                totals: compiled.totals,
                counters: compiled.counters,
                metrics: metricsFor(compiled, `${caseKey(testCase)} compiled`),
            },
            failures: [],
        };

        row.failures.push(...evaluateControls(testCase, row));
        if (expectations) {
            row.failures.push(...evaluateExpectations(testCase, row, expectations));
        }
        report.failures.push(...row.failures);
        report.cases.push(row);
        printRow(row);
        for (const failure of row.failures) {
            console.error(`  FAIL ${failure}`);
        }
    }

    if (options.outPath) {
        fs.mkdirSync(path.dirname(path.resolve(options.outPath)), { recursive: true });
        fs.writeFileSync(options.outPath, `${JSON.stringify(report, null, 2)}\n`);
        console.log(`wrote ${options.outPath}`);
    }

    if (report.failures.length > 0) {
        throw new Error(report.failures.join('\n'));
    }

    console.log('compact_turn_codegen_perf_suite_node passed');
}

main();
