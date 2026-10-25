const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

async function checkScrollbars(page) {
  const scrollbar = await page.locator('#scrollbar-probe').evaluate(element => {
    const style = getComputedStyle(element, '::-webkit-scrollbar-button');
    return { repeat: style.backgroundRepeat, position: style.backgroundPosition, width: style.width, height: style.height };
  });
  assert.deepEqual(scrollbar, { repeat: 'no-repeat', position: '50% 50%', width: '16px', height: '16px' },
    'every generated arrow slot must receive the base style, including slots that do not match :single-button');

  const probe = page.locator('#scrollbar-probe');
  const box = await probe.boundingBox();
  const position = () => probe.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }));
  const reset = () => probe.evaluate(element => element.scrollTo(0, 0));
  for (const axis of ['x', 'y']) {
    await reset();
    const click = axis === 'y'
      ? { x: box.x + box.width - 8, y: box.y + box.height - 24 }
      : { x: box.x + box.width - 24, y: box.y + box.height - 8 };
    await page.mouse.click(click.x, click.y);
    await page.waitForFunction(axis => document.querySelector('#scrollbar-probe')[axis === 'y' ? 'scrollTop' : 'scrollLeft'] > 0, axis);
    const line = (await position())[axis];
    await reset();
    const track = axis === 'y'
      ? { x: box.x + box.width - 8, y: box.y + box.height / 2 }
      : { x: box.x + box.width / 2, y: box.y + box.height - 8 };
    await page.mouse.click(track.x, track.y);
    await page.waitForFunction(({ axis, line }) => document.querySelector('#scrollbar-probe')[axis === 'y' ? 'scrollTop' : 'scrollLeft'] > line,
      { axis, line });
    await reset();
    const thumb = axis === 'y'
      ? { x: box.x + box.width - 8, y: box.y + 30 }
      : { x: box.x + 30, y: box.y + box.height - 8 };
    await page.mouse.move(thumb.x, thumb.y);
    await page.mouse.down();
    await page.mouse.move(click.x, click.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(axis => {
      const e = document.querySelector('#scrollbar-probe');
      return axis === 'y' ? e.scrollTop >= e.scrollHeight - e.clientHeight - 1 : e.scrollLeft >= e.scrollWidth - e.clientWidth - 1;
    }, axis);
  }
  await reset();
  // Content that fits must not acquire a scrollbar or consume a gutter.
  assert(await page.locator('#short-probe').evaluate(e => e.clientWidth === e.offsetWidth && e.clientHeight === e.offsetHeight));
}

(async () => {
  const output = path.resolve(__dirname, '../../build/mis-scrollbar-checks');
  await fs.mkdir(output, { recursive: true });
  const css = await fs.readFile(path.resolve(__dirname, '../css/mis-win95.css'), 'utf8');
  const reports = [];
  for (const [name, engine, options] of [['chrome', chromium, { channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'] }], ['webkit', webkit, {}]]) {
    const browser = await engine.launch(options);
    try {
      for (const scale of [1, 1.25, 1.5, 2]) {
        const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: scale });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.setContent('<body class="mis-win95"><div id="scrollbar-probe" tabindex="0"><div>Long scrolling content</div></div><div id="short-probe">Short content</div></body>');
        await page.addStyleTag({ content: css + '\n#scrollbar-probe { position:absolute;top:40px;left:40px;width:280px;height:200px;overflow:scroll;background:white;scroll-behavior:auto; } #scrollbar-probe > div { width:1000px;height:900px;background:repeating-linear-gradient(#fff 0 29px,#dfdfdf 29px 30px); } #short-probe { position:absolute;top:270px;left:40px;width:280px;height:100px;overflow:auto;background:white; }' });
        await page.screenshot({ path: path.join(output, `${name}-${scale}.png`) });
        await checkScrollbars(page);
        reports.push({ browser: name, scale, arrows: true, trackPaging: true, thumbDragging: true, shortContent: true });
        await context.close();
      }
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify(reports, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
