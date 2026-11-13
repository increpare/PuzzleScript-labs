'use strict';
// Electron-independent host. Trusted-origin checking belongs to the Electron
// boundary; source/board limits, ownership and cancellation live here.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {LiveGeneration}=require('./live-generation.cjs'),{NativePool}=require('./hybrid-session.cjs');
class DesktopBackend {
 constructor({engine,directory,workers,scoreWorkers=2,gpu=true,gpuOptions={},auxStreams=512,nativeExe=path.join(__dirname,'../bin',process.platform+'-'+process.arch,'mis-native-worker'+(process.platform==='win32'?'.exe':'')),onEvent}){workers??=gpu?7:8;assert(!fs.existsSync(directory),'Fresh desktop backend directory required');fs.mkdirSync(directory,{recursive:true});Object.assign(this,{engine,directory,workers,scoreWorkers,gpu,gpuOptions,auxStreams,nativeExe,onEvent});this.games=new Map();this.views=new Map();this.draining=new Set();this.retiringGames=new Set();this.serial=0;this.closed=false;}
 async open({source}){assert(!this.closed&&typeof source==='string'&&Buffer.byteLength(source)<=768*1024,'Native source capacity768KiB');assert(this.views.size<64,'Desktop worker capacity64');const key=crypto.createHash('sha256').update(source).digest('hex');let game=this.games.get(key);
  if(!game){assert(this.games.size+this.retiringGames.size<3,'Desktop compiled game capacity3');game={key,views:new Set(),source};this.games.set(key,game);const directory=path.join(this.directory,'game-'+(++this.serial));
   game.live=new LiveGeneration({engine:this.engine,directory,workers:this.workers,scoreWorkers:this.scoreWorkers,gpu:this.gpu,gpuOptions:this.gpuOptions,auxStreams:this.auxStreams,nativeExe:this.nativeExe,onEvent:e=>{const v=this.views.get(e.owner);if(v&&!v.closed){const {owner,...message}=e;this.onEvent?.({handle:v.id,message});}}});
   game.ready=(async()=>{await game.live.initialize(source);const focus=path.join(directory,'foreground');fs.mkdirSync(focus);game.focus=new NativePool({count:2,engineClient:game.live.engineClient,prepared:game.live.prepared,source,directory:focus,exe:this.nativeExe});await game.focus.initialize();game.metadata=await game.live.engineClient.request({op:'generation_model',revision:game.live.prepared.revision});return game;})();game.ready.catch(()=>{});
  }
  const id=crypto.randomUUID(),view={id,game,closed:false,operations:new Map(),tasks:new Set()};this.views.set(id,view);game.views.add(id);
  try{await game.ready;if(view.closed)return {available:false,reason:'closed'};return {available:true,handle:id,backend:'native',note:'native C++; optional CUDA discovery',optimization:game.live.prepared.telemetry,ruleTags:game.metadata.ruleTags,ruleQuantity:game.metadata.ruleQuantity};}
  catch(e){await this.closeView(id);return {available:false,reason:e.message};}
 }
 view(id){const v=this.views.get(id);assert(v&&!v.closed&&!this.closed,'Unknown or closed desktop worker');return v;}
 async command({handle,message}){const v=this.view(handle);assert(message&&typeof message.type==='string');const g=await v.game.ready;if(v.closed)throw Error('Closed desktop worker');
  if(message.type==='generationJobs'){
   assert(Array.isArray(message.jobs)&&message.jobs.length<=1024);const native=[],fallback=[];for(const j of message.jobs){if(j.goals?.need?.length||j.goals?.ban?.length)fallback.push(j);else native.push(j);}
   try{await g.live.assign(v.id,native);return {fallbackJobs:fallback};}catch(e){await g.live.assign(v.id,[]);return {fallbackJobs:message.jobs,reason:e.message};}
  }
  assert(message.type==='assess'||message.type==='prove','Unsupported desktop operation');assert(Number.isSafeInteger(message.id)&&!v.operations.has(message.id)&&v.operations.size<16,'Desktop request identity/capacity');
  const controller=new AbortController();v.operations.set(message.id,controller);const options={...message.opts},board=message.board;let witness;
  const emit=r=>{if(!v.closed&&!controller.signal.aborted){witness={status:'solved',solution:r.solution,length:r.solution.length,lanes:{},optimal:false,deep:false,difficulty_pending:true,validated_original:true};this.onEvent?.({handle:v.id,message:{type:'progress',id:message.id,witness}});}};
  // CPU is admitted immediately. Waiting for GPU startup must never delay a
  // quick CPU completion; later GPU callbacks are invalidated by this signal.
  const cpu=g.focus.request(message.type==='assess'?'assess':'solve',board,message.type==='prove'?{...options,strategy:'bfs'}:options,{signal:controller.signal});
  if(message.type==='assess'){
   const task=g.live.gpuReady.then(info=>{if(!info.available||v.closed||controller.signal.aborted)return;return g.live.assistant.assist(board,{timeoutMs:60000,maxExpanded:1000000,signal:controller.signal}).then(r=>{if(r.status==='solved')emit(r);});}).catch(()=>{}).finally(()=>v.tasks.delete(task));v.tasks.add(task);
  }
  const task=(async()=>{try{let r=await cpu;if(v.closed||controller.signal.aborted)return {cancelled:true};if(witness&&r.status!=='solved')r={...witness,assessment_status:r.status};return {message:{type:message.type==='assess'?'assessed':'proved',id:message.id,result:r}};}finally{controller.abort();v.operations.delete(message.id);}})();v.tasks.add(task);task.finally(()=>v.tasks.delete(task)).catch(()=>{});return task;
 }
 closeView(id){const v=this.views.get(id);if(!v)return Promise.resolve();v.closed=true;this.views.delete(id);v.game.views.delete(id);for(const c of v.operations.values())c.abort();
  const close=(async()=>{try{await v.game.ready;await v.game.live.assign(id,[]);}catch{}await Promise.allSettled([...v.tasks]);if(!v.game.views.size)await this.retire(v.game);})();this.draining.add(close);close.finally(()=>this.draining.delete(close)).catch(()=>{});return close;
 }
 retire(game){if(game.closing)return game.closing;if(this.games.get(game.key)===game)this.games.delete(game.key);this.retiringGames.add(game);game.closing=Promise.all([game.live.close(),game.focus?.close()]).finally(()=>this.retiringGames.delete(game));return game.closing;}
 async diagnostics(){return {views:this.views.size,games:this.games.size,draining:this.draining.size,backends:await Promise.all([...this.games.values()].map(async g=>{await g.ready;return {source:g.key,jobs:g.live.entries.size,foreground:g.focus.stats,generation:await g.live.statistics()};}))};}
 close(){if(this.closing)return this.closing;this.closed=true;this.closing=(async()=>{await Promise.allSettled([...this.views.keys()].map(id=>this.closeView(id)));await Promise.allSettled([...this.draining]);})();return this.closing;}
}
module.exports={DesktopBackend};
