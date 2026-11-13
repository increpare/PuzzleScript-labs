'use strict';
const {Worker}=require('node:worker_threads');
class WorkerClient {
 constructor(file,workerData){this.serial=0;this.pending=new Map();this.worker=new Worker(file,{workerData});this.closed=false;
  this.worker.on('message',r=>{const p=this.pending.get(r.id);if(!p)return this.fail(Error('Unexpected MIS worker response'));this.pending.delete(r.id);clearTimeout(p.timer);r.ok?p.resolve(r.result):p.reject(Error(r.error));});
  this.worker.on('error',e=>this.fail(e));this.worker.on('exit',code=>{if(!this.closed)this.fail(Error('MIS worker exited '+code));});
 }
 fail(e){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();this.worker.terminate();}
 request(fields,timeout=30000){if(this.closed)return Promise.reject(Error('MIS worker closed'));if(this.pending.size>=512)return Promise.reject(Error('MIS worker request capacity512'));const id=++this.serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(Error('MIS worker deadline: '+fields.op)),timeout);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({...fields,id});});}
 async close(){this.fail(Error('MIS worker closed'));await this.worker.terminate();}
}
module.exports={WorkerClient};
