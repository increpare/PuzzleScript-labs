import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateProgram } from './exploration/generate.mjs';

let writeCase, readCase;
try { ({ writeCase, readCase } = await import('./exploration/artifacts.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const cli = fileURLToPath(new URL('../bin/explore.mjs', import.meta.url));
const temporary = callback => {
  const directory = mkdtempSync(join(tmpdir(), 'puzzlescript-exploration-'));
  try { return callback(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
};

test('saved cases preserve source, tape, authority and failure evidence without golden boards', () => {
  assert.equal(typeof writeCase, 'function');
  temporary(directory => {
    const program = generateProgram('artifact', 2);
    const result = { status: 'failed', phase: 'session', failureType: 'comparison', nativeErrorFree: true,
      signature: 'injected artifact control', error: { message: 'test-only evidence' } };
    const filename = writeCase({ program, result, provenance: { campaignSeed: 'artifact', index: 2 } }, directory);
    const saved = readCase(filename);
    assert.deepEqual(saved.program, program);
    assert.deepEqual(saved.result, result);
    assert.equal(saved.authority.revision, '57f9f6cba69f6aa52ed738d5aee1d709d0037648');
    assert.equal(typeof saved.candidate.buildSha256['session.js'], 'string');
    assert.match(readFileSync(filename.replace(/\.json$/, '.ps'), 'utf8'), /^title /);
    assert.equal(Object.hasOwn(saved, 'expectedBoard'), false);
    const repeated = writeCase({ ...saved, authority: { revision: 'stale copied authority' } }, directory);
    assert.notEqual(repeated, filename, 'Saved evidence is not overwritten');
    assert.equal(readCase(repeated).authority.revision, saved.authority.revision, 'The current writer supplies actual provenance');
    saved.authority.revision = 'another-authority';
    writeFileSync(filename, JSON.stringify(saved));
    assert.throws(() => readCase(filename), /authority/i);
  });
});

test('a campaign stops on a real injected comparison failure and saves every in-flight failure', async () => {
  const { runCampaign } = await import('./exploration/campaign.mjs');
  const { createProgramChecker } = await import('./exploration/check.mjs');
  const { stepSession } = await import('../build/session.js');
  const check = await createProgramChecker({ stepSession: (...args) => {
    const result = stepSession(...args); return { ...result, modified: !result.modified };
  } });
  const directory = mkdtempSync(join(tmpdir(), 'puzzlescript-fault-campaign-'));
  try {
    const report = await runCampaign({ seed: 'fault-control', cases: 8, jobs: 2, out: directory }, () => {}, async program => check(program));
    assert.equal(report.totals.passed, 0);
    assert.equal(report.totals.failed, report.totals.completed);
    assert.ok(report.totals.completed < report.totals.requested);
    assert.equal(report.findings.length, report.totals.failed);
    for (const finding of report.findings) {
      const saved = readCase(finding.filename);
      assert.equal(saved.result.failureType, 'comparison');
      assert.equal(saved.result.nativeErrorFree, true);
      assert.match(saved.result.signature, /returned/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the CLI explores real cases and replays a saved successful model', () => {
  assert.equal(typeof writeCase, 'function');
  temporary(directory => {
    const output = execFileSync(process.execPath, [cli, '--seed', 'cli-control', '--cases', '8', '--jobs', '2', '--out', directory],
      { encoding: 'utf8', timeout: 30000 });
    const report = JSON.parse(output);
    assert.equal(report.totals.completed, 8);
    assert.equal(report.totals.passed, 8);
    assert.equal(report.totals.excluded, 0);
    assert.equal(report.totals.failed, 0);
    assert.ok(report.totals.snapshots >= 8);
    assert.ok(report.totals.uniqueSources >= 6);
    const filename = writeCase({ program: generateProgram('cli-control', 0), result: { status: 'passed' }, provenance: {} }, directory);
    const replay = JSON.parse(execFileSync(process.execPath, [cli, '--replay', filename], { encoding: 'utf8', timeout: 10000 }));
    assert.equal(replay.status, 'passed');
    assert.throws(() => execFileSync(process.execPath, [cli, '--shrink', filename],
      { encoding: 'utf8', timeout: 10000, stdio: 'pipe' }), error => /does not reproduce/.test(error.stderr));
  });
});
