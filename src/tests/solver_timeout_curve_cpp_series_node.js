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
const jsCanonicalJson = path.join(tempDir, 'js-canonical.json');
const canonicalCorpus = path.join(tempDir, 'canonical-corpus');
const cppPortfolioJson = path.join(tempDir, 'cpp-portfolio.json');
const cppPortfolioCanonicalJson = path.join(tempDir, 'cpp-portfolio-canonical.json');
const cppHdaJson = path.join(tempDir, 'cpp-hda.json');
const cppHdaCanonicalJson = path.join(tempDir, 'cpp-hda-canonical.json');
const cppPortfolioCompiledJson = path.join(tempDir, 'cpp-portfolio-compiled.json');
const cppHdaCompiledJson = path.join(tempDir, 'cpp-hda-compiled.json');
const cppPortfolioCompiledCanonicalJson = path.join(tempDir, 'cpp-portfolio-compiled-canonical.json');
const outCsv = path.join(tempDir, 'out.csv');
const outSvg = path.join(tempDir, 'out.svg');
const argLog = path.join(tempDir, 'native-args.jsonl');
const fakeSolver = path.join(tempDir, 'fake_native_solver.js');
const fakeCompiledSolver = path.join(tempDir, 'fake_compiled_native_solver.js');
const fakeCompiledCanonicalSolver = path.join(tempDir, 'fake_compiled_canonical_solver.js');

const payload = {
    meta: {
        corpus: 'test-corpus',
        max_ms: 10,
        step_ms: 10,
        generated_at: '2026-06-16T00:00:00.000Z',
        solver: 'Javascript',
        playable: 1,
    },
    results: [
        {
            game: 'one_move.txt',
            levels: [
                { status: 'solved', elapsed_ms: 5, timeout_ms: 10 },
            ],
        },
    ],
};
fs.writeFileSync(baseJson, JSON.stringify(payload));
const { writeCanonicalSolverCorpus } = require('./write_solver_canonical_corpus');

const sourceCorpus = path.join(tempDir, 'source-corpus');
fs.mkdirSync(sourceCorpus);
fs.copyFileSync(
    path.join(__dirname, 'solver_smoke_tests', 'one_move.txt'),
    path.join(sourceCorpus, 'one_move.txt')
);
writeCanonicalSolverCorpus(sourceCorpus, canonicalCorpus);

function writeFakeSolver(filePath, tag) {
    fs.writeFileSync(filePath, [
        '#!/usr/bin/env node',
        "'use strict';",
        "const fs = require('fs');",
        `fs.appendFileSync(${JSON.stringify(argLog)}, JSON.stringify([${JSON.stringify(tag)}, ...process.argv.slice(2)]) + '\\n');`,
        "process.stdout.write(JSON.stringify({ results: [{ game: 'one_move.txt', levels: [{ status: 'solved', elapsed_ms: 5, timeout_ms: 10 }] }] }));",
        '',
    ].join('\n'));
    fs.chmodSync(filePath, 0o755);
}

writeFakeSolver(fakeSolver, 'default');
writeFakeSolver(fakeCompiledSolver, 'compiled');
writeFakeSolver(fakeCompiledCanonicalSolver, 'compiled-canonical');

const result = spawnSync(process.execPath, [
    path.join(__dirname, 'solver_timeout_curve.js'),
    '--from-json', baseJson,
    '--allow-smoke',
    '--max-ms', '10',
    '--step-ms', '10',
    '--label', 'Javascript',
    '--save-json-canonical', jsCanonicalJson,
    '--canonical-corpus', canonicalCorpus,
    '--cpp-solver', fakeSolver,
    '--cpp-series', `c++ portfolio:${cppPortfolioJson}:--jobs 1 --strategy portfolio`,
    '--cpp-series', `c++ portfolio (canonical):${cppPortfolioCanonicalJson}:${canonicalCorpus}:--jobs 1 --strategy portfolio`,
    '--cpp-series', `c++ hda-weighted-astar x8:${cppHdaJson}:--strategy hda-weighted-astar --hda-jobs 8`,
    '--cpp-series', `c++ hda-weighted-astar x8 (canonical):${cppHdaCanonicalJson}:${canonicalCorpus}:--strategy hda-weighted-astar --hda-jobs 8`,
    '--cpp-series', `c++ portfolio compiled:${cppPortfolioCompiledJson}:${fakeCompiledSolver}:--compact-node-storage --jobs 1 --strategy portfolio`,
    '--cpp-series', `c++ hda-weighted-astar x8 compiled:${cppHdaCompiledJson}:${fakeCompiledSolver}:--compact-node-storage --strategy hda-weighted-astar --hda-jobs 8`,
    '--cpp-series', `c++ portfolio compiled (canonical):${cppPortfolioCompiledCanonicalJson}:${canonicalCorpus}:${fakeCompiledCanonicalSolver}:--compact-node-storage --jobs 1 --strategy portfolio`,
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
assert.strictEqual(nativeInvocations.length, 7, 'expected seven native solver runs');
assert.deepStrictEqual(
    nativeInvocations.map((entry) => entry[0]),
    ['default', 'default', 'default', 'default', 'compiled', 'compiled', 'compiled-canonical']
);
assert.strictEqual(nativeInvocations[1][1], canonicalCorpus, 'canonical portfolio series should use canonical corpus');
assert.strictEqual(nativeInvocations[3][1], canonicalCorpus, 'canonical HDA series should use canonical corpus');
assert.strictEqual(nativeInvocations[6][1], canonicalCorpus, 'canonical compiled series should use canonical corpus');
assert.ok(fs.existsSync(jsCanonicalJson), 'canonical JS JSON should be saved');
assert.ok(fs.existsSync(cppPortfolioCompiledCanonicalJson), 'canonical compiled portfolio JSON should be saved');
assert.match(fs.readFileSync(outSvg, 'utf8'), /stroke-dasharray="6 4"/, 'canonical series should render dashed');
assert.match(fs.readFileSync(outCsv, 'utf8'), /Javascript \(canonical\),10,1,100\.00/);

const { parseCppSeriesSpec } = require('./solver_timeout_curve');
const parsedCorpusOnly = parseCppSeriesSpec(`label:${cppPortfolioCanonicalJson}:${canonicalCorpus}:--jobs 1`);
assert.strictEqual(parsedCorpusOnly.corpus, canonicalCorpus);
assert.strictEqual(parsedCorpusOnly.solver, null);
const parsed = parseCppSeriesSpec(`label:${cppPortfolioCompiledCanonicalJson}:${canonicalCorpus}:${fakeCompiledCanonicalSolver}:--jobs 1`);
assert.strictEqual(parsed.corpus, canonicalCorpus);
assert.strictEqual(parsed.solver, fakeCompiledCanonicalSolver);

console.log('solver_timeout_curve_cpp_series_node passed');
