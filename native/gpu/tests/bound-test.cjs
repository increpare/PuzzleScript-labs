'use strict';
const assert=require('node:assert/strict'),{cutoffEvidence}=require('./scoring-bound.cjs');
const base={primary:{status:'solved',expanded:100,refined:true},cap:106,gpu:{status:'solved',exact_score:true,expanded:9},privateState:{localFull:true,localFloor:10,eliteFull:true,eliteFloor:9,baseEffort:9},globalFloor:10,globalFull:true};
assert(cutoffEvidence(base).canReject);
for(const override of [
 {primary:{...base.primary,refined:false}}, {cap:105}, {gpu:{...base.gpu,expanded:107}}, {gpu:{status:'unknown'}},
 {privateState:null}, {globalFull:false}, {globalFloor:9},
 {privateState:{...base.privateState,localFull:false}}, {privateState:{...base.privateState,localFloor:9}},
 {privateState:{...base.privateState,eliteFull:false}}, {privateState:{...base.privateState,eliteFloor:8}},
 {privateState:{...base.privateState,baseEffort:8}}
])assert(!cutoffEvidence({...base,...override}).canReject,JSON.stringify(override));
const initial={...base,primary:{status:'solved',expanded:0,refined:true},cap:6,gpu:{status:'solved',exact_score:true,expanded:0},globalFloor:1};
assert.equal(cutoffEvidence(initial).upper,1);assert(!cutoffEvidence(initial).canReject,'Zero-work root wins still tie effort1');
console.log('Cutoff evidence: native gate/cap, root wins, shortlist ties, private elites and reward preservation passed; pruning stays disabled');
