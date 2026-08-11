'use strict';

function compileFileNative(bin, gamePath, spawnSync) {
  const r = spawnSync(bin, ['compile', gamePath, '--diagnostics'], { encoding: 'utf8' });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const ok = r.status === 0 && !/\berror\b/i.test(text);
  return { ok, errors: ok ? [] : [text.trim() || `exit ${r.status}`] };
}

module.exports = { compileFileNative };
