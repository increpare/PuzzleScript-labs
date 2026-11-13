'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),{LiveGeneration}=require(path.join(root,'desktop/mis/backend/mis/live-generation.cjs'));
const out=path.join(root,'build/gpu-startup-'+Date.now());fs.mkdirSync(out,{recursive:true});
let release,entered=false;
class DelayedAssistant {
 initialize(){entered=true;return new Promise(resolve=>{release=()=>resolve({available:false,reason:'test delayed startup'});});}
 async close(){}
}
(async()=>{const s=new LiveGeneration({engine:root,directory:path.join(out,'session'),workers:1,gpu:true,assistantClass:DelayedAssistant});
 try{const timeout=new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('CPU initialization waited for GPU')),10000);t.unref();});
  const r=await Promise.race([s.initialize(fs.readFileSync(path.join(root,'src/demo/sokoban_basic.txt'),'utf8')),timeout]);assert(entered);assert(!s.exactAvailable);
  const board=r.levels[0].board,result=await s.pool.request('assess',board,{timeMs:1500,refine:false});assert.equal(result.status,'solved');assert(result.validated_original);
  release();assert.equal((await s.gpuReady).available,false);await s.exactReady;assert(!s.exactAvailable);
  console.log('Foreground native initialization and assessment complete while GPU startup is blocked');
 }finally{release?.();await s.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
