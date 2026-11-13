'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {WorkerClient}=require('./worker-client.cjs'),{ServiceClient}=require('../cuda/service-client.cjs'),{WallContextCache}=require('../cuda/wall-context-cache.cjs'),{hash}=require('../cuda/prepare.cjs'),{boardGrid}=require('./board-grid.cjs');
const actions=['up','left','down','right','action'];
class ExactBfs {
 constructor({engine=path.join(__dirname,'../engine'),directory,exe=path.join(__dirname,'../bin',process.platform+'-'+process.arch,'puzzlescript-guided-service.exe'),capacity=32,contexts=2,deviceMb=1024,keyMb=512,nodes=4096,engineClient,prepared,client,reference}={}){
  assert(directory&&!fs.existsSync(directory)&&capacity>=1&&capacity<=128);fs.mkdirSync(directory,{recursive:true});
  Object.assign(this,{engine,directory,exe,capacity,contexts,deviceMb,keyMb,nodes,prepared});
  this.ownEngine=!engineClient;this.engineClient=engineClient||new WorkerClient(path.join(__dirname,'engine-worker.cjs'),{engine});
  this.compiler=new WorkerClient(path.join(__dirname,'compiler-worker.cjs'),{reference});this.ownClient=!client;this.client=client||new ServiceClient(exe,path.join(directory,'gpu.log'));this.cache=new WallContextCache(this.client,{capacity:contexts});this.shapes=new Map();this.active=new Set();this.serial=0;
 }
 async request(q){const r=await this.client.request(q);assert(r.ok,r.error);return r.report;}
 async initialize(source){
  this.prepared??=await this.engineClient.request({op:'compile',source});this.model=await this.compiler.request({op:'compile',source:this.prepared.source});
  const names=new Map(this.model.objects.filter(Boolean).map(o=>[o.name,o]));this.map=this.prepared.solver.objects.map(o=>o?names.get(o.name)?.id:-1);assert(this.map.every(Number.isInteger));
  this.configuration=await this.request(this.ownClient?{op:'configure',mode:'cuda',search_mode:'parallel-bfs',parents_per_job:1,batch:this.capacity,gpu_contexts:this.contexts,nodes_per_query:this.nodes,device_mb:this.deviceMb,key_mb:this.keyMb,waves:4}:{op:'info'});
  assert(this.configuration.device.hardware&&this.configuration.device.backend==='CUDA');return {device:this.configuration.device,exe_sha256:hash(this.exe),authority:this.model.authority};
 }
 shape(w,h){const id=w+'x'+h;if(!this.shapes.has(id)){assert(this.shapes.size<128);const task=(async()=>{
  if(w*h>512)return {unsupported:'GPU capacity: at most 512 cells'};
  const upload=await this.compiler.request({op:'shape',revision:this.model.revision,w,h,slots:this.capacity});delete upload.initial_boards;const g=upload.game;
  // First scoring subset: deterministic games. AGAIN settles through the
  // existing bounded interpreter continuation. History-changing commands and
  // exceptional edges need a separate native scoring parity proof.
  for(let i=0;i<g[7];i++)if(g[g[13]+i*4+2])return {unsupported:'random rule group'};
  for(let i=0;i<g[9];i++)if(g[g[14]+i*8+3]&~20)return {unsupported:'command other than win/again'};
  for(let i=0;i<g[10];i++){const p=g[16]+i*18;if(g[p+17])continue;
   for(const [field,n]of [[15,g[23]],[16,g[24]]])for(let j=0;j<n;j++)if(g[g[p+field]+j])return {unsupported:'random replacement or direction'};
  }
  const file=path.join(this.directory,id+'.json'),boards_file=path.join(this.directory,id+'.psgb'),stride=256+w*h*g[23],bytes=Buffer.alloc(24+this.capacity*stride*4);
  [0x42475350,1,this.capacity,w,h,g[23]].forEach((v,i)=>bytes.writeUInt32LE(v,i*4));
  for(let slot=0;slot<this.capacity;slot++)for(let i=0;i<256;i++)bytes.writeUInt32LE(upload.initial[128+i],24+4*(slot*stride+i));
  fs.writeFileSync(file,JSON.stringify(upload),{flag:'wx'});fs.writeFileSync(boards_file,bytes,{flag:'wx'});return {id,file,boards_file};
 })();task.catch(()=>{});this.shapes.set(id,task);}return this.shapes.get(id);}
 score(board,options){const task=this.run(board,options);this.active.add(task);task.finally(()=>this.active.delete(task)).catch(()=>{});return task;}
 async run(board,{maxExpanded,maxStates=this.nodes,timeoutMs=60000,signal,validate=true}={}){
  assert(Number.isInteger(maxExpanded)&&maxExpanded>0&&maxExpanded<=1000000);assert(Number.isInteger(maxStates)&&maxStates>0&&maxStates<=this.nodes);assert(timeoutMs>0&&timeoutMs<=60000);assert(this.active.size<this.capacity,'Use bounded shared admission before GPU scoring');
  const start=performance.now(),deadline=start+timeoutMs,unknown=reason=>({status:'unknown',reason,exact_score:false,ms:performance.now()-start});
  boardGrid(this.prepared,board);const group=await this.shape(board.w,board.h);if(group.unsupported)return unknown(group.unsupported);let lease,query,cancelling;
  const stop=()=>this.closed||signal?.aborted||performance.now()>=deadline;
  const cancel=()=>{if(query&&!cancelling)cancelling=this.request({op:'cancel',query});this.cache.expire();};
  const timer=setTimeout(cancel,timeoutMs);signal?.addEventListener('abort',cancel,{once:true});
  try{lease=await this.cache.acquire(group,stop);if(!lease||stop())return unknown('cancelled_or_deadline');
   const objects=Array(board.w*board.h*this.model.stride).fill(0),p=this.prepared;
   for(let tile=0;tile<board.w*board.h;tile++)for(let word=0;word<p.original.stride;word++){let bits=board.cells[tile*p.original.stride+word]>>>0;while(bits){const old=word*32+31-Math.clz32(bits&-bits),id=p.idMap[old];if(id>=0){const target=this.map[id];assert(target>=0);objects[tile*this.model.stride+(target>>>5)]|=1<<(target&31);}bits=(bits&(bits-1))>>>0;}}
   query='score-'+(++this.serial);const r=await this.client.submit({query,handle:lease.handle,objects:objects.map(n=>n>>>0),strategy:'parallel-bfs',executor:'cuda',max_expanded:maxExpanded,max_states:maxStates,timeout_ms:Math.max(1,Math.floor(deadline-performance.now()))});query=null;
   const q=r.report;assert(r.ok&&q.search_engine==='device-exact-bfs'&&q.search_mode==='parallel-bfs');assert.equal(q.cpu_expanded,0);assert.equal(q.cpu_interpreter_invocations,0);assert.equal(q.gpu_fallbacks,0);assert.equal(q.ordinary_successor_readback_bytes,0);
   if(q.gpu_receipts)assert(r.hardware&&r.kernel_receipts_checked&&r.device.hardware&&r.device.backend==='CUDA');
   if(stop()||q.status!=='candidate_solution')return {...unknown(stop()?'cancelled_or_deadline':q.status),gpu:q};
   assert(q.gpu_receipts>0);const solution=q.solution.map(a=>{const n=actions.indexOf(a);assert(n>=0);return n;});
   if(validate){const check=await this.engineClient.request({op:'validate',revision:p.revision,board:{...board,cells:Array.from(board.cells)},solution});assert(check.valid,'Exact GPU BFS path rejected by original engine');}
   return {status:'solved',expanded:q.expanded,solution,exact_score:true,validated_original:validate,gpu:q,ms:performance.now()-start};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(cancelling)await cancelling;if(lease)this.cache.release(lease);}
 }
 async statistics(){return this.request({op:'info'});}
 async close(){this.closed=true;if(this.ownClient)await this.request({op:'cancel_all'});this.cache.expire();await Promise.allSettled([...this.active]);if(this.ownClient)await this.request({op:'drain'});await this.cache.close();await this.client.close();await this.compiler.close();if(this.ownEngine)await this.engineClient.close();}
}
module.exports={ExactBfs};
