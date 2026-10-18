const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Files } = require('./files.cjs');

test('native game round trip, MRU and successful folder survive restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mis-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'my game.txt'), second = path.join(root, 'other.ps');
  await fs.writeFile(file, 'title First\n(MIS transform\nchoose 1 [Wall] -> []\nMIS end)\n');
  await fs.writeFile(second, 'title Second');
  const store = new Files(path.join(root, 'profile')); await store.load();
  const opened = await store.open(file);
  assert.match(opened.text, /MIS transform/);
  await store.save(file, opened.text + '(saved)');
  await store.open(second); await store.open(file);
  assert.deepEqual(store.recent, [file, second]);
  const restored = new Files(path.join(root, 'profile')); await restored.load();
  assert.deepEqual(restored.recent, [file, second]);
  assert.equal(restored.saveLocation('new.txt'), path.join(root, 'new.txt'));
  assert.match(await fs.readFile(file, 'utf8'), /\(saved\)$/);
  // History is not write authorization in a fresh process.
  await assert.rejects(restored.save(file, 'wrong'), /destination/);
});

test('failed opens/saves preserve history, destination and saved preferences', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mis-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new Files(path.join(root, 'profile')), file = path.join(root, 'game.txt');
  await fs.writeFile(file, 'original'); await store.open(file);
  const settings = await fs.readFile(store.settingsFile, 'utf8');
  await assert.rejects(store.open(path.join(root, 'missing.txt')));
  await assert.rejects(store.save(file, null));
  await assert.rejects(store.save(path.join(root, 'unselected.txt'), 'changed'), /destination/);
  assert.equal(await fs.readFile(file, 'utf8'), 'original');
  assert.equal(await fs.readFile(store.settingsFile, 'utf8'), settings);
  assert.deepEqual(store.recent, [file]);
  assert(!(await fs.readdir(root)).some(name => name.endsWith('.tmp')));
});
