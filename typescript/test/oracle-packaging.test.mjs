import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadPuzzleScript } from './native-host.cjs';

test('the vanilla oracle loads its pinned package fixtures independently of labs src', () => {
  const native = loadPuzzleScript({ includeTests: true });
  assert.equal(native.srcDir, fileURLToPath(new URL('./vanilla', import.meta.url)));
  assert.equal(native.oracle.implementation, 'vanilla');
});
