const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
 let server, browser;
 try {
  const { serve } = await import('../../scripts/gui95-serve.mjs');
  ({server} = await serve({root:path.resolve(__dirname,'..'),entry:'mis.html',host:'127.0.0.1',port:0}));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({channel:'chrome'});
  const page = await browser.newPage({viewport:{width:1360,height:900}});
  page.setDefaultTimeout(12000);
  const output=path.resolve(__dirname,'../../build/mis-level-checks');fs.mkdirSync(output,{recursive:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto(base+'/mis.html?genWorkers=1');
  await page.waitForFunction(()=>window.misApp?.model);
  assert.equal(await page.locator('#new-level').count(),1,'New belongs beside Duplicate');
  const source=fs.readFileSync(path.join(__dirname,'../demo/sokoban_basic.txt'),'utf8').replace(/(\nLEVELS\s*\n=+)[\s\S]*/,'$1\n\n...\n...\n...\n\n...\n...\n...\n...\n');
  const transform='choose 1 [ no Crate no Player no Target ] -> [ Player ]\nchoose 1 [ no Crate no Player no Target ] [ no Crate no Player no Target ] -> [ Crate ] [ Target ]';
  await page.locator('#file-input').setInputFiles({name:'batch.txt',mimeType:'text/plain',buffer:Buffer.from(source+'\n(MIS transform\n'+transform+'\nMIS end)\n')});
  await page.waitForFunction(()=>misApp.fileName==='batch.txt');
  await page.locator('#gen-btn').click();
  await page.waitForFunction(()=>misApp.cards.length>0);
  const first=await page.evaluate(()=>({id:misApp.gen.id,transform:misApp.transform,source:misApp.source}));
  await page.locator('.level-item').nth(1).click();
  assert.equal(await page.evaluate(()=>misApp.gen),null,'selection alone does not start a job');
  await page.locator('#gen-btn').click();
  await page.waitForFunction(()=>misApp.cards.length>0);
  assert.equal(await page.locator('.generation-badge.running').count(),2);
  assert.match(await page.locator('#generation-summary').textContent(),/2 levels generating/);
  assert.equal(await page.evaluate(()=>misApp.generationPool.activeCount()),2);
  assert.equal(await page.evaluate(()=>misApp.generationPool.workerCount()),1,'one shared worker');
  const second=await page.evaluate(()=>misApp.gen.id);
  await page.screenshot({path:path.join(output,'running-levels.png'),fullPage:true});
  await page.locator('.level-item').first().click();
  assert.equal(await page.evaluate(()=>misApp.gen.id),first.id);
  assert.equal(await page.locator('#tab-transform .mis-code-editor').evaluate(el=>el.misEditor.getValue()),first.transform);
  assert.equal(await page.evaluate(()=>misApp.transform),first.transform);
  assert(await page.evaluate(()=>misApp.cards.every(c=>c.levelIndex===0)));
  // Writing an original-ID combination may add a legend glyph; other jobs and
  // their collections must survive both insertion and its undo.
  await page.evaluate(()=>{
   const b=MISCore.cloneBoard(misApp.board),m=misApp.model;
   MISCore.placeObject(m,b.cells,0,m.names.player.ids[0]);MISCore.placeObject(m,b.cells,0,m.names.target.ids[0]);MISCore.placeObject(m,b.cells,b.h,m.names.crate.ids[0]);
   const r=MISCore.assess(m,b,{timeMs:1000});if(r.status!=='solved')throw new Error('legend fixture must solve');
   misApp.cards=[{key:'legend-fixture',board:b,result:r,baseKey:misApp.gen.baseKey,levelIndex:0,objects:3,diff:2}];
   document.querySelector('#rank-select').dispatchEvent(new Event('change'));
   document.querySelector('.card .add-level-card').click();
  });
  assert.equal(await page.evaluate(()=>misApp.model.levels.length),3);
  assert.equal(await page.evaluate(()=>misApp.workspaces[2].gen.running),true);
  assert(await page.evaluate(()=>misApp.workspaces[2].cards.length>0));
  await page.locator('#undo-btn').click();
  assert.equal(await page.evaluate(()=>misApp.model.levels.length),2);
  assert.equal(await page.evaluate(()=>misApp.workspaces[1].gen.running),true);
  assert(await page.evaluate(()=>misApp.workspaces[1].cards.length>0));
  await page.locator('.level-item').nth(1).locator('.generation-badge').click();
  assert.equal(await page.evaluate(()=>misApp.levelIndex),0,'badge does not select');
  assert.equal(await page.evaluate(()=>misApp.generationPool.activeCount()),1);
  assert.equal(await page.evaluate(()=>misApp.gen.running),true);
  // A changed transform invalidates a paused shortlist, including pins.
  await page.locator('#gen-btn').click();
  await page.locator('.card .pin-card').first().click();
  await page.locator('#tab-transform .mis-code-editor').evaluate(el=>el.misEditor.setValue(el.misEditor.getValue()+'\nchoose 1 [ no Wall no Crate no Player ] -> [ Wall ]'));
  assert.equal(await page.evaluate(()=>misApp.cards.length),0,'paused candidates must follow changed transform');
  assert.equal(await page.evaluate(()=>misApp.pinned.length),0,'paused pins must follow changed transform');
  await page.locator('#tab-transform .mis-code-editor').evaluate((el,text)=>el.misEditor.setValue(text),first.transform);
  await page.locator('#gen-btn').click();
  // Undo while generating must reconcile the worker's seed as well as the board.
  await page.locator('[data-resize="right"]').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>misApp.gen.base.w),4);
  await page.locator('#undo-btn').click();
  assert.equal(await page.evaluate(()=>misApp.board.w),3);
  assert.equal(await page.evaluate(()=>misApp.gen.base.w),3);
  assert.equal(await page.evaluate(()=>misApp.gen.running),true);
  await page.locator('#new-level').click();
  await page.locator('#new-width').fill('4');await page.locator('#new-height').fill('5');
  await page.screenshot({path:path.join(output,'new-level.png')});
  await page.locator('#create-level').click();
  await page.waitForFunction(()=>misApp.board.w===4&&misApp.board.h===5);
  assert.equal(await page.evaluate(()=>misApp.transform),first.transform);
  assert.equal(await page.evaluate(()=>misApp.generationPool.activeCount()),1,'insertion preserves other jobs');
  assert.equal(await page.evaluate(()=>misApp.model.levels.length),3);
  // Resize in a single undo step, with locks carried to the corresponding cells.
  await page.evaluate(()=>{misApp.locks[misApp.levelIndex][0]=1});
  await page.locator('[data-resize="left"]').focus();await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(()=>misApp.board.w),5);
  assert.equal(await page.evaluate(()=>misApp.locks[misApp.levelIndex][misApp.board.h]),1);
  await page.locator('#undo-btn').click();
  assert.equal(await page.evaluate(()=>misApp.board.w),4);
  assert.equal(await page.evaluate(()=>misApp.locks[misApp.levelIndex][0]),1);
  const handle=await page.locator('[data-resize="bottom-right"]').boundingBox();
  const cell=await page.evaluate(()=>document.querySelector('#board').getBoundingClientRect().width/misApp.board.w);
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+cell,handle.y+handle.height/2+cell);
  await page.screenshot({path:path.join(output,'resize.png')});
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await page.evaluate(()=>misApp.board.w),4,'Escape cancels resize');
  // Per-level transforms survive selection and insertion, and Add preserves its seed.
  await page.locator('.level-item').first().click();
  await page.waitForFunction(()=>misApp.cards.length>0);
  const seed=await page.evaluate(()=>MISCore.cellsKey(misApp.board.cells));
  await page.locator('.card .add-level-card').first().click();
  assert.equal(await page.evaluate(()=>misApp.model.levels.length),4);
  await page.locator('.level-item').first().click();
  assert.equal(await page.evaluate(()=>MISCore.cellsKey(misApp.board.cells)),seed);
  assert.equal(await page.evaluate(()=>misApp.gen.running),true);
  // Force the same checkpoint used by the timer, then reload into paused recovered results.
  await page.evaluate(()=>misApp.checkpoint());
  await page.reload();
  await page.waitForFunction(()=>misApp.recoveryReady);
  assert.equal(await page.evaluate(()=>misApp.fileName),'batch.txt');
  assert(await page.evaluate(()=>Object.values(misApp.workspaces).some(s=>s.cards.length>0)));
  assert.equal(await page.evaluate(()=>misApp.generationPool?.activeCount()||0),0);
  // Equal cell bitsets on different board shapes must not share a solve proof.
  const shapes=source.replace(/(\nLEVELS\s*\n=+)[\s\S]*/,'$1\n\n.P*O\n\n.*\nPO\n');
  await page.locator('#file-input').setInputFiles({name:'shapes.txt',mimeType:'text/plain',buffer:Buffer.from(shapes)});
  await page.waitForFunction(()=>misApp.fileName==='shapes.txt'&&document.querySelector('#status-text').textContent.includes('Solvable'));
  await page.locator('.level-item').nth(1).click();
  await page.waitForFunction(()=>document.querySelector('#status-text').textContent.includes('Unsolvable'),null,{timeout:3000});
  const out=path.resolve(__dirname,'../../build/mis-level-checks');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'levels.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('mis_levels_browser: ok (two jobs, selection, per-level pause, shared pool, insertion, resize undo/cancel, add, recovery)');
 } finally {if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
