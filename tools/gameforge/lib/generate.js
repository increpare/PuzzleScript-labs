'use strict';

const { spawnSync: defaultSpawnSync } = require('child_process');

function runLevelSetGenerator({
  generatorBin,
  gamePath,
  specPath,
  outPath,
  timeMs,
  samples,
  jobs,
  seed,
  inactivityStartMs,
  solverTimeoutMs,
  exhaustPasses,
  spawnSync = defaultSpawnSync,
}) {
  const args = [
    gamePath,
    specPath,
    '--out', outPath,
    '--time-ms', String(timeMs),
    '--samples', String(samples),
    '--jobs', String(jobs),
    '--seed', String(seed != null ? seed : 1),
  ];
  if (solverTimeoutMs != null) {
    args.push('--solver-timeout-ms', String(solverTimeoutMs));
  }
  if (inactivityStartMs != null) {
    args.push('--inactivity-start', `${inactivityStartMs}ms`);
  }
  if (exhaustPasses != null) {
    args.push('--exhaust-passes', String(exhaustPasses));
  }

  const spawnTimeout = timeMs > 0 ? timeMs + 15000 : undefined;
  const result = spawnSync(generatorBin, args, {
    encoding: 'utf8',
    timeout: spawnTimeout,
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

module.exports = { runLevelSetGenerator };
