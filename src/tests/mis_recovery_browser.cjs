const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  let server, browser;
  try {
    const helper = path.resolve(__dirname, '../js/mis/mis_recovery.js');
    server = http.createServer(async (request, response) => {
      if (request.url === '/mis_recovery.js') {
        try {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(await fs.readFile(helper));
        } catch (_) {
          response.writeHead(404).end();
        }
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><script src="/mis_recovery.js"></script>');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chrome' });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    assert.equal(await page.evaluate(() => typeof window.MISRecovery?.create), 'function', 'browser exposes MISRecovery.create');

    const roundTrip = await page.evaluate(async () => {
      const reports = [];
      window.recovery = MISRecovery.create({ onError: error => reports.push(error.message) });
      const empty = await recovery.load();
      const record = {
        source: 'title Recovery\nlevels\nP.\n',
        levels: [{ transform: '[ Player ] -> [ Player ]', cells: new Int32Array([1, -2147483648, 2147483647]), intent: true }],
        nested: new Map([['pins', new Set(['first'])]])
      };
      const saved = await recovery.save(record);
      const loaded = await MISRecovery.create().load();
      return { empty, saved, source: loaded.source, typed: loaded.levels[0].cells instanceof Int32Array, cells: [...loaded.levels[0].cells], intent: loaded.levels[0].intent, map: loaded.nested instanceof Map, pins: [...loaded.nested.get('pins')], reports };
    });
    assert.deepEqual(roundTrip, {
      empty: null, saved: true, source: 'title Recovery\nlevels\nP.\n', typed: true,
      cells: [1, -2147483648, 2147483647], intent: true, map: true, pins: ['first'], reports: []
    }, 'source and arbitrary structured clone values round-trip through IndexedDB');

    const writes = await page.evaluate(async () => {
      const pending = Array.from({ length: 30 }, (_, revision) => recovery.save({ revision, cells: new Int32Array([revision]) }));
      const results = await Promise.all(pending);
      const loaded = await recovery.load();
      return { results, revision: loaded.revision, cells: [...loaded.cells] };
    });
    assert.deepEqual(writes, { results: Array(30).fill(true), revision: 29, cells: [29] }, 'overlapping writes retain the latest snapshot');

    await page.reload();
    assert.equal(await page.evaluate(async () => (await MISRecovery.create().load()).revision), 29, 'a new page can recover the completed snapshot');
    const isolated = await browser.newContext();
    const otherPage = await isolated.newPage();
    await otherPage.goto(base);
    assert.equal(await otherPage.evaluate(async () => MISRecovery.create().load()), null, 'browser profiles do not share recovery data');
    await isolated.close();

    const clearing = await page.evaluate(async () => {
      const primary = MISRecovery.create();
      const secondary = MISRecovery.create({ key: 'another-workspace' });
      await secondary.save({ source: 'independent' });
      const cleared = await primary.clear();
      return { cleared, primary: await primary.load(), secondary: await secondary.load() };
    });
    assert.deepEqual(clearing, { cleared: true, primary: null, secondary: { source: 'independent' } }, 'clear deletes only this workspace');
    const captured = await page.evaluate(async () => {
      const recovery = MISRecovery.create();
      const record = { source: 'at-save', cells: new Int32Array([7]) };
      const pending = recovery.save(record);
      record.source = 'changed-later';
      record.cells[0] = 99;
      await pending;
      const loaded = await recovery.load();
      return { source: loaded.source, cells: [...loaded.cells] };
    });
    assert.deepEqual(captured, { source: 'at-save', cells: [7] }, 'save captures a snapshot before mutable caller state changes');

    const failures = await page.evaluate(async () => {
      const reports = [];
      const recovery = MISRecovery.create({ onError: error => reports.push(error.message) });
      const first = await recovery.save({ uncloneable: () => {} });
      const second = await recovery.save({ uncloneable: () => {} });
      const retained = await recovery.load();
      const repeatedReports = reports.length;
      const retried = await recovery.save({ source: 'retry succeeded' });
      const failedAgain = await recovery.save({ uncloneable: () => {} });
      return { first, second, source: retained.source, repeatedReports, retried, failedAgain, reports };
    });
    assert.equal(failures.first, false);
    assert.equal(failures.second, false);
    assert.equal(failures.source, 'at-save', 'failed replacement keeps the last committed snapshot');
    assert.equal(failures.repeatedReports, 1, 'repeated failures are reported once until storage succeeds');
    assert.equal(failures.retried, true, 'later saves retry after failure');
    assert.equal(failures.failedAgain, false);
    assert.equal(failures.reports.length, 2, 'a new failure after a successful retry is reported');
    assert.match(failures.reports[0], /recovery.*save.*clone/i, 'failure report identifies the operation and cause');

    const aborted = await page.evaluate(async () => {
      const reports = [];
      // Use real IndexedDB, aborting after put succeeds but before its transaction
      // commits. A request success alone must never count as a completed save.
      const factory = { open(name) {
        const request = indexedDB.open(name);
        request.addEventListener('success', () => {
          const db = request.result;
          const transaction = db.transaction.bind(db);
          db.transaction = (names, mode) => {
            const tx = transaction(names, mode);
            if (mode === 'readwrite') {
              const objectStore = tx.objectStore.bind(tx);
              tx.objectStore = name => {
                const store = objectStore(name);
                const put = store.put.bind(store);
                store.put = (record, key) => {
                  const request = put(record, key);
                  request.addEventListener('success', () => tx.abort());
                  return request;
                };
                return store;
              };
            }
            return tx;
          };
        });
        return request;
      } };
      const recovery = MISRecovery.create({ indexedDB: factory, onError: error => reports.push(error.message) });
      const saved = await recovery.save({ source: 'must not replace the completed snapshot' });
      return { saved, source: (await recovery.load()).source, reports };
    });
    assert.equal(aborted.saved, false, 'a successful put followed by transaction abort is a failed save');
    assert.equal(aborted.source, 'retry succeeded', 'aborted replacement retains the last committed snapshot');
    assert.equal(aborted.reports.length, 1);
    assert.match(aborted.reports[0], /recovery.*save.*abort/i);

    const upgraded = await page.evaluate(async () => {
      const recovery = MISRecovery.create();
      await recovery.load();
      const canUpgrade = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 2000);
        const request = indexedDB.open('mis95-recovery', 2);
        request.onsuccess = () => { clearTimeout(timer); request.result.close(); resolve(true); };
        request.onerror = () => { clearTimeout(timer); resolve(false); };
      });
      return { canUpgrade, source: (await recovery.load()).source };
    });
    assert.deepEqual(upgraded, { canUpgrade: true, source: 'retry succeeded' }, 'version changes release old connections and the next operation reopens');
    assert.deepEqual(errors, [], 'no browser exceptions');
    assert.equal(typeof require('../js/mis/mis_recovery.js').create, 'function', 'helper also exposes a CommonJS module');
    console.log(JSON.stringify({ structuredClone: true, overlappingWrites: true, reload: true, isolatedContexts: true, clear: true, failures: true, atomicAbort: true, versionChange: true, errors }));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
