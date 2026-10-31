#!/usr/bin/env node
// Bound each source-compiled vanilla comparison; preserve failures and timeouts.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const marker = 'CACHED_AGAIN_AUDIT_RESULT ';
const liveChildren = new Set();
process.on('exit', () => { for (const child of liveChildren) child.kill('SIGKILL'); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(signal === 'SIGINT' ? 130 : 143));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function hashes(directory, accept) {
  const result = {};
  function visit(relative = '') {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (accept(name)) result[name] = sha256(path.join(directory, name));
    }
  }
  visit();
  return result;
}
function provenance(baseline, candidate) {
  return {
    baseline: hashes(path.resolve(baseline), name => name.endsWith('.js') || name === 'package.json'),
    candidate: hashes(path.resolve(candidate), name => name.endsWith('.js') || name === 'package.json'),
    oracle: hashes(path.join(root, 'test'), name => /\.(cjs|mjs|js|json)$/.test(name)),
    oracle_manifest: sha256(path.join(root, 'oracle-source.json')),
    tool: sha256(__filename),
  };
}
async function child() {
  const build = pathToFileURL(path.resolve(args[1]) + path.sep);
  const names = ['model', 'rule-model', 'turn-rules', 'commands', 'source-compiler', 'source-model',
    'source-assets', 'declaration-model', 'execution-model', 'win-conditions', 'session-model', 'session'];
  const types = Object.assign({}, ...await Promise.all(names.map(name => import(new URL(name + '.js', build)))));
  const { createSessionOracle } = require('../test/legacy-session-oracle.cjs');
  const oracle = createSessionOracle(types);
  const fixture = oracle.corpusFixtures()[Number(args[2])];
  const started = performance.now();
  let result;
  try { result = { status: 'passed', observations: oracle.compareFixture(fixture) }; }
  catch (error) { result = { status: 'failed', error: error.stack ?? String(error) }; }
  process.stdout.write('\n' + marker + JSON.stringify({ ...result, elapsed_ms: performance.now() - started }) + '\n');
}
async function main() {
  if (args.length < 3) throw new Error('Usage: audit-cached-again.cjs BASELINE_BUILD CANDIDATE_BUILD OUTPUT_JSON [JOBS=2] [TIMEOUT_SECONDS=120]');
  const [baseline, candidate, output] = args;
  const jobs = Number(args[3] ?? 2), timeout = Number(args[4] ?? 120) * 1000;
  if (!Number.isInteger(jobs) || jobs < 1 || !Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid jobs/timeout');
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'test/vanilla/tests/resources/testdata.js'), 'utf8') + ';this.fixtures=testdata;', context);
  const allFixtures = context.fixtures.map(([name, payload], index) => ({ name, source: payload[0], index }))
    .filter(fixture => /\bagain\b/i.test(fixture.source));
  const inputProvenance = provenance(baseline, candidate);
  const prior = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { results: [] };
  if (prior.results.length) assert.deepEqual(prior.provenance, inputProvenance, 'Resume inputs changed; choose a new output path');
  const results = prior.results.map(row => ({ ...row,
    baseline: { timeout_ms: prior.timeout_ms, ...row.baseline },
    candidate: { timeout_ms: prior.timeout_ms, ...row.candidate } }));
  const completed = new Set(results.map(row => row.index));
  assert.equal(completed.size, results.length, 'Duplicate resumed fixture');
  for (const row of results) assert.equal(allFixtures.find(fixture => fixture.index === row.index)?.name, row.name, 'Resumed fixture changed');
  const fixtures = allFixtures.filter(fixture => !completed.has(fixture.index));
  let cursor = 0;
  function run(build, index) {
    return new Promise(resolve => {
      const process = spawn(global.process.execPath, [__filename, '--fixture', path.resolve(build), String(index)], { stdio: ['ignore', 'pipe', 'pipe'] });
      liveChildren.add(process);
      let stdout = '', stderr = '', timedOut = false;
      process.stdout.on('data', chunk => { stdout += chunk; });
      process.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => { timedOut = true; process.kill('SIGKILL'); }, timeout);
      process.on('error', error => { clearTimeout(timer); resolve({ status: 'failed', error: String(error) }); });
      process.on('close', code => {
        clearTimeout(timer);
        liveChildren.delete(process);
        if (timedOut) return resolve({ status: 'timeout', timeout_ms: timeout });
        const line = stdout.split('\n').findLast(line => line.startsWith(marker));
        if (line) return resolve({ timeout_ms: timeout, ...JSON.parse(line.slice(marker.length)) });
        resolve({ status: 'failed', error: `exit ${code}: ${stderr}\n${stdout}` });
      });
    });
  }
  await Promise.all(Array.from({ length: Math.min(jobs, fixtures.length) }, async () => {
    while (cursor < fixtures.length) {
      const fixture = fixtures[cursor++];
      const before = await run(baseline, fixture.index);
      const after = await run(candidate, fixture.index);
      if (before.status === 'passed' && after.status === 'passed') assert.deepEqual(after.observations, before.observations, fixture.name);
      results.push({ name: fixture.name, index: fixture.index, baseline: before, candidate: after });
      fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
      fs.writeFileSync(output, JSON.stringify({ fixtures: allFixtures.length, jobs, timeout_ms: timeout, provenance: inputProvenance, results }, null, 2) + '\n');
      console.error(`${results.length}/${allFixtures.length} ${fixture.name}: ${before.status}/${after.status}`);
    }
  }));
  results.sort((a, b) => a.index - b.index);
  const summary = { total: results.length,
    paired_passed: results.filter(row => row.baseline.status === 'passed' && row.candidate.status === 'passed').length,
    baseline_failed: results.filter(row => row.baseline.status === 'failed').length,
    baseline_timeout: results.filter(row => row.baseline.status === 'timeout').length,
    candidate_failed: results.filter(row => row.candidate.status === 'failed').length,
    candidate_timeout: results.filter(row => row.candidate.status === 'timeout').length };
  fs.writeFileSync(output, JSON.stringify({ summary, fixtures: allFixtures.length, jobs, timeout_ms: timeout, provenance: inputProvenance, results }, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  if (results.some(row => row.baseline.status === 'passed' && row.candidate.status !== 'passed')) global.process.exitCode = 1;
}
(args[0] === '--fixture' ? child() : main()).catch(error => { console.error(error); process.exitCode = 1; });
