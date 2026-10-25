const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  let server, browser;
  try {
    let base = process.argv[2];
    if (!base) {
      const { buildWeb } = await import('../../scripts/build-mis-web.mjs');
      const web = await buildWeb();
      const { serve } = await import('../../scripts/gui95-serve.mjs');
      ({ server } = await serve({ root: web, entry: 'index.html', port: 0, host: '127.0.0.1' }));
      base = `http://127.0.0.1:${server.address().port}/`;
    }
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const OriginalWorker = window.Worker;
      window.solveTest = { requests: [], hold: false, terminated: 0 };
      window.Worker = class extends OriginalWorker {
        postMessage(message, ...args) {
          // Background health checks retain their 1.5-second allowance.
          if (message.type === 'assess' && message.opts.timeMs !== 1500) {
            solveTest.requests.push(structuredClone(message.opts));
            if (solveTest.hold) { solveTest.held = { worker: this, message }; return; }
            if (solveTest.fail) {
              solveTest.fail = false;
              queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'assessed', id: message.id, result: { status: 'error', error: 'Controlled test failure' } } })));
              return;
            }
          }
          return super.postMessage(message, ...args);
        }
        terminate() { solveTest.terminated++; return super.terminate(); }
      };
    });
    await page.goto(new URL('?genWorkers=1', base).href);
    await page.waitForFunction(() => solveTest.requests.length > 0);
    assert.equal(await page.evaluate(() => solveTest.requests[0].timeMs), -1, 'the selected level must have no clock cutoff');
    assert.equal(await page.evaluate(() => solveTest.requests[0].maxExpanded), 0, 'the selected level must have no expansion cutoff');
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('Solvable'));

    // Worker failures are visible, retryable, and never cached as a proof.
    await page.evaluate(() => { solveTest.fail = true; misApp.assessCache.clear(); });
    await page.locator('#backend-select').selectOption('native');
    await page.waitForFunction(() => document.querySelector('#status-text').textContent === 'Solver error');
    assert.match(await page.locator('#status-effort').textContent(), /Controlled test failure/);
    assert(await page.evaluate(() => [...misApp.assessCache.values()].every(result => !result.deep)));
    await page.locator('#solve-btn').filter({ hasText: 'Retry solve' }).click();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('Solvable'));

    // An in-flight solve must stop even when switching to a cached level.
    await page.evaluate(() => { solveTest.hold = true; });
    await page.locator('#level-list .level-item').nth(1).click();
    await page.locator('#solve-btn').filter({ hasText: 'Stop solver' }).waitFor();
    await page.waitForFunction(() => !!solveTest.held);
    const before = await page.evaluate(() => solveTest.terminated);
    await page.locator('#level-list .level-item').first().click();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('Solvable'));
    assert((await page.evaluate(() => solveTest.terminated)) > before);
    // A queued old result cannot replace the cached current level's result.
    await page.evaluate(() => solveTest.held.worker.dispatchEvent(new MessageEvent('message', { data: { type: 'assessed', id: solveTest.held.message.id, result: { status: 'timeout' } } })));
    assert.match(await page.locator('#status-text').textContent(), /Solvable/);

    // Stop is immediate, does not claim unsolvability, and permits a fresh solve.
    await page.evaluate(() => { misApp.assessCache.clear(); });
    await page.locator('#backend-select').selectOption('js');
    await page.locator('#solve-btn').filter({ hasText: 'Stop solver' }).click();
    assert.match(await page.locator('#status-text').textContent(), /stopped/i);
    assert(await page.evaluate(() => [...misApp.assessCache.values()].every(result => !result.deep)));
    await page.evaluate(() => { solveTest.hold = false; });
    await page.locator('#solve-btn').filter({ hasText: 'Retry solve' }).click();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('Solvable'));

    // The user's reported puzzle: real native solver, not a stubbed result.
    await page.locator('#backend-select').selectOption('native');
    await page.locator('#demo-select').selectOption('4');
    await page.waitForFunction(() => misApp.fileName === 'heroes_of_sokoban.txt');
    await page.locator('#level-list .level-item').nth(3).click();
    const start = Date.now();
    await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('Solvable'), null, { timeout: 180000 });
    const result = await page.evaluate(() => {
      const key = misApp.cacheKey(misApp.board);
      const result = misApp.assessCache.get(key);
      MISCore.replayFrames(misApp.model, misApp.board, result.solution);
      return { status: result.status, moves: result.solution.length, replayWon: MISCore.winconditionsNow(), level: misApp.levelIndex };
    });
    assert.equal(result.status, 'solved');
    assert(result.replayWon, 'Heroes of Sokoban level 4 solution must win in the JS player');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ unlimitedFocusSearch: true, cachedLevelCancelsOldSearch: true, stopAndRetry: true, errorsAreRetryable: true, heroesLevel4: result, elapsedMs: Date.now() - start, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
