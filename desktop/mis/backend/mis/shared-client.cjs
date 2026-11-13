'use strict';
const path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{ServiceClient}=require('../cuda/service-client.cjs'),{FairBroker}=require('./fair-broker.cjs');
// Both policies use ONE GPU owner, arena and pool budget. The two views share
// the existing128 admitted-query limit; scoring does not create a second arena.
class SharedClient {
 constructor(exe,directory,{scoreParents=1}={}){assert(Number.isInteger(scoreParents)&&scoreParents>=1&&scoreParents<=16);Object.assign(this,{exe,directory,scoreParents});this.pending=new Map();this.broker=new FairBroker({slots:128,capacity:512});}
 ensure(){return this.client??=new ServiceClient(this.exe,path.join(this.directory,'shared-gpu.log'));}
 view(mode){const owner=this;return {
  async request(request){
   if(request.op==='cancel'&&owner.pending.has(request.query)){owner.pending.get(request.query).abort();return {ok:true,report:null};}
   const r=await owner.ensure().request(request.op==='load'?{...request,search_mode:mode,...(mode==='parallel-bfs'&&owner.scoreParents!==1?{scoring_parents:owner.scoreParents}:{})}:request);
   if(r.ok&&request.op==='info')r.report.shared_admission={...owner.broker.stats,active:owner.broker.active.size,queued:owner.broker.queue.length};return r;
  },
  async submit(request){
   assert(!owner.pending.has(request.query));const controller=new AbortController(),deadline=performance.now()+request.timeout_ms;owner.pending.set(request.query,controller);
   const timer=setTimeout(()=>controller.abort(),request.timeout_ms);
   try{const result=await owner.broker.submit({base:mode,covered:()=>false,signal:controller.signal,deadline,bytes:256+4*(request.objects?.length||0),run:()=>{
    owner.pending.delete(request.query);return owner.ensure().submit({...request,timeout_ms:Math.max(1,Math.floor(deadline-performance.now()))});}});
    if(result.cancelled)return {ok:true,hardware:false,kernel_receipts_checked:false,report:{status:'cancelled',search_engine:mode==='parallel-bfs'?'device-exact-bfs':'device-guided',search_mode:mode,gpu_receipts:0,gpu_expanded:0,cpu_expanded:0,cpu_interpreter_invocations:0,gpu_fallbacks:0,ordinary_successor_readback_bytes:0}};
    return result;
   }finally{clearTimeout(timer);owner.pending.delete(request.query);}
  },
  async close(){if(mode==='greedy'){assert(!owner.pending.size);owner.broker.close();await owner.ensure().close();}},
  kill(){owner.client?.kill();}
 };}
}
module.exports={SharedClient};
