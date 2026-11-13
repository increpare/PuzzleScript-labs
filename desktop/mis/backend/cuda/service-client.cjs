'use strict';
// Out-of-order acknowledgements and individual completions share one JSONL pipe.
const fs=require('node:fs'),readline=require('node:readline'),{spawn}=require('node:child_process'),{performance}=require('node:perf_hooks');
class ServiceClient {
 constructor(exe,log,options={}){this.serial=0;this.queries=new Map();this.requests=new Map();this.dead=false;const fd=fs.openSync(log,'w'),launcher=options.launcher||[];this.child=spawn(launcher[0]||exe,launcher.length?[...launcher.slice(1),exe,'--service']:['--service'],{stdio:['pipe','pipe',fd],windowsHide:true});fs.closeSync(fd);
  // Process exit can precede stdout EOF. Stop new requests then, but allow the
  // final ACK/completion frames to drain before rejecting unresolved work.
  this.child.on('exit',()=>{this.dead=true;});
  this.exited=new Promise(resolve=>{this.child.on('close',(code,signal)=>{this.dead=true;this.fail(Error(`Service exit ${code}/${signal}`),false);resolve({code,signal});});this.child.on('error',error=>{this.dead=true;this.fail(error,false);resolve({error:error.message});});});
  this.child.stdin.on('error',e=>this.fail(e));readline.createInterface({input:this.child.stdout}).on('line',line=>{if(launcher.length&&!line.trimStart().startsWith('{'))fs.appendFileSync(log+'.launcher',line+'\n');else this.line(line);});
 }
 fail(error,kill=true){for(const p of this.requests.values()){clearTimeout(p.timer);p.reject(error);}this.requests.clear();for(const q of this.queries.values())q.reject(error);this.queries.clear();if(kill)this.child.kill();}
 line(line){try{
  if(Buffer.byteLength(line)>16*1024*1024)throw Error('Service frame exceeds 16 MiB');const r=JSON.parse(line);
  if(r.event!==undefined){if(r.event!=='completed'||!r.ok)throw Error('Unexpected service event');const q=this.queries.get(r.query);if(!q)throw Error('Unknown/duplicate terminal query '+r.query);this.queries.delete(r.query);q.resolve({...r,client_ms:performance.now()-q.start});return;}
  const p=this.requests.get(r.id);if(!p)throw Error('Unknown service acknowledgement');this.requests.delete(r.id);clearTimeout(p.timer);p.resolve({...r,client_ms:performance.now()-p.start});
 }catch(e){this.fail(e);}}
 request(fields,timeout=300000){if(this.dead)return Promise.reject(Error('Service exited'));if(this.requests.size>=4096)return Promise.reject(Error('Client request capacity 4096'));const id=String(++this.serial),text=JSON.stringify({...fields,id});if(Buffer.byteLength(text)>1024*1024)return Promise.reject(Error('Service request exceeds 1 MiB'));
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(Error('Service request timeout: '+fields.op)),timeout);this.requests.set(id,{resolve,reject,timer,start:performance.now()});this.child.stdin.write(text+'\n');});
 }
 enqueue(fields){const query=fields.query||'q'+(++this.serial);if(this.queries.has(query))throw Error('Duplicate client query');const start=performance.now();let resolve,reject;const completed=new Promise((yes,no)=>{resolve=yes;reject=no;});
  // Callers can inspect admission separately without causing unhandled failures.
  completed.catch(()=>{});this.queries.set(query,{resolve,reject,start});
  const accepted=this.request({...fields,op:fields.continuation?'resume':'submit',query}).then(r=>{if(!r.ok){this.queries.delete(query);reject(Error(r.error));}return r;}).catch(e=>{this.queries.delete(query);reject(e);throw e;});
  return {query,accepted,completed};
 }
 async submit(fields){const item=this.enqueue(fields);const r=await item.accepted;if(!r.ok)throw Error(r.error);return item.completed;}
 async close(){if(!this.dead){const r=await this.request({op:'shutdown'});if(!r.ok)throw Error(r.error);this.child.stdin.end();}const r=await this.exited;if(r.code!==0||r.signal!==null)throw Error('Service abnormal shutdown '+JSON.stringify(r));return r;}
 kill(){this.child.kill();}
}
module.exports={ServiceClient};
