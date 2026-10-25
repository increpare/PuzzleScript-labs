// No URL: build and test a nested static deployment. URL: check the public host.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  let server, browser;
  const errors = [], failures = [], reports = [];
  try {
    let base = process.argv[2];
    if (!base) {
      const { buildWeb } = await import('../../scripts/build-mis-web.mjs');
      const web = await buildWeb();
      const { serve } = await import('../../scripts/gui95-serve.mjs');
      ({ server } = await serve({ root: path.dirname(web), entry: 'mis-web/mis.html', port: 0, host: '127.0.0.1' }));
      base = `http://127.0.0.1:${server.address().port}/mis-web/`;
    }
    base = base.replace(/\/?$/, '/');
    browser = await chromium.launch({ channel: 'chrome' });
    for (const entry of ['', 'mis.html']) {
      const context = await browser.newContext();
      const page = await context.newPage({ viewport: { width: 1360, height: 900 } });
      page.setDefaultTimeout(30000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
      const response = await page.goto(base + entry + '?genWorkers=1');
      assert.equal(response.status(), 200, 'workbench entry must exist');
      await page.waitForFunction(() => window.misApp?.model && document.querySelector('#status-text').textContent.includes('Solvable'));
      assert.match(await page.title(), /MIS95/);
      assert.equal(await page.locator('.mis-code-editor.cm-editor').count(), 2);
      const arrowStyle = await page.locator('#cards').evaluate(element => {
        const style = getComputedStyle(element, '::-webkit-scrollbar-button');
        return { repeat: style.backgroundRepeat, position: style.backgroundPosition, width: style.width, height: style.height };
      });
      assert.deepEqual(arrowStyle, { repeat: 'no-repeat', position: '50% 50%', width: '16px', height: '16px' }, 'scrollbar arrow slots must not tile');
      assert.match(await page.locator('#backend-note').textContent(), /native/);
      const wasm = await context.request.get(new URL('js/mis/wasm/mis_native.wasm', base).href);
      assert.equal(wasm.status(), 200);
      assert.match(wasm.headers()['content-type'], /application\/wasm/);
      const demos = await page.locator('#demo-select option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      // The first demo is already loaded at startup; return to it last.
      for (const demo of [...demos.slice(1), demos[0]]) {
        const before = await page.evaluate(() => misApp.source);
        await page.locator('#demo-select').selectOption(demo);
        await page.waitForFunction(source => misApp.source !== source && !!misApp.model, before);
      }
      // Exercise the solver/generator workers, not just the page shell.
      const fixture = name => fs.readFile(path.join(__dirname, 'fixtures/mis-two-feet', name + '.txt'), 'utf8');
      const game = await fixture('game'), transform = await fixture('transform');
      await page.locator('#file-input').setInputFiles({ name: 'two-feet.txt', mimeType: 'text/plain', buffer: Buffer.from(game + '\n(MIS transform\n' + transform.trim() + '\nMIS end)\n') });
      await page.waitForFunction(() => document.title.includes('OUTDATED TECH'));
      await page.locator('#gen-btn').click();
      await page.waitForFunction(() => document.querySelectorAll('#cards .card').length > 0, null, { timeout: 45000 });
      await page.locator('#gen-btn').click();
      reports.push({ url: base + entry, demos: demos.length, nativeSolver: true, generatedSuggestions: await page.locator('#cards .card').count() });
      await context.close();
    }
    assert.deepEqual(failures, [], 'no missing page or worker assets');
    assert.deepEqual(errors, [], 'no browser exceptions');
    console.log(JSON.stringify({ reports, failures, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
