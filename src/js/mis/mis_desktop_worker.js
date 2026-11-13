'use strict';
// Worker-shaped renderer transport; the existing browser worker owns fallback
// operations and all JavaScript/rule-goal behavior. No Node access is exposed.
(function () {
 const bridge=window.misNativeBackend,workers=new Map();
 if(!bridge)return;
 const backendOption=document.querySelector('#backend-select option[value="native"]');if(backendOption)backendOption.textContent="Automatic";
 bridge.onEvent(function(e){const w=workers.get(e.handle);if(w&&!w.dead)w.emit(e.message);});
 class MISDesktopWorker {
  constructor(url){this.dead=false;this.url=url;this.fallback=new Worker(url);this.ready=false;this.handle=null;this.fallback.onmessage=e=>{if(e.data.type==='ready'){this.fallbackReady=e.data;this.finishInit();}else this.emit(e.data);};this.fallback.onerror=e=>this.onerror?.(e);}
  emit(data){if(!this.dead)this.onmessage?.({data});}
  finishInit(){if(this.ready||!this.fallbackReady||!this.nativeReady||this.dead)return;this.ready=true;this.emit(this.nativeReady.available?{...this.fallbackReady,...this.nativeReady,type:'ready',ok:true}:this.fallbackReady);}
  postMessage(message){if(this.dead)return;
   if(message.type==='init'){this.fallback.postMessage(message);this.init=message.backend==='js'?Promise.resolve({available:false}):bridge.open({source:message.source}).catch(e=>({available:false,reason:e.message}));this.init.then(r=>{this.nativeReady=r;if(r.available){this.handle=r.handle;if(this.dead){bridge.close(r.handle).catch(()=>{});return;}workers.set(r.handle,this);}this.finishInit();});return;}
   if(!this.handle||!['assess','prove','generationJobs'].includes(message.type)){this.fallback.postMessage(message);return;}
   bridge.command({handle:this.handle,message}).then(r=>{if(this.dead)return;if(message.type==='generationJobs')this.fallback.postMessage({type:'generationJobs',jobs:r.fallbackJobs||[]});else if(r.message)this.emit(r.message);}).catch(()=>{if(!this.dead)this.fallback.postMessage(message);});
  }
  terminate(){if(this.dead)return;this.dead=true;this.fallback.terminate();if(this.handle){workers.delete(this.handle);bridge.close(this.handle).catch(()=>{});}}
 }
 window.MISDesktopWorker=MISDesktopWorker;
})();
