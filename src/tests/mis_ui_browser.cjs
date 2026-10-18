const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const base=process.argv[2]||'http://127.0.0.1:8081';
const output=path.resolve(__dirname,'../../build/mis-ui-checks');
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome'});
 try {
  const p=await browser.newPage({viewport:{width:1360,height:900}}), errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/mis.html?genWorkers=1');
  await p.waitForFunction(()=>document.querySelector('#status-text').textContent.includes('Solvable'));
  // Keyboard menus retain the editor's focus, with a stationary pointer over a command.
  await p.locator('#tab-transform .mis-code-editor').click();
  await p.evaluate(()=>window.previousFocus=document.activeElement);
  await p.mouse.move(60,100);
  await p.keyboard.press('Alt+f');
  assert.equal(await p.locator('#menu-file').isVisible(),true);
  await p.keyboard.press('End');
  assert((await p.evaluate(()=>document.activeElement.textContent)).includes('Choose demo'));
  await p.keyboard.press('Escape');
  assert(await p.evaluate(()=>document.activeElement===window.previousFocus));
  // Both splitters have keyboard sizing, reset and pointer-cancel contracts.
  for(const [id,key] of [['code-splitter','ArrowLeft'],['results-splitter','ArrowUp']]) {
   const h=p.locator('#'+id);await h.focus();
   const before=Number(await h.getAttribute('aria-valuenow'));await p.keyboard.press(key);
   assert.equal(Number(await h.getAttribute('aria-valuenow')),before+10);
   const r=await h.boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2-30,r.y+r.height/2-30);await p.keyboard.press('Escape');await p.mouse.up();
   assert.equal(Number(await h.getAttribute('aria-valuenow')),before+10);
   await p.keyboard.press('Home');
  }
  // The user's two-foot construction transform supplies real native-solver results.
  const game=fs.readFileSync(path.join(__dirname,'fixtures/mis-two-feet/game.txt'),'utf8'),transform=fs.readFileSync(path.join(__dirname,'fixtures/mis-two-feet/transform.txt'),'utf8');
  await p.locator('#file-input').setInputFiles({name:'two-feet.txt',mimeType:'text/plain',buffer:Buffer.from(game+'\n(MIS transform\n'+transform.trim()+'\nMIS end)\n')});
  await p.waitForFunction(()=>document.title.includes('OUTDATED TECH'));
  const boardHeight=(await p.locator('#board-wrap').boundingBox()).height;
  await p.locator('#gen-btn').click();
  await p.waitForFunction(()=>document.querySelectorAll('#cards .card').length>0,null,{timeout:45000});
  assert.equal((await p.locator('#board-wrap').boundingBox()).height,boardHeight);
  await p.locator('#cards .card').first().hover();
  await p.evaluate(()=>{window.heldCard=document.querySelector('#cards .card');window.heldSource=misApp.source;window.generated=misApp.gen.stats.reduce((n,s)=>n+(s?s.generated:0),0)});
  await p.waitForFunction(()=>misApp.gen.stats.reduce((n,s)=>n+(s?s.generated:0),0)>window.generated,null,{timeout:15000});
  assert(await p.evaluate(()=>window.heldCard===document.querySelector('#cards .card')&&window.heldSource===misApp.source));
  const pin=p.locator('#cards .card').first().locator('.pin-card');await pin.click();
  assert.equal(await pin.getAttribute('aria-pressed'),'true');
  assert(await p.evaluate(()=>document.activeElement===window.heldCard.querySelector('.pin-card')));
  await p.locator('#gen-btn').click();
  await p.screenshot({path:output+'/results.png'});
  // CSS work areas corresponding to enlargement, plus DPR rasterization.
  const layouts=[];
  for(const scale of [1,1.25,1.5,2]) {
   const context=await browser.newContext({viewport:{width:Math.round(1360/scale),height:Math.round(900/scale)},deviceScaleFactor:scale});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/mis.html');await page.waitForFunction(()=>document.querySelector('#board').width>10);
   const report=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,board:document.querySelector('#board').getBoundingClientRect().toJSON(),wrap:document.querySelector('#board-wrap').getBoundingClientRect().toJSON(),footer:document.querySelector('.side-actions').getBoundingClientRect().toJSON(),editor:document.querySelector('#tab-transform .editor-box').getBoundingClientRect().toJSON()}));
   assert(report.pageWidth<=report.width+1,JSON.stringify(report));
   assert(report.board.left>=report.wrap.left&&report.board.right<=report.wrap.right+1);
   assert(report.board.top>=report.wrap.top&&report.board.bottom<=report.wrap.bottom+1);
   assert(report.editor.height>=100,JSON.stringify(report));
   await page.locator('#peek-btn').scrollIntoViewIfNeeded();assert(await page.locator('#peek-btn').isVisible());
   await page.screenshot({path:output+'/layout-'+scale+'.png',fullPage:true});layouts.push({scale,width:report.width,editorHeight:report.editor.height});
   await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({menus:true,splitters:true,stableResults:true,hoverKeepsSource:true,pinFocus:true,layouts,errors}));
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
