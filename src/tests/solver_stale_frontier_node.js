#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
process.env.PUZZLESCRIPT_SOLVER_SKIP_STALE='1';
const {VisitedStateBuckets,recordVisitedDepth,skipStaleFrontierNode,reconstruct}=require('./run_solver_tests_js').__solverSearchInternals;
const result=()=>({frontier_pops:0,stale_frontier_entries:0,stale_pops:0});
let live='root';const nodes=[{snapshot:'root',depth:0,parent:-1,input:null}];
const visited=new VisitedStateBuckets(nodes,{matchesSnapshot:snapshot=>snapshot===live});
nodes[0].visitedEntry=visited.addInitial(0,0);
nodes.push({snapshot:'A',depth:6,parent:0,input:'long'});
nodes[1].visitedEntry=visited.record(42,6,1,null,false);
live='A';const better=visited.find(42,2);assert.equal(better.duplicate,false);
nodes.push({snapshot:'A',depth:2,parent:0,input:'short'});
nodes[2].visitedEntry=visited.record(42,2,2,better.entry,false);
assert.equal(nodes[1].visitedEntry,nodes[2].visitedEntry);
const metrics=result();assert(skipStaleFrontierNode(nodes[1],1,metrics));assert.equal(skipStaleFrontierNode(nodes[2],2,metrics),false);
assert.deepEqual(metrics,{frontier_pops:2,stale_frontier_entries:1,stale_pops:1});
// A hash collision has its own stable record and cannot dominate another state.
live='B';const collision=visited.find(42,1);assert(collision.collided);assert.equal(collision.entry,null);
nodes.push({snapshot:'B',depth:1,parent:1,input:'branch'});
nodes[3].visitedEntry=visited.record(42,1,3,null,true);
assert.equal(skipStaleFrontierNode(nodes[3],3,result()),false);
assert.notEqual(nodes[3].visitedEntry,nodes[2].visitedEntry);
assert.equal(visited.size,3);assert.equal(visited.collisions,1);
// Descendants can still reconstruct through an obsolete ancestor.
assert.deepEqual(reconstruct(nodes,3,'win'),['long','branch','win']);
assert.equal(nodes[1].snapshot,'A');
const map=new Map();const record=recordVisitedDepth(map,'state',5,1);
assert.equal(recordVisitedDepth(map,'state',2,2),record);
assert(skipStaleFrontierNode({visitedEntry:record},1,result()));
assert.equal(skipStaleFrontierNode({visitedEntry:record},2,result()),false);
const child=spawnSync(process.execPath,['-e',`const assert=require('node:assert/strict');const {skipStaleFrontierNode}=require(${JSON.stringify(require.resolve('./run_solver_tests_js'))}).__solverSearchInternals;const r={frontier_pops:0,stale_frontier_entries:0,stale_pops:0};assert.equal(skipStaleFrontierNode({visitedEntry:{index:2}},1,r),false);assert.equal(r.stale_frontier_entries,1);assert.equal(r.stale_pops,0);`],{env:{...process.env,PUZZLESCRIPT_SOLVER_SKIP_STALE:'0'},encoding:'utf8',windowsHide:true});
assert.equal(child.status,0,child.stderr);
// Exercise the real search and both visited representations on a reopening
// case. Older parents remain usable while their queued expansions are skipped.
const path=require('node:path');
function search(skip,mapFallback) {
    const run=spawnSync(process.execPath,[path.join(__dirname,'run_solver_tests_js.js'),path.join(__dirname,'solver_tests'),
        '--game','15 push pull levels.txt','--level','17','--timeout-ms','3000','--jobs','1','--strategy','weighted-astar','--quiet','--json'],
        {env:{...process.env,PUZZLESCRIPT_SOLVER_SKIP_STALE:String(skip),PUZZLESCRIPT_DISABLE_HASH_BUCKETS:mapFallback?'1':'0'},encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
    assert.equal(run.status,0,run.stderr);
    const row=JSON.parse(run.stdout).results.find(row=>row.level===17);
    assert.equal(row.status,'solved');
    return row;
}
const unpruned=search(0,false),bucketed=search(1,false),mapped=search(1,true);
assert(bucketed.stale_pops>0 && mapped.stale_pops>0);
assert.deepEqual(bucketed.solution,unpruned.solution);
assert.deepEqual(mapped.solution,unpruned.solution);
assert(bucketed.expanded<unpruned.expanded);
console.log('solver_stale_frontier_node passed');
