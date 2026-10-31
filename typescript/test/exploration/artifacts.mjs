import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProgram } from './program.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'oracle-source.json'), 'utf8'));
const digest = text => createHash('sha256').update(text).digest('hex');
export const authority = Object.freeze({ repository: manifest.repository, revision: manifest.revision,
  manifestSha256: digest(JSON.stringify(manifest.sourceSha256)) });
let candidate;
function candidateIdentity() {
  candidate ??= { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    buildSha256: Object.fromEntries(readdirSync(resolve(root, 'build')).filter(name => name.endsWith('.js')).sort()
      .map(name => [name, digest(readFileSync(resolve(root, 'build', name)))])) };
  return candidate;
}

/** Save reproducible input and observed evidence, never an engine-generated golden board. */
export function writeCase(value, directory, prefix = 'case') {
  mkdirSync(directory, { recursive: true });
  const stem = prefix + '-' + digest(JSON.stringify(value.program)).slice(0, 16);
  let filename = resolve(directory, stem + '.json'), suffix = 1;
  while (existsSync(filename) || existsSync(filename.replace(/\.json$/, '.ps'))) filename = resolve(directory, stem + '-' + suffix++ + '.json');
  const saved = { ...value, format: 'puzzlescript-exploration/v1', authority, candidate: candidateIdentity() };
  writeFileSync(filename, JSON.stringify(saved, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(filename.replace(/\.json$/, '.ps'), renderProgram(value.program), { flag: 'wx' });
  return filename;
}

export function readCase(filename) {
  const value = JSON.parse(readFileSync(filename, 'utf8'));
  assert.equal(value.format, 'puzzlescript-exploration/v1', 'Unknown saved-case format');
  assert.deepEqual(value.authority, authority, 'Saved case targets another oracle authority');
  assert.ok(value.program && Array.isArray(value.program.inputs), 'Saved case needs its program and tape');
  return value;
}
