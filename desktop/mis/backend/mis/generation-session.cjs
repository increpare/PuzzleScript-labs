'use strict';
// The application's authored generator, asynchronous only at solver calls.
// Protected native/WASM producers retain the MIS score. CUDA discovers further
// candidates; separate native workers assess discoveries with that SAME
// API before any candidate is eligible for the application's shortlist.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {WorkerClient}=require('./worker-client.cjs'),{NativePool}=require('./hybrid-session.cjs'),{GpuAssistant}=require('./gpu-assistant.cjs'),{loadAsyncGenerator}=require('../tools/async-mis-generator.cjs'),{hash}=require('../cuda/prepare.cjs');
const {setMaxListeners}=require('node:events');
const turn=()=>new Promise(r=>setImmediate(r));
const packed=b=>({w:b.w,h:b.h,cells:Array.from(b.cells)});
const timeout=()=>({status:'timeout',expanded:0});

class WasmPool extends NativePool {
 async start(slot){
  slot.epoch++;const worker=new WorkerClient(path.join(__dirname,'engine-worker.cjs'),{engine:this.engine});
  const client={client:{exited:Promise.resolve()},kill(){client.client.exited=worker.close();},close:()=>worker.close()};slot.client=client;
  const p=await worker.request({op:'compile',source:this.source});await worker.request({op:'wasm_initialize',revision:p.revision});
  for(const method of ['solve','assess'])client[method]=(board,options)=>worker.request({op:'wasm_'+method,revision:p.revision,board:packed(board),options},500000);
 }
}

class GenerationSession {
 constructor({engine=path.join(__dirname,'../engine'),directory,workers,backend='native',gpu=false,gpuOptions={},auxStreams=512,nativeExe=path.join(__dirname,'../bin',process.platform+'-'+process.arch,'mis-native-worker'+(process.platform==='win32'?'.exe':'')),onEvaluation,validateDiscovery=false,validationCache=true,scoreWorkers=2,validation='native',gridMode='local',assistantClass=GpuAssistant}={}){
  workers??=gpu?7:8;
  assert(directory&&!fs.existsSync(directory),'Fresh MIS generation directory required');assert(['native','wasm'].includes(backend));assert(!gpu||backend==='native','CUDA assistance requires native scoring');assert(Number.isInteger(auxStreams)&&auxStreams>=1&&auxStreams<=512);
  assert(typeof validateDiscovery==='boolean'&&typeof validationCache==='boolean');
  assert(Number.isInteger(scoreWorkers)&&scoreWorkers>=1&&scoreWorkers<=8);
  fs.mkdirSync(directory,{recursive:true});Object.assign(this,{engine,directory,workers,backend,useGpu:gpu,gpuOptions,auxStreams,nativeExe,onEvaluation,validateDiscovery,validationCache,scoreWorkers,validation,gridMode,assistantClass});
  this.engineClient=new WorkerClient(path.join(__dirname,'engine-worker.cjs'),{engine,validationCache});this.core=require(path.join(engine,'src/js/mis/mis_core.js'));this.analysis=require(path.join(engine,'src/js/mis/mis_transform_analysis.js'));
  this.adapted=loadAsyncGenerator(path.join(engine,'src/js/mis/mis_generator.js'),this.core);this.jobs=[];this.contexts={cpu:[],gpu:[]};this.closed=false;
  this.stats={cpu_assessments:0,gpu_attempts:0,gpu_witnesses:0,aux_assessments:0,aux_solved:0,duplicate_requests:0,gpu_errors:0,candidates:0,late_candidates:0,peak_retained:0,gpu_request_ms:0,aux_assess_ms:0};
  this.pending=new Map();this.recent=new Map();this.recentBytes=0;
 }
 async initialize(source){
  this.source=source;const start=performance.now();this.prepared=await this.engineClient.request({op:'compile',source});
  const data=await this.engineClient.request({op:'generation_model',revision:this.prepared.revision});this.model=data.model;this.ruleQuantity=data.ruleQuantity;
  const opts={count:this.workers,engineClient:this.engineClient,prepared:this.prepared,source,directory:this.directory,exe:this.nativeExe,validation:this.validation,gridMode:this.gridMode};
  this.pool=this.backend==='native'?new NativePool(opts):Object.assign(new WasmPool(opts),{engine:this.engine});
  this.gpuReady=this.useGpu?(async()=>{try{
   this.assistant=new this.assistantClass({engine:this.engine,directory:path.join(this.directory,'gpu'),capacity:128,validationCache:this.validationCache,...this.gpuOptions});const info=await this.assistant.initialize(source);
   if(this.closed)return {available:false,reason:'closed'};
   const scoreDir=path.join(this.directory,'scoring');fs.mkdirSync(scoreDir);this.scorer=new NativePool({...opts,count:this.scoreWorkers,directory:scoreDir});await this.scorer.initialize();return info;
  }catch(e){this.stats.gpu_errors++;return {available:false,reason:e.message};}})():Promise.resolve({available:false,reason:'disabled'});
  await this.pool.initialize();return {backend:this.backend,cpu_ready_ms:performance.now()-start,levels:this.prepared.levels,identity:{engine_sources:this.prepared.sources,adapter:this.adapted.identity,transform_analysis:hash(path.join(this.engine,'src/js/mis/mis_transform_analysis.js')),native:this.backend==='native'?hash(this.nativeExe):undefined}};
 }
 async configure(jobs){
  assert(!this.running&&!this.closed,'Stop generation before replacing jobs');assert(Array.isArray(jobs)&&jobs.length>0&&jobs.length<=1024,'MIS generation job capacity1024');
  const ids=new Set();this.jobs=[];this.contexts={cpu:[],gpu:[]};this.recent.clear();this.recentBytes=0;
  for(const msg of jobs){
   assert((typeof msg.id==='string'||Number.isSafeInteger(msg.id))&&!ids.has(msg.id),'Unique generation job id required');ids.add(msg.id);
   this.jobs.push(await this.createJob(msg));
  }
  const cpuCount=Math.max(this.workers,this.jobs.length),gpuCount=Math.max(this.auxStreams,this.jobs.length);
  // MIS's private sets are bounded already. Auxiliary copies share a declared
  // 64MiB board-key budget, with at least32 entries or explicit rejection.
  for(const role of ['cpu',...(this.useGpu?['gpu']:[])]){
   const count=role==='cpu'?cpuCount:gpuCount;
   for(let i=0;i<count;i++){const job=this.jobs[i%this.jobs.length],bytes=job.base.cells.byteLength*2+128,maxSeen=role==='gpu'?Math.min(20000,Math.floor(64*1024*1024/count/bytes)):job.msg.maxSeen;
    if(role==='gpu')assert(maxSeen>=32,'Auxiliary generator dedupe capacity64MiB exceeded');
    this.contexts[role].push({role,index:i,job,seed:((job.msg.seed>>>0)+i*7919+(role==='gpu'?0x9e3779b9:0))>>>0,maxSeen,steps:0,gen:null});
   }
  }
  return {jobs:this.jobs.length,cpu_contexts:cpuCount,gpu_contexts:this.useGpu?gpuCount:0,retained_capacity:512};
 }
 async createJob(msg){
   assert(!msg.goals?.need?.length&&!msg.goals?.ban?.length,'Rule-goal generation requires the existing MIS JavaScript worker');
   assert(!msg.workClock||msg.pipeline!=='legacy','Work clock needs lazy generation');
   const base=await this.engineClient.request({op:'check_board',revision:this.prepared.revision,board:packed(msg.base)});
   const transforms=msg.transforms?.length?msg.transforms:[{id:'transform',text:msg.transform}],programs=transforms.map(t=>({id:t.id,program:this.core.parseTransform(t.text,this.model)})).filter(t=>!t.program.errors.length&&t.program.statements.length);
   assert(programs.length,'No usable MIS transforms');assert(!msg.frozen||msg.frozen.length===base.w*base.h,'Frozen-cell mask dimensions');
   const certificate=this.analysis.sessionCertificate(this.model,programs.map(p=>p.program),base,{ruleQuantity:this.ruleQuantity,chooseScale:msg.adaptive===true?this.adapted.generator.MAX_CHOOSE_SCALE:1,repeated:msg.parents==='elite'});
   let baselineNotify;const baselineReady=new Promise(r=>{baselineNotify=r;});return {msg:structuredClone(msg),base,programs,certificate,top:[],protectedTop:[],baseline:null,baselineReady,baselineNotify};
 }
 signalFor(job){return job?.controller?.signal||this.controller?.signal;}
 baseline(job){
  if(!job.baseline)job.baseline=(async()=>{const options={timeMs:3000,maxExpanded:400000,...(job.msg.baseEffort>0?{refine:false}:{refineGate:0}),...(job.msg.workClock?{timeMs:120000,primaryMaxExpanded:10000,deterministic:true,refineTimeMs:120000}:{})};
   const r=await this.pool.request('assess',packed(job.base),options,{signal:this.signalFor(job)});
   return {baseEffort:job.msg.baseEffort>0?job.msg.baseEffort:r.status==='solved'?r.effort:0,seedPrimaryMs:r.status==='solved'?(job.msg.workClock?r.expanded/50:r.primaryMs):undefined,result:r};
  })().then(r=>{job.baselineNotify(r);return r;},e=>{job.baselineNotify(null);throw e;});return job.baseline;
 }
 async prepare(){assert(this.jobs.length&&!this.running);const start=performance.now();await Promise.all(this.jobs.map(j=>this.baseline(j)));return {baseline_ms:performance.now()-start};}
 async context(c){if(c.gen)return c.gen;let b;if(c.role==='gpu'){
   // Discovery cannot enqueue another baseline ahead of protected producers.
   const signal=this.signalFor(c.job);let abort;const cancelled=new Promise(r=>{abort=()=>r(null);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
   try{b=await Promise.race([c.job.baselineReady,cancelled]);}finally{signal.removeEventListener('abort',abort);}if(!b)return null;
  }else b=await this.baseline(c.job);const msg=c.job.msg;
  const call=(method,board,options)=>{if(this.stopped(c.job))return Promise.resolve(timeout());if(c.role==='cpu'){this.stats.cpu_assessments++;return this.pool.request(method,packed(board),options,{signal:this.signalFor(c.job),deadline:this.deadline});}assert(method==='assess','GPU discovery does not provide shortest-path proofs');return this.auxiliary(c.job,board,options);};
  c.gen=this.adapted.generator.create({...msg,model:this.model,base:c.job.base,program:c.job.programs[0].program,programs:c.job.programs.length>1?c.job.programs:null,backend:{assess:(b,o)=>call('assess',b,o),solve:(b,o)=>call('solve',b,o)},gate:this.analysis.gate(this.model,c.job.certificate),...b,seed:c.seed,frozen:msg.frozen?Uint8Array.from(msg.frozen):null,maxSeen:c.maxSeen,shard:msg.shardCount>1?{index:msg.shardIndex,count:msg.shardCount}:null});return c.gen;
 }
 stopped(job){return this.closed||this.controller?.signal.aborted||job?.controller?.signal.aborted||performance.now()>=this.deadline;}
 key(job,board){const cells=board.cells instanceof Int32Array?board.cells:Int32Array.from(board.cells);return JSON.stringify([typeof job.msg.id,job.msg.id,job.version??0])+'\0'+board.w+'x'+board.h+'\0'+this.core.cellsKey(cells);}
 auxiliary(job,raw,options){
  const board=packed(raw),key=this.key(job,board);if(this.pending.has(key)){this.stats.duplicate_requests++;return this.pending.get(key);}if(this.recent.has(key)){this.stats.duplicate_requests++;return Promise.resolve(timeout());}
  // A producer waits rather than evicting work that already has a witness.
  if(this.pending.size>=512)return Promise.resolve(timeout());
  const task=(async()=>{this.stats.gpu_attempts++;const t=performance.now();let witness;
   try{witness=await this.assistant.assist(board,{timeoutMs:Math.max(1,Math.min(60000,Math.ceil(this.deadline-t))),maxExpanded:512,signal:this.signalFor(job),deferValidation:!this.validateDiscovery});}catch(e){this.stats.gpu_errors++;return timeout();}
   this.stats.gpu_request_ms+=performance.now()-t;this.onEvaluation?.({role:'gpu',jobId:job.msg.id,board,result:witness,observed_ms:performance.now()-this.began});if(this.stopped(job)||!['solved','candidate_solution'].includes(witness.status))return timeout();assert(witness.status==='solved'?witness.validated_original:!this.validateDiscovery&&witness.validation_deferred===true&&!witness.validated_original);this.stats.gpu_witnesses++;
   const start=performance.now();this.stats.aux_assessments++;const result=await this.scorer.request('assess',board,options,{signal:this.signalFor(job),deadline:this.deadline});this.stats.aux_assess_ms+=performance.now()-start;
   if(result.status==='solved'){assert(result.validated_original);this.stats.aux_solved++;result.discovery='cuda';}return result;
  })().finally(()=>{this.pending.delete(key);this.recent.set(key,true);this.recentBytes+=key.length*2;while(this.recent.size>8192||this.recentBytes>64*1024*1024){const k=this.recent.keys().next().value;this.recent.delete(k);this.recentBytes-=k.length*2;}});
  this.pending.set(key,task);this.stats.peak_retained=Math.max(this.stats.peak_retained,this.pending.size);return task;
 }
 accept(c,found){if(!found)return;if(this.stopped(c.job)){this.stats.late_candidates++;return;}const result=found.result;assert(result.status==='solved'&&result.validated_original&&Number.isFinite(result.effort),'Only MIS-scored original-engine-validated candidates can enter the shortlist');
  const board=packed(found.board),key=this.key(c.job,board),row={jobId:c.job.msg.id,revision:c.job.msg.revision,role:c.role,board,result:structuredClone(result),observed_ms:performance.now()-this.began,key};this.stats.candidates++;
  const insert=list=>{if(list.some(r=>r.key===key))return;list.push(row);list.sort((a,b)=>b.result.effort-a.result.effort||a.key.localeCompare(b.key));list.length=Math.min(list.length,c.job.msg.keep||8);};insert(c.job.top);if(c.role==='cpu')insert(c.job.protectedTop);this.onCandidate?.(row);
 }
 run({durationMs=10000,signal,onCandidate,maxStepsPerContext=Infinity}={}){
  assert(!this.running&&!this.closed&&this.jobs.length&&Number.isInteger(durationMs)&&durationMs>0&&durationMs<=3600000);this.controller=new AbortController();setMaxListeners(1024,this.controller.signal);this.began=performance.now();this.deadline=this.began+durationMs;this.onCandidate=onCandidate;const abort=()=>this.controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,durationMs);
  assert(maxStepsPerContext===Infinity||Number.isInteger(maxStepsPerContext)&&maxStepsPerContext>0&&maxStepsPerContext<=1000000);
  const loop=async(list,slot,concurrency)=>{const assigned=list.filter((_,i)=>i%concurrency===slot);if(!assigned.length)return;const ends=new Map(assigned.map(c=>[c,c.steps+maxStepsPerContext]));for(let cursor=0;!this.stopped();cursor++){
   if(assigned.every(c=>c.steps>=ends.get(c)))break;const c=assigned[cursor%assigned.length];if(c.steps>=ends.get(c))continue;const gen=await this.context(c);if(this.stopped()||!gen)break;this.accept(c,await gen.step());c.steps++;await turn();
  }};
  this.running=(async()=>{const cpu=Array.from({length:this.workers},(_,i)=>loop(this.contexts.cpu,i,this.workers));const gpu=(async()=>{const info=await this.gpuReady;if(info.available&&!this.stopped())await Promise.all(Array.from({length:Math.min(512,this.contexts.gpu.length)},(_,i)=>loop(this.contexts.gpu,i,Math.min(512,this.contexts.gpu.length))));})();
   const tasks=[...cpu,gpu];tasks.forEach(p=>p.catch(abort));const settled=await Promise.allSettled(tasks);const failure=settled.find(r=>r.status==='rejected');if(failure)throw failure.reason;return {elapsed_ms:performance.now()-this.began,stats:{...this.stats},outputs:this.outputs()};
  })().finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.running=null;this.onCandidate=null;});return this.running;
 }
 stop(){this.controller?.abort();return this.running||Promise.resolve();}
 outputs(){return this.jobs.map(j=>({jobId:j.msg.id,top:j.top.map(({key,...r})=>r),protected:j.protectedTop.map(({key,...r})=>r)}));}
 async statistics(){return {controller:{...this.stats},validation:await this.engineClient.request({op:'validation_stats',revision:this.prepared.revision}),native:this.pool.stats,scorer:this.scorer?.stats,gpu:this.assistant?.initialized?await this.assistant.statistics():null,contexts:Object.fromEntries(Object.entries(this.contexts).map(([k,v])=>[k,v.map(c=>({jobId:c.job.msg.id,seed:c.seed,steps:c.steps,stats:c.gen?.stats(),profile:c.gen?.profile(),best:c.gen?.best(),work:c.gen?.work()}))]))};}
 async close(){if(this.closed)return;this.closed=true;await this.stop().catch(()=>{});await this.gpuReady;await Promise.all([this.pool?.close(),this.scorer?.close(),this.assistant?.close()]);await this.engineClient.close();}
}
module.exports={GenerationSession,WasmPool};
