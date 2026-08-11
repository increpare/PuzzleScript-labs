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
  spawnSync = defaultSpawnSync,
}) {
  const result = spawnSync(generatorBin, [
    gamePath,
    specPath,
    '--out', outPath,
    '--time-ms', String(timeMs),
    '--samples', String(samples),
    '--jobs', String(jobs),
    '--seed', String(seed != null ? seed : 1),
  ], { encoding: 'utf8' });

  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

module.exports = { runLevelSetGenerator };
