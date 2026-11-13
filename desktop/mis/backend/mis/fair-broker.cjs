'use strict';
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
// The queue holds whole assessments. A native worker is acquired only when a
// request is selected. No rejected/deferred result is fed to the generator.
class FairBroker {
 constructor({slots=2,capacity=512,bytes=64*1024*1024,agingMs=250,uncoveredBurst=8,clock=()=>performance.now()}={}){
  assert(Number.isInteger(slots)&&slots>0&&slots<=128&&capacity>=slots&&Number.isInteger(uncoveredBurst)&&uncoveredBurst>0);Object.assign(this,{slots,capacity,limit:bytes,agingMs,uncoveredBurst,clock});
  this.queue=[];this.active=new Set();this.waiters=[];this.retained=0;this.lastBase=null;this.lastContext=new Map();this.uncoveredGrants=0;
  this.stats={submitted:0,started:0,completed:0,cancelled_queued:0,peak_queued:0,peak_retained_bytes:0,backpressure:0,queue_ms:0,uncovered_started:0,aged_started:0,by_base:{}};
 }
 async submit({base,context=0,covered,run,signal,deadline=Infinity,bytes=256}){
  assert(typeof covered==='function'&&typeof run==='function'&&bytes>0&&bytes<=this.limit);
  // This wait is backpressure, never an assessment or an invented timeout.
  while(!this.closed&&!signal?.aborted&&this.clock()<deadline&&(this.queue.length+this.active.size>=this.capacity||this.retained+bytes>this.limit)){
   this.stats.backpressure++;await new Promise(resolve=>{const w={resolve,signal};w.abort=()=>{this.waiters.splice(this.waiters.indexOf(w),1);resolve();};signal?.addEventListener('abort',w.abort,{once:true});this.waiters.push(w);});
  }
  if(this.closed||signal?.aborted||this.clock()>=deadline)return {status:'timeout',cancelled:true,reason:'generation_stopped'};
  const job={base,context,covered,run,signal,deadline,bytes,queued:this.clock()};
  const promise=new Promise((resolve,reject)=>Object.assign(job,{resolve,reject}));promise.catch(()=>{});
  job.abort=()=>this.pump();signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.retained+=bytes;this.stats.submitted++;
  this.stats.peak_queued=Math.max(this.stats.peak_queued,this.queue.length);this.stats.peak_retained_bytes=Math.max(this.stats.peak_retained_bytes,this.retained);this.pump();return promise;
 }
 stopped(j){return this.closed||j.signal?.aborted||this.clock()>=j.deadline;}
 wake(){for(const w of this.waiters.splice(0)){w.signal?.removeEventListener('abort',w.abort);w.resolve();}}
 release(j){j.signal?.removeEventListener('abort',j.abort);this.retained-=j.bytes;this.stats.completed++;this.wake();}
 choose(){
  const now=this.clock(),aged=this.queue.filter(j=>now-j.queued>=this.agingMs),uncovered=this.queue.filter(j=>!j.covered());
  // Reserve most opportunities for bases without output; give old requests a
  // turn after at most eight such grants, so covered improvements cannot starve.
  let candidates=aged.length&&this.uncoveredGrants>=this.uncoveredBurst?aged:uncovered.length?uncovered:this.queue;
  const bases=[...new Set(candidates.map(j=>j.base))];let index=bases.indexOf(this.lastBase);const base=bases[(index+1)%bases.length];
  candidates=candidates.filter(j=>j.base===base);const contexts=[...new Set(candidates.map(j=>j.context))];index=contexts.indexOf(this.lastContext.get(base));const context=contexts[(index+1)%contexts.length];
  const job=candidates.find(j=>j.context===context);this.lastBase=base;this.lastContext.set(base,context);
  const isUncovered=!job.covered();this.uncoveredGrants=isUncovered?this.uncoveredGrants+1:0;
  this.stats.uncovered_started+=+isUncovered;this.stats.aged_started+=+(now-job.queued>=this.agingMs);
  return job;
 }
 pump(){
  for(let i=this.queue.length-1;i>=0;i--){const j=this.queue[i];if(this.stopped(j)){this.queue.splice(i,1);this.stats.cancelled_queued++;this.release(j);j.resolve({status:'timeout',cancelled:true,reason:'generation_stopped'});}}
  while(!this.closed&&this.active.size<this.slots&&this.queue.length){const j=this.choose();this.queue.splice(this.queue.indexOf(j),1);this.active.add(j);this.stats.started++;this.stats.queue_ms+=this.clock()-j.queued;
   const row=this.stats.by_base[String(j.base)]??={started:0,completed:0};row.started++;
   Promise.resolve().then(j.run).then(j.resolve,j.reject).finally(()=>{this.active.delete(j);row.completed++;this.release(j);this.pump();});
  }
 }
 close(){this.closed=true;this.pump();this.wake();assert(!this.queue.length);}
}
module.exports={FairBroker};
