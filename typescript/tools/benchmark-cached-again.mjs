#!/usr/bin/env node
// Compare the same readable engine workload, excluding compilation and hashing.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const args = process.argv.slice(2);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const cases = ['deterministic', 'rigid', 'noagain'];
function canonical(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Set) return [...item].map(entry => entry && typeof entry === 'object' && 'name' in entry ? entry.name : entry).sort();
    if (item instanceof Map) return [...item.entries()];
    return item;
  });
}
async function sample(buildPath) {
  const build = pathToFileURL(resolve(buildPath) + '/');
  const { compileSource, SourceCompilationKind } = await import(new URL('source-compiler.js', build));
  const { Movement } = await import(new URL('model.js', build));
  const { createSession, stepSession } = await import(new URL('session.js', build));
  const rows = [];
  for (const name of cases) {
    let source = readFileSync(new URL(`../../native/tests/fixtures/cached_again/${name}.txt`, import.meta.url), 'utf8');
    // 100 columns, 10 rows. Only the first row contains the active player.
    source = source.replace(/(LEVELS\s*\n)(P[^\n]*)\s*$/, (_match, header, row) => header + row + '\n' + ('.'.repeat(100) + '\n').repeat(9));
    const compiled = compileSource(source);
    if (compiled.outcome.kind !== SourceCompilationKind.Accepted) throw new Error(name + ': source rejected');
    const game = compiled.outcome.game;
    function run(count = false) {
      let evaluations = 0;
      const counted = count ? { ...game, get earlyRules() { evaluations++; return game.earlyRules; } } : game;
      const environment = { nextLevelSeed() { throw new Error('Unexpected level seed request'); } };
      let result = createSession(counted, { seed: 'typescript-cached-again-benchmark' }, environment);
      const effects = [];
      const begin = performance.now();
      result = stepSession(counted, result.state, Movement.Action, environment);
      effects.push(...result.effects);
      let turns = 1;
      while ((result.state.againing || name === 'noagain') && turns < 100) {
        result = stepSession(counted, result.state, null, environment);
        effects.push(...result.effects);
        turns++;
      }
      const elapsed = performance.now() - begin;
      if (turns !== 100 || result.state.againing) throw new Error(name + ': unexpected turn count');
      return { elapsed_ms: elapsed, early_rule_passes: evaluations, turns,
        checksum: sha256(canonical({ state: result.state, effects, turns })) };
    }
    const work = run(true);
    run(); run();
    const repetitions = 3;
    const samples = Array.from({ length: repetitions }, () => run());
    if (samples.some(row => row.checksum !== work.checksum)) throw new Error(name + ': unstable result');
    rows.push({ name, cells: 1000, turns: 100, repetitions,
      elapsed_ms: samples.reduce((sum, row) => sum + row.elapsed_ms, 0),
      early_rule_passes: work.early_rule_passes, checksum: work.checksum,
      source_sha256: sha256(source) });
  }
  console.log(JSON.stringify(rows));
}
async function main() {
  if (args.length < 3) throw new Error('Usage: benchmark-cached-again.mjs BASELINE_BUILD CANDIDATE_BUILD OUTPUT_JSON [PAIRS=9]');
  const [baseline, candidate, output] = args;
  const pairs = Number(args[3] ?? 9);
  if (!Number.isInteger(pairs) || pairs < 3) throw new Error('Need at least 3 paired samples');
  const samples = { baseline: [], candidate: [] };
  const run = label => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--sample', resolve(label === 'baseline' ? baseline : candidate)], { encoding: 'utf8' }));
  run('baseline'); run('candidate');
  for (let pair = 0; pair < pairs; pair++) for (const label of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) samples[label].push(run(label));
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const results = cases.map((name, index) => {
    const checksums = new Set([...samples.baseline, ...samples.candidate].map(rows => rows[index].checksum));
    if (checksums.size !== 1) throw new Error(name + ': baseline/candidate full-state checksum mismatch');
    const ratios = samples.baseline.map((rows, pair) => rows[index].elapsed_ms / samples.candidate[pair][index].elapsed_ms);
    return { name, cells: 1000, turns: 100,
      baseline_median_ms: median(samples.baseline.map(rows => rows[index].elapsed_ms / rows[index].repetitions)),
      candidate_median_ms: median(samples.candidate.map(rows => rows[index].elapsed_ms / rows[index].repetitions)),
      median_paired_speedup: median(ratios), paired_min: Math.min(...ratios), paired_max: Math.max(...ratios),
      baseline_rule_passes: samples.baseline[0][index].early_rule_passes,
      candidate_rule_passes: samples.candidate[0][index].early_rule_passes };
  });
  const hashes = build => Object.fromEntries(['session.js', 'turn-rules.js', 'compatibility-vanilla-5a94bde1.js'].map(file => [file, sha256(readFileSync(resolve(build, file)))]));
  const report = { baseline_commit: 'fba2000a', node: process.version, architecture: process.arch, pairs,
    policy: 'Pinned vanilla quirks; hashing full final session/effects outside timing; plain games timed, earlyRules getter counts collected separately',
    sources: { baseline: hashes(baseline), candidate: hashes(candidate) }, results, samples };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(results));
}
(args[0] === '--sample' ? sample(args[1]) : main()).catch(error => { console.error(error); process.exitCode = 1; });
