'use strict';
const fs=require('node:fs'),readline=require('node:readline'),{spawn}=require('node:child_process'),{performance}=require('node:perf_hooks');
class JsonWorker {
 constructor(exe,args,log){this.pending=[];this.serial=0;this.dead=false;const fd=fs.openSync(log,'w');this.child=spawn(exe,args,{stdio:['pipe','pipe',fd],windowsHide:true});fs.closeSync(fd);this.exited=new Promise(resolve=>{this.child.on('exit',(code,signal)=>{this.dead=true;for(const p of this.pending.splice(0))p.reject(Error(`Worker exit ${code}/${signal}`));resolve({code,signal});});this.child.on('error',e=>{this.dead=true;this.pending.splice(0).forEach(p=>p.reject(e));resolve({code:null,signal:null,error:e.message});});});this.child.stdin.on('error',e=>{this.pending.splice(0).forEach(p=>p.reject(e));this.kill();});readline.createInterface({input:this.child.stdout}).on('line',line=>this.line(line));}
 line(line){const p=this.pending[0];if(!p){this.kill();return;}try{
  if(Buffer.byteLength(line)>16*1024*1024)throw Error('Worker response exceeds 16 MiB');const r=JSON.parse(line);if(r.id!==p.id)throw Error('Worker response ID mismatch');const message={...r,client_ms:performance.now()-p.start};
  if(r.event!==undefined){if(r.event!=='completed'||!r.ok||!p.onEvent)throw Error('Unexpected worker event');const index=r.report?.job_index;if(!Number.isSafeInteger(index)||index<0||index>=2048||p.events.has(index))throw Error('Worker completion identity/count error');p.events.add(index);p.onEvent(message);return;}
  this.pending.shift();p.resolve(message);
 }catch(e){this.pending.splice(0).forEach(x=>x.reject(e));this.kill();}}
 async request(fields,timeout=300000,onEvent){if(this.dead||this.child.killed)throw Error('Worker already exited');if(fields.progress===true&&typeof onEvent!=='function')throw Error('Progress request requires an event callback');if(onEvent&&fields.progress!==true)throw Error('Event callback requires progress:true');if(this.pending.length>=128)throw Error('Worker pending capacity 128');const id=String(++this.serial),message=JSON.stringify({...fields,id});if(Buffer.byteLength(message)>1024*1024)throw Error('Worker request exceeds 1 MiB');const p=new Promise((resolve,reject)=>this.pending.push({id,resolve,reject,start:performance.now(),onEvent,events:new Set()}));this.child.stdin.write(message+'\n');const timer=setTimeout(()=>this.kill(),timeout);try{return await p;}finally{clearTimeout(timer);}}
 async close(){if(!this.dead&&!this.child.killed){const r=await this.request({op:'shutdown'});if(!r.ok)throw Error(r.error||'Shutdown rejected');this.child.stdin.end();}const r=await this.exited;if(r.code!==0||r.signal!==null)throw Error(`Worker did not close normally: ${JSON.stringify(r)}`);}
 kill(){this.child.kill();}
}
module.exports={JsonWorker};
