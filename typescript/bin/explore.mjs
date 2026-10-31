#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCampaign } from '../test/exploration/campaign.mjs';
import { runIsolated, cancelWorkers } from '../test/exploration/process.mjs';
import { readCase, writeCase } from '../test/exploration/artifacts.mjs';
import { minimizeProgram } from '../test/exploration/shrink.mjs';

const options = { seed: 'puzzlescript-interactions', cases: 200, start: 0, jobs: 4,
  timeoutMs: 5000, maxChecks: 200, maxTimeMs: 30000,
  out: resolve(dirname(fileURLToPath(import.meta.url)), '../exploration-findings') };
const names = { '--seed': 'seed', '--cases': 'cases', '--start': 'start', '--jobs': 'jobs',
  '--timeout-ms': 'timeoutMs', '--out': 'out', '--json': 'json', '--replay': 'replay',
  '--shrink': 'shrink', '--shrink-checks': 'maxChecks', '--shrink-ms': 'maxTimeMs' };
const numeric = new Set(['cases', 'start', 'jobs', 'timeoutMs', 'maxChecks', 'maxTimeMs']);

async function shrink(filename) {
  const original = readCase(filename), initial = original.result;
  if (initial?.status !== 'failed' || !initial.nativeErrorFree) {
    throw new Error('Original program does not reproduce the saved error-free failure category');
  }
  const reduced = await minimizeProgram(original.program, async program => {
    const result = await runIsolated(program, options);
    return result.status === 'failed' && result.nativeErrorFree && result.signature === initial.signature;
  }, options);
  const result = await runIsolated(reduced.program, options);
  if (result.status !== 'failed' || !result.nativeErrorFree || result.signature !== initial.signature) throw new Error('Reduced failure did not reproduce on confirmation');
  const saved = writeCase({ program: reduced.program, result,
    provenance: { ...original.provenance, reducedFrom: resolve(filename) },
    reduction: { checks: reduced.checks, fixedPoint: reduced.fixedPoint } }, options.out, 'reduced');
  return { filename: saved, checks: reduced.checks, fixedPoint: reduced.fixedPoint };
}

async function main() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]], value = args[index + 1];
    if (!name || value === undefined) throw new Error('Usage: explore.mjs [--seed TEXT] [--cases N] [--start N] [--jobs N] [--timeout-ms N] [--out DIR] [--json FILE] [--replay FILE | --shrink FILE]');
    options[name] = numeric.has(name) ? Number(value) : value;
  }
  for (const name of numeric) if (!Number.isSafeInteger(options[name]) || options[name] < (name === 'start' ? 0 : 1)) throw new Error('Invalid integer option: ' + name);
  if (options.jobs > 16) throw new Error('Use at most 16 isolated workers');
  if (!Number.isSafeInteger(options.start + options.cases)) throw new Error('Case index range exceeds safe integers');
  if (options.replay && options.shrink) throw new Error('Choose replay or shrink');
  let report;
  if (options.replay) {
    report = await runIsolated(readCase(options.replay).program, options);
    if (report.status !== 'passed') process.exitCode = 1;
  } else if (options.shrink) report = await shrink(options.shrink);
  else {
    report = await runCampaign(options, progress => {
      if (progress.completed % 50 === 0 || progress.status === 'failed') console.error(JSON.stringify(progress));
    });
    report.reductions = [];
    const signatures = new Set();
    for (const finding of report.findings) {
      if (!finding.nativeErrorFree || signatures.has(finding.signature)) continue;
      signatures.add(finding.signature);
      try { report.reductions.push(await shrink(finding.filename)); }
      catch (error) { report.reductions.push({ filename: finding.filename, error: error.message }); }
    }
    if (report.totals.failed > 0) process.exitCode = 1;
  }
  if (options.json) {
    mkdirSync(dirname(resolve(options.json)), { recursive: true });
    writeFileSync(options.json, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { cancelWorkers(); process.exit(code); });
main().catch(error => { cancelWorkers(); console.error(error.stack ?? error); process.exitCode = 1; });
