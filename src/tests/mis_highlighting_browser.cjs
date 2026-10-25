// Checks rendered colors as well as tokens; token classes alone can hide a
// missing stylesheet. Uses an isolated browser profile and a short-lived server.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
	const { serve } = await import('../../scripts/gui95-serve.mjs');
	const { server } = await serve({ root: path.resolve(__dirname, '..'), entry: 'mis.html', port: 0, host: '127.0.0.1' });
	let browser;
	try {
		browser = await chromium.launch({ channel: 'chrome' });
		const page = await browser.newPage({ viewport: { width: 1360, height: 900 } }), errors = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('dialog', dialog => dialog.accept());
		await page.goto(`http://127.0.0.1:${server.address().port}/mis.html?genWorkers=1`);
		await page.waitForFunction(() => window.misApp?.model);
		const editor = name => page.locator('#tab-' + name + ' .mis-code-editor');
		async function tokens(name) {
			await page.locator('[data-tab="' + name + '"]').click();
			await page.waitForFunction(name => {
				const root = document.querySelector('#tab-' + name + ' .mis-code-editor');
				const view = root.misEditor.view;
				return view.state.field(PuzzleScriptCM6Plugins.require('exact-prefix').exactPrefix) >= view.viewport.to && root.querySelector('.cm-line span');
			}, name);
			return editor(name).locator('.cm-line span').evaluateAll(spans => spans.map(span => ({ text: span.textContent.trim(), classes: span.className.split(/\s+/), color: getComputedStyle(span).color })));
		}
		const source = await tokens('source');
		const green = source.find(t => t.text === 'green' && t.classes.includes('cm-COLOR-GREEN'));
		assert(green, 'named color token is visible');
		assert.notEqual(green.color, 'rgb(0, 0, 0)', 'named colors must render in color');
		assert(source.some(t => t.text === '1' && t.classes.includes('cm-COLOR-GREEN') && t.color === green.color), 'sprite pixels use the palette too');

		const transform = 'TRANSFORM\n========\n  choose 2-6 option 0.4 horizontal [ Player | no Wall ] -> [ | Player ] or option 0.6 [ Crate ] -> []\n(nested (choose 99) comment\n\ncontinued)\nGENERATION\n[ Player\n  choose 1 [ Crate ] -> []\nchoose (count) 2 [ Wall ] -> []';
		await editor('transform').evaluate((root, text) => root.misEditor.setValue(text), transform);
		const highlighted = await tokens('transform');
		for (const [text, style] of [['TRANSFORM', 'HEADER'], ['GENERATION', 'HEADER'], ['========', 'EQUALSBIT'], ['choose', 'LOGICWORD'], ['option', 'LOGICWORD'], ['or', 'LOGICWORD'], ['2-6', 'number'], ['0.4', 'number'], ['horizontal', 'DIRECTION'], ['no', 'DIRECTION'], ['Player', 'NAME'], ['Crate', 'NAME'], ['->', 'ARROW']]) {
			assert(highlighted.some(t => t.text === text && t.classes.includes('cm-' + style)), text + ' is highlighted as ' + style);
		}
		assert(!highlighted.some(t => t.classes.includes('cm-ERROR')), 'supported syntax and incomplete lines must not poison later highlighting');
		assert(highlighted.some(t => t.text.includes('choose 99') && t.classes.includes('cm-comment')), 'nested comment keywords stay comments');
		assert(highlighted.some(t => t.text === 'continued)' && t.classes.includes('cm-comment')), 'multiline comments survive blank lines');
		const color = style => highlighted.find(t => t.classes.includes('cm-' + style)).color;
		assert.notEqual(color('NAME'), color('LOGICWORD'), 'names and transform keywords have distinct colors');
		assert.notEqual(color('ARROW'), color('DIRECTION'), 'arrows and directions have distinct colors');
		const probabilities = 'option .5 [Wall] -> []\nor option 1e-1 [Crate] -> []';
		assert.deepEqual(await page.evaluate(text => MISCore.parseTransform(text, misApp.model).errors, probabilities), []);
		await editor('transform').evaluate((root, text) => root.misEditor.setValue(text), probabilities);
		const probabilityTokens = await tokens('transform');
		for (const text of ['.5', '1e-1']) assert(probabilityTokens.some(t => t.text === text && t.classes.includes('cm-number')), text + ' is a valid probability');

		// Context is rebuilt when game definitions change, including names in
		// cells that happen to look like transform keywords or numbers.
		const game = (await fs.readFile(path.resolve(__dirname, '../demo/sokoban_basic.txt'), 'utf8'))
			.replace(/Crate/g, 'NovelCrate').replace(/LEGEND/i, 'LEGEND\n1 = NovelCrate');
		await page.locator('#file-input').setInputFiles({ name: 'numeric.txt', mimeType: 'text/plain', buffer: Buffer.from(game) });
		await page.waitForFunction(() => misApp.model.names.novelcrate && misApp.model.names['1']);
		await editor('transform').evaluate(root => root.misEditor.setValue('choose 1 [ 1 NovelCrate ] -> [ UnknownName ]'));
		const numeric = await tokens('transform');
		assert(numeric.some(t => t.text === '1' && t.classes.includes('cm-NAME')), 'numeric aliases stay names inside cells');
		assert(numeric.some(t => t.text === 'NovelCrate' && t.classes.includes('cm-NAME')), 'new game definitions are highlighted');
		assert(numeric.some(t => t.text === 'UnknownName' && t.classes.includes('cm-ERROR')), 'unknown objects are marked');
		assert.deepEqual(errors, []);
		const output = path.resolve(__dirname, '../../build/mis-editor-checks');
		await fs.mkdir(output, { recursive: true });
		await editor('transform').evaluate((root, text) => root.misEditor.setValue(text), transform.replace(/Crate/g, 'NovelCrate'));
		await tokens('transform');
		await page.screenshot({ path: path.join(output, 'highlighting.png') });
		console.log('MIS95 source and transform highlighting: passed');
	} finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
