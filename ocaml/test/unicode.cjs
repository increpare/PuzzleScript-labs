#!/usr/bin/env node
'use strict';
// Independent full-scalar checks use the JS Unicode behavior of the oracle host.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const hash = data => crypto.createHash('blake2b512').update(data).digest('hex');
const directory = fs.mkdtempSync(path.join(__dirname, 'results/unicode-'));
const snapshot = (source, name) => {
  const data = fs.readFileSync(source), file = path.join(directory, name);
  fs.writeFileSync(file, data, { flag: 'wx', mode: 0o755 });
  return { file, sha256: sha(data) };
};
const binary = snapshot(path.join(__dirname, '../_build/default/cli/main.exe'), 'candidate.exe');
const probe = snapshot(path.join(__dirname, '../_build/default/test/unicode_probe.exe'), 'probe.exe');
const report = { revision: require('../oracle-source.json').revision,
  binary: binary.file, binarySha256: binary.sha256, probe,
  constructionHashes: Object.fromEntries(['unicode.cjs', 'unicode_probe.ml'].map(file =>
    [file, sha(fs.readFileSync(path.join(__dirname, file)))])),
  environment: { node: process.version, unicode: process.versions.unicode },
  startedAt: new Date().toISOString(), fixtures: 6, passed: 0, checkedScalars: 0, failures: [] };
try {
  const run = spawnSync(probe.file, [], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  const actual = JSON.parse(run.stdout);
  report.observation = actual;
  const fragments = [], whitespace = [], identifiers = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    report.checkedScalars++;
    const character = String.fromCodePoint(cp);
    fragments.push(character, '\0');
    if (/\s/u.test(character)) whitespace.push(character);
    if (/[\p{L}\p{N}_]/u.test(character)) identifiers.push(character);
  }
  const source = fragments.join(''), units = Buffer.alloc(source.length * 2);
  for (let index = 0; index < source.length; index++) units.writeUInt16BE(source.charCodeAt(index), index * 2);
  const expected = { source: hash(source), lower: hash(source.toLowerCase()), upper: hash(source.toUpperCase()),
    whitespace: hash(whitespace.join('')), identifiers: hash(identifiers.join('')), utf16: hash(units) };
  try {
    assert.equal(actual.unicodeVersion.split('.').slice(0, 2).join('.'), process.versions.unicode);
    assert.equal(actual.checkedScalars, report.checkedScalars);
    assert.deepEqual(actual.stream, expected);
    report.passed++;
  } catch (error) { report.failures.push({ name: 'complete scalar stream', message: error.message, actual: actual.stream, expected }); }
  const contexts = ["Α'Σ", "ΟΣ'Α", "ΟΣ.Α", "ΟΣ'", 'İ Σ́'];
  assert.equal(actual.contexts.length, contexts.length);
  for (const [index, source] of contexts.entries()) {
    const expected = { source, lower: source.toLowerCase(), upper: source.toUpperCase() };
    try { assert.deepEqual(actual.contexts[index], expected); report.passed++; }
    catch (error) { report.failures.push({ name: 'context ' + index, message: error.message, actual: actual.contexts[index], expected }); }
  }
} catch (error) { report.failures.push({ name: 'Unicode probe', message: error.message }); }
report.finishedAt = new Date().toISOString();
assert.equal(sha(fs.readFileSync(binary.file)), binary.sha256);
assert.equal(sha(fs.readFileSync(probe.file)), probe.sha256);
const json = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(path.join(directory, 'report.json'), json);
fs.writeFileSync(path.join(__dirname, 'results/unicode.json'), json);
console.log(JSON.stringify({ fixtures: report.fixtures, passed: report.passed, checkedScalars: report.checkedScalars,
  failures: report.failures.length, report: path.join(directory, 'report.json') }, null, 2));
if (report.failures.length) process.exitCode = 1;
