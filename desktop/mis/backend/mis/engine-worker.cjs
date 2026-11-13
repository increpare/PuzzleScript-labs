'use strict';
// Actual MIS compiler/optimizer and original-game witness validation, isolated
// from the Node event loop and from the pinned-vanilla GPU upload compiler.
const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(workerData.engine,'src'),sources={},sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=['js/mis/mis_shims.js','js/storagewrapper.js','js/bitvec.js','js/level.js','js/languageConstants.js','js/globalVariables.js','js/debug.js','js/plugin_header_on.js','js/font.js','js/rng.js','js/riffwave.js','js/sfxr.js','js/codemirror/stringstream.js','js/colorhelpers.js','js/colors.js','js/engine.js','js/parser.js','js/compiler.js','js/soundbar.js'];
function read(f){const b=fs.readFileSync(path.join(root,f));sources[f]=sha(b);return b.toString('utf8');}
vm.runInThisContext(files.map(read).join('\n')+'\nmisAfterEngineLoaded();\n'+read('js/mis/mis_core.js')+'\n'+read('js/semantic_compile.js')+'\n'+read('js/mis/mis_optimizer_bundle.js')+'\nglobalThis.MISCore=MISCore;globalThis.misCompile=misCompile;globalThis.MISOptimizer=MISOptimizer;');
let prepared,model,revision=0,sourceText,wasmBackend,wasmNative;
const validationCache=new Map(),validationLimit=16*1024*1024,validationEntries=4096;
let validationStats;
const originalValidate=MISCore.validateSolution;
MISCore.validateSolution=function(m,b,solution){
 if(!Array.isArray(solution)||!solution.every(a=>Number.isInteger(a)&&a>=0&&a<=4))return false;
 const stats=validationStats;stats.calls++;const bytes=24+b.cells.length*4+solution.length;
 const key=workerData.validationCache!==false&&m===model&&bytes*2<=validationLimit
  ?b.w+'x'+b.h+'\0'+Buffer.from(Int32Array.from(b.cells).buffer).toString('latin1')+'\0'+Buffer.from(solution).toString('latin1'):null;
 if(key!==null&&validationCache.has(key)){const value=validationCache.get(key);validationCache.delete(key);validationCache.set(key,value);stats.cache_hits++;return true;}
 const start=performance.now();stats.replays++;const valid=originalValidate(m,b,solution);stats.replay_ms+=performance.now()-start;if(!valid){stats.invalid++;return false;}
 if(key!==null){const size=key.length*2;validationCache.set(key,size);stats.bytes+=size;while(validationCache.size>validationEntries||stats.bytes>validationLimit){const first=validationCache.keys().next().value;stats.bytes-=validationCache.get(first);validationCache.delete(first);stats.evictions++;}}
 return true;
};
function board(raw){assert(model,'Compile a game first');assert(raw&&Number.isInteger(raw.w)&&raw.w>0&&raw.w<=512&&Number.isInteger(raw.h)&&raw.h>0&&raw.h<=512&&raw.w*raw.h<=65536,'MIS CPU board capacity65536 cells');assert(Array.isArray(raw.cells)&&raw.cells.length===raw.w*raw.h*model.stride,'MIS board stride');
 const cells=Int32Array.from(raw.cells,n=>{assert(Number.isInteger(n)&&n>=-2147483648&&n<=0xffffffff,'MIS object word');return n;});
 for(let tile=0;tile<raw.w*raw.h;tile++){const layers=new Set();for(let w=0;w<model.stride;w++){let bits=cells[tile*model.stride+w]>>>0;while(bits){const bit=31-Math.clz32(bits&-bits),id=w*32+bit,o=model.objects[id];assert(o&&o.layer>=0,'MIS unknown object bit');assert(!layers.has(o.layer),'MIS multiple objects in one collision layer');layers.add(o.layer);bits=(bits&(bits-1))>>>0;}}}
 return {w:raw.w,h:raw.h,cells};
}
async function handle(r){
 if(r.op==='compile'){
  assert(typeof r.source==='string'&&Buffer.byteLength(r.source)<=4*1024*1024,'MIS source capacity4MiB');const result=misCompile(r.source);assert(result.ok&&!result.hasErrors,JSON.stringify(result.errors));model=MISCore.extractModel(r.source);prepared=MISOptimizer.prepare(r.source,model,{enabled:r.optimize!==false,hasErrors:false});sourceText=r.source;wasmBackend=null;revision++;validationCache.clear();validationStats={calls:0,replays:0,cache_hits:0,invalid:0,replay_ms:0,bytes:0,evictions:0};
  const describe=m=>({objectCount:m.objectCount,stride:m.stride,layerCount:m.layerCount,noaction:m.noaction,objects:m.objects.map(o=>o?{id:o.id,name:o.name,layer:o.layer}:null)});
  return {revision,source_sha256:sha(r.source),source:prepared.source,original:describe(model),solver:describe(prepared.model),idMap:Array.from(prepared.idMap),telemetry:prepared.telemetry,sources,levels:model.levels.filter(l=>l.board).map(l=>({index:l.index,board:{w:l.board.w,h:l.board.h,cells:Array.from(l.board.cells)}}))};
 }
 assert(prepared&&r.revision===revision,'Stale MIS game revision');
 if(r.op==='validation_stats')return {...validationStats,entries:validationCache.size};
 if(r.op==='generation_model')return {model,ruleQuantity:prepared.ruleQuantity,ruleTags:prepared.ruleTags};
 if(r.op==='check_board')return board(r.board);
 if(r.op==='project'){const b=prepared.project(board(r.board));return {w:b.w,h:b.h,cells:Array.from(b.cells,n=>n>>>0)};}
 if(r.op==='grid'){
  const b=r.original?board(r.board):prepared.project(board(r.board)),m=r.original?model:prepared.model,grid=[];
  for(let l=0;l<m.layerCount;l++)for(let y=0;y<b.h;y++)for(let x=0;x<b.w;x++){const tile=x*b.h+y;const id=m.layerObjects[l].find(id=>MISCore.hasBit(b.cells,tile,id,m.stride));grid.push(id===undefined?-1:id);}
  return {width:b.w,height:b.h,grid};
 }
 if(r.op==='wasm_initialize'){
  const nativeApi=require(path.join(root,'js/mis/mis_native.js')),factory=require(path.join(root,'js/mis/wasm/mis_native.js'));
  wasmNative=nativeApi.create(await factory());let attached,originalNative=false;
  if(prepared.telemetry.enabled&&!MISOptimizer.hasRuleReductions(prepared)){attached=wasmNative.attach(sourceText,model);originalNative=attached.ok&&(model.noaction||wasmNative.actionUnnecessary());}
  if(!originalNative)attached=wasmNative.attach(prepared.source,prepared.model);assert(attached.ok,attached.reason);
  if(prepared.telemetry.enabled&&!originalNative)wasmNative.attachOriginal(sourceText,model);
  wasmBackend=MISOptimizer.createBackend(prepared,wasmNative,{originalNative});
  return {backend:'native-wasm',originalNative,wasm_sha256:sha(fs.readFileSync(path.join(root,'js/mis/wasm/mis_native.wasm'))),adapter_sha256:sha(fs.readFileSync(path.join(root,'js/mis/mis_native.js')))};
 }
 if(r.op==='wasm_solve'||r.op==='wasm_assess'){assert(wasmBackend,'Initialize actual MIS wasm backend first');const b=board(r.board),result=wasmBackend[r.op==='wasm_solve'?'solve':'assess'](b,{...r.options,verifyOriginalJS:true});if(result.status==='solved'){prepared.activateOriginal();assert(MISCore.validateSolution(model,b,result.solution),'MIS WASM witness rejected by original engine');result.validated_original=true;}return result;}
 if(r.op==='validate'){
  assert(Array.isArray(r.solution)&&r.solution.length<=1000000&&r.solution.every(a=>Number.isInteger(a)&&a>=0&&a<=4),'MIS witness input capacity');const b=board(r.board);prepared.activateOriginal();const valid=MISCore.validateSolution(model,b,r.solution);return {valid,engine:'MIS original Labs engine',revision};
 }
 throw Error('Unsupported MIS engine operation '+r.op);
}
let queue=Promise.resolve();parentPort.on('message',r=>{queue=queue.then(async()=>{try{parentPort.postMessage({id:r.id,ok:true,result:await handle(r)});}catch(e){parentPort.postMessage({id:r.id,ok:false,error:e.stack||String(e)});}});});
