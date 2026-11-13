'use strict';
// Installed as src/tests/again_solver_parity_node.cjs; small, headless regression.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread){
 require('./js_oracle/lib/puzzlescript_node_env.js').loadPuzzleScript();global.PuzzleScriptTestAssertions={push(){},equal(){}};
 const load=loadLevelFromState;loadLevelFromState=(game,index,seed)=>load(game,index,seed==null?'again-regression:level:'+index:seed);
 const traces=[];
 for(const fixture of workerData.fixtures){
  unitTesting=true;lazyFunctionGeneration=false;compile(['loadLevel',0],fixture.source,fixture.seed);assert.equal(errorCount,0);verbose_logging=false;
  const states=[];const capture=()=>{let after={dat:level.objects,width:level.width,height:level.height,oldflickscreendat};const history=Array(backups.length);for(let i=backups.length-1;i>=0;i--){after=unconsolidateDiff(backups[i],after);history[i]=[...after.dat];}return {board:[...level.objects],movements:[...level.movements],rng:JSON.parse(JSON.stringify(RandomGen._state)),history,restart:JSON.parse(JSON.stringify(restartTarget)),againing,checkpoint:storage_get(document.URL+'_checkpoint')};};
  const drain=()=>{let n=0;while(againing){assert(++n<200);const beforeLevel=level;processInput(-1,undefined,undefined,workerData.fast);if(workerData.fast)assert.equal(level,beforeLevel,'Solver snapshots require stable level identity across AGAIN');states.push(capture());}};
  states.push(capture());drain();for(const op of fixture.inputs){if(op==='undo')DoUndo(false,true);else if(op==='restart')DoRestart(false);else processInput(op,undefined,undefined,workerData.fast);states.push(capture());drain();}
  traces.push(states);
 }
 parentPort.postMessage(traces);
}else{
 const fixtures=[
  {file:'again-random.ps',seed:'split-colors-5',inputs:[4,'undo',4,'restart']},
  {file:'again-checkpoint.ps',seed:'dead-probe',inputs:[4,'restart','undo',4]},
  {file:'unchanged-win.ps',seed:'unchanged-win',inputs:[4]},
 ].map(f=>({...f,source:fs.readFileSync(path.join(__dirname,'fixtures/again',f.file),'utf8')}));
 const run=fast=>new Promise((resolve,reject)=>{const w=new Worker(__filename,{workerData:{fast,fixtures}});w.once('message',resolve);w.once('error',reject);});
 Promise.all([run(false),run(true)]).then(([player,solver])=>{assert.deepEqual(solver,player,'Solver fast path must preserve player RNG, probes, checkpoints and history');console.log('again_solver_parity_node: vanilla probe parity passed');}).catch(e=>{console.error(e);process.exitCode=1;});
}
