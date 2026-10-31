import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let runIsolated;
try { ({ runIsolated } = await import('./exploration/process.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const control = { version: 1, name: 'child control', family: 'unit', seed: 'unit',
  objects: [{ name: 'Background', color: 'black' }, { name: 'Player', color: 'white' }],
  properties: [], layers: [['Background'], ['Player']],
  board: [[['Background', 'Player'], ['Background']]], rules: [], inputs: [3] };

test('a real isolated worker compares a complete generated source game', async () => {
  assert.equal(typeof runIsolated, 'function');
  const result = await runIsolated(control, { timeoutMs: 5000 });
  assert.equal(result.status, 'passed');
  assert.equal(result.report.snapshots, 2);
});

async function withWorker(code, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'puzzlescript-worker-'));
  try {
    const filename = join(directory, 'worker.mjs'); writeFileSync(filename, code);
    return await callback(pathToFileURL(filename));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('a timed-out child is killed and never counted as a comparison failure or pass', async () => {
  assert.equal(typeof runIsolated, 'function');
  const result = await withWorker('setInterval(() => {}, 1000);', worker => runIsolated(control, { worker, timeoutMs: 100 }));
  assert.equal(result.status, 'failed');
  assert.equal(result.failureType, 'timeout');
  assert.equal(result.phase, 'process');
});

test('a child without a valid result and a child with excessive output are process failures', async () => {
  assert.equal(typeof runIsolated, 'function');
  const empty = await withWorker('process.stdin.resume();', worker => runIsolated(control, { worker, timeoutMs: 1000 }));
  assert.equal(empty.failureType, 'process');
  const noisy = await withWorker('process.stdout.write("x".repeat(20000));', worker => runIsolated(control, { worker, maxOutputBytes: 1000 }));
  assert.equal(noisy.failureType, 'process');
  assert.match(noisy.error.message, /output/i);
});

test('worker assertion evidence is preserved and invalid result objects are rejected', async () => {
  assert.equal(typeof runIsolated, 'function');
  const result = await withWorker('console.log(\'PS_EXPLORATION_RESULT {"status":"passed"}\');', worker => runIsolated(control, { worker }));
  assert.equal(result.failureType, 'process', 'A passed report must contain its observation counts');
});
