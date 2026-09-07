#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {spawnSync}=require('child_process');
if(process.argv.length<7||process.argv.length>9)throw Error('Usage: run_portfolio_diagnosis.js DIAGNOSTIC_EXE REFERENCE_EXE CORPUS CASES_PREFIX OUTPUT_DIR [TIMEOUT_MS=250] [REPEATS=3]');
const [binary,reference,corpus,casesPrefix,output]=process.argv.slice(2,7).map(p=>path.resolve(p));
const budget=Number(process.argv[7]||250),repeats=Number(process.argv[8]||3);
assert(Number.isSafeInteger(budget)&&budget>0&&Number.isSafeInteger(repeats)&&repeats>0);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const cases=JSON.parse(fs.readFileSync(casesPrefix+'.json')).cases;
assert.equal(cases.length,32);
for(const c of cases)assert.equal(hash(path.join(corpus,c.game)),c.source_sha256);
fs.mkdirSync(output,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('PUZZLESCRIPT_')));
const report={binary_hashes:[binary,reference].map(hash),cases_sha256:hash(casesPrefix+'.json'),
  timeout_ms:budget,repeats,
  scope:'32 frozen cases, compact nodes and auto heuristic for every strategy. Source compilation excluded; search plus built-in player replay inside reported elapsed time. No PUZZLESCRIPT overrides. Diagnostic-only lock override, production defaults unchanged.',
  runs:[],checks:[]};
function run(label,mode,budget,{cap=0,trace=false,exe=binary,tsv=casesPrefix+'.tsv',expected=32}={}){
  const args=[corpus,tsv,mode,String(budget),String(cap),trace?'trace':'quiet'];
  const t=performance.now();
  const r=spawnSync(exe,args,{env,encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:64000000});
  fs.writeFileSync(path.join(output,label+'.jsonl'),r.stdout||'');
  fs.writeFileSync(path.join(output,label+'.stderr'),r.stderr||'');
  if(r.error)throw r.error;
  assert.equal(r.status,0,r.stderr);
  const rows=r.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,expected);
  assert(rows.every(r=>!r.result.status.includes('error')&&!r.result.compiled_rules_attached));
  const record={label,mode,budget,cap,trace,wall_ms:performance.now()-t,sha256:hash(path.join(output,label+'.jsonl')),
    solved:rows.filter(r=>r.result.status==='solved'&&r.result.elapsed_ms<budget).length};
  report.runs.push(record);fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(label,record.solved,record.wall_ms.toFixed(0));
  return rows;
}
const signature=rows=>rows.map(({result:r})=>[r.game,r.level,r.status,r.expanded,r.generated,r.unique_states,r.duplicates,r.solution]);
// Recording must not change deterministic work when the clock-dependent lock
// is disabled, or before its earliest activation. Timeouts invalidate this check.
for(const [mode,cap] of [['auto',64],['no-lock',256]]){
  const a=run(`check-${mode}-trace`,mode,60000,{cap,trace:true});
  const b=run(`check-${mode}-quiet`,mode,60000,{cap});
  assert(a.every(r=>r.result.status!=='timeout')&&b.every(r=>r.result.status!=='timeout'));
  assert.deepStrictEqual(signature(a),signature(b));
  report.checks.push({mode,cap,identical_results:32});
}
const warmup=path.join(output,'warmup.tsv');
fs.writeFileSync(warmup,cases.filter(c=>c.stratum==='easy').slice(0,2).map(c=>c.game+'\t'+c.level).join('\n')+'\n');
const configs=['reference','auto','no-lock','wa2','wa8','greedy','bfs'];
for(const mode of configs)run('warmup-'+mode,mode==='reference'?'auto':mode,25,{exe:mode==='reference'?reference:binary,tsv:warmup,expected:2});
for(let repeat=0;repeat<repeats;repeat++){
  const offset=(repeat*2)%configs.length;
  let order=configs.slice(offset).concat(configs.slice(0,offset));
  if(repeat%2)order=order.reverse();
  for(const mode of order)run(`${mode}-${repeat+1}`,mode==='reference'?'auto':mode,budget,{exe:mode==='reference'?reference:binary});
}
// Separate explanatory traces from deadline comparisons; recording itself can
// perturb a clock-triggered decision. Never substitute trace timings for quiet.
for(const mode of ['auto','no-lock'])run('trace-'+mode,mode,budget,{trace:true});
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
