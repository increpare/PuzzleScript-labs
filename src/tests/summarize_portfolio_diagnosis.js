#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
if(process.argv.length!==5)throw Error('Usage: summarize_portfolio_diagnosis.js STUDY_DIR CASES_JSON OUTPUT_JSON');
const [dir,caseFile,output]=process.argv.slice(2),cases=JSON.parse(fs.readFileSync(caseFile)).cases;
const modes=['reference','auto','no-lock','wa2','wa8','greedy','bfs'];
const read=label=>fs.readFileSync(path.join(dir,label+'.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const pass=r=>r.result.status==='solved'&&r.result.elapsed_ms<250;
const runs=Object.fromEntries(modes.map(m=>[m,[1,2,3].map(n=>read(m+'-'+n))]));
for(const batches of Object.values(runs))for(const rows of batches)assert.deepStrictEqual(rows.map(r=>[r.result.game,r.result.level]),cases.map(c=>[c.game,c.level]));
const summary={counts:{},partitions:{},stable_changes:{},per_case:[],trace:{}};
for(const m of modes){
  summary.counts[m]=runs[m].map(r=>r.filter(pass).length);
  summary.partitions[m]=Object.fromEntries(['discovery','validation'].map(p=>[p,runs[m].map(r=>r.filter((v,i)=>cases[i].partition===p&&pass(v)).length)]));
  const gains=[],losses=[];
  for(let i=0;i<cases.length;i++){
    if(runs.auto.every(r=>!pass(r[i]))&&runs[m].every(r=>pass(r[i])))gains.push([cases[i].game,cases[i].level]);
    if(runs.auto.every(r=>pass(r[i]))&&runs[m].every(r=>!pass(r[i])))losses.push([cases[i].game,cases[i].level]);
  }
  summary.stable_changes[m]={gains,losses};
}
for(let i=0;i<cases.length;i++)summary.per_case.push({...cases[i],modes:Object.fromEntries(modes.map(m=>[m,runs[m].map(r=>({solved:pass(r[i]),elapsed_ms:r[i].result.elapsed_ms,expanded:r[i].result.expanded,generated:r[i].result.generated,lock_expanded:r[i].diagnosis.lock_expanded}))]))});
for(const m of ['auto','no-lock']){
  const rows=read('trace-'+m);
  summary.trace[m]=rows.map(({result:r,diagnosis:d})=>({game:r.game,level:r.level,solved:pass({result:r}),expanded:r.expanded,
    lock_expanded:d.lock_expanded,initial_h:d.initial_h,best_h:d.best_h,
    fraction_after_last_h_improvement:r.expanded?(r.expanded-d.last_improvement_expanded)/r.expanded:0,
    lanes:d.lanes,events:d.events,dropped_events:d.dropped_events}));
}
summary.opportunity={stable_portfolio:cases.filter((c,i)=>runs.auto.every(r=>pass(r[i]))).length,
  stable_any_fixed:cases.filter((c,i)=>['wa2','wa8','greedy','bfs'].some(m=>runs[m].every(r=>pass(r[i])))).map(c=>[c.game,c.level]),
  stable_fixed_additions:cases.filter((c,i)=>runs.auto.every(r=>!pass(r[i]))&&['wa2','wa8','greedy','bfs'].some(m=>runs[m].every(r=>pass(r[i])))).map(c=>[c.game,c.level])};
fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({counts:summary.counts,partitions:summary.partitions,stable_changes:summary.stable_changes,opportunity:summary.opportunity},null,2));
for(const m of ['auto','no-lock']){
 const rows=summary.trace[m],timed=rows.filter(r=>!r.solved);
 console.log(m,{locked:rows.filter(r=>r.lock_expanded).map(r=>[r.game,r.level,r.lock_expanded]),
   one_lane:rows.filter(r=>r.lanes.filter(l=>l.expanded>0).length===1).length,
   timeout_best_zero:timed.filter(r=>r.best_h===0).map(r=>[r.game,r.level]),
   timeout_no_improvement:timed.filter(r=>r.best_h===r.initial_h).length});
}
