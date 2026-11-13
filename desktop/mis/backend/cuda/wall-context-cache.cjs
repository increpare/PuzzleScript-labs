'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
// Concurrent leases share immutable uploaded data. Loading is serialized; active
// leases cannot be evicted. Expired waiters resolve without uploading or dispatch.
class WallContextCache {
 constructor(client,{capacity=8,bytes=128*1024*1024}={}){Object.assign(this,{client,capacity,limit:bytes});this.entries=new Map();this.waiting=[];this.bytes=0;this.busy=false;this.serial=0;this.stats={loads:0,hits:0,evictions:0,expired:0,peak_entries:0,peak_bytes:0};}
 acquire(group,stopped){if(this.failure)return Promise.reject(this.failure);return new Promise((resolve,reject)=>{this.waiting.push({group,stopped,resolve,reject});this.pump();});}
 async request(q){const r=await this.client.request(q);assert(r.ok,JSON.stringify(r));return r;}
 pump(){if(this.busy){this.wakeup=true;return;}this.busy=true;this.wakeup=false;this.pumping=(async()=>{while(this.waiting.length){const w=this.waiting[0];if(w.stopped()){this.waiting.shift();this.stats.expired++;w.resolve(null);continue;}
   let entry=this.entries.get(w.group.id);if(entry){this.waiting.shift();entry.refs++;entry.used=++this.serial;this.stats.hits++;w.resolve(entry);continue;}
   const bound=4096+4*(fs.statSync(w.group.file).size+fs.statSync(w.group.boards_file).size);if(bound>this.limit){this.waiting.shift();const e=Error('Compiled context exceeds declared cache capacity');e.code='CONTEXT_CAPACITY';w.reject(e);continue;}
   const victims=[];let count=this.entries.size,size=this.bytes;for(const idle of [...this.entries.values()].filter(e=>e.refs===0).sort((a,b)=>a.used-b.used)){if(count<this.capacity&&size+bound<=this.limit)break;victims.push(idle);count--;size-=idle.bound;}
   if(count>=this.capacity||size+bound>this.limit)break;
   // Claim this waiter BEFORE any await. Expiration may mutate the remaining
   // queue during unload; shifting afterwards could silently lose its successor.
   this.waiting.shift();this.current=w;try{
    for(const idle of victims){assert.equal(idle.refs,0);await this.request({op:'unload',handle:idle.handle});this.entries.delete(idle.id);this.bytes-=idle.bound;this.stats.evictions++;}
    if(w.stopped()){this.stats.expired++;w.resolve(null);continue;}
    const r=await this.request({op:'load',file:w.group.file,boards_file:w.group.boards_file});entry={id:w.group.id,handle:r.report.handle,bound,refs:0,used:++this.serial};this.entries.set(entry.id,entry);this.bytes+=bound;this.stats.loads++;this.stats.peak_entries=Math.max(this.stats.peak_entries,this.entries.size);this.stats.peak_bytes=Math.max(this.stats.peak_bytes,this.bytes);assert(this.bytes<=this.limit&&this.entries.size<=this.capacity);if(w.stopped()){this.stats.expired++;w.resolve(null);}else{entry.refs++;w.resolve(entry);}
   }catch(e){w.reject(e);throw e;}finally{this.current=null;}
  }})().catch(e=>{this.failure=e;for(const w of this.waiting.splice(0))w.reject(e);}).finally(()=>{this.busy=false;if(this.wakeup&&this.waiting.length)this.pump();});}
 release(entry){assert(this.entries.get(entry.id)===entry&&entry.refs>0);entry.refs--;entry.used=++this.serial;this.pump();}
 expire(){for(let i=this.waiting.length;i-->0;)if(this.waiting[i].stopped()){const [w]=this.waiting.splice(i,1);this.stats.expired++;w.resolve(null);}this.pump();}
 abort(error){this.failure=error;for(const w of this.waiting.splice(0))w.reject(error);}
 async close(){if(this.pumping)await this.pumping;assert(!this.busy&&this.waiting.length===0);for(const entry of this.entries.values()){assert.equal(entry.refs,0);await this.request({op:'unload',handle:entry.handle});}this.entries.clear();this.bytes=0;if(this.failure)throw this.failure;}
}
module.exports={WallContextCache};
