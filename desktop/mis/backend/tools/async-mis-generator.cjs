'use strict';
// Adapt the actual, hash-checked MIS loop's backend call sites to promises.
// Default adaptation preserves the authored policy exactly. Optional explicit
// refinement replaces retry selection/feedback attribution, never transforms.
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const SUPPORTED='78c93a3dbabcff6fd38791ac4217766ca4703dd81241dcaf2f16d5d2dc915d74';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function loadAsyncGenerator(file,core,clock=performance,options={}){const original=fs.readFileSync(file,'utf8');if(hash(original)!==SUPPORTED)throw Error('Unsupported MIS generator source revision; rerun adaptation equivalence tests before updating its hash');let source=original;const edits=[];
 function replace(a,b,count){const actual=source.split(a).length-1;if(actual!==count)throw Error(`Unsupported MIS source shape: ${a} (${actual}, expected ${count})`);source=source.split(a).join(b);edits.push({from:a,to:b,count});}
 for(const name of ['step()','stepWith(program)','assessLazy(board, retried)','assessLegacy(board, retried)'])replace('function '+name,'async function '+name,1);
 replace('const found = stepWith(', 'const found = await stepWith(',1);replace('backend.assess(', 'await backend.assess(',4);replace('backend.solve(', 'await backend.solve(',2);
 if(options.incrementalWork)replace('let n = r.expanded || 0;', 'let n = r.workExpanded !== undefined ? r.workExpanded : (r.expanded || 0);',1);
 if(options.boundedDiscovery){
  // A bounded discovery search did not run a MIS assessment. Preserve its
  // unknown outcome without parking the board as a native timeout or inflating
  // the private CPU budget. No solvability/score conclusion is inferred.
  replace("if (r.status !== 'solved') return recordUnsolved(r, ms, board, retried);", "if (r.status === 'unknown' && r.bounded_unknown) { stats.discoveryUnknown = (stats.discoveryUnknown || 0) + 1; return null; }\n            if (r.status !== 'solved') return recordUnsolved(r, ms, board, retried);",1);
 }
 if(options.observeScoringState)replace('best: function () { return topEfforts.slice(); },','best: function () { return topEfforts.slice(); },\n            scoringState: function () { return { localFull: topEfforts.length >= keepCount, localFloor: floor(), eliteFull: !eliteParents || elite.length >= eliteSize, eliteFloor: eliteParents ? (elite.length ? elite[elite.length - 1].effort : 0) : 1000000000, eliteCount: elite.length, eliteSize: eliteSize, baseEffort: baseEffort }; },',1);
 if(options.priorityRefinement){
  if(!options.incrementalWork)throw Error('Priority refinement requires incremental work accounting');
  replace('const parked = [];',"const parked = []; const retryQueue = opts.retryQueue; if (!retryQueue) throw new Error('Priority retry queue required'); let feedbackOrigin = null;",1);
  const oldRetry="\t\t\tfor (let i = 0; i < parked.length; i++) {\r\n\t\t\t\tif (parked[i].budget * retryGrowth < budget || (retryGrowth > 1 && budget >= maxBudget && parked[i].budget < budget)) { board = parked[i].board; parked.splice(i, 1); retried = true; break; }\r\n\t\t\t}";
  const retry=source.includes(oldRetry)?oldRetry:oldRetry.replaceAll('\r\n','\n');
  replace(retry,"feedbackOrigin = { group: groupIndex, arm: groups[groupIndex].armIndex, parentEffort: baseEffort, refinement: false };\n            const retry = retryQueue.take({ floor: floor() });\n            if (retry) { board = retry.board; feedbackOrigin = retry.origin; retried = true; }",1);
  replace('board = C.runTransform(model, program, pickParent(), frozen, rng);',"const parent = pickParent(); const knownParent = elite.find(function (e) { return e.board === parent; }); feedbackOrigin.parentEffort = knownParent ? knownParent.effort : baseEffort;\n                board = C.runTransform(model, program, parent, frozen, rng);",1);
  replace('if (parked.length < 32) parked.push({ board: board, budget: budget });','retryQueue.put({ board: board, origin: feedbackOrigin, primary: primary });',1);
  replace('[arm, group].forEach(function (a) { a.ms += spent; a.pulls++; a.reward += reward; });',"const feedbackGroup = groups[feedbackOrigin.group], feedbackArm = feedbackGroup.arms[feedbackOrigin.arm];\n            [feedbackArm, feedbackGroup].forEach(function (a) { a.ms += spent; a.pulls++; a.reward += reward; });\n            retryQueue.charge({ work: workStates - w0, kind: feedbackOrigin.refinement ? 'refine' : 'explore' });",1);
  replace('group.armIndex = pickArm(group.arms);','feedbackGroup.armIndex = pickArm(feedbackGroup.arms);',1);
 }
 if(options.validFeedback){
  if(!options.priorityRefinement)throw Error('Valid-parent feedback requires explicit priority refinement');
  replace('let feedbackOrigin = null;',"let feedbackOrigin = null; const feedback = opts.feedback; if (!feedback) throw new Error('Valid-parent feedback required'); let backgroundWork = 0;",1);
  replace('const shortlistFloor = floor();',"feedback.bindBoard(board, feedbackOrigin);\n            const shortlistFloor = floor();",1);
  // Completion counts are not a quality reward. The separate observer credits
  // only changes in log(1 + best + top-k mean), including deferred witnesses.
  replace('const feedbackGroup = groups[feedbackOrigin.group], feedbackArm = feedbackGroup.arms[feedbackOrigin.arm];',"reward = 0;\n            const feedbackGroup = groups[feedbackOrigin.group], feedbackArm = feedbackGroup.arms[feedbackOrigin.arm];",1);
  replace('if (elite.length >= eliteSize && effort <= elite[elite.length - 1].effort) return;',"const key = C.cellsKey(board.cells), old = elite.findIndex(function (e) { return C.cellsKey(e.board.cells) === key; });\n            if (old >= 0) { if (elite[old].effort >= effort) return; elite.splice(old, 1); }\n            if (elite.length >= eliteSize && effort <= elite[elite.length - 1].effort) return;",1);
  const returnHook='\t\treturn {\r\n\t\t\tstep: step,';
  const hook=source.includes(returnHook)?returnHook:returnHook.replaceAll('\r\n','\n');
  replace(hook,"feedback.attach({ parent: function (effort, board) { if (eliteParents) addElite(effort, board); }, credit: function (e) {\n            const g = groups[e.origin.group], a = g.arms[e.origin.arm]; if (!a) throw new Error('Invalid feedback origin');\n            [g, a].forEach(function (v) { v.reward += e.reward; v.ms += e.work / WORK_STATES_PER_MS; }); backgroundWork += e.work;\n        } });\n"+hook,1);
  replace('return workStates / WORK_STATES_PER_MS;', 'return (workStates + backgroundWork) / WORK_STATES_PER_MS;',1);
 }
 const pure=Object.fromEntries(['boardDiffCount','cellsKey','hashString','makeRng','runTransform'].map(k=>{if(typeof core[k]!=='function')throw Error('Missing pure MIS primitive '+k);return[k,core[k]];})),module={exports:{}};vm.runInNewContext(source,{module,MISCore:pure,performance:clock,console},{filename:'async-adapted-'+file,timeout:10000});if(typeof module.exports.create!=='function')throw Error('MIS factory missing');return{generator:module.exports,identity:{source:file,originalSha256:hash(original),adaptedSha256:hash(source),edits,pureCoreMethods:Object.keys(pure)}};
}
module.exports={loadAsyncGenerator,SUPPORTED};
