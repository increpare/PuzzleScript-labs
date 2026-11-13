'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{performance}=require('node:perf_hooks'),{JsonWorker}=require('../tools/json-worker.cjs');
const strategy={portfolio:0,bfs:1,astar:2,'astar-deep':3,greedy:4};
const {boardGrid}=require('./board-grid.cjs');
class NativeMisBackend {
 constructor({engineClient,prepared,source,log,exe=path.join(__dirname,'../bin',process.platform+'-'+process.arch,'mis-native-worker'+(process.platform==='win32'?'.exe':'')),validation='native',gridMode='local'}){assert(['js','native'].includes(validation)&&['worker','local'].includes(gridMode));Object.assign(this,{engineClient,prepared,source,validation,gridMode});this.client=new JsonWorker(exe,[],log);}
 async request(q){const r=await this.client.request(q);assert(r.ok,r.error);return r.report;}
 agree(table,model){return table.objectCount===model.objectCount&&table.layerCount===model.layerCount&&model.objects.every((o,id)=>!o?table.objects[id]?.layer<0:table.objects[id]?.name.toLowerCase()===o.name&&table.objects[id]?.layer===o.layer);}
 async initialize(){const p=this.prepared;this.original=false;
  const reduced=['removed_inert_rules','removed_cosmetic_objects','removed_collision_layers','removed_cosmetic_rules','removed_win_irrelevant_rules','merged_object_aliases'].some(k=>p.telemetry[k]>0);
  if(p.telemetry.enabled&&!reduced){const t=await this.request({op:'compile',source:this.source});this.original=this.agree(t,p.original)&&(p.original.noaction||t.actionUnnecessary);}
  if(!this.original){const t=await this.request({op:'compile',source:p.source});assert(this.agree(t,p.solver),'Native MIS canonical object tables differ');}
  if(this.validation==='native'){const t=await this.request({op:'compile_original',source:this.source});assert(this.agree(t,p.original),'Native original object tables differ');}
  return {backend:'native-mis-c-api',originalNative:this.original,validation:this.validation,gridMode:this.gridMode};
 }
 async run(method,board,options={}){assert(method==='solve'||method==='assess');const started=performance.now(),timing={grid_ms:0,native_ms:0,validation_ms:0,validation_kind:'none'};let phase='grid_ms',at=started;const mark=next=>{if(phase)timing[phase]+=performance.now()-at;phase=next;at=performance.now();};
  try{const grid=this.gridMode==='local'?boardGrid(this.prepared,board,this.original):await this.engineClient.request({op:'grid',revision:this.prepared.revision,board,original:this.original});const opts={...options};if(method==='solve'){opts.strategy=strategy[opts.strategy||'astar'];assert(Number.isInteger(opts.strategy),'MIS strategy');}
   mark('native_ms');const r=await this.request({op:method,...grid,options:opts});mark('validation_ms');
   if(r.status==='solved'){let check;
    if(this.validation==='native'&&r.solution.length>0&&r.solution.length<=100000){check=await this.request({op:'validate_original',...boardGrid(this.prepared,board,true),solution:r.solution});timing.validation_kind='native';}
    if(!check?.valid){check=await this.engineClient.request({op:'validate',revision:this.prepared.revision,board,solution:r.solution});timing.validation_kind=this.validation==='native'?'js-fallback':'js';}
    assert(check.valid,'Native MIS result rejected by original game');r.validated_original=true;r.validation_engine=check.engine||'MIS original Labs engine';
   }
   mark(null);r.transport=timing;r.ms=performance.now()-started;return r;
  }finally{mark(null);this.lastTiming=timing;}
 }
 solve(board,options){return this.run('solve',board,options);}
 assess(board,options){return this.run('assess',board,options);}
 close(){return this.client.close();}
 kill(){this.client.kill();}
}
module.exports={NativeMisBackend};
