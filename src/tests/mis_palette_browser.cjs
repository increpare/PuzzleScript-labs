const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

(async () => {
  let server;
  try {
    let base = process.argv[2];
    if (!base) {
      const { buildWeb } = await import('../../scripts/build-mis-web.mjs');
      const web = await buildWeb();
      const { serve } = await import('../../scripts/gui95-serve.mjs');
      ({ server } = await serve({ root: web, entry: 'index.html', port: 0, host: '127.0.0.1' }));
      base = `http://127.0.0.1:${server.address().port}/`;
    }
    const output = path.resolve(__dirname, '../../build/mis-palette-checks');
    await fs.mkdir(output, { recursive: true });
    const reports = [], errors = [];
    for (const [name, engine, options] of [['chrome', chromium, { channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'] }], ['webkit', webkit, {}]]) {
      const browser = await engine.launch(options);
      try {
        for (const scale of [1, 1.25, 1.5, 2]) {
          const context = await browser.newContext({ viewport: { width: Math.round(1360 / scale), height: Math.round(900 / scale) }, deviceScaleFactor: scale });
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          page.on('pageerror', error => errors.push({ browser: name, url: page.url(), message: error.message }));
          // Do not navigate away while a live host's WASM fetch is pending:
          // WebKit reports those test-induced canceled loads as page errors.
          await page.addInitScript(() => {
            const OriginalWorker = window.Worker;
            window.paletteWorkers = [];
            window.Worker = class extends OriginalWorker {
              constructor(...args) {
                super(...args);
                const state = this.paletteState = { ready: false, stopped: false };
                paletteWorkers.push(state);
                this.addEventListener('message', event => { if (event.data.type === 'ready') state.ready = true; });
              }
              terminate() { this.paletteState.stopped = true; return super.terminate(); }
            };
          });
          for (const demo of ['heroes_of_sokoban', 'castlecloset']) {
            await page.goto(new URL(`?demo=demo/${demo}.txt&genWorkers=1`, base).href);
            await page.waitForFunction(() => window.misApp?.model && document.querySelector('#board').width > 10);
            await page.waitForFunction(() => paletteWorkers.length > 0 && paletteWorkers.every(worker => worker.ready || worker.stopped));
            for (const codeWidth of ['34%', '48%']) {
              await page.evaluate(width => document.body.style.setProperty('--code-width', width), codeWidth);
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              const report = await page.evaluate(() => {
                const rect = id => document.getElementById(id).getBoundingClientRect().toJSON();
                const palette = document.querySelector('#palette');
                return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, stage: rect('stage'), wrap: rect('board-wrap'), board: rect('board'), palette: rect('palette'), paletteWidth: palette.clientWidth, paletteScrollWidth: palette.scrollWidth, tiles: palette.children.length, tileWidths: [...palette.children].map(tile => tile.getBoundingClientRect().width), rows: new Set([...palette.children].map(tile => tile.offsetTop)).size };
              });
              await page.screenshot({ path: path.join(output, `${name}-${demo}-${scale}-${codeWidth.slice(0, -1)}.png`), fullPage: true });
              assert(report.pageWidth <= report.width + 1, 'palette must not widen the page');
              assert(report.wrap.right <= report.stage.right + 1, `board pane must fit the designer: ${JSON.stringify(report)}`);
              assert(report.palette.right <= report.stage.right + 1, 'palette must fit the designer');
              assert(report.palette.height <= 101, 'large palettes must scroll within their height allowance');
              assert(report.paletteScrollWidth <= report.paletteWidth + 1, 'objects must wrap without horizontal clipping');
              if (report.tiles * 31 - 3 > report.paletteWidth) assert(report.rows > 1, 'object palettes must wrap when a row cannot fit');
              assert(report.tileWidths.every(width => Math.abs(width - 28) < 1), 'object tiles retain their size');
              assert(Math.abs((report.board.left + report.board.right) / 2 - (report.wrap.left + report.wrap.right) / 2) <= 1, 'board must be centered in its visible pane');
              assert(report.board.left >= report.wrap.left && report.board.right <= report.wrap.right + 1);
              const last = page.locator('#palette .swatch').last();
              await last.click();
              assert.equal(await last.getAttribute('aria-pressed'), 'true');
              assert(await last.evaluate(tile => {
                const box = tile.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                return hit === tile || tile.contains(hit);
              }), 'the final object must be reachable inside the palette');
              reports.push({ browser: name, demo, scale, codeWidth, tiles: report.tiles, rows: report.rows, boardCentered: true, lastTileReachable: true });
            }
          }
          await context.close();
        }
      } finally { await browser.close(); }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ cases: reports.length, browsers: [...new Set(reports.map(report => report.browser))], scales: [1, 1.25, 1.5, 2], games: ['heroes_of_sokoban', 'castlecloset'], maxRows: Math.max(...reports.map(report => report.rows)), boardCentered: true, lastTileReachable: true, errors }, null, 2));
  } finally { if (server) await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
