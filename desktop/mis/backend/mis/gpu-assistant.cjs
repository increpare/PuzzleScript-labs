'use strict';
// Desktop/backend bridge. Positive witnesses only; this is not a replacement
// for MIS effort assessment, shortest-path proofs, or the protected CPU lane.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {WorkerClient}=require('./worker-client.cjs'),{ServiceClient}=require('../cuda/service-client.cjs'),{WallContextCache}=require('../cuda/wall-context-cache.cjs'),{hash}=require('../cuda/prepare.cjs');
const SELECTED_SHA256='75456c484a53c35e14da859d6effd34603663d14d0e7265b66384bedc2ef22a1';
const actions=['up','left','down','right','action'];
class GpuAssistant {
 constructor({engine=path.join(__dirname,'../engine'),reference,exe=path.resolve(__dirname,'../bin',process.platform+'-'+process.arch,'puzzlescript-guided-service'+(process.platform==='win32'?'.exe':'')),directory,capacity=8,contexts=8,deviceMb=6144,keyMb=2048,validationCache=true,sharedClient}){
  assert(directory&&Number.isInteger(capacity)&&capacity>0&&capacity<=128&&Number.isInteger(contexts)&&contexts>0&&contexts<=8);assert.equal(hash(exe),SELECTED_SHA256,'Use the selected verified GPU executable');
  assert(!fs.existsSync(directory),'Use a fresh assistant directory');fs.mkdirSync(directory,{recursive:true});Object.assign(this,{directory,capacity,contexts,deviceMb,keyMb,exe});
  this.engine=new WorkerClient(path.join(__dirname,'engine-worker.cjs'),{engine,validationCache});this.compiler=new WorkerClient(path.join(__dirname,'compiler-worker.cjs'),{reference});this.client=sharedClient||new ServiceClient(exe,path.join(directory,'gpu.log'));
  this.cache=new WallContextCache(this.client,{capacity:contexts});this.shapes=new Map();this.waiting=[];this.active=new Set();this.serial=0;this.closed=false;this.retainedBytes=0;
  this.stats={requests:0,submitted:0,validated:0,deferred:0,validation_ms:0,invalid_witnesses:0,unknown:0,gpu_receipts:0,gpu_expanded:0,peak_active:0,peak_retained:0,peak_bytes:0};
 }
 async request(q){const r=await this.client.request(q);assert(r.ok,r.error);return r.report;}
 async initialize(source){assert(!this.initializing&&!this.prepared&&!this.closed);this.initializing=true;const start=performance.now();try{
  this.prepared=await this.engine.request({op:'compile',source});this.gpuModel=await this.compiler.request({op:'compile',source:this.prepared.source});
  const map=new Map(this.gpuModel.objects.filter(Boolean).map(o=>[o.name,o]));this.objectMap=this.prepared.solver.objects.map(o=>{if(!o)return -1;const target=map.get(o.name);assert(target&&target.layer>=0,'Canonical GPU object mapping: '+o.name);return target.id;});
  assert.equal(this.prepared.solver.layerCount,this.gpuModel.layerCount,'Canonical layer tables differ');
  this.configuration=await this.request({op:'configure',mode:'cuda',parents_per_job:16,gpu_contexts:this.contexts,batch:this.capacity,nodes_per_query:4096,root_count_slots:true,search_mode:'greedy',device_mb:this.deviceMb,key_mb:this.keyMb,waves:4});
  assert(this.configuration.device.hardware&&this.configuration.device.backend==='CUDA','Hardware CUDA execution required');this.initialized=true;
  return {available:true,device:this.configuration.device,setup_ms:performance.now()-start,source_sha256:this.prepared.source_sha256,optimizer:this.prepared.telemetry,engine_sources:this.prepared.sources,gpu_authority:this.gpuModel.authority,levels:this.prepared.levels,original:this.prepared.original,backend:'cuda-positive-assistance',difficulty_score:false};
 }catch(e){await this.close();throw e;}finally{this.initializing=false;}}
 shape(w,h){const key=w+'x'+h;if(!this.shapes.has(key)){assert(this.shapes.size<128,'MIS shape capacity128');const pending=(async()=>{
  const upload=await this.compiler.request({op:'shape',revision:this.gpuModel.revision,w,h,slots:this.capacity});delete upload.initial_boards;
  const file=path.join(this.directory,key+'.json'),boards_file=path.join(this.directory,key+'.psgb'),ow=upload.game[23],stride=256+w*h*ow;
  const bytes=Buffer.alloc(24+this.capacity*stride*4);[0x42475350,1,this.capacity,w,h,ow].forEach((v,i)=>bytes.writeUInt32LE(v,i*4));
  for(let slot=0;slot<this.capacity;slot++)for(let i=0;i<256;i++)bytes.writeUInt32LE(upload.initial[128+i],24+(slot*stride+i)*4);
  fs.writeFileSync(file,JSON.stringify(upload),{flag:'wx'});fs.writeFileSync(boards_file,bytes,{flag:'wx'});return {id:key,file,boards_file};
 })();pending.catch(()=>{});this.shapes.set(key,pending);}return this.shapes.get(key);}
 assist(raw,{timeoutMs=200,maxExpanded=1000000,signal,deferValidation=false}={}){
  assert(typeof deferValidation==='boolean');
  assert(this.initialized&&!this.closed,'Initialize MIS GPU assistant first');assert(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000&&Number.isInteger(maxExpanded)&&maxExpanded>0&&maxExpanded<=1000000);
  assert(raw&&Number.isInteger(raw.w)&&Number.isInteger(raw.h)&&raw.w>0&&raw.h>0&&raw.w*raw.h<=512,'GPU board capacity512 cells');assert(raw.cells&&(Array.isArray(raw.cells)||ArrayBuffer.isView(raw.cells))&&raw.cells.length===raw.w*raw.h*this.prepared.original.stride,'MIS board stride');
  assert(this.waiting.length+this.active.size<512,'MIS retained candidate capacity512');const board={w:raw.w,h:raw.h,cells:Array.from(raw.cells)},bytes=board.cells.length*4+256;assert(this.retainedBytes+bytes<=64*1024*1024,'MIS candidate storage capacity64MiB');
  const j={board,bytes,start:performance.now(),deadline:performance.now()+timeoutMs,maxExpanded,signal,deferValidation,cancelled:false,query:null};
  const done=new Promise((resolve,reject)=>{j.resolve=resolve;j.reject=reject;});j.done=done;done.catch(()=>{});
  j.abort=()=>{j.cancelled=true;if(j.query&&!j.cancelling)j.cancelling=this.request({op:'cancel',query:j.query}).catch(e=>{j.error=e;});this.cache.expire();this.pump();};
  signal?.addEventListener('abort',j.abort,{once:true});if(signal?.aborted)j.cancelled=true;j.timer=setTimeout(j.abort,timeoutMs);this.retainedBytes+=bytes;this.stats.requests++;this.waiting.push(j);this.stats.peak_retained=Math.max(this.stats.peak_retained,this.waiting.length+this.active.size);this.stats.peak_bytes=Math.max(this.stats.peak_bytes,this.retainedBytes);this.pump();return done;
 }
 stopped(j){return this.closed||j.cancelled||performance.now()>=j.deadline;}
 unknown(j,reason){this.stats.unknown++;return {status:'unknown',reason,solution:null,ms:performance.now()-j.start,difficulty_score:false,shortest_path_guaranteed:false};}
 pump(){
  // Expired waiters never have to wait behind a running GPU/validation job.
  for(let i=this.waiting.length-1;i>=0;i--){const j=this.waiting[i];if(this.stopped(j)){this.waiting.splice(i,1);this.finish(j,null,this.unknown(j,'cancelled_or_deadline'));}}
  while(!this.closed&&this.active.size<this.capacity&&this.waiting.length){const j=this.waiting.shift();this.active.add(j);this.stats.peak_active=Math.max(this.stats.peak_active,this.active.size);this.run(j).then(r=>this.finish(j,null,r),e=>this.finish(j,e));}
 }
 finish(j,error,result){clearTimeout(j.timer);j.signal?.removeEventListener('abort',j.abort);this.active.delete(j);this.retainedBytes-=j.bytes;error?j.reject(error):j.resolve(result);queueMicrotask(()=>this.pump());}
 async run(j){let lease;const timing={};try{
  const t=performance.now(),projected=await this.engine.request({op:'project',revision:this.prepared.revision,board:j.board});timing.project_ms=performance.now()-t;if(this.stopped(j))return this.unknown(j,'cancelled_or_deadline');
  const objects=Array(j.board.w*j.board.h*this.gpuModel.stride).fill(0),stride=this.prepared.solver.stride;
  for(let tile=0;tile<j.board.w*j.board.h;tile++)for(let word=0;word<stride;word++){let bits=projected.cells[tile*stride+word]>>>0;while(bits){const bit=31-Math.clz32(bits&-bits),mapped=this.objectMap[word*32+bit];assert(Number.isInteger(mapped)&&mapped>=0,'Missing GPU object provenance');const at=tile*this.gpuModel.stride+(mapped>>>5);objects[at]=(objects[at]|(1<<(mapped&31)))>>>0;bits=(bits&(bits-1))>>>0;}}
  const prepare=performance.now(),group=await this.shape(j.board.w,j.board.h);if(this.stopped(j))return this.unknown(j,'cancelled_or_deadline');lease=await this.cache.acquire(group,()=>this.stopped(j));timing.prepare_ms=performance.now()-prepare;if(!lease||this.stopped(j))return this.unknown(j,'cancelled_or_deadline');
  j.query='mis-'+(++this.serial);const submitted=performance.now();this.stats.submitted++;
  const r=await this.client.submit({query:j.query,handle:lease.handle,root_index:0,objects,strategy:'greedy',executor:'cuda',max_expanded:j.maxExpanded,max_states:1000000,timeout_ms:Math.max(1,Math.floor(j.deadline-submitted))});j.query=null;
  const q=r.report;assert(r.ok&&q.search_engine==='device-guided'&&q.search_mode==='greedy');assert.equal(q.cpu_expanded,0);assert.equal(q.cpu_interpreter_invocations,0);assert.equal(q.gpu_fallbacks,0);assert.equal(q.ordinary_successor_readback_bytes,0);
  if(q.gpu_receipts)assert(r.hardware&&r.kernel_receipts_checked&&r.device.hardware&&r.device.backend==='CUDA');this.stats.gpu_receipts+=q.gpu_receipts;this.stats.gpu_expanded+=q.gpu_expanded;timing.gpu_request_ms=performance.now()-submitted;
  if(this.stopped(j)||q.status!=='candidate_solution')return {...this.unknown(j,this.stopped(j)?'cancelled_or_deadline':q.status),gpu:q,timing};
  assert(q.gpu_receipts>0&&Array.isArray(q.solution));const solution=q.solution.map(a=>{const n=actions.indexOf(a);assert(n>=0,'Invalid GPU solution action');return n;});
  // Generation only uses discovery to admit a CPU assessment. Its scored
  // solution is validated before publication, so replaying this unused path
  // would duplicate work. A deferred result must never claim solved/validated.
  if(j.deferValidation){this.stats.deferred++;return {status:'candidate_solution',solution,ms:performance.now()-j.start,validated_original:false,validation_deferred:true,difficulty_score:false,shortest_path_guaranteed:false,gpu:q,timing};}
  const validate=performance.now(),check=await this.engine.request({op:'validate',revision:this.prepared.revision,board:j.board,solution});timing.validate_ms=performance.now()-validate;this.stats.validation_ms+=timing.validate_ms;
  if(!check.valid){this.stats.invalid_witnesses++;return {...this.unknown(j,'original_engine_rejected'),gpu:q,timing};}
  if(this.stopped(j))return {...this.unknown(j,'cancelled_or_deadline'),gpu:q,timing};this.stats.validated++;
  return {status:'solved',solution,ms:performance.now()-j.start,validated_original:true,validation_engine:check.engine,difficulty_score:false,shortest_path_guaranteed:false,gpu:q,timing};
 }finally{if(j.cancelling)await j.cancelling;if(lease)this.cache.release(lease);}}
 async statistics(){return {...this.stats,active:this.active.size,queued:this.waiting.length,retained_bytes:this.retainedBytes,cache:{...this.cache.stats},gpu:await this.request({op:'info'})};}
 close(){if(this.closing)return this.closing;this.closed=true;for(const j of [...this.waiting,...this.active])j.abort();this.closing=(async()=>{
  const results=await Promise.allSettled([...this.active].map(j=>j.done));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
  try{if(this.initialized){await this.request({op:'drain'});await this.cache.close();}await this.client.close();}catch(e){errors.push(e);this.client.kill();}
  await Promise.all([this.engine.close(),this.compiler.close()]);if(errors.length)this.close_errors=errors.map(e=>e.message);return {closed:true,errors:this.close_errors||[]};})();return this.closing;}
}
module.exports={GpuAssistant,SELECTED_SHA256};
