// Run with an already served MIS page: node src/tests/mis_editor_browser.cjs URL
const { chromium } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || 'http://127.0.0.1:8080';
(async () => {
	const browser = await chromium.launch({ channel: 'chrome' });
	try {
		const page = await browser.newPage({ viewport: { width: 1360, height: 900 } }), errors = [];
		page.setDefaultTimeout(10000);
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(base + '/mis.html?genWorkers=1');
		await page.waitForFunction(() => window.misApp && misApp.model);
		assert.equal(await page.locator('.mis-code-editor.cm-editor').count(), 2);
		assert.equal(await page.locator('.CodeMirror').count(), 0);
		const original = fs.readFileSync(path.join(__dirname, 'fixtures/mis-two-feet/game.txt'), 'utf8').replace(/\r\n?/g, '\n');
		await page.locator('#file-input').setInputFiles({ name: 'two-feet.txt', mimeType: 'text/plain', buffer: Buffer.from(original) });
		await page.waitForFunction(() => misApp.model.names.foot_selected);
		const editor = name => page.locator('#tab-' + name + ' .mis-code-editor');
		async function setText(name, text) {
			await page.locator('[data-tab="' + name + '"]').click();
			await editor(name).locator('.cm-content').click();
			await page.keyboard.press('Control+a');
			await page.keyboard.insertText(text);
			await page.keyboard.press('Control+End');
		}
		async function accept(name, label) {
			const option = editor(name).locator('.cm-tooltip-autocomplete li').filter({ hasText: label }).first();
			try { await option.waitFor({ state: 'visible' }); await option.click(); }
			catch (error) {
				console.error(await editor(name).evaluate(root => { const api = root.misEditor, v = api.view; PuzzleScriptCM6Plugins.require('exact-prefix').ensureExactPrefix(v, v.state.selection.main.head, 500); const token = PuzzleScriptCM6Plugins.require('stream-state').getTokenAtPosition(v.state, api.language, v.state.selection.main.head); return { doc: api.getValue(), focus: v.hasFocus, status: PuzzleScriptCM6Runtime.completionStatus(v.state), labels: PuzzleScriptCM6Runtime.currentCompletions(v.state).map(x => x.label), section: token.state.section, comment: token.state.commentLevel, inside: token.state.inside_cell, token: token.string, pos: v.state.selection.main.head, cursor: api.getCursor(), tree: PuzzleScriptCM6Runtime.syntaxTree(v.state).toString() }; }));
				throw error;
			}
		}
		// Game source uses the ordinary parser's object completions as you type.
		await page.locator('[data-tab=source]').click();
		await editor('source').evaluate(root => {
			const api = root.misEditor, start = api.getValue().indexOf('[ up player ]') + 5;
			api.view.dispatch({ selection: { anchor: start, head: start + 6 } }); api.focus();
		});
		await page.keyboard.type('Foot_'); await accept('source', 'Foot_Selected');
		assert(await editor('source').evaluate(root => root.misEditor.getValue().includes('[ up Foot_Selected ]')));
		await page.keyboard.press('Control+z');
		assert(!(await editor('source').evaluate(root => root.misEditor.getValue().includes('[ up Foot_Selected ]'))));
		await setText('source', original);
		await page.waitForFunction(text => misApp.source === text, original);
		// Transform completion is in RULES context, with the current game's names.
		await setText('transform', 'choose 1 [ '); await page.keyboard.type('Foot_');
		await accept('transform', 'Foot_Selected');
		assert.equal(await editor('transform').evaluate(root => root.misEditor.getValue()), 'choose 1 [ Foot_Selected');
		await setText('transform', 'ch'); await page.keyboard.press('Control+Space');
		await accept('transform', 'choose');
		assert.equal(await editor('transform').evaluate(root => root.misEditor.getValue()), 'choose');
		await page.keyboard.press('Control+z');
		assert.equal(await editor('transform').evaluate(root => root.misEditor.getValue()), 'ch');
		await page.keyboard.press('Control+y');
		assert.equal(await editor('transform').evaluate(root => root.misEditor.getValue()), 'choose');
		assert.equal(await editor('source').evaluate(root => root.misEditor.getValue()), original);
		await page.keyboard.press('Control+f'); assert(await editor('transform').locator('.cm-search').isVisible());
		await page.keyboard.press('Escape'); assert(!(await editor('transform').locator('.cm-search').count()));
		// Recompiling renamed objects refreshes transform context, without stale names.
		const renamed = original.replace(/Foot_Selected/gi, 'NovelFoot');
		await setText('source', renamed); await page.waitForFunction(() => misApp.model.names.novelfoot);
		await setText('transform', 'choose 1 [ '); await page.keyboard.type('Novel'); await accept('transform', 'NovelFoot');
		await setText('transform', 'choose 1 [ Foot_S'); await page.keyboard.press('Control+Space');
		assert(!(await editor('transform').locator('.cm-tooltip-autocomplete li').filter({ hasText: 'Foot_Selected' }).count()));
		// Comments suppress suggestions, while invalid transforms keep diagnostics.
		await setText('transform', '( '); await page.keyboard.type('Novel'); await page.keyboard.press('Control+Space');
		assert.equal(await editor('transform').locator('.cm-tooltip-autocomplete').count(), 0);
		await setText('transform', 'choose x [ NovelFoot ] -> []');
		await page.locator('#transform-diag .err').first().waitFor();
		assert(await editor('transform').locator('.cm-line.err-line').count());
		await page.locator('#transform-diag .err').first().click();
		assert(await editor('transform').evaluate(root => root.contains(document.activeElement)));
		await setText('transform', 'choose 1 [ '); await page.keyboard.type('Novel');
		await editor('transform').locator('.cm-tooltip-autocomplete').waitFor();
		const out = path.resolve(__dirname, '../../build/mis-editor-checks'); fs.mkdirSync(out, { recursive: true });
		await page.screenshot({ path: path.join(out, 'autocomplete.png') });
		assert.deepEqual(errors, []);
		console.log(JSON.stringify({ cm6Panels: 2, sourceAutocomplete: true, transformAutocomplete: true, manualCompletion: true, undoRedo: true, isolatedHistories: true, search: true, renamedObjects: true, comments: true, diagnostics: true, errors }));
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });


