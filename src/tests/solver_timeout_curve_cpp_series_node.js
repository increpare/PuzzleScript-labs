#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-curve-cpp-series-'));
process.on('exit', () => {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
        // best-effort cleanup
    }
});

const baseJson = path.join(tempDir, 'js.json');
const cppPortfolioJson = path.join(tempDir, 'cpp-portfolio.json');
const cppHdaJson = path.join(tempDir, 'cpp-hda.json');
const outCsv = path.join(tempDir, 'out.csv');
const outSvg = path.join(tempDir, 'out.svg');
const argLog = path.join(tempDir, 'native-args.jsonl');
const fakeSolver = path.join(tempDir, 'fake_native_solver.js');

const payload = {
    meta: {
        corpus: 'test-corpus',
        max_ms: 10,
        step_ms: 10,
        generated_at: '2026-06-16T00:00:00.000Z',
        solver: 'JS smart',
        playable: 1,
    },
    results: [
        {
            game: 'fake.txt',
            levels: [
                { status: 'solved', elapsed_ms: 5, timeout_ms: 10 },
            ],
        },
    ],
};
fs.writeFileSync(baseJson, JSON.stringify(payload));

fs.writeFileSync(fakeSolver, [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    `fs.appendFileSync(${JSON.stringify(argLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    "process.stdout.write(JSON.stringify({ results: [{ game: 'fake.txt', levels: [{ status: 'solved', elapsed_ms: 5, timeout_ms: 10 }] }] }));",
    '',
].join('\n'));
fs.chmodSync(fakeSolver, 0o755);

const result = spawnSync(process.execPath, [
    path.join(__dirname, 'solver_timeout_curve.js'),
    '--from-json', baseJson,
    '--allow-smoke',
    '--max-ms', '10',
    '--step-ms', '10',
    '--cpp-solver', fakeSolver,
    '--cpp-series', `c++ portfolio:${cppPortfolioJson}:--jobs 1 --strategy portfolio`,
    '--cpp-series', `c++ hda-weighted-astar x8:${cppHdaJson}:--strategy hda-weighted-astar --hda-jobs 8`,
    '--out-csv', outCsv,
    '--out-svg', outSvg,
], {
    encoding: 'utf8',
});

assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
const nativeInvocations = fs.readFileSync(argLog, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
assert.strictEqual(nativeInvocations.length, 2, 'expected two native solver runs');
assert.deepStrictEqual(
    nativeInvocations.map((args) => args.filter((arg) => ['--jobs', '1', '--strategy', 'portfolio', '--hda-jobs', '8', 'hda-weighted-astar'].includes(arg))),
    [
        ['--jobs', '1', '--strategy', 'portfolio'],
        ['--strategy', 'hda-weighted-astar', '--hda-jobs', '8'],
    ]
);
assert.ok(fs.existsSync(cppPortfolioJson), 'portfolio native JSON should be saved');
assert.ok(fs.existsSync(cppHdaJson), 'HDA native JSON should be saved');
assert.match(fs.readFileSync(outCsv, 'utf8'), /c\+\+ hda-weighted-astar x8,10,1,100\.00/);

console.log('solver_timeout_curve_cpp_series_node passed');
