#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');
const crypto = require('crypto');
const assert = require('assert');
const [baseline, output, pairArg = '5'] = process.argv.slice(2);
if (!baseline || !output) throw Error('Usage: compare_input_flow_js.js BASELINE_COMPILER_JS OUTPUT_JSON [PAIRS=5]');
const pairs = Number(pairArg);
assert(Number.isSafeInteger(pairs) && pairs > 0);
const compiler = path.resolve('src/js/compiler.js');
fs.mkdirSync('build', { recursive: true });
const temp = fs.mkdtempSync(path.resolve('build/input-flow-js-'));
const hook = path.join(temp, 'baseline.cjs');
// Substitute only the compiler source in the runtime's existing VM loader.
// Both runs use the same engine, fixtures, runner, settings and Node binary.
fs.writeFileSync(hook, `const fs=require('fs'),path=require('path');
const original=fs.readFileSync;
fs.readFileSync=function(file,...args){
 if(typeof file==='string' && path.resolve(file)===${JSON.stringify(compiler)})
   return original.call(this,${JSON.stringify(path.resolve(baseline))},...args);
 return original.call(this,file,...args);
};\n`);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { scope: 'Serial alternating full JS simulation tests, including source compilation, after one warmup per side. Only compiler.js differs.', node: process.version,
    compiler_hashes: [hash(baseline), hash(compiler)], fixture_hash: hash('src/tests/resources/testdata.js'), pairs: [] };
function run(candidate) {
    const start = performance.now();
    const child = spawnSync(process.execPath, [...(candidate ? [] : ['--require', hook]), 'src/tests/run_tests_node.js', '--sim-only', '--breakdown'], {
        encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 32000000,
        env: { ...process.env, PUZZLESCRIPT_SKIP_AUXILIARY_TESTS: '1', PUZZLESCRIPT_INPUT_SPECIALIZATION: '1' },
    });
    if (child.error) throw child.error;
    assert.strictEqual(child.status, 0, child.stdout + child.stderr);
    return { wall_ms: performance.now() - start, stdout: child.stdout, stderr: child.stderr };
}
run(false); run(true);
for (let p = 0; p < pairs; ++p) {
    const row = {};
    for (const candidate of p % 2 ? [true, false] : [false, true]) row[candidate ? 'candidate' : 'baseline'] = run(candidate);
    report.pairs.push(row);
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`JS replay pair ${p + 1}: ${row.baseline.wall_ms.toFixed(1)} -> ${row.candidate.wall_ms.toFixed(1)} ms`);
}
