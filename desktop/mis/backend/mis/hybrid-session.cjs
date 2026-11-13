'use strict';
// One application game, retained native MIS workers plus optional CUDA help.
// findSolution races feasibility. assess preserves the actual MIS effort API
// and may publish an earlier validated witness while CPU scoring continues.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {WorkerClient}=require('./worker-client.cjs'),{NativeMisBackend}=require('./native-backend.cjs'),{GpuAssistant}=require('./gpu-assistant.cjs');
class NativePool {
 constructor({count,engineClient,prepared,source,directory,exe,validation='native',gridMode='local'}){assert(Number.isInteger(count)&&count>=1&&count<=16);Object.assign(this,{engineClient,prepared,source,directory,exe,validation,gridMode});this.slots=Array.from({length:count},(_,index)=>({index,epoch:0,busy:false,client:null}));this.queue=[];this.tasks=new Set();this.stats={submitted:0,completed:0,cancelled:0,restarts:0,peak_active:0,queue_ms:0,grid_ms:0,native_ms:0,validation_ms:0,native_validations:0,js_validations:0,cancelled_queued:0,cancelled_active:0};}
 async start(slot){slot.epoch++;slot.client=new NativeMisBackend({engineClient:this.engineClient,prepared:this.prepared,source:this.source,exe:this.exe,validation:this.validation,gridMode:this.gridMode,log:path.join(this.directory,`native-${slot.index}-${slot.epoch}.log`)});await slot.client.initialize();}
 async initialize(){await Promise.all(this.slots.map(s=>this.start(s)));}
 request(method,board,options,{signal,deadline=Infinity}={}){assert(!this.closed&&this.tasks.size<512,'Native MIS retained capacity512');const j={method,board,options,signal,deadline,queuedAt:performance.now(),cancelled:!!signal?.aborted};const done=new Promise((resolve,reject)=>Object.assign(j,{resolve,reject}));j.done=done;done.catch(()=>{});this.tasks.add(j);this.stats.submitted++;
  j.abort=()=>{j.cancelled=true;if(j.slot)j.slot.client?.kill();this.pump();};signal?.addEventListener('abort',j.abort,{once:true});this.queue.push(j);this.pump();return done;
 }
 stopped(j){return this.closed||j.cancelled||performance.now()>=j.deadline;}
 pump(){
  for(let i=this.queue.length-1;i>=0;i--){const j=this.queue[i];if(this.stopped(j)){this.queue.splice(i,1);this.finish(j,{status:'timeout',cancelled:true});}}
  for(const slot of this.slots){if(this.closed||slot.busy||!this.queue.length)continue;const j=this.queue.shift();slot.busy=true;j.slot=slot;j.startedAt=performance.now();this.stats.queue_ms+=j.startedAt-j.queuedAt;this.stats.peak_active=Math.max(this.stats.peak_active,this.slots.filter(s=>s.busy).length);let attempted=false;
   (async()=>{try{if(!slot.client){this.stats.restarts++;await this.start(slot);}if(this.stopped(j))return {status:'timeout',cancelled:true};attempted=true;return await slot.client[j.method](j.board,j.options);}finally{
    if(attempted&&slot.client.lastTiming){const t=slot.client.lastTiming;for(const k of ['grid_ms','native_ms','validation_ms'])this.stats[k]+=t[k];if(t.validation_kind==='native')this.stats.native_validations++;else if(t.validation_kind.startsWith('js'))this.stats.js_validations++;}
    if(j.cancelled){slot.client?.kill();if(slot.client)await slot.client.client.exited;slot.client=null;}j.slot=null;slot.busy=false;
   }})().then(r=>this.finish(j,this.stopped(j)?{status:'timeout',cancelled:true}:r),e=>this.finish(j,this.stopped(j)?{status:'timeout',cancelled:true}:null,this.stopped(j)?null:e));
  }
 }
 finish(j,r,e){j.signal?.removeEventListener('abort',j.abort);this.tasks.delete(j);this.stats.completed++;if(r?.cancelled){this.stats.cancelled++;this.stats[j.startedAt===undefined?'cancelled_queued':'cancelled_active']++;if(j.startedAt===undefined)this.stats.queue_ms+=performance.now()-j.queuedAt;}e?j.reject(e):j.resolve(r);queueMicrotask(()=>this.pump());}
 async close(){this.closed=true;for(const j of [...this.tasks])j.abort();await Promise.allSettled([...this.tasks].map(j=>j.done));await Promise.all(this.slots.map(s=>s.client?.close()));}
}
class HybridSession {
 constructor({engine=path.join(__dirname,'../engine'),directory,workers=8,gpu=true,gpuOptions={},nativeExe}={}){assert(directory&&!fs.existsSync(directory),'Fresh hybrid session directory required');fs.mkdirSync(directory,{recursive:true});Object.assign(this,{engine,directory,workers,useGpu:gpu,gpuOptions,nativeExe});this.engineClient=new WorkerClient(path.join(__dirname,'engine-worker.cjs'),{engine});this.controllers=new Set();this.tasks=new Set();this.stats={requests:0,cpu_wins:0,gpu_wins:0,early_witnesses:0,gpu_failures:0};}
 async initialize(source){this.source=source;const start=performance.now();this.prepared=await this.engineClient.request({op:'compile',source});this.pool=new NativePool({count:this.workers,engineClient:this.engineClient,prepared:this.prepared,source,directory:this.directory,exe:this.nativeExe});
  // GPU readiness never gates the original CPU worker's admission.
  this.gpuReady=this.useGpu?(async()=>{try{this.assistant=new GpuAssistant({engine:this.engine,directory:path.join(this.directory,'gpu'),...this.gpuOptions});const r=await this.assistant.initialize(source);if(this.closed){await this.assistant.close();return {available:false,reason:'closed'};}this.gpuInfo=r;return r;}catch(e){this.stats.gpu_failures++;return {available:false,reason:e.message};}})():Promise.resolve({available:false,reason:'disabled'});
  await this.pool.initialize();return {backend:'native-mis-with-optional-cuda',cpu_ready_ms:performance.now()-start,levels:this.prepared.levels,optimizer:this.prepared.telemetry};
 }
 gpu(board,options,signal){return this.gpuReady.then(info=>{if(!info.available||signal.aborted||this.closed)return {status:'unknown',reason:info.reason||'cancelled'};return this.assistant.assist(board,{timeoutMs:Math.max(1,Math.min(60000,Math.floor(options.deadline-performance.now()))),maxExpanded:options.maxExpanded||1000000,signal});}).catch(e=>{this.stats.gpu_failures++;return {status:'unknown',reason:e.message};});}
 track(task){this.tasks.add(task);task.finally(()=>this.tasks.delete(task)).catch(()=>{});return task;}
 findSolution(raw,{timeMs=1000,maxExpanded=0,deterministic=false,signal,onWitness}={}){
  assert(!this.closed&&this.pool&&Number.isInteger(timeMs)&&timeMs>0&&timeMs<=60000);const board={w:raw.w,h:raw.h,cells:Array.from(raw.cells)},start=performance.now(),deadline=start+timeMs,controller=new AbortController();this.controllers.add(controller);this.stats.requests++;
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const timer=setTimeout(cancel,timeMs);
  const run=(async()=>{let winner,decision;const choose=(role,r)=>{if(!winner&&!controller.signal.aborted&&performance.now()<=deadline&&(r.status==='solved'||role==='cpu'&&r.status==='unsolvable')){winner={...r,winner:role,observed_ms:performance.now()-start};decision=winner.observed_ms;if(r.status==='solved'){this.stats[role+'_wins']++;onWitness?.(winner);}controller.abort();}};
   // CPU request is enqueued before GPU work is considered.
   const cpu=this.pool.request('solve',board,{strategy:'portfolio',timeMs,maxExpanded,deterministic},{signal:controller.signal,deadline}).then(r=>{choose('cpu',r);return r;});
   const gpu=this.gpu(board,{deadline,maxExpanded},controller.signal).then(r=>{choose('gpu',r);return r;});
   const results=await Promise.allSettled([cpu,gpu]);if(!winner){const error=results.find(r=>r.status==='rejected');if(error)throw error.reason;}
   return {...(winner||{status:'timeout',solution:null,observed_ms:performance.now()-start}),total_ms:performance.now()-start,settlement_ms:decision===undefined?0:performance.now()-start-decision};
  })().finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);this.controllers.delete(controller);});return this.track(run);
 }
 assess(raw,options={},onWitness){assert(!this.closed&&this.pool);const board={w:raw.w,h:raw.h,cells:Array.from(raw.cells)},controller=new AbortController();this.controllers.add(controller);this.stats.requests++;const signal=options.signal;const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const start=performance.now();
  const run=(async()=>{
   const cpu=this.pool.request('assess',board,options,{signal:controller.signal});
   const gpu=this.gpu(board,{deadline:start+60000,maxExpanded:1000000},controller.signal).then(r=>{if(r.status==='solved'&&!controller.signal.aborted){this.stats.early_witnesses++;onWitness?.({...r,observed_ms:performance.now()-start});}return r;});
   try{return await cpu;}finally{controller.abort();await gpu;}
  })().finally(()=>{signal?.removeEventListener('abort',cancel);this.controllers.delete(controller);});return this.track(run);
 }
 async close(){if(this.closed)return;this.closed=true;for(const c of this.controllers)c.abort();await Promise.allSettled([...this.tasks]);await this.gpuReady;await Promise.all([this.pool?.close(),this.assistant?.close()]);await this.engineClient.close();}
}
module.exports={HybridSession,NativePool};
