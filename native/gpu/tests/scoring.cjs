'use strict';
// Runs only the production backend and shipped helpers; no experimental imports.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'../../..'),base=path.join(root,'desktop/mis/backend'),host=path.join(base,'mis');
const {GpuGeneration}=require(path.join(host,'gpu-generation.cjs')),{NativeMisBackend}=require(path.join(host,'native-backend.cjs'));
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.split('='))),out=path.resolve(args.out||path.join(root,'build/gpu-scoring-'+Date.now()));assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const normalize=r=>Object.fromEntries(['status','expanded','solution','lanes','effort','length','refined','optimal'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
(async()=>{const rows=[];for(let family=0;family<6;family++){
 const input=path.join(__dirname,'fixtures/scoring'),source=fs.readFileSync(path.join(input,'game'+family+'.txt'),'utf8'),session=new GpuGeneration({directory:path.join(out,'session'+family),workers:1,scoreWorkers:2,gpu:true});let native;
 try{await session.initialize(source);const gpu=await session.gpuReady;assert(gpu.available,gpu.reason);await session.exactReady;assert(session.exactAvailable,session.lastGpuError);session.controller=new AbortController();require('node:events').setMaxListeners(2048,session.controller.signal);session.deadline=performance.now()+60000;
  native=new NativeMisBackend({engineClient:session.engineClient,prepared:session.prepared,source,log:path.join(out,'reference'+family+'.log')});await native.initialize();
  const samples=Array.from({length:+(args.samples||24)},(_,i)=>JSON.parse(fs.readFileSync(path.join(input,`case-${family}-${i}.json`)))),job={msg:{id:0},top:[]};
  const discovery=session.assistant.assist(samples[0].board,{timeoutMs:60000,maxExpanded:32,deferValidation:true});
  const results=await Promise.all(samples.map((r,i)=>session.scoreCandidate(job,r.board,r.options,i,'fixture-'+i)));
  const d=await discovery;assert(d.gpu.gpu_receipts>0&&d.gpu.search_mode==='greedy');
  for(let i=0;i<samples.length;i++){const row=samples[i],actual=results[i],reference=await native.assess(row.board,row.options);assert.deepEqual(normalize(actual),normalize(reference),`Assessment family ${family} case ${i}`);assert(actual.bfs_evidence?.gpu.gpu_receipts>0);assert(!actual.bfsDeferred);rows.push({family,index:i,actual,reference});}
  const row=samples[0],options={...row.options,refineGate:row.result.expanded+1},gated=await session.scoreCandidate(job,row.board,options,0,'gate'),reference=await native.assess(row.board,options);assert.deepEqual(normalize(gated),normalize(reference));assert(!gated.refined&&!gated.bfs_evidence);
  // Verify independently replayed exact paths, not just composed score minima.
  const exact=await session.exact.score(row.board,{maxExpanded:Math.max(1,row.result.expanded+6),validate:true});
  const bfs=await native.solve(row.board,{strategy:'bfs',timeMs:60000,maxExpanded:row.result.expanded+6,deterministic:true});
  if(exact.status==='solved'){assert(exact.validated_original&&exact.gpu.gpu_receipts>0);assert.equal(exact.expanded,bfs.expanded);assert.deepEqual(exact.solution,bfs.solution);}else assert.notEqual(bfs.status,'solved');
  // A device failure must finish the missing lane on native, retaining primary.
  const original=session.exact.score;session.exact.score=async()=>{throw Error('deliberate device failure');};
  const fallback=await session.scoreCandidate(job,row.board,row.options,0,'failure');session.exact.score=original;assert.deepEqual(normalize(fallback),normalize(await native.assess(row.board,row.options)));assert(session.scoreStats.cpu_fallbacks>0);
  const stats=await session.statistics();assert(stats.gpu.gpu.peak_device_bytes<=6*1024**3);assert(stats.gpu.gpu.pool_count<=8);assert(stats.gpu.gpu.shared_admission.active<=128);
  fs.writeFileSync(path.join(out,'family'+family+'.json'),JSON.stringify({stats,discovery:d,rows:rows.filter(r=>r.family===family)},null,2));console.log('Production native / shared CUDA score parity',family,results.length,'plus gate, path and failed-device fallback');
 }finally{await native?.close();await session.close();}
 }
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({passed:true,cases:rows.length,hardware:'CUDA receipts required; CPU interpreter invocations and ordinary successor readback must be zero',scope:'Shipped production helpers, full score/count/path equality, private gates, simultaneous discovery and exact scoring, independent original-engine replay, failed GPU native completion.'},null,2));
})().catch(e=>{fs.writeFileSync(path.join(out,'FAILED.txt'),e.stack);console.error(e);process.exitCode=1;});
