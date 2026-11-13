'use strict';
const assert=require('node:assert/strict');
// A bounded search outcome is reusable work evidence, never an unsolvability
// claim or a completed MIS assessment. A larger grant bypasses the old limit.
class DiscoveryCache {
 constructor({capacity=8192,bytes=64*1024*1024}={}){Object.assign(this,{capacity,limit:bytes});this.entries=new Map();this.bytes=0;this.stats={hits:0,shared:0,executed:0,evictions:0};}
 async acquire(key,cap,run){
  assert(typeof key==='string'&&Number.isInteger(cap)&&cap>0&&typeof run==='function');
  let e=this.entries.get(key);
  if(e?.result&&(e.kind==='witness'||cap<=e.cap)){this.stats.hits++;this.touch(key,e);return {...structuredClone(e.result),discovery_cache:true};}
  if(e?.flight&&cap<=e.flightCap){this.stats.shared++;return e.flight.then(r=>({...structuredClone(r),discovery_shared:true}));}
  // Different grants may run concurrently, but an older completion cannot
  // replace a newer/larger retained decision for this board.
  e??={bytes:key.length*2+128};this.touch(key,e);if(!e.accounted){this.bytes+=e.bytes;e.accounted=true;}
  const token={};e.token=token;e.flightCap=cap;this.stats.executed++;
  const flight=Promise.resolve().then(run).then(r=>{
   if(e.token===token){const kind=['candidate_solution','solved'].includes(r.status)?'witness':['work_limit','exhausted'].includes(r.reason)?r.reason:null;
    if(kind){const result=kind==='witness'?structuredClone(r):{status:'unknown',reason:kind,bounded_unknown:true,discovery_cap:cap};
     if(kind==='witness'){result.discovery_evidence={status:r.gpu?.status,expanded:r.gpu?.expanded,gpu_receipts:r.gpu?.gpu_receipts};delete result.gpu;delete result.timing;result.ms=0;}
     const bytes=(key.length+JSON.stringify(result).length)*2+128;
     this.bytes+=bytes-e.bytes;e.bytes=bytes;e.result=result;e.kind=kind;e.cap=cap;
    }
   }return r;
  }).finally(()=>{if(e.token===token)e.flight=null;this.trim();});e.flight=flight;flight.catch(()=>{});this.trim();return flight;
 }
 touch(key,e){this.entries.delete(key);this.entries.set(key,e);}
 trim(){for(const [key,e]of this.entries){if(this.entries.size<=this.capacity&&this.bytes<=this.limit)break;if(e.flight)continue;this.entries.delete(key);this.bytes-=e.bytes;this.stats.evictions++;}}
}
module.exports={DiscoveryCache};
