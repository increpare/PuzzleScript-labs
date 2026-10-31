import { createHash } from 'node:crypto';
import { generateProgram, families } from './generate.mjs';
import { sourceIdentity } from './program.mjs';
import { runIsolated } from './process.mjs';
import { writeCase, authority } from './artifacts.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Stop assigning cases on the first failure; finish the already running children. */
export async function runCampaign({ seed, start = 0, cases, jobs = 4, timeoutMs = 5000, out }, progress = () => {}, runCase = runIsolated) {
  const totals = { requested: cases, completed: 0, passed: 0, excluded: 0, failed: 0,
    comparisonFailures: 0, oracleExceptions: 0, timeouts: 0, processFailures: 0,
    snapshots: 0, candidateOperations: 0, levelLoads: 0 };
  const byFamily = Object.fromEntries(families.map(name => [name, { completed: 0, passed: 0, excluded: 0, failed: 0 }]));
  const sources = new Set(), ruleSets = new Set(), boards = new Set(), findings = [];
  let next = start, stopped = false;
  await Promise.all(Array.from({ length: Math.min(jobs, cases) }, async () => {
    while (!stopped && next < start + cases) {
      const index = next++, program = generateProgram(seed, index);
      sources.add(sourceIdentity(program)); ruleSets.add(digest(program.rules)); boards.add(digest(program.board));
      const result = await runCase(program, { timeoutMs });
      totals.completed++; byFamily[program.family].completed++;
      if (result.status === 'passed') {
        totals.passed++; byFamily[program.family].passed++;
        for (const key of ['snapshots', 'candidateOperations', 'levelLoads']) totals[key] += result.report[key];
      } else if (result.status === 'excluded') { totals.excluded++; byFamily[program.family].excluded++; }
      else {
        stopped = true; totals.failed++; byFamily[program.family].failed++;
        const count = { comparison: 'comparisonFailures', exception: 'oracleExceptions', timeout: 'timeouts', process: 'processFailures' }[result.failureType];
        totals[count]++;
        const filename = writeCase({ program, result, provenance: { campaignSeed: seed, index } }, out);
        findings.push({ filename, index, phase: result.phase, failureType: result.failureType,
          signature: result.signature, nativeErrorFree: result.nativeErrorFree });
      }
      progress({ index, completed: totals.completed, requested: cases, status: result.status });
    }
  }));
  Object.assign(totals, { uniqueSources: sources.size, uniqueRuleSets: ruleSets.size, uniqueBoards: boards.size });
  return { authority, seed, start, jobs, timeoutMs, totals, byFamily, findings };
}
