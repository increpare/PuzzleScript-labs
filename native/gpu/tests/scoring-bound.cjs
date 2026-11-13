'use strict';
// Ranking-only evidence. An exact completed eligible lane bounds the final
// minimum from above. It is NOT an exact final score and is never a timeout.
function cutoffEvidence({primary,cap,gpu,privateState,globalFloor,globalFull}){
 if(primary?.status!=='solved'||!primary.refined||!gpu?.exact_score||gpu.status!=='solved'||!Number.isSafeInteger(gpu.expanded)||gpu.expanded<0||cap!==Math.max(1,primary.expanded+6)||gpu.expanded>cap)return {valid:false,canReject:false,reason:'No completed eligible matching-cap BFS lane'};
 const upper=Math.max(1,gpu.expanded),s=privateState;
 if(!s||!globalFull||!s.localFull||!s.eliteFull)return {valid:true,upper,canReject:false,reason:'A shortlist or private parent reservoir still has room'};
 const canReject=upper<globalFloor&&upper<s.localFloor&&upper<=s.eliteFloor&&upper<=s.baseEffort;
 return {valid:true,upper,canReject,reason:canReject?'Below both shortlist cutoffs, rejected by the full private elite, and unable to earn quality reward':'A shortlist tie, elite opportunity or quality reward still needs the exact score'};
}
module.exports={cutoffEvidence};
