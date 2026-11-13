'use strict';
const assert=require('node:assert/strict'),{FairBroker}=require('../../../desktop/mis/backend/mis/fair-broker.cjs');
const turn=()=>new Promise(r=>setImmediate(r));
(async()=>{
 let now=0;const broker=new FairBroker({slots:1,capacity:64,clock:()=>now}),grants=[],releases=[];
 const request=(base,context,covered,signal)=>broker.submit({base,context,covered:()=>covered,signal,run:()=>{grants.push([base,context]);return new Promise(resolve=>releases.push(()=>resolve({status:'solved',effort:7})));}});
 const pending=[request('occupied',0,true)];await turn();
 for(let i=0;i<12;i++)pending.push(request('covered',i%3,true));
 for(const base of ['newA','newB','newC'])for(let i=0;i<3;i++)pending.push(request(base,i,false));
 // Abort queued work must never run, and must release its declared storage.
 const abort=new AbortController();pending.push(request('cancelled',0,false,abort.signal));abort.abort();
 now=1000;
 for(let i=0;i<22;i++){assert(releases.length);releases.shift()();await turn();}
 const results=await Promise.all(pending);assert.equal(results.filter(r=>r.cancelled).length,1);assert(!grants.some(([b])=>b==='cancelled'));
 assert.deepEqual(grants.slice(1,4).map(([base])=>base),['newA','newB','newC']);
 assert(grants.slice(1,10).some(([base])=>base==='covered'),'Aged covered work must get a bounded turn');
 for(const base of ['newA','newB','newC'])assert.deepEqual(grants.filter(([b])=>b===base).map(([,c])=>c),[0,1,2]);
 assert.equal(broker.retained,0);assert.equal(broker.stats.completed,broker.stats.submitted);broker.close();
 console.log('Fair admission: uncovered bases, context rotation, aging, cancellation and storage release passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
