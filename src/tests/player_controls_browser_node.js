#!/usr/bin/env node
'use strict';
// Exercise source/release players and the CM6 preview in a real touch browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('@playwright/test');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(__dirname, 'solver_smoke_tests/one_move.txt'), 'utf8')
    .replace(/SOUNDS/i, 'SOUNDS\nsfx0 123');
const mime = {'.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.txt':'text/plain'};
function standalone(directory) {
    return fs.readFileSync(path.join(root, directory, 'standalone_inlined.txt'), 'utf8')
        .replace(/"__GAMEDAT__"/g, () => JSON.stringify(source))
        .replace(/__GAMETITLE__/g, 'Player controls test')
        .replace(/___BGCOLOR___/g, 'black').replace(/___TEXTCOLOR___/g, 'white')
        .replace(/__HOMEPAGE_STRIPPED_PROTOCOL__/g, 'example.com')
        .replace(/__HOMEPAGE__/g, 'https://example.com');
}
(async () => {
    const server = http.createServer((req,res) => {
        const relative = decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);
        if (/^(src|bin)\/export-test.html$/.test(relative)) {
            res.setHeader('Content-Type','text/html');res.end(standalone(relative.split('/')[0]));return;
        }
        const file = path.resolve(root, relative);
        if (!file.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
        try {res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}
        catch {res.writeHead(404);res.end();}
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({headless:true});
    let checked=0;
    try {
        for (const directory of ['src','bin']) for (const surface of ['editor','play','export-test']) {
            for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
                console.log(`Checking ${directory}/${surface} ${viewport.width}x${viewport.height}`);
                const context = await browser.newContext({hasTouch:true,isMobile:true,viewport});
                const page = await context.newPage();const errors=[];
                page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});
                await page.route('**/gist_proxy.py?*', route=>route.fulfill({contentType:'application/json',body:JSON.stringify({content:source})}));
                await page.goto(`${base}/${directory}/${surface}.html?p=test`,{waitUntil:'networkidle'});
                await page.waitForFunction(()=>window.Mobile && Mobile.playerRoot);
                await page.evaluate(code=>compile(['loadLevel',0],code),source);
                await page.waitForTimeout(100);
                if(surface==='editor') {
                    await page.locator('#expandPreviewButton').tap();
                    assert.equal(await page.locator('.preview-expanded').count(),1);
                    // Swiping the canvas must use the CM6 editor's public blur API.
                    await page.evaluate(()=>Mobile._instance.handleFocusChange({touches:[{clientX:canvas.getBoundingClientRect().x+1,clientY:canvas.getBoundingClientRect().y+1}]}));
                }
                await page.locator('#gameMenuButton').tap();
                await page.locator('#controlSize').selectOption('64');
                await page.locator('#swapControls').check();
                await page.locator('#overlayControls').uncheck();
                await page.locator('#closeMenuButton').tap();
                assert.equal(await page.locator('.controls-swapped').count(),1);
                const box=await page.locator('#moveleft').boundingBox();assert(box);
                await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
                await page.mouse.down();
                assert(await page.evaluate(()=>keybuffer.includes(37)));
                await page.mouse.up();
                assert.equal(await page.evaluate(()=>keybuffer.includes(37)),false);
                await page.locator('#muteButton').tap();
                assert(await page.evaluate(()=>muted));
                await page.locator('#unMuteButton').tap();
                assert.equal(await page.evaluate(()=>Boolean(muted)),false);
                if(surface==='editor') {
                    await page.keyboard.press('Escape');
                    assert.equal(await page.locator('.preview-expanded').count(),0);
                    assert(await page.locator('.cm-content').isEditable());
                }
                assert.deepEqual(errors,[],`${directory}/${surface} ${viewport.width}`);
                checked++;
                await context.close();
            }
        }
        for (const directory of ['src','bin']) for (const theme of ['light','dark']) {
            const context = await browser.newContext({viewport:{width:1440,height:900}});
            const page = await context.newPage();const errors=[];
            page.on('pageerror',error=>errors.push(error.message));
            await page.goto(`${base}/${directory}/editor.html`,{waitUntil:'networkidle'});
            await page.evaluate(({code,theme})=>{
                compile(['loadLevel',0],code);
                document.body.style.colorScheme=theme;
                document.body.classList.toggle('light-theme',theme==='light');
                document.body.classList.toggle('dark-theme',theme==='dark');
            },{code:source,theme});
            assert.equal(await page.locator('#playerToolbar').isVisible(),false);
            await page.locator('#levelEditorClickLink').click();
            assert(await page.evaluate(()=>levelEditorOpened));
            assert(await page.locator('.cm-content').isEditable());
            assert(await page.evaluate(()=>canvas.width>0 && canvas.height>0 && glyphImages.length>0));
            await page.locator('#levelEditorClickLink').click();
            assert.equal(await page.evaluate(()=>levelEditorOpened),false);
            const painted=await page.evaluate(()=>{
                compile(['restart'],editor.getValue());
                regenText();
                let count=0;
                const original=createSprite;
                createSprite=function(...args){count++;return original(...args)};
                try {
                    regenText();const reused=count===0;
                    state.fgcolor='#ff00ff';regenText();
                    return {reused,repainted:count>0,space:!!textImages[' ']};
                } finally {createSprite=original;}
            });
            assert.deepEqual(painted,{reused:true,repainted:true,space:false});
            assert.deepEqual(errors,[],`${directory} desktop ${theme}`);
            checked++;
            await context.close();
        }
        console.log(`player_controls_browser_node passed (${checked} touch/desktop source/release layouts)`);
    } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
