#!/usr/bin/env node
'use strict';
// Freeze selection from baseline-only observations, before running any ablation.
// One level per distinct game/source prevents a long game dominating the sample.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
if(process.argv.length!==6) throw Error('Usage: select_portfolio_diagnosis_cases.js BASELINE_250_DIR PR13_3000_DIR CORPUS OUTPUT_PREFIX');
const [shortDir,longDir,corpus,prefix]=process.argv.slice(2);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const shortManifest=read(path.join(shortDir,'manifest.json'));
const longManifest=read(path.join(longDir,'manifest.json'));
assert.equal(shortManifest.binary_hashes[0],longManifest.binary_hashes[1],'Selection budgets must use the same PR13 baseline');
assert.deepStrictEqual(shortManifest.sources,longManifest.sources,'Selection corpora differ');
const short=Array.from({length:3},(_,i)=>read(path.join(shortDir,`before-${i+1}.json`)).results);
const long=Array.from({length:3},(_,i)=>new Map(read(path.join(longDir,`after-${i+1}.json`)).results.map(r=>[JSON.stringify([r.game,r.level]),r])));
const maps=short.map(run=>new Map(run.map(r=>[JSON.stringify([r.game,r.level]),r])));
const median=a=>a.slice().sort((x,y)=>x-y)[1];
const pools={easy:[],near:[],deeper:[],hard:[]};
for(const r of short[0]){
  if(r.status==='skipped_message')continue;
  const key=JSON.stringify([r.game,r.level]), a=maps.map(m=>m.get(key)),b=long.map(m=>m.get(key));
  assert(a.every(Boolean)&&b.every(Boolean));
  const pass=(r,t)=>r.status==='solved'&&r.elapsed_ms<t;
  let stratum;
  if(a.every(r=>pass(r,100))&&a.every(r=>r.solution_length>0))stratum='easy';
  else if(a.every(r=>pass(r,250))&&median(a.map(r=>r.elapsed_ms))>=100)stratum='near';
  else if(a.every(r=>!pass(r,250))&&b.every(r=>pass(r,3000)))stratum='deeper';
  else if(a.every(r=>r.status==='timeout')&&b.every(r=>r.status==='timeout'))stratum='hard';
  if(!stratum)continue;
  pools[stratum].push({game:r.game,level:r.level,stratum,profile:r.portfolio_profile,
    baseline_250_ms:a.map(r=>r.elapsed_ms),baseline_3000_ms:b.map(r=>r.elapsed_ms),
    has_action:r.portfolio_has_action_input,late_rules:r.portfolio_late_rule_count,
    random:r.portfolio_uses_random,
    source_sha256:hash(fs.readFileSync(path.join(corpus,r.game))),
    selection_key:hash('portfolio-diagnosis-v1\t'+key)});
}
const cases=[],usedGames=new Set(),usedSources=new Set();
// Fill scarce strata first. The order and quota are fixed, not adjusted to results.
for(const stratum of ['near','deeper','hard','easy']){
  const candidates=pools[stratum].sort((a,b)=>a.selection_key.localeCompare(b.selection_key));
  let n=0;
  for(const row of candidates){
    if(usedGames.has(row.game)||usedSources.has(row.source_sha256))continue;
    usedGames.add(row.game);usedSources.add(row.source_sha256);
    cases.push({...row,partition:n%2?'validation':'discovery'});
    if(++n===8)break;
  }
  assert.equal(n,8,`Not enough distinct games in ${stratum}`);
}
cases.sort((a,b)=>a.selection_key.localeCompare(b.selection_key));
const report={selection:'Eight baseline-only cases per difficulty stratum, SHA-256 order, one level per game and source hash. Alternating within-stratum discovery/validation assignment. No ablation results used.',
  input_manifests:[shortDir,longDir].map(d=>({path:d,sha256:hash(fs.readFileSync(path.join(d,'manifest.json')))})),
  pool_sizes:Object.fromEntries(Object.entries(pools).map(([k,v])=>[k,v.length])),cases};
fs.mkdirSync(path.dirname(prefix),{recursive:true});
fs.writeFileSync(prefix+'.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(prefix+'.tsv',cases.map(r=>r.game+'\t'+r.level).join('\n')+'\n');
console.log(JSON.stringify({pool_sizes:report.pool_sizes,cases:cases.map(r=>[r.stratum,r.game,r.level,r.profile])},null,2));
