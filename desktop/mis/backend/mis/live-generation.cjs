'use strict';
// Live desktop assignments. Replacing one owner/job cancels only its work;
// unchanged generator objects, RNGs, feedback, baselines and queues survive.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{setMaxListeners}=require('node:events');
const {GpuGeneration:GenerationSession}=require('./gpu-generation.cjs');
class LiveGeneration extends GenerationSession {
 constructor(options){super(options);this.entries=new Map();this.version=0;this.cursor={cpu:0,gpu:0};this.active={cpu:new Set(),gpu:new Set()};this.edits=Promise.resolve();this.deadline=Infinity;this.began=performance.now();this.onEvent=options.onEvent;this.lastStats=new Map();this.controller=new AbortController();setMaxListeners(2048,this.controller.signal);
  this.onCandidate=row=>{const job=this.entries.get(row.jobId);if(job&&!this.stopped(job))this.emit(job,{type:'candidate',board:row.board,result:row.result,role:row.role});};
 }
 async initialize(source){const r=await super.initialize(source);this.gpuReady.then(i=>{this.gpuAvailable=i.available;this.kick();});return r;}
 emit(job,event){this.onEvent?.({owner:job.owner,...event,jobId:job.originalId,revision:job.msg.revision,generationEpoch:job.msg.generationEpoch});}
 assign(owner,messages){assert(!this.closing&&typeof owner==='string'&&owner.length<=128&&Array.isArray(messages)&&messages.length<=1024);const copy=structuredClone(messages);const change=this.edits.then(()=>this.edit(owner,copy));this.edits=change.catch(()=>{});return change;}
 async edit(owner,messages){assert(!this.closed);const ids=new Set(),next=[];
  // Validate replacements completely before changing any existing assignment.
  for(const m of messages){assert((typeof m.jobId==='string'&&m.jobId.length<=128||Number.isSafeInteger(m.jobId))&&!ids.has(m.jobId),'Unique live job identity');ids.add(m.jobId);const id=JSON.stringify([owner,typeof m.jobId,m.jobId]),old=this.entries.get(id);
   if(old&&old.msg.revision===m.revision&&old.msg.generationEpoch===m.generationEpoch){next.push(old);continue;}
   const job=await this.createJob({...m,id});Object.assign(job,{owner,originalId:m.jobId,version:++this.version,controller:new AbortController(),tasks:new Set(),contexts:[]});setMaxListeners(2048,job.controller.signal);next.push(job);
  }
  assert(this.entries.size-[...this.entries.values()].filter(j=>j.owner===owner).length+next.length<=1024,'Live job capacity1024');
  const retain=new Set(next),removed=[...this.entries.values()].filter(j=>j.owner===owner&&!retain.has(j));
  for(const j of removed){this.entries.delete(j.msg.id);this.lastStats.delete(j.msg.id);j.controller.abort();}
  await Promise.allSettled(removed.flatMap(j=>[...j.tasks]));for(const j of next)this.entries.set(j.msg.id,j);
  this.rebalance();this.kick();return {jobs:next.length,total:this.entries.size};
 }
 rebalance(){this.jobs=[...this.entries.values()];const count=this.jobs.length,perGpu=count?Math.max(1,Math.floor(this.auxStreams/count)):0,totalGpu=count*perGpu;this.contexts={cpu:[],gpu:[]};
  for(const job of this.jobs){
   const make=(role,index)=>({role,index,job,seed:role==='cpu'?(job.msg.seed>>>0):((job.msg.seed>>>0)+index*7919+0x9e3779b9)>>>0,maxSeen:role==='cpu'?job.msg.maxSeen:Math.max(1,Math.min(20000,Math.floor(64*1024*1024/Math.max(totalGpu,512)/(job.base.cells.byteLength*2+128)))),steps:0,gen:null,busy:false});
   if(!job.contexts.length)job.contexts.push(make('cpu',0));this.contexts.cpu.push(job.contexts[0]);
   if(this.useGpu&&job.base.w*job.base.h<=512){
    // Discard only idle excess replicas when assignments grow. Running work
    // completes normally; at most512 retiring replicas exist globally.
    const keep=job.contexts.slice(0,perGpu+1),excess=job.contexts.slice(perGpu+1),retiring=excess.filter(c=>c.busy);for(const c of excess.filter(c=>!c.busy))this.archive(job,c);for(const c of retiring)c.retiring=true;job.contexts=keep;
    while(job.contexts.length<perGpu+1)job.contexts.push(make('gpu',job.contexts.length));for(const c of job.contexts)c.retiring=false;this.contexts.gpu.push(...job.contexts.slice(1));job.contexts.push(...retiring);
   }
  }
 }
 kick(){if(this.pumpQueued||this.closed)return;this.pumpQueued=true;setImmediate(()=>{this.pumpQueued=false;this.pump();});}
 pump(){if(this.closed)return;for(const role of ['cpu',...(this.gpuAvailable?['gpu']:[])]){
  const list=this.contexts[role],limit=role==='cpu'?this.workers:512;if(!list.length)continue;
  while(this.active[role].size<limit){let chosen;for(let k=0;k<list.length;k++){const c=list[this.cursor[role]++%list.length];if(!c.busy&&!this.stopped(c.job)&&(role==='cpu'||c.job.baseline)){chosen=c;break;}}if(!chosen)break;
   const c=chosen;c.busy=true;const task=(async()=>{const gen=await this.context(c);if(!gen||this.stopped(c.job))return;this.accept(c,await gen.step());c.steps++;
    const now=performance.now();if(now-(this.lastStats.get(c.job.msg.id)||0)>250){this.lastStats.set(c.job.msg.id,now);this.emitStats(c.job);}
   })().catch(e=>{if(!this.stopped(c.job)){c.job.controller.abort();this.emit(c.job,{type:'genError',message:e.message});}}).finally(()=>{c.busy=false;this.active[role].delete(task);c.job.tasks.delete(task);if(c.retiring){this.archive(c.job,c);c.job.contexts=c.job.contexts.filter(x=>x!==c);}this.kick();});
   this.active[role].add(task);c.job.tasks.add(task);
  }
 }}
 mergeStats(target,source){for(const[k,v]of Object.entries(source))if(typeof v==='number')target[k]=k==='budgetMs'?Math.max(target[k]||0,v):(target[k]||0)+v;}
 archive(job,c){if(c.archived||!c.gen)return;c.archived=true;this.mergeStats(job.retiredStats??={},c.gen.stats());this.mergeStats(job.retiredProfile??={},c.gen.profile());}
 emitStats(job){const stats={...job.retiredStats},profile={...job.retiredProfile};let exhausted=true;for(const c of job.contexts){if(!c.gen)continue;this.mergeStats(stats,c.gen.stats());this.mergeStats(profile,c.gen.profile());exhausted&&=c.gen.exhausted();}this.emit(job,{type:'stats',stats,profile,arms:job.contexts[0]?.gen?.arms()||[],transforms:job.contexts[0]?.gen?.transforms()||[],exhausted});}
 close(){if(this.closing)return this.closing;this.closing=(async()=>{await this.edits;for(const j of this.entries.values())j.controller.abort();this.controller.abort();await Promise.allSettled([...this.active.cpu,...this.active.gpu]);await super.close();this.entries.clear();this.contexts={cpu:[],gpu:[]};})();return this.closing;}
}
module.exports={LiveGeneration};
