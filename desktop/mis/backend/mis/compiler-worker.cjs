'use strict';
const {parentPort,workerData}=require('node:worker_threads'),assert=require('node:assert/strict');
const oracle=require('../tools/oracle.cjs'),wide=require('../tools/export-v2.cjs');
oracle.initialize(workerData.reference);let compiled,revision=0;
parentPort.on('message',r=>{try{
 let result;
 if(r.op==='compile'){
  compiled=oracle.compileProgram(r.source,'mis');revision++;
  const objects=Array.from({length:compiled.objectCount},()=>null);for(const[name,o]of Object.entries(compiled.objects))if(o.id>=0)objects[o.id]={id:o.id,name,layer:o.layer};
  result={revision,objects,stride:compiled.STRIDE_OBJ,layerCount:compiled.collisionLayers.length,authority:oracle.identity()};
 }else if(r.op==='shape'){
  assert(compiled&&r.revision===revision,'Stale GPU compiler revision');assert(Number.isInteger(r.w)&&r.w>0&&Number.isInteger(r.h)&&r.h>0&&r.w*r.h<=512,'GPU board capacity512 cells');assert(Number.isInteger(r.slots)&&r.slots>=1&&r.slots<=128);
  const objects=new Int32Array(r.w*r.h*compiled.STRIDE_OBJ),upload=wide.uploadCompiled({...compiled,levels:[{width:r.w,height:r.h,objects}]},[],{name:'MIS canonical assistance',seed:'mis',historyCapacity:1});
  assert(upload.game[23]<=4&&upload.game[22]<=16,'GPU shape exceeds4object words or16win conditions');assert(upload.game[29]===0,'GPU assistance requires canonical audio removal');for(let i=0;i<21;i++)assert(upload.game[upload.game[28]+i]===0xffffffff,'GPU assistance requires canonical event removal');for(let i=0;i<upload.game[9];i++)assert(!(upload.game[upload.game[14]+i*8+3]&~23),'GPU assistance rejects checkpoint/message/sfx commands');
  // Duplicate pristine placeholders allocate slots without executing gameplay.
  upload.initial_boards=Array.from({length:r.slots},()=>upload.initial);result=upload;
 }else throw Error('Unsupported GPU compiler operation '+r.op);
 parentPort.postMessage({id:r.id,ok:true,result});
 }catch(e){parentPort.postMessage({id:r.id,ok:false,error:e.stack||String(e)});}});
