#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');

function runNode(args, options = {}) {
    return spawnSync(process.execPath, args, {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        ...options,
    });
}

function assertUsage(result, scriptName) {
    assert.strictEqual(result.status, 0, `${scriptName} --help should exit 0\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
    assert.ok(result.stdout.includes('Usage:'), `${scriptName} --help should print usage`);
    assert.ok(!result.stderr.includes('Error:'), `${scriptName} --help should not print a stack trace`);
}

assertUsage(runNode(['src/tests/diff_ir_json.js', '--help']), 'diff_ir_json.js');
assertUsage(runNode(['src/tests/run_compilation_tests_cpp_direct.js', '--help']), 'run_compilation_tests_cpp_direct.js');

const missingGame = runNode([
    'src/tests/run_solver_tests_js.js',
    'src/tests/solver_tests',
    '--game',
    'karamell',
    '--solver-opt-parity',
    '--no-solutions',
    '--quiet',
    '--summary-only',
]);
assert.notStrictEqual(missingGame.status, 0, '--game karamell should not pass after running zero levels');
assert.ok(
    missingGame.stderr.includes('No solver games matched --game "karamell"'),
    `missing game filter should explain the failed match\nstderr:\n${missingGame.stderr}`
);
assert.ok(
    missingGame.stderr.includes('karamell.txt'),
    `missing game filter should suggest the checked-in filename\nstderr:\n${missingGame.stderr}`
);

const summaryOnly = runNode([
    'src/tests/run_ps_static_analysis.js',
    'src/tests/static_analysis_testdata/runtime_contracts',
    '--game',
    'merge-projection',
    '--summary-only',
]);
assert.strictEqual(summaryOnly.status, 0, summaryOnly.stderr || summaryOnly.stdout);
const summaryReport = JSON.parse(summaryOnly.stdout);
assert.strictEqual(summaryReport.schema, 'ps-static-analysis-batch-summary-v1');
assert.strictEqual(summaryReport.source_count, 1);
assert.strictEqual(summaryReport.reports.length, 1);
assert.ok(summaryReport.reports[0].summary);
assert.ok(summaryReport.reports[0].facts.count_layer_invariants);
assert.strictEqual(summaryReport.reports[0].ps_tagged, undefined);
assert.ok(
    summaryOnly.stdout.length < 12000,
    `summary-only output should stay compact, got ${summaryOnly.stdout.length} bytes`
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-static-analysis-summary-'));
const outPath = path.join(tmpDir, 'summary.json');
const summaryOut = runNode([
    'src/tests/run_ps_static_analysis.js',
    'src/tests/static_analysis_testdata/runtime_contracts',
    '--game',
    'merge-projection',
    '--summary-only',
    '--out',
    outPath,
]);
assert.strictEqual(summaryOut.status, 0, summaryOut.stderr || summaryOut.stdout);
assert.strictEqual(summaryOut.stdout, '');
assert.strictEqual(JSON.parse(fs.readFileSync(outPath, 'utf8')).schema, 'ps-static-analysis-batch-summary-v1');

console.log('static_tool_cli_hardening_node: ok');
