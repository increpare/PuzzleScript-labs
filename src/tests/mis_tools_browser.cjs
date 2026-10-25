// Run against a served source or MIS web build.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:8080';

(async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.goto(base + '/mis.html?genWorkers=1');
        await page.waitForFunction(() => window.misApp && misApp.model);
        const menus = await page.locator('.menu-trigger').allTextContents();
        assert.equal(menus[menus.indexOf('Run') + 1], 'Tools', 'Tools follows Run');
        const original = fs.readFileSync(path.join(__dirname, '../demo/sokoban_basic.txt'), 'utf8');
        const editor = page.locator('#tab-source .mis-code-editor');
        async function load() {
            await page.locator('#file-input').setInputFiles({ name: 'sokoban.txt', mimeType: 'text/plain', buffer: Buffer.from(original) });
            await page.waitForFunction(text => misApp.source === text, original);
        }
        async function canonicalize(stripSprites = false) {
            await page.getByRole('button', { name: 'Tools', exact: true }).click();
            await page.getByRole('menuitem', { name: stripSprites ? 'Canonicalize (strip sprites)' : 'Canonicalize', exact: true }).click();
        }
        await load();
        const before = await page.evaluate(() => misApp.undo.length);
        await canonicalize();
        const output = await page.evaluate(() => misApp.source);
        assert.notEqual(output, original);
        assert(!/^=+$/m.test(output));
        assert(/^Crate$/m.test(output));
        assert(/\.000\.\n\.111\.\n22222\n\.333\.\n\.3\.3\./.test(output), 'normal command retains player art');
        assert.equal(await page.evaluate(() => misApp.undo.length), before + 1);
        assert(await editor.evaluate(root => root.contains(document.activeElement)));
        assert(await page.locator('#source-diag .ok').isVisible());
        assert.equal(await page.evaluate(() => misApp.dirty), true);
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForFunction(text => misApp.source === text, original);
        await page.keyboard.press('ControlOrMeta+Shift+z');
        await page.waitForFunction(text => misApp.source === text, output);
        // The workbench's document Undo/Redo also restores the whole source.
        await load(); await canonicalize();
        await page.locator('#undo-btn').click();
        assert.equal(await page.evaluate(() => misApp.source), original);
        await page.locator('#redo-btn').click();
        assert.equal(await page.evaluate(() => misApp.source), output);
        await load(); await canonicalize(true);
        const stripped = await page.evaluate(() => misApp.source);
        assert(!/^[.0-9]{5}$/m.test(stripped.split('LEGEND')[0]), 'strip command removes grids');
        assert(await page.evaluate(() => misApp.model.objects.filter(Boolean).every(object => object.colors.length === 1)));
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForFunction(text => misApp.source === text, original);
        await page.keyboard.press('ControlOrMeta+Shift+z');
        await page.waitForFunction(text => misApp.source === text, stripped);
        // Read the live editor, even before its 450 ms compile debounce expires.
        await load();
        await page.locator('[data-tab=source]').click();
        const pending = original.replace(/Crate/g, 'Chest');
        await page.evaluate(text => {
            document.querySelector('#tab-source .mis-code-editor').misEditor.setValue(text);
            window.misDocument.canonicalize();
        }, pending);
        const pendingOutput = await page.evaluate(() => misApp.source);
        assert(/^Chest$/m.test(pendingOutput));
        await page.locator('#undo-btn').click();
        assert.equal(await page.evaluate(() => misApp.source), pending);
        // A rejected conversion adds no edit and leaves the draft intact.
        const invalid = pending.replace('all Target on Chest', 'all UndefinedObject on Chest');
        const invalidResult = await page.evaluate(text => {
            const api = document.querySelector('#tab-source .mis-code-editor').misEditor;
            api.setValue(text);
            const undo = misApp.undo.length;
            window.misDocument.canonicalize();
            return { text: api.getValue(), undo, after: misApp.undo.length };
        }, invalid);
        assert.equal(invalidResult.text, invalid);
        assert.equal(invalidResult.after, invalidResult.undo);
        assert.deepEqual(errors, []);
        console.log('mis_tools_browser: menu, replacement, names, undo/redo, pending edits and invalid input passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
