'use strict';
const {GenerationSession}=require('./generation-session.cjs'),{FairBroker}=require('./fair-broker.cjs'),{DiscoveryCache}=require('./discovery-cache.cjs'),{loadAsyncGenerator}=require('../tools/async-mis-generator.cjs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const packed=b=>({w:b.w,h:b.h,cells:Array.from(b.cells)}),stopped=()=>({status:'timeout',cancelled:true});
class FairGeneration extends GenerationSession {
 constructor(options){super(options);this.boundedDiscovery=options.boundedDiscovery===true;this.observeScoringState=options.observeScoringState===true;this.thresholdStats={requests:0,privateEliteFull:0,localShortlistFull:0,globalShortlistFull:0,eliteCounts:Array(17).fill(0),localFloorBins:Array(32).fill(0)};this.broker=new FairBroker({slots:this.scoreWorkers,uncoveredBurst:options.uncoveredBurst||8});this.assessmentCache=new Map();this.assessmentBytes=0;
  if(this.boundedDiscovery)this.discoveryCache=new DiscoveryCache();
  if(this.boundedDiscovery||options.observeScoringState)this.adapted=loadAsyncGenerator(path.join(this.engine,'src/js/mis/mis_generator.js'),this.core,performance,{boundedDiscovery:this.boundedDiscovery,observeScoringState:options.observeScoringState===true});
 }
 async context(c){
  if(c.role==='cpu'||c.gen)return super.context(c);
  const signal=this.signalFor(c.job);let abort;const cancelled=new Promise(resolve=>{abort=()=>resolve(null);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  let baseline;try{baseline=await Promise.race([c.job.baselineReady,cancelled]);}finally{signal.removeEventListener('abort',abort);}if(!baseline)return null;
  const msg=c.job.msg;
  c.gen=this.adapted.generator.create({...msg,model:this.model,base:c.job.base,program:c.job.programs[0].program,programs:c.job.programs.length>1?c.job.programs:null,
   backend:{assess:(board,options)=>{if(this.observeScoringState){const s=c.gen.scoringState(),t=this.thresholdStats;t.requests++;t.privateEliteFull+=+s.eliteFull;t.localShortlistFull+=+s.localFull;t.globalShortlistFull+=+(c.job.top.length>=(c.job.msg.keep||8));t.eliteCounts[Math.min(16,s.eliteCount)]++;t.localFloorBins[s.localFloor?Math.min(31,1+Math.floor(Math.log2(s.localFloor))):0]++;}return this.stopped(c.job)?Promise.resolve(stopped()):this.auxiliary(c.job,board,options,c.index);},solve:()=>{throw Error('GPU discovery cannot provide shortest-path proofs');}},
   gate:this.analysis.gate(this.model,c.job.certificate),...baseline,seed:c.seed,frozen:msg.frozen?Uint8Array.from(msg.frozen):null,maxSeen:c.maxSeen,shard:msg.shardCount>1?{index:msg.shardIndex,count:msg.shardCount}:null});return c.gen;
 }
 auxiliary(job,raw,options,context=0){
  const board=packed(raw),key=this.prepared.source_sha256+'\0'+this.prepared.revision+'\0'+this.key(job,board)+'\0'+JSON.stringify(Object.entries(options).sort(([a],[b])=>a.localeCompare(b)));
  if(this.pending.has(key)){this.stats.duplicate_requests++;return this.pending.get(key).then(r=>structuredClone(r));}
  if(this.assessmentCache.has(key)){this.stats.duplicate_requests++;return Promise.resolve(JSON.parse(this.assessmentCache.get(key)));}
  const task=(async()=>{
   if(this.stopped(job))return stopped();this.stats.gpu_attempts++;const start=performance.now();let witness;
   try{witness=await this.discover(job,board,{timeoutMs:Math.max(1,Math.min(60000,Math.ceil(this.deadline-start))),maxExpanded:512,signal:this.signalFor(job),deferValidation:!this.validateDiscovery});}
   catch(e){this.stats.gpu_errors++;this.lastGpuError=e.message;return {status:this.boundedDiscovery?'unknown':'timeout',bounded_unknown:true,reason:'gpu_error',detail:e.message};}
   this.stats.gpu_request_ms+=performance.now()-start;this.onEvaluation?.({role:witness.discovery_cache||witness.discovery_shared?'gpu_reuse':'gpu',jobId:job.msg.id,board,result:witness,observed_ms:performance.now()-this.began});
   if(this.stopped(job))return stopped();if(!['solved','candidate_solution'].includes(witness.status))return {status:this.boundedDiscovery?'unknown':'timeout',bounded_unknown:true,reason:witness.reason};
   assert(witness.status==='solved'?witness.validated_original:witness.validation_deferred&&!witness.validated_original);this.stats.gpu_witnesses++;
   const scoreStart=performance.now();this.stats.aux_assessments++;
   const result=await this.scoreCandidate(job,board,options,context,key);
   this.stats.aux_assess_ms+=performance.now()-scoreStart;
   this.onEvaluation?.({role:'score',jobId:job.msg.id,context,board,options,result,observed_ms:performance.now()-this.began});
   if(result.status==='solved'){assert(result.validated_original);this.stats.aux_solved++;result.discovery='cuda';}
   // Reuse exact assessments only. A failed bounded attempt is not a statement
   // about later budgets, and a different private elite gate changes the key.
   if(!this.stopped(job)&&['solved','unsolvable'].includes(result.status)){
    const value=JSON.stringify(result),bytes=(key.length+value.length)*2;if(bytes<=64*1024*1024){this.assessmentCache.set(key,value);this.assessmentBytes+=bytes;
     while(this.assessmentCache.size>8192||this.assessmentBytes>64*1024*1024){const k=this.assessmentCache.keys().next().value;this.assessmentBytes-=(k.length+this.assessmentCache.get(k).length)*2;this.assessmentCache.delete(k);}}
   }return result;
  })().finally(()=>this.pending.delete(key));
  this.pending.set(key,task);this.stats.peak_retained=Math.max(this.stats.peak_retained,this.pending.size);return task;
 }
 discover(job,board,options){
  if(!this.discoveryCache)return this.assistant.assist(board,options);
  const key=this.prepared.source_sha256+'\0'+this.prepared.revision+'\0'+this.key(job,board);
  return this.discoveryCache.acquire(key,options.maxExpanded,()=>this.assistant.assist(board,options));
 }
 scoreCandidate(job,board,options,context,key){return this.broker.submit({base:job.msg.id,context,covered:()=>job.top.length>0,bytes:key.length*2+board.cells.length*4+512,signal:this.signalFor(job),deadline:this.deadline,
  run:()=>this.scorer.request('assess',board,options,{signal:this.signalFor(job),deadline:this.deadline})});}
 async statistics(){return {...await super.statistics(),gpu_last_error:this.lastGpuError,thresholds:this.observeScoringState?this.thresholdStats:null,discovery_cache:this.discoveryCache?{...this.discoveryCache.stats,bytes:this.discoveryCache.bytes,entries:this.discoveryCache.entries.size}:null,admission:{...this.broker.stats,active:this.broker.active.size,queued:this.broker.queue.length,retained_bytes:this.broker.retained}};}
 async close(){await super.close();this.broker.close();}
}
module.exports={FairGeneration};
