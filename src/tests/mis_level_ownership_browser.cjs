const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 let browser,server;
 try{
  const {serve}=await import('../../scripts/gui95-serve.mjs');
  ({server}=await serve({root:path.resolve(__dirname,'..'),entry:'mis.html',host:'127.0.0.1',port:0}));
  browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{const Native=Worker;window.holdSimplify=false;window.assignments=[];window.Worker=class extends Native{postMessage(m,...args){if(m.type==='generationJobs')window.assignments.push(structuredClone(m));if(m.type==='simplify'&&window.holdSimplify){window.releaseSimplify=()=>super.postMessage(m,...args);return;}return super.postMessage(m,...args);}}});
  await page.goto(`http://127.0.0.1:${server.address().port}/mis.html?genWorkers=1`);
  await page.waitForFunction(()=>window.misApp?.recoveryReady&&document.querySelector('#status-text').textContent.includes('Solvable'));
  // Starting another level (select it, Generate) uses its Auto preset; the
  // thumbnail's badge only shows that it is generating and can't start it.
  await page.locator('.level-item').nth(1).click();
  await page.locator('#gen-btn').click();
  await page.locator('.level-item').first().click();
  assert.equal(await page.evaluate(()=>misApp.levelIndex),0);
  assert.equal(await page.locator('.level-item button.generation-badge').count(),0,'badge is not a button');
  await page.waitForFunction(()=>document.querySelectorAll('.level-item')[1].querySelector('.generation-badge.running'));
  await page.waitForFunction(()=>assignments.some(a=>a.jobs.some(j=>j.jobId===misApp.workspaces[1].id&&j.transforms?.length>1)));
  await page.evaluate(()=>document.querySelector('#stop-all-generation').click());
  // Simplify belongs to the source workspace even when the response arrives elsewhere.
  await page.evaluate(()=>{holdSimplify=true});
  await page.locator('#simplify-btn').click();await page.waitForFunction(()=>!!window.releaseSimplify);
  await page.locator('.level-item').nth(1).click();await page.evaluate(()=>releaseSimplify());
  await page.waitForFunction(()=>!!misApp.workspaces[0].special,null,{timeout:60000});
  assert.equal(await page.evaluate(()=>misApp.workspaces[1].special),null);
  assert.equal(await page.evaluate(()=>misApp.workspaces[0].special.levelIndex),0);
  // An edit and immediate switch keep the text and editor history with their owner.
  const a=await page.evaluate(()=>misApp.workspaces[0].transform),b=await page.evaluate(()=>misApp.transform);
  await page.locator('.level-item').first().click();
  await page.evaluate(()=>{const cm=document.querySelector('#tab-transform .mis-code-editor').misEditor;cm.setValue(cm.getValue()+'\n(level A edit)');document.querySelectorAll('.level-item')[1].click()});
  assert.equal(await page.evaluate(()=>misApp.workspaces[0].transform),a+'\n(level A edit)');
  assert.equal(await page.evaluate(()=>misApp.transform),b);
  await page.locator('#tab-transform .mis-code-editor').evaluate(el=>{el.misEditor.setValue(el.misEditor.getValue()+'\n(level B edit)');el.misEditor.focus()});
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await page.evaluate(()=>misApp.transform),b);
  await page.locator('.level-item').first().click();
  await page.locator('#tab-transform .mis-code-editor').evaluate(el=>el.misEditor.focus());await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await page.evaluate(()=>misApp.transform),a);
  // An invalid draft is preserved alongside its last executable game.
  await page.locator('[data-tab="source"]').click();
  const draft='This is an unfinished PuzzleScript draft';
  await page.locator('#tab-source .mis-code-editor').evaluate((el,text)=>el.misEditor.setValue(text),draft);
  await page.waitForFunction(text=>misApp.source===text,draft);
  await page.evaluate(()=>misApp.checkpoint());await page.reload();await page.waitForFunction(()=>misApp.recoveryReady);
  assert.equal(await page.evaluate(()=>misApp.source),draft+'\n\n');
  assert.equal(await page.locator('#tab-source .mis-code-editor').evaluate(el=>el.misEditor.getValue()),await page.evaluate(()=>misApp.source));
  assert(await page.evaluate(()=>!!misApp.model&&!!misApp.board));
  assert.match(await page.locator('#source-diag').textContent(),/Errors/);
  assert.deepEqual(errors,[]);
  console.log('mis_level_ownership_browser: ok (delayed simplify, instant switch, per-level editor undo, invalid draft recovery)');
 }finally{if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
})().catch(e=>{console.error(e);process.exitCode=1});
