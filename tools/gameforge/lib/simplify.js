'use strict';

const { spawnSync: defaultSpawnSync } = require('child_process');

function runSimplify({
  simplifyBin,
  inPath,
  outPath,
  timeoutMs,
  spawnSync = defaultSpawnSync,
}) {
  const result = spawnSync(simplifyBin, [
    inPath,
    '--out', outPath,
    '--simplify-timeout-ms', String(timeoutMs),
  ], { encoding: 'utf8' });

  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

module.exports = { runSimplify };
