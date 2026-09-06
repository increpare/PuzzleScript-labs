#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const assert = require('assert');
const [folder, prefix] = process.argv.slice(2).map(p=>path.resolve(p));
assert(folder && prefix, 'Usage: summarize_solver_corpus.js RUN_DIRECTORY OUTPUT_PREFIX');
const manifest = JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
assert.strictEqual(manifest.runs.length,manifest.pairs*4,'Incomplete battery');
const hash = data=>crypto.createHash('sha256').update(data).digest('hex');
const median = xs=>xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const key = r=>JSON.stringify([r.game,r.level]);
const strict = r=>r.status==='solved'&&r.elapsed_ms<manifest.timeout_ms;
const raw={manifest,observations:{}};
for(const record of [...manifest.warmups,...manifest.runs]) {
    const buf=fs.readFileSync(path.join(folder,record.label+'.json'));
    assert.strictEqual(hash(buf),record.sha256,'Raw observation changed');
    raw.observations[record.label]=JSON.parse(buf);
}
const summary={timeout_ms:manifest.timeout_ms,pairs:manifest.pairs,source_files:manifest.sources.length,engines:{}};
const changes=[];
for(const engine of ['native','js']) {
    const records=manifest.runs.filter(r=>r.engine===engine);
    const runs={};
    for(const side of ['before','after']) runs[side]=records.filter(r=>r.side===side).sort((a,b)=>a.pair-b.pair).map(r=>raw.observations[r.label].results.filter(row=>row.status!=='skipped_message'));
    const counts={};
    for(const side of ['before','after']) counts[side]=runs[side].map(run=>run.filter(strict).length);
    const result={playable:runs.before[0].length,strict_counts:counts,median_strict:{before:median(counts.before),after:median(counts.after)},
        budget_solved:{},late_solved:{},errors:records.map(r=>({side:r.side,pair:r.pair,errors:r.errors,replay_rejected:r.replay_rejected})),pairs:[],thresholds:[]};
    for(const side of ['before','after']) {
        result.budget_solved[side]=runs[side].map(run=>run.filter(r=>r.status==='solved').length);
        result.late_solved[side]=runs[side].map(run=>run.filter(r=>r.status==='solved'&&!strict(r)).length);
    }
    for(let p=0;p<manifest.pairs;p++) {
        const before=new Set(runs.before[p].filter(strict).map(key)), after=new Set(runs.after[p].filter(strict).map(key));
        result.pairs.push({pair:p+1,before:before.size,after:after.size,delta:after.size-before.size,
            gained:[...after].filter(k=>!before.has(k)).map(JSON.parse),lost:[...before].filter(k=>!after.has(k)).map(JSON.parse)});
    }
    const rows=new Map();
    for(const side of ['before','after']) for(const run of runs[side]) for(const row of run) {
        const k=key(row);
        if(!rows.has(k)) rows.set(k,{game:row.game,level_index:row.level,before:[],after:[]});
        rows.get(k)[side].push(row);
    }
    result.stable_gains=[];result.stable_losses=[];result.changed_levels=[];
    for(const row of rows.values()) {
        assert.strictEqual(row.before.length,manifest.pairs);assert.strictEqual(row.after.length,manifest.pairs);
        const before=row.before.filter(strict).length,after=row.after.filter(strict).length;
        if(row.before.some((r,p)=>strict(r)!==strict(row.after[p]))) {
            const change={engine,game:row.game,level_index:row.level_index,before_solved_runs:before,after_solved_runs:after,
                classification:before===0&&after===manifest.pairs?'stable_gain':after===0&&before===manifest.pairs?'stable_loss':after===before?'mixed_same_frequency':after>before?'more_often_solved':'less_often_solved',
                before:row.before.map(r=>({status:r.status,elapsed_ms:r.elapsed_ms})),after:row.after.map(r=>({status:r.status,elapsed_ms:r.elapsed_ms}))};
            changes.push(change);result.changed_levels.push(change);
            if(change.classification==='stable_gain') result.stable_gains.push([row.game,row.level_index]);
            if(change.classification==='stable_loss') result.stable_losses.push([row.game,row.level_index]);
        }
    }
    for(const threshold of [1,5,10,25,50,100,150,200,manifest.timeout_ms].filter((v,i,a)=>v<=manifest.timeout_ms&&a.indexOf(v)===i)) {
        const before=runs.before.map(run=>run.filter(r=>r.status==='solved'&&r.elapsed_ms<threshold).length);
        const after=runs.after.map(run=>run.filter(r=>r.status==='solved'&&r.elapsed_ms<threshold).length);
        result.thresholds.push({threshold_ms:threshold,before,after,before_median:median(before),after_median:median(after)});
    }
    summary.engines[engine]=result;
}
fs.mkdirSync(path.dirname(prefix),{recursive:true});
fs.writeFileSync(prefix+'-summary.json',JSON.stringify(summary,null,2)+'\n');
// Keep every result/counter/solution from every completed observation, including
// warmups, rather than retaining only the attractive outcomes. Compression is
// lossless and keeps repetitive per-level instrumentation from bloating the PR.
fs.writeFileSync(prefix+'-raw.json.gz',zlib.gzipSync(JSON.stringify(raw),{level:9}));
const csv=v=>'"'+String(v).replaceAll('"','""')+'"';
const columns=['engine','game','level_index','before_solved_runs','after_solved_runs','classification'];
fs.writeFileSync(prefix+'-changed-levels.csv',[columns.join(','),...changes.map(row=>columns.map(k=>csv(row[k])).join(','))].join('\n')+'\n');
for(const [engine,result] of Object.entries(summary.engines)) console.log(engine,JSON.stringify({strict:result.strict_counts,medians:result.median_strict,budget:result.budget_solved,late:result.late_solved,stable_gains:result.stable_gains,stable_losses:result.stable_losses}));
