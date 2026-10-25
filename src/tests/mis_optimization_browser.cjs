// Real offline-capable workers: paired baseline/optimized checks on both engines.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');

(async () => {
  let server, browser, isolatedWeb;
  const reports = [], errors = [];
  try {
    const { buildWeb } = await import('../../scripts/build-mis-web.mjs');
    const web = await buildWeb();
    isolatedWeb = await fs.mkdtemp(path.join(os.tmpdir(), 'mis-optimization-'));
    await fs.cp(web, isolatedWeb, { recursive: true });
    const { serve } = await import('../../scripts/gui95-serve.mjs');
    ({ server } = await serve({ root: isolatedWeb, entry: 'mis.html', port: 0, host: '127.0.0.1' }));
    const base = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '?genWorkers=1');
    await page.waitForFunction(() => window.misApp?.model);
    const games = ['tests/fixtures/mis-optimization/game.txt', 'demo/sokoban_basic.txt',
      'demo/microban.txt', 'demo/lunar_lockout.txt',
      'tests/good_games/ALL GREEN TO BLUE.txt'];
    for (const name of games) {
      const source = await fs.readFile(path.join(__dirname, '..', name), 'utf8');
      for (const backend of ['js', 'native']) {
        const report = await page.evaluate(async ({ source, name, backend }) => {
          if (!misCompile(source).ok) throw new Error('original compile failed: ' + name);
          const model = MISCore.extractModel(source);
          const boards = model.levels.filter(level => level.board).slice(0, 2).map(level => level.board);
          const transform = MISCore.parseTransform('choose 1 [ Wall | no Wall no Player ] -> [ | Wall ]', model);
          if (!transform.errors.length && transform.statements.length) {
            const seed = boards[0];
            for (const index of [11, 29]) boards.push(MISCore.runTransform(model, transform, seed, null, MISCore.makeRng(index)));
          }
          const results = [];
          // Reverse order in the second pair to reduce warmup/order bias.
          for (const optimize of [false, true, true, false]) {
            const worker = new Worker(new URL('js/mis/mis_worker.js', location.href));
            try {
              const request = message => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('worker timeout')), 60000);
                worker.onmessage = event => {
                  if (event.data.type === 'error') { clearTimeout(timer); reject(new Error(event.data.message)); }
                  else { clearTimeout(timer); resolve(event.data); }
                };
                worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
                worker.postMessage(message);
              });
              const ready = await request({ type: 'init', source, backend, optimize });
              if (!ready.ok || ready.backend !== backend) throw new Error('wrong backend: ' + JSON.stringify(ready));
              if (optimize && !ready.optimization.enabled && !ready.errors.some(error => error.isError)) {
                throw new Error('unexpected optimization fallback: ' + name + ': ' + ready.optimization.reason);
              }
              const samples = [];
              // Includes original-game replay and per-request projection costs.
              for (let repeat = 0; repeat < 3; repeat++) {
                for (const [index, board] of boards.entries()) {
                  const reply = await request({ type: 'assess', id: index, board, opts: { timeMs: 1500, maxExpanded: 150000, refine: false } });
                  const result = reply.result;
                  if (ready.optimization.enabled && !result.optimization.enabled) throw new Error('optimization disabled during solve: ' + result.optimization.reason);
                  if (result.status === 'solved' && !MISCore.validateSolution(model, board, result.solution)) throw new Error('original replay failed: ' + name);
                  samples.push({ index, repeat, status: result.status, ms: result.ms, expanded: result.expanded, length: result.solution?.length });
                }
              }
              results.push({ optimize, preparation: ready.optimization, samples });
            } finally { worker.terminate(); }
          }
          return { name, backend, results };
        }, { source, name, backend });
        for (const [off, on] of [[0, 1], [3, 2]]) {
          const before = report.results[off].samples, after = report.results[on].samples;
          assert.deepEqual(after.map(row => row.status), before.map(row => row.status), name + ': solve outcomes');
        }
        reports.push(report);
        console.log(name + ' / ' + backend + ': ' + JSON.stringify(report.results.map(run => ({ optimized: run.preparation.enabled, objects: run.preparation.solverObjects,
          prepareMs: run.preparation.prepareMs, ms: run.samples.reduce((sum, row) => sum + row.ms, 0), solved: run.samples.filter(row => row.status === 'solved').length }))));
      }
    }
    assert.deepEqual(errors, []);
    const destination = path.resolve('build/mis-optimization-benchmark.json');
    await fs.writeFile(destination, JSON.stringify({ reports, errors }, null, 2) + '\n');
    console.log('mis_optimization_browser: ok; paired measurements: ' + destination);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (isolatedWeb) await fs.rm(isolatedWeb, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
