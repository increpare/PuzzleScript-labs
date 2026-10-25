const assert = require('node:assert/strict');
const test = require('node:test');
const recovery = require('../js/mis/mis_recovery.js');

const tick = () => new Promise(resolve => setImmediate(resolve));
async function within(promise, duration = 300) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve('timed out'), duration); })]);
  } finally {
    clearTimeout(timer);
  }
}

test('unavailable storage returns safe results and reports a failure only once', async () => {
  const errors = [];
  const store = recovery.create({ indexedDB: null, onError: error => errors.push(error) });
  assert.equal(await store.save({ source: 'unsaved' }), false);
  assert.equal(await store.load(), null);
  assert.equal(await store.clear(), false);
  assert.equal(errors.length, 1);
  assert(errors[0] instanceof Error);
  assert.match(errors[0].message, /recovery.*save.*unavailable/i);
});

test('a failing error callback cannot reject operations or poison the queue', async () => {
  const store = recovery.create({ indexedDB: null, onError: () => { throw new Error('display failed'); } });
  assert.equal(await store.save({}), false);
  assert.equal(await store.load(), null);
});

test('a blocked open resolves failure and closes a connection that opens late', async () => {
  const requests = [], errors = [];
  const factory = { open() { const request = {}; requests.push(request); return request; } };
  const store = recovery.create({ indexedDB: factory, onError: error => errors.push(error.message) });
  const pending = store.load();
  await tick();
  if (requests[0].onblocked) requests[0].onblocked();
  assert.equal(await within(pending), null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /blocked/i);
  let closed = 0;
  requests[0].result = { close() { closed++; } };
  requests[0].onsuccess();
  assert.equal(closed, 1, 'late success must not leak a database connection');
  const retry = store.clear();
  await tick();
  assert.equal(requests.length, 2, 'the next operation tries opening again');
  requests[1].error = new Error('retry unavailable');
  requests[1].onerror();
  assert.equal(await retry, false);
});

test('an open request with no browser events has a fixed timeout', async () => {
  const errors = [];
  const store = recovery.create({ indexedDB: { open() { return {}; } }, onError: error => errors.push(error.message) });
  assert.equal(await within(store.load(), 6000), null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /timed out/i);
});
