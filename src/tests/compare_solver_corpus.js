#!/usr/bin/env node
'use strict';
// Measure actual deadline-limited solve counts, not an expansion proxy. Each
// revision runs its own solver/engine on identical source bytes. Serial,
// alternating runs reduce contention between measurements and run-order bias.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const args = process.argv.slice(2);
if (args.length < 5) throw Error('Usage: compare_solver_corpus.js BEFORE_ROOT AFTER_ROOT BEFORE_NATIVE AFTER_NATIVE OUTPUT_DIR [PAIRS=3] [TIMEOUT_MS=250]');
const roots = args.slice(0,2).map(p=>path.resolve(p));
const binaries = args.slice(2,4).map(p=>path.resolve(p));
const output = path.resolve(args[4]);
const pairs = Number(args[5] || 3), timeout = Number(args[6] || 250);
assert(Number.isSafeInteger(pairs) && pairs > 0 && Number.isSafeInteger(timeout) && timeout > 0);
fs.mkdirSync(output, {recursive:true});
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const corpus = path.join(roots[1], 'src/tests/solver_tests');
const manifest = root => fs.readdirSync(path.join(root,'src/tests/solver_tests')).filter(f=>f.endsWith('.txt')).sort().map(name=>({name,sha256:hash(fs.readFileSync(path.join(root,'src/tests/solver_tests',name)))}));
assert.deepStrictEqual(manifest(roots[0]),manifest(roots[1]),'Corpus changed; use a shared explicit corpus before comparing');
// Do not accidentally inherit an opt-in pruning/profiling experiment from the
// invoking shell. Each runner supplies its own normal default settings.
const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('PUZZLESCRIPT_')));
const report = {schema:1, timeout_ms:timeout, pairs, node:process.version, platform:process.platform,
    scope:'Serial before/after full-corpus runs; native portfolio, JS weighted-astar; one worker, normal default instrumentation, no opt-in experiments or native generated kernels. Separate smoke warmups are excluded. Per-level elapsed_ms excludes source compilation; process wall is also retained. Strict counts require status=solved AND elapsed_ms < timeout_ms.',
    roots, binaries, binary_sha256:binaries.map(p=>hash(fs.readFileSync(p))),
    source_sha256:roots.map(root=>Object.fromEntries(['src/tests/run_solver_tests_js.js','src/js/compiler.js','src/js/engine.js','native/src/solver/main.cpp','native/src/runtime/core.cpp','native/src/compiler/lower_to_runtime.cpp'].map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]))),
    sources:manifest(roots[1]), runs:[], warmups:[]};
const persist = () => fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
persist();
const key = row => JSON.stringify([row.game,row.level]);
const expectedKeys = {};
function run(engine, side, pair, warmup=false) {
    const label = `${engine}-${side ? 'after' : 'before'}-${warmup ? 'warmup' : pair+1}`;
    const command = engine === 'native' ? binaries[side] : process.execPath;
    const target = warmup ? path.join(roots[1],'src/tests/solver_smoke_tests') : corpus;
    const argv = [...(engine==='js'?[path.join(roots[side],'src/tests/run_solver_tests_js.js')]:[]),target,
        '--timeout-ms',String(timeout),'--strategy',engine==='native'?'portfolio':'weighted-astar',
        '--no-solutions','--json','--progress-per-game',...(engine==='native'?['--jobs','1']:[])];
    const record = {engine,side:side?'after':'before',pair:pair+1,label,command,args:argv,started_utc:new Date().toISOString()};
    fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify(record,null,2)+'\n');
    console.log(`Starting ${label}`);
    return new Promise((resolve,reject)=>{
        const start = performance.now();
        const out = fs.openSync(path.join(output,label+'.json'),'w');
        const err = fs.openSync(path.join(output,label+'.stderr.txt'),'w');
        const child = spawn(command,argv,{cwd:roots[side],env,windowsHide:true,stdio:['ignore',out,err]});
        const guard = setTimeout(()=>child.kill(),20*60*1000);
        child.on('error', reject);
        child.on('close', code=>{
            clearTimeout(guard); fs.closeSync(out); fs.closeSync(err);
            try {
                record.wall_ms = performance.now()-start;
                record.exit_code=code;
                assert.strictEqual(code,0,`${label} failed; see its stderr`);
                const raw=fs.readFileSync(path.join(output,label+'.json'));
                const data=JSON.parse(raw);
                const playable=data.results.filter(r=>r.status!=='skipped_message');
                const keys=playable.map(key).sort();
                assert.strictEqual(new Set(keys).size,keys.length,'Duplicate level keys');
                if(!warmup) {
                    if(expectedKeys[engine]) assert.deepStrictEqual(keys,expectedKeys[engine],'Before/after playable denominators differ');
                    else expectedKeys[engine]=keys;
                }
                record.sha256=hash(raw); record.totals=data.totals; record.playable=playable.length;
                record.solved_under_budget=playable.filter(r=>r.status==='solved').length;
                record.solved_strict=playable.filter(r=>r.status==='solved'&&r.elapsed_ms<timeout).length;
                record.solved_at_or_above_limit=record.solved_under_budget-record.solved_strict;
                record.errors=playable.filter(r=>/error/.test(r.status)).map(r=>({game:r.game,level:r.level,status:r.status,error:r.error}));
                record.replay_rejected=playable.reduce((sum,r)=>sum+(r.replay_rejected||0),0);
                if(engine==='native') assert(playable.every(r=>!r.compiled_rules_attached&&!r.specialized_full_turn_attached&&!r.specialized_compact_turn_attached),'Unexpected native kernel attachment');
                (warmup?report.warmups:report.runs).push(record); persist();
                console.log(`${label}: ${record.solved_strict}/${record.playable} strictly <${timeout}ms; ${record.solved_under_budget} solved under budget; ${record.errors.length} errors; ${(record.wall_ms/1000).toFixed(1)}s wall`);
                resolve();
            } catch(error) { reject(error); }
        });
    });
}
(async()=>{
    for(const engine of ['native','js']) for(const side of [0,1]) await run(engine,side,-1,true);
    for(let pair=0;pair<pairs;pair++) {
        for(const engine of pair%2?['js','native']:['native','js'])
            for(const side of pair%2?[1,0]:[0,1]) await run(engine,side,pair);
    }
    fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify({complete:true,runs:report.runs.length})+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
