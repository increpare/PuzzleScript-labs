'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tools/gameforge/fixtures/smoke_job');
const RUN_JS = path.join(REPO_ROOT, 'tools/gameforge/run.js');
const TIMEOUT_MS = Number(process.env.GAMEFORGE_SMOKE_TIMEOUT_MS || '120000');

const cppBin = process.env.PUZZLESCRIPT_CPP
  || path.join(REPO_ROOT, 'build/native/puzzlescript_cpp');
const generatorBin = process.env.PUZZLESCRIPT_GENERATOR
  || path.join(REPO_ROOT, 'build/native/puzzlescript_generator');
const simplifyBin = process.env.PUZZLESCRIPT_SIMPLIFY
  || path.join(REPO_ROOT, 'build/native/puzzlescript_simplify');
const solverBin = process.env.PUZZLESCRIPT_SOLVER
  || path.join(REPO_ROOT, 'build/native/puzzlescript_solver');

function requireBin(binPath, label) {
  if (!fs.existsSync(binPath)) {
    console.error(`Missing ${label}: ${binPath}`);
    console.error('Build native tools or symlink build/ to an existing build directory.');
    process.exit(2);
  }
}

requireBin(cppBin, 'PUZZLESCRIPT_CPP');
requireBin(generatorBin, 'PUZZLESCRIPT_GENERATOR');
requireBin(simplifyBin, 'PUZZLESCRIPT_SIMPLIFY');
requireBin(solverBin, 'PUZZLESCRIPT_SOLVER');

const jobDir = path.join(os.tmpdir(), `gameforge-smoke-${process.pid}`);
fs.rmSync(jobDir, { recursive: true, force: true });
fs.cpSync(FIXTURE_DIR, jobDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    RUN_JS,
    jobDir,
    '--cpp', cppBin,
    '--generator', generatorBin,
    '--simplify', simplifyBin,
    '--solver', solverBin,
  ],
  {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  },
);

if (result.error) {
  console.error(result.error.stack || String(result.error));
  process.exit(1);
}

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
if (result.status !== 0 && result.status !== 1) {
  console.error(`run.js exited ${result.status}\n${output}`);
  process.exit(1);
}

const reportPath = path.join(jobDir, 'out/report.json');
const gamePath = path.join(jobDir, 'out/game.txt');
assert.ok(fs.existsSync(reportPath), 'expected out/report.json');
assert.ok(fs.existsSync(gamePath), 'expected out/game.txt');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const allowed = new Set(['publishable', 'playable_incomplete', 'mechanic_only']);
assert.ok(allowed.has(report.status), `unexpected status: ${report.status} failures=${JSON.stringify(report.failures)}`);

const compileResult = spawnSync(cppBin, ['compile', gamePath, '--diagnostics'], { encoding: 'utf8' });
const compileText = `${compileResult.stdout || ''}\n${compileResult.stderr || ''}`;
assert.strictEqual(compileResult.status, 0, `out/game.txt compile failed:\n${compileText}`);
assert.ok(!/\berror\b/i.test(compileText), `compile diagnostics contain error:\n${compileText}`);

fs.rmSync(jobDir, { recursive: true, force: true });

console.log(`run_gameforge_smoke_node: ok (status=${report.status}, exit=${result.status})`);
