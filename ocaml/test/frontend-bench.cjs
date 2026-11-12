#!/usr/bin/env node
'use strict';
// Compare immutable native benchmark executables on identical source snapshots.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const option = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const recordFile = option('baseline-record');
assert.ok(recordFile, 'Provide --baseline-record=PATH from a saved native benchmark/source snapshot');
const baseline = JSON.parse(fs.readFileSync(recordFile));
const rounds = Number(option('rounds') ?? 5), iterations = Number(option('iterations') ?? 10);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0 && Number.isSafeInteger(iterations) && iterations > 0);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
assert.equal(sha(fs.readFileSync(baseline.baselineBinary)), baseline.baselineSha256);
assert.equal(sha(fs.readFileSync(path.join(__dirname, 'frontend_bench.ml'))), baseline.driverSha256, 'Use the same benchmark driver');
for (const source of baseline.sources) assert.equal(sha(fs.readFileSync(source.file)), source.sha256);
const directory = fs.mkdtempSync(path.join(baseline.directory, 'comparison-'));
const snapshot = (original, name) => {
  const bytes = fs.readFileSync(original), file = path.join(directory, name);
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o755 });
  return { file, sha256: sha(bytes) };
};
const candidate = snapshot(path.join(__dirname, '../_build/default/test/frontend_bench.exe'), 'candidate-bench.exe');
const binary = snapshot(path.join(__dirname, '../_build/default/cli/main.exe'), 'candidate-cli.exe');
const report = { kind: 'frontend-performance', startedAt: new Date().toISOString(),
  binary: binary.file, binarySha256: binary.sha256, candidateBenchmark: candidate,
  baselineBinary: baseline.baselineBinary, baselineSha256: baseline.baselineSha256,
  baselineCliSha256: baseline.baselineCliSha256, driverSha256: baseline.driverSha256,
  constructionSha256: sha(fs.readFileSync(__filename)), sources: baseline.sources,
  rounds, iterations, samples: [], failures: [] };
try {
  for (let round = 0; round < rounds; round++) {
    for (const stage of ['parse', 'compile']) {
      const endpoints = round % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
      for (const endpoint of endpoints) {
        const executable = endpoint === 'baseline' ? baseline.baselineBinary : candidate.file;
        const run = spawnSync(executable, ['--stage', stage, '--iterations', String(iterations), ...baseline.sources.map(value => value.file)],
          { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
        assert.equal(run.status, 0, run.stderr || run.error?.message);
        const sample = JSON.parse(run.stdout), expected = baseline.baseline.find(value => value.stage === stage);
        assert.deepEqual(sample.observations, expected.observations, 'Frontend outcome signatures');
        assert.equal(sample.checksum, expected.checksum / expected.iterations * iterations);
        report.samples.push({ round, endpoint, ...sample });
      }
      console.log(JSON.stringify({ round, stage, completedSamples: report.samples.length }));
    }
  }
  const median = values => { const sorted = values.toSorted((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
  report.summary = Object.fromEntries(['parse', 'compile'].map(stage => {
    const values = endpoint => {
      const samples = report.samples.filter(value => value.stage === stage && value.endpoint === endpoint);
      return Object.fromEntries(['cpuSeconds', 'wallSeconds', 'allocatedBytes'].map(key => [key, median(samples.map(value => value[key]))]));
    };
    const before = values('baseline'), after = values('candidate');
    return [stage, { baseline: before, candidate: after,
      ratios: Object.fromEntries(Object.keys(before).map(key => [key, after[key] / before[key]])) }];
  }));
} catch (error) { report.failures.push({ message: error.message }); }
assert.equal(sha(fs.readFileSync(candidate.file)), candidate.sha256);
assert.equal(sha(fs.readFileSync(baseline.baselineBinary)), baseline.baselineSha256);
for (const source of baseline.sources) assert.equal(sha(fs.readFileSync(source.file)), source.sha256);
report.finishedAt = new Date().toISOString();
const json = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(path.join(directory, 'report.json'), json);
fs.writeFileSync(path.join(__dirname, 'results/frontend-performance.json'), json);
console.log(JSON.stringify({ summary: report.summary, failures: report.failures.length,
  report: path.join(directory, 'report.json') }, null, 2));
if (report.failures.length) process.exitCode = 1;
