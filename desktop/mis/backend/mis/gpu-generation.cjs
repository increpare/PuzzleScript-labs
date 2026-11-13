'use strict';
const path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{FairGeneration}=require('./fair-generation.cjs'),{ExactBfs}=require('./exact-bfs.cjs'),{SharedAssistant}=require('./shared-assistant.cjs'),{FairBroker}=require('./fair-broker.cjs');
class GpuGeneration extends FairGeneration {
 constructor(options){super({...options,boundedDiscovery:true,uncoveredBurst:2,assistantClass:options.assistantClass||SharedAssistant});this.gpuAdmission=new FairBroker({slots:32,capacity:512});this.scoreStats={eligible:0,skipped_cpu_bfs:0,gpu_solved:0,gpu_bounded:0,cpu_fallbacks:0,native_full_fallbacks:0,unsupported:0,not_gated:0,request_ms:0};}
 async initialize(source){const identity=await super.initialize(source);this.exactReady=this.gpuReady.then(async ready=>{if(ready.available&&!this.closed){
  this.exact=new ExactBfs({engine:this.engine,engineClient:this.engineClient,prepared:this.prepared,directory:path.join(this.directory,'gpu-scoring'),client:this.assistant.shared.view('parallel-bfs'),reference:this.gpuOptions.reference,exe:this.assistant.exe,capacity:32,contexts:2});this.exactInfo=await this.exact.initialize(source);this.exactAvailable=true;
 }return this.exactInfo;}).catch(e=>{this.lastGpuError=e.message;return null;});return identity;}
 async scoreCandidate(job,board,options,context,key){
  let shape;try{shape=this.exactAvailable?await this.exact.shape(board.w,board.h):null;}catch(e){this.lastGpuError=e.message;}
  const supported=shape&&!shape.unsupported;
  if(!supported){this.scoreStats.unsupported++;return super.scoreCandidate(job,board,options,context,key);}
  // Release the CPU worker after primary/greedy/A*. A validated partial is
  // retained on the host while other candidates use those same two workers.
  const start=performance.now(),partial=await super.scoreCandidate(job,board,{...options,skipBfs:true},context,key);
  if(partial.status!=='solved'||!partial.refined){this.scoreStats.not_gated++;return partial;}
  // Ordinary helpers ignore the experimental flag and already finish native
  // BFS. Keep that authoritative result; never interpret it as a partial.
  if(partial.bfsDeferred!==true){this.scoreStats.native_full_fallbacks++;return partial;}
  this.scoreStats.eligible++;assert(partial.validated_original);assert(!('bfs'in partial.lanes));const cap=Math.max(1,partial.expanded+6);
  if(cap>1000000){this.scoreStats.unsupported++;return super.scoreCandidate(job,board,options,context,key);}
  const primaryTimeout=options.timeMs??1500,refineTimeout=options.refineTimeMs??(primaryTimeout>0?primaryTimeout:1500);
  const timeout=Math.max(1,Math.min(60000,Math.floor(refineTimeout),Math.floor(this.deadline-performance.now())));
  const gpu=await this.gpuAdmission.submit({base:job.msg.id,context,covered:()=>job.top.length>0,signal:this.signalFor(job),deadline:this.deadline,bytes:board.cells.length*4+512,
   run:()=>this.exact.score(board,{maxExpanded:cap,timeoutMs:timeout,signal:this.signalFor(job),validate:false}).catch(e=>({status:'unknown',reason:'gpu_error',detail:e.message}))});
  this.scoreStats.request_ms+=performance.now()-start;
  if(this.stopped(job)||gpu.cancelled)return {status:'timeout',cancelled:true};
  let count;
  if(gpu.status==='solved'){this.scoreStats.gpu_solved++;count=gpu.expanded;this.scoreStats.skipped_cpu_bfs++;}
  else if(gpu.gpu&&['work_limit','exhausted'].includes(gpu.reason)){this.scoreStats.gpu_bounded++;this.scoreStats.skipped_cpu_bfs++;}
  else{this.scoreStats.cpu_fallbacks++;const fallback=await this.broker.submit({base:job.msg.id,context,covered:()=>job.top.length>0,signal:this.signalFor(job),deadline:this.deadline,bytes:board.cells.length*4+512,
    run:()=>this.scorer.request('solve',board,{strategy:'bfs',timeMs:refineTimeout,maxExpanded:cap,deterministic:options.deterministic},{signal:this.signalFor(job),deadline:this.deadline})});
   if(fallback.cancelled)return fallback;if(fallback.status==='solved')count=fallback.expanded;
  }
  if(count!==undefined){partial.lanes.bfs=count;partial.effort=Math.max(1,Math.min(...Object.values(partial.lanes)));}
  delete partial.bfsDeferred;partial.scoring_backend='shared-cuda-ordered-bfs';partial.bfs_evidence={status:gpu.status,reason:gpu.reason,expanded:gpu.expanded??gpu.gpu?.expanded,cap,timeout_ms:timeout,reference_timeout_ms:refineTimeout,gpu:gpu.gpu};partial.ms=performance.now()-start;return partial;
 }
 async statistics(){return {...await super.statistics(),gpu_score:{...this.scoreStats,admission:this.gpuAdmission.stats,identity:this.exactInfo}};}
 async close(){if(this.closed)return;await this.stop().catch(()=>{});await this.exactReady;await this.exact?.close();this.gpuAdmission.close();await super.close();}
}
module.exports={GpuGeneration};
