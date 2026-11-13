#pragma once
// Device-owned exact BFS. Gameplay is the existing cooperative interpreter.
// Fixed checked per-query slices keep independent queries free of insertion races.
namespace resident {
#ifdef PS_CUDA_PHASE_PROFILE
// Diagnostic process-lifetime counters. Callers subtract their start snapshot;
// SM clocks include suspension and are not occupancy/utilization measurements.
J phase_profile_report(){
 unsigned long long totals[48]{};unsigned int overflow=0;
 ck(cudaMemcpyFromSymbol(totals,interpreter_phase_totals,sizeof(totals)));
 ck(cudaMemcpyFromSymbol(&overflow,interpreter_phase_overflow,sizeof(overflow)));
 require(!overflow,"Interpreter phase diagnostic counter overflow");
 J::Array values;for(auto value:totals)values.push_back(ji(value));return J(std::move(values));
}
#endif
constexpr u32 nil=0xffffffffu;
// Keys and interpreter scratch are dynamically allocated; aggregate byte/key
// limits below remain authoritative. This accommodates large canonical boards.
constexpr u32 max_key_words=65536;
enum Status:u32 {Running,Unfinished,WorkLimit,Solved,Exhausted,Memory,Cancelled,Timeout,Failure,Vacant,Transferred};
enum Phase:u32 {Idle,Execute,Tick,Settled,Assist};
enum Stage:u32 {NeedRoot,Root,Parent,Ready};
enum Detail:u32 {None,NodeCapacity,HashCapacity,CycleMemory,Interpreter,ContinuationLimit,AgainLimit,Receipt,DeviceCapacity};
struct Lane {u32 phase=Idle,op=nil,ticks=0,rounds=0,cyclic=0,fresh=0;};
#ifdef PS_PRODUCTION_SEARCH
struct ParallelLane {
 u32 state=0,slot=0,probe_count=0,error=0,winner=0;
 u32 generated=0,duplicates=0,cycles=0,probes=0,yields=0;
};
#endif
struct Node {u32 parent=nil,action=0,depth=0;};
struct PathState {u32 cursor=nil,length=0,done=0,error=0;};
// Reuses a vacant destination's path scratch. Each dispatch is bounded; cursor
// and probe position continue across launches, including forced collisions.
__global__ void rehash_move(const uint64_t* hashes,u32 count,u32* table,u32 size,PathState* state,u32 budget,u32 maximum){
 if(blockIdx.x||threadIdx.x)return;auto& p=*state;
 for(u32 step=0;step<budget&&p.cursor<count&&!p.error;step++){
  if(p.length==nil)p.length=u32(hashes[p.cursor])&(size-1);
  if(p.done>=maximum){p.error=1;break;}p.done++;
  if(!table[p.length]){table[p.length]=++p.cursor;p.length=nil;}
  else p.length=(p.length+1)&(size-1);
 }
}
struct Query {
 u32 generation=1,status=Running,detail=None,stage=NeedRoot,head=0,count=0,parent=nil,cursor=0;
 u32 cap=1000,grant_end=1000,max_states=10000,max_frontier=0,winner_parent=nil,winner_action=nil,root_cycle=0;
 u32 probing=0,probe_slot=0,probe_count=0,receipt_round=0,receipt_error=0;
 u32 batch_start=0,batch_count=0,batch_cursor=0,slot_generation=1,batch_owner=2;
 uint64_t expanded=0,generated=0,duplicates=0,cycles=0,invocations=0,probes=0,hash=0,physical_parents=0,gpu_expanded=0,cpu_expanded=0,gpu_invocations=0,cpu_invocations=0;
 Lane lanes[80];
#ifdef PS_PRODUCTION_SEARCH
 u32 level_end=0,guided=0,heuristic_weight=3,queued_count=0,heap_count[16]{},batch_parents[16]{};uint64_t contention_yields=0;
#endif
};
PS_HD inline u32 search_parent(const Query& q,u32 lane){
#ifdef PS_PRODUCTION_SEARCH
 if(q.guided)return q.batch_parents[lane/5];
#endif
 return q.batch_start+lane/5;
}
PS_HD inline uint64_t hash_key(const u32* key,u32 kw,uint64_t mask){uint64_t h=0;u32 k=0;for(;k+1<kw;k+=2){uint64_t w=uint64_t(key[k])|(uint64_t(key[k+1])<<32);h=(((h<<5)|(h>>59))^w)*0x517cc1b727220a95ull;}if(k<kw)h=(((h<<5)|(h>>59))^key[k])*0x517cc1b727220a95ull;return h&mask;}
PS_HD inline bool equal_key(const u32* a,const u32* b,u32 kw){for(u32 w=0;w<kw;w++)if(a[w]!=b[w])return false;return true;}
PS_HD inline void copy_key(u32* a,const u32* b,u32 kw){for(u32 w=0;w<kw;w++)a[w]=b[w];}
PS_HD inline u32 input_action(u32 index){const u32 order[5]={3,0,2,1,4};return order[index];}
PS_HD inline void credit_parent(Query& q){q.expanded++;if(q.batch_owner==2)q.gpu_expanded++;else q.cpu_expanded++;}
PS_HD inline void prepare_one(Query& q,u32 parents,u32 actions,bool on_gpu){if(q.status!=Running)return;
 if(q.stage==NeedRoot){q.stage=Root;q.parent=nil;q.cursor=0;q.batch_count=1;q.lanes[0]={Execute,8,0,0,0};q.lanes[0].fresh=1;}
 else if(q.stage==Ready){if(q.head==q.count){q.status=Exhausted;return;}if(q.expanded>=q.cap){q.status=WorkLimit;return;}if(q.expanded>=q.grant_end){q.status=Unfinished;return;}u32 available=q.count-q.head,remaining=u32((q.cap<q.grant_end?q.cap:q.grant_end)-q.expanded);q.batch_count=available<parents?available:parents;if(q.batch_count>remaining)q.batch_count=remaining;q.batch_start=q.head;q.batch_cursor=0;q.batch_owner=on_gpu?2:1;q.parent=q.head++;credit_parent(q);q.physical_parents+=q.batch_count;q.cursor=0;q.probing=0;q.stage=Parent;for(u32 p=0;p<q.batch_count;p++)for(u32 a=0;a<actions;a++){auto& lane=q.lanes[p*5+a];lane={Execute,input_action(a),0,0,0};lane.fresh=1;}}
 u32 active=q.stage==Root?1:q.batch_count*5;for(u32 a=0;a<active;a++){if(q.stage==Parent&&a%5>=actions)continue;auto& lane=q.lanes[a];if(lane.phase==Tick){lane.phase=Execute;lane.op=5;lane.rounds=0;lane.fresh=2;}if(lane.phase==Execute){q.invocations++;if(on_gpu)q.gpu_invocations++;else q.cpu_invocations++;}}}
__global__ void prepare(Query* queries,u32 count,u32 parents,u32 actions){u32 qi=blockIdx.x*blockDim.x+threadIdx.x;if(qi<count)prepare_one(queries[qi],parents,actions,true);}
__global__ void restore_lanes(Layout l,Query* queries,u32* states,u32* ops,const u32* pristine,const u32* keys,const u32* packed,u32 kw,u32 capacity,u32 count,u32 parents,u32 actions){u32 i=blockIdx.x*blockDim.x+threadIdx.x,slots=parents*5;if(i>=count*slots)return;u32 qi=i/slots,a=i%slots;auto& q=queries[qi];ops[i]=nil;if(q.status!=Running||(q.stage==Root?a!=0:a>=q.batch_count*5||a%5>=actions))return;auto& lane=q.lanes[a];if(lane.phase!=Execute)return;if(lane.fresh){const u32* key=lane.fresh==2?packed+size_t(i)*kw:q.stage==Root?pristine+size_t(qi)*kw:keys+(size_t(qi)*capacity+search_parent(q,a))*kw;restore_key(l,states+size_t(i)*l.STATE_WORDS,key);lane.fresh=0;}ops[i]=lane.op;}
__global__ void pack_active(Layout l,const u32* states,const u32* ops,const u32* status,u32* packed,uint64_t* hashes,u32 kw,u32 count,uint64_t mask){u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=count||ops[i]==nil||status[i]!=1)return;u32* key=packed+size_t(i)*kw;capture_key(l,states+size_t(i)*l.STATE_WORDS,key);hashes[i]=hash_key(key,kw,mask);}
// Parallel execution may speculate on later parents. Only this ordered commit
// advances the logical BFS head and counts, including a win in a batch prefix.
PS_HD inline void finish_one(Query& q,const u32* status,const u32* packed,const uint64_t* packed_hashes,u32* keys,uint64_t* hashes,Node* nodes,u32* table,u32* terminal,u32 kw,u32 capacity,u32 table_size,u32 parents,u32 actions,u32 probe_budget){const u32 qi=0,slots=parents*5;if(q.status!=Running)return;
 u32 active=q.stage==Root?1:q.stage==Parent?q.batch_count*5:0;
 for(u32 a=0;a<active;a++){
  if(q.stage==Parent&&a%5>=actions)continue;
  auto& lane=q.lanes[a];u32 i=qi*slots+a;
  if(lane.phase==Execute){
   if(++lane.rounds>100000){q.status=Failure;q.detail=ContinuationLimit;return;}
   if(status[i]>1){q.status=Failure;q.detail=Interpreter;return;}
   if(status[i]==0)continue;
   const u32* k=packed+size_t(i)*kw;
   if(k[0]&&!k[1]){
    if(lane.ticks>=10000){q.status=Failure;q.detail=AgainLimit;return;}
    if(lane.ticks>=64)lane.phase=Assist;else{lane.ticks++;lane.phase=Tick;}
   }else lane.phase=Settled;
  }
 }
 if(q.stage==Root){
  if(q.lanes[0].phase!=Settled)return;
  const u32* key=packed+size_t(qi*slots)*kw;uint64_t h=packed_hashes[qi*slots];
  copy_key(keys+size_t(qi)*capacity*kw,key,kw);hashes[size_t(qi)*capacity]=h;
  nodes[size_t(qi)*capacity]={nil,0,0};table[size_t(qi)*table_size+(u32(h)&(table_size-1))]=1;q.count=1;q.stage=Ready;
  if(key[1]){q.status=Solved;q.head=1;copy_key(terminal+size_t(qi)*kw,key,kw);}
  else if(q.lanes[0].cyclic){q.status=Exhausted;q.head=1;q.root_cycle=1;q.cycles++;}
  else q.max_frontier=1;
  return;
 }
 if(q.stage!=Parent)return;
 while(q.batch_cursor<q.batch_count){
  while(q.cursor<actions){
   u32 a=q.batch_cursor*5+q.cursor,i=qi*slots+a;
   if(q.lanes[a].phase!=Settled)return;
   const u32* key=packed+size_t(i)*kw;
   if(!q.probing){
    q.generated++;
    if(q.lanes[a].cyclic){q.cycles++;q.cursor++;continue;}
    if(key[1]){q.status=Solved;q.winner_parent=q.parent;q.winner_action=input_action(q.cursor);copy_key(terminal+size_t(qi)*kw,key,kw);return;}
    q.hash=packed_hashes[i];q.probe_slot=u32(q.hash)&(table_size-1);q.probe_count=0;q.probing=1;
   }
   bool resolved=false;
   while(probe_budget){
    probe_budget--;q.probes++;u32* slot=table+size_t(qi)*table_size+q.probe_slot;u32 entry=*slot;
    if(!entry){
     if(q.count>=q.max_states||q.count>=capacity){q.status=Memory;q.detail=q.count>=q.max_states?NodeCapacity:DeviceCapacity;return;}
     u32 id=q.count++;size_t index=size_t(qi)*capacity+id;
     copy_key(keys+index*kw,key,kw);hashes[index]=q.hash;
     nodes[index]={q.parent,input_action(q.cursor),nodes[size_t(qi)*capacity+q.parent].depth+1};*slot=id+1;
     u32 open=q.count-q.head;if(open>q.max_frontier)q.max_frontier=open;resolved=true;break;
    }
    size_t index=size_t(qi)*capacity+entry-1;
    if(hashes[index]==q.hash&&equal_key(keys+index*kw,key,kw)){q.duplicates++;resolved=true;break;}
    q.probe_slot=(q.probe_slot+1)&(table_size-1);
    if(++q.probe_count>=table_size){q.status=Memory;q.detail=HashCapacity;return;}
   }
   if(!resolved)return;
   q.probing=0;q.cursor++;
  }
  q.batch_cursor++;q.cursor=0;
  if(q.batch_cursor<q.batch_count){q.parent=q.batch_start+q.batch_cursor;q.head++;credit_parent(q);}
 }
 q.stage=Ready;if(q.head==q.count)q.status=Exhausted;else if(q.expanded>=q.cap)q.status=WorkLimit;else if(q.expanded>=q.grant_end)q.status=Unfinished;
}
__global__ void finish(Query* queries,const u32* status,const u32* receipts,const u32* packed,const uint64_t* packed_hashes,u32* keys,uint64_t* hashes,Node* nodes,u32* table,u32* terminal,u32 kw,u32 capacity,u32 table_size,u32 count,u32 parents,u32 actions,u32 probe_budget){
 u32 qi=blockIdx.x*blockDim.x+threadIdx.x;if(qi>=count)return;auto& q=queries[qi];u32 slots=parents*5,expected=(++q.receipt_round)*2;
 for(u32 a=0;a<slots;a++)if(receipts[qi*slots+a]!=expected){q.receipt_error=1;q.status=Failure;q.detail=Receipt;}
 finish_one(q,status+size_t(qi)*slots,packed+size_t(qi)*slots*kw,packed_hashes+size_t(qi)*slots,keys+size_t(qi)*capacity*kw,hashes+size_t(qi)*capacity,nodes+size_t(qi)*capacity,table+size_t(qi)*table_size,terminal+size_t(qi)*kw,kw,capacity,table_size,parents,actions,probe_budget);
}
__device__ void copy_key_warp(u32* dest,const u32* source,u32 words){
 for(u32 w=threadIdx.x;w<words;w+=32)dest[w]=source[w];
 __syncwarp();
}
__device__ bool equal_key_warp(const u32* a,const u32* b,u32 words){
 bool same=true;for(u32 w=threadIdx.x;w<words;w+=32)if(a[w]!=b[w]){same=false;break;}
 return __all_sync(0xffffffffu,same);
}
// One complete warp owns a query. The leader alone mutates BFS metadata;
// all lanes copy/compare one ordered key together. No cross-query atomics.
__global__ void finish_warp(Query* queries,const u32* status,const u32* receipts,const u32* packed,const uint64_t* packed_hashes,u32* keys,uint64_t* hashes,Node* nodes,u32* table,u32* terminal,u32 kw,u32 capacity,u32 table_size,u32 count,u32 parents,u32 actions,u32 probe_budget){
 u32 qi=blockIdx.x;if(qi>=count)return;auto& q=queries[qi];u32 lane_id=threadIdx.x,slots=parents*5;
 if(lane_id==0){
  u32 expected=(++q.receipt_round)*2;
  for(u32 a=0;a<slots;a++)if(receipts[qi*slots+a]!=expected){q.receipt_error=1;q.status=Failure;q.detail=Receipt;}
  if(q.status==Running){
   u32 active=q.stage==Root?1:q.stage==Parent?q.batch_count*5:0;
   for(u32 a=0;a<active;a++){
    if(q.stage==Parent&&a%5>=actions)continue;
    auto& lane=q.lanes[a];u32 i=qi*slots+a;
    if(lane.phase!=Execute)continue;
    if(++lane.rounds>100000){q.status=Failure;q.detail=ContinuationLimit;break;}
    if(status[i]>1){q.status=Failure;q.detail=Interpreter;break;}
    if(status[i]==0)continue;
    const u32* k=packed+size_t(i)*kw;
    if(k[0]&&!k[1]){
     if(lane.ticks>=10000){q.status=Failure;q.detail=AgainLimit;break;}
     if(lane.ticks>=64)lane.phase=Assist;else{lane.ticks++;lane.phase=Tick;}
    }else lane.phase=Settled;
   }
  }
 }
 __syncwarp();if(q.status!=Running)return;
 if(q.stage==Root){
  if(q.lanes[0].phase!=Settled)return;
  const u32* key=packed+size_t(qi*slots)*kw;uint64_t h=packed_hashes[qi*slots];
  copy_key_warp(keys+size_t(qi)*capacity*kw,key,kw);
  if(lane_id==0){hashes[size_t(qi)*capacity]=h;nodes[size_t(qi)*capacity]={nil,0,0};table[size_t(qi)*table_size+(u32(h)&(table_size-1))]=1;q.count=1;}
  if(key[1]){
   copy_key_warp(terminal+size_t(qi)*kw,key,kw);
   if(lane_id==0){q.status=Solved;q.head=1;}
  }else if(q.lanes[0].cyclic){if(lane_id==0){q.status=Exhausted;q.head=1;q.root_cycle=1;q.cycles++;}}
  else if(lane_id==0)q.max_frontier=1;
  if(lane_id==0)q.stage=Ready;
  return;
 }
 if(q.stage!=Parent)return;
 while(q.batch_cursor<q.batch_count){
  while(q.cursor<actions){
   u32 a=q.batch_cursor*5+q.cursor,i=qi*slots+a;
   if(q.lanes[a].phase!=Settled)return;
   const u32* key=packed+size_t(i)*kw;
   if(!q.probing){
    if(lane_id==0)q.generated++;
    if(q.lanes[a].cyclic){if(lane_id==0){q.cycles++;q.cursor++;}__syncwarp();continue;}
    if(key[1]){
     copy_key_warp(terminal+size_t(qi)*kw,key,kw);
     if(lane_id==0){q.status=Solved;q.winner_parent=q.parent;q.winner_action=input_action(q.cursor);}
     return;
    }
    if(lane_id==0){q.hash=packed_hashes[i];q.probe_slot=u32(q.hash)&(table_size-1);q.probe_count=0;q.probing=1;}
    __syncwarp();
   }
   bool resolved=false;
   while(probe_budget){
    probe_budget--;if(lane_id==0)q.probes++;
    u32* slot=table+size_t(qi)*table_size+q.probe_slot;u32 entry=*slot;
    if(!entry){
     if(q.count>=q.max_states||q.count>=capacity){if(lane_id==0){q.status=Memory;q.detail=q.count>=q.max_states?NodeCapacity:DeviceCapacity;}return;}
     u32 id=q.count;size_t index=size_t(qi)*capacity+id;
     copy_key_warp(keys+index*kw,key,kw);
     if(lane_id==0){
      q.count++;hashes[index]=q.hash;nodes[index]={q.parent,input_action(q.cursor),nodes[size_t(qi)*capacity+q.parent].depth+1};*slot=id+1;
      u32 open=q.count-q.head;if(open>q.max_frontier)q.max_frontier=open;
     }
     __syncwarp();resolved=true;break;
    }
    size_t index=size_t(qi)*capacity+entry-1;
    if(hashes[index]==q.hash&&equal_key_warp(keys+index*kw,key,kw)){
     if(lane_id==0)q.duplicates++;__syncwarp();resolved=true;break;
    }
    if(lane_id==0){q.probe_slot=(q.probe_slot+1)&(table_size-1);if(++q.probe_count>=table_size){q.status=Memory;q.detail=HashCapacity;}}
    __syncwarp();if(q.status!=Running)return;
   }
   if(!resolved)return;
   if(lane_id==0){q.probing=0;q.cursor++;}__syncwarp();
  }
  if(lane_id==0){q.batch_cursor++;q.cursor=0;if(q.batch_cursor<q.batch_count){q.parent=q.batch_start+q.batch_cursor;q.head++;credit_parent(q);}}
  __syncwarp();
 }
 if(lane_id==0){q.stage=Ready;if(q.head==q.count)q.status=Exhausted;else if(q.expanded>=q.cap)q.status=WorkLimit;else if(q.expanded>=q.grant_end)q.status=Unfinished;}
}
#ifdef PS_PRODUCTION_SEARCH
#include "production-priority.cuh"
#include "production-search.cuh"
#endif
__global__ void decisions(Query* queries,const u32* answer,u32 count,u32 slots){u32 qi=blockIdx.x*blockDim.x+threadIdx.x;if(qi>=count)return;auto& q=queries[qi];if(q.status!=Running)return;u32 active=q.stage==Root?1:q.stage==Parent?q.batch_count*5:0;for(u32 a=0;a<active;a++)if(q.lanes[a].phase==Assist){u32 v=answer[qi*slots+a];if(v==1){q.lanes[a].ticks++;q.lanes[a].phase=Tick;}else if(v==2){q.lanes[a].cyclic=1;q.lanes[a].phase=Settled;}else if(v==3){q.status=Memory;q.detail=CycleMemory;}}}
__global__ void resume(Query* queries,u32 count,u32 grant){u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=count)return;auto& q=queries[i];if(q.status==Unfinished){uint64_t end=q.expanded+grant;q.grant_end=u32(end<q.cap?end:q.cap);q.status=Running;}}
__global__ void resume_slot(Query* queries,u32 index,u32 grant){if(blockIdx.x||threadIdx.x)return;auto& q=queries[index];if(q.status==Unfinished){uint64_t end=q.expanded+grant;q.grant_end=u32(end<q.cap?end:q.cap);q.status=Running;}}
__global__ void stop(Query* queries,u32 count,u32 which,u32 status){u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=count||(which!=nil&&i!=which))return;auto& q=queries[i];if(q.status==Running||q.status==Unfinished||(q.status==Memory&&(q.detail==DeviceCapacity||q.detail==HashCapacity)))q.status=status;}
__global__ void backtrace(const Query* queries,const Node* nodes,PathState* paths,u32* result,u32 count,u32 capacity,u32 path_capacity){u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=count||queries[i].status!=Solved)return;const auto& q=queries[i];auto& p=paths[i];if(p.done)return;
 if(p.cursor==nil){if(q.winner_parent==nil){p.done=1;return;}if(q.winner_action>4){p.error=2;p.done=1;return;}result[size_t(i)*path_capacity]=q.winner_action;p.length=1;p.cursor=q.winner_parent;}
 for(u32 step=0;p.cursor&&step<256;step++){if(p.cursor>=q.count||p.length>=path_capacity){p.error=1;p.done=1;return;}const auto& node=nodes[size_t(i)*capacity+p.cursor];if(node.parent>=p.cursor||node.action>4){p.error=2;p.done=1;return;}result[size_t(i)*path_capacity+p.length++]=node.action;p.cursor=node.parent;}if(!p.cursor)p.done=1;
}
#ifdef PS_PRODUCTION_SEARCH
constexpr u32 profile_stage_count=7;
#else
constexpr u32 profile_stage_count=5;
#endif
struct History {u32 parent=nil;std::unordered_set<std::string> seen;std::deque<std::string> ring;};
struct Config {u32 n,kw,capacity,table_size,fuel,probe_budget,hash_bits,cap,grant,maximum,parents;
#ifdef PS_PRODUCTION_SEARCH
 u32 commit_passes=4,guided=0,heuristic_weight=3;
#endif
uint64_t bytes;bool parallel_finish=false,scalar_interpreter=false,profile=false,cooperative_commit=true,idle_pool=false,blocking_wait=true,stream_init=false,word_specialization=false,line_compaction=false,parallel_ellipses=false;};
// Keep this in member-construction order, including Gpu's six buffers. Both
// capacity accounting and arena preflight use these exact aligned sizes.
std::vector<size_t> device_allocations(const Game& g,const Config& c){size_t n=c.n,kw=c.kw,lanes=n*c.parents*5;
 std::vector<size_t> sizes{g.g.size()*4,lanes*g.l.STATE_WORDS*4,lanes*((g.l.CELL_CAP+1)*g.l.OBJ_WORDS+g.l.MOV_WORDS)*4,lanes*4,lanes*4,lanes*4,
 n*sizeof(Query),n*kw*4,n*c.capacity*kw*4,n*c.table_size*4,n*kw*4,lanes*4,n*c.capacity*8,n*c.capacity*sizeof(Node),n*sizeof(PathState),n*std::min(c.capacity,65536u)*4,lanes*kw*4,lanes*8
#ifdef PS_PRODUCTION_SEARCH
 ,lanes*sizeof(ParallelLane),n*c.capacity*4,n*c.capacity*4,n*16*((c.capacity+15)/16)*4
#endif
 };
#ifdef PS_PRODUCTION_SEARCH
 if(c.guided>=3)sizes.push_back(n*novelty_words(g.l.CELL_CAP,g.l.OBJ_WORDS)*4);
#endif
 return sizes;
}
std::vector<size_t> pinned_allocations(const Config& c){return {size_t(c.n)*sizeof(Query),size_t(c.kw)*4};}
uint64_t allocation_bytes(const std::vector<size_t>& sizes){uint64_t total=0;for(auto bytes:sizes){bytes=ByteArena::aligned(bytes);require(total<=UINT64_MAX-bytes,"Device allocation sum overflow");total+=bytes;}return total;}
Config configuration(const Game& g,const J& req,bool check_free=true){Config c{};
#ifdef PS_PRODUCTION_SEARCH
 const auto policy=str(req,"search_mode","parallel-bfs");
 require(policy=="parallel-bfs"||policy=="greedy"||policy=="weighted"||policy=="novelty"||policy=="novelty-tie","Unsupported production search_mode");
 c.guided=policy=="greedy"?1:policy=="weighted"?2:policy=="novelty"?3:policy=="novelty-tie"?4:0;
 c.heuristic_weight=u32(num(req,"heuristic_weight",3));require(c.heuristic_weight&&c.heuristic_weight<=16,"Heuristic weight must be1..16");
 if(c.guided)require(g.l.CELL_CAP<=512&&g.g[22]<=16&&g.l.OBJ_WORDS<=4,"Guided ranking currently requires at most512 cells,16 win conditions and4 object words");
 require(flag(req,"cooperative_commit",true),"Production target requires parallel commit");
 c.commit_passes=u32(num(req,"commit_passes",4));require(c.commit_passes&&c.commit_passes<=8,"Production commit_passes must be1..8");
#endif
auto bounded=[&](const char* k,int fallback,int maximum){int v=num(req,k,fallback);require(v>0&&v<=maximum,std::string("Invalid device-search capacity: ")+k);return u32(v);};
 c.n=bounded("batch",int(g.roots.size()),256);c.kw=key_words(g.l);require(c.kw<=max_key_words,"Device-search key exceeds65536 words");c.capacity=bounded("nodes",4096,1000000);c.table_size=bounded("table_entries",int(std::bit_ceil(c.capacity*2)),4194304);require(std::has_single_bit(c.table_size),"Device-search table must be a power of two");c.fuel=bounded("fuel",2048,2048);c.probe_budget=bounded("probe_budget",256,256);c.hash_bits=bounded("hash_bits",64,64);c.cap=bounded("max_expanded",1000,1000000);c.grant=bounded("grant",c.cap,1000000);c.maximum=bounded("max_states",c.capacity,1000000);c.parents=bounded("parents_per_query",16,16);require(g.roots.size()==1||g.roots.size()==c.n,"Batch must match root count or replicate one pristine root");canonical_guard(g);
 const auto mapping=str(req,"interpreter_mapping","warp");require(mapping=="warp"||mapping=="scalar","Interpreter mapping must be warp or scalar");c.scalar_interpreter=mapping=="scalar";c.parallel_finish=flag(req,"parallel_finish",false);require(!(c.scalar_interpreter&&c.parallel_finish),"Parallel finish requires warp interpreter mapping");
 c.profile=flag(req,"profile_stages",false);c.cooperative_commit=flag(req,"cooperative_commit",true);c.idle_pool=flag(req,"idle_pool",false);c.blocking_wait=flag(req,"blocking_wait",true);c.word_specialization=flag(req,"word_specialization",false);c.line_compaction=flag(req,"line_compaction",false);c.parallel_ellipses=flag(req,"parallel_ellipses",false);uint64_t lanes=uint64_t(c.n)*c.parents*5;
 require(lanes*g.l.STATE_WORDS*4<=4ull*1024*1024*1024,"Device-search interpreter pool exceeds4GiB; reduce batch or parents_per_query");
 c.bytes=allocation_bytes(device_allocations(g,c));
 require(c.bytes<=6ull*1024*1024*1024&&uint64_t(c.n)*c.capacity*c.kw*4<=2ull*1024*1024*1024,"Device-search storage exceeds6GiB/2GiB key limits");if(check_free){size_t free=0,total=0;ck(cudaMemGetInfo(&free,&total));require(c.bytes+64ull*1024*1024<=free,"Insufficient free hardware GPU memory for device-search capacities");}return c;
}
#include "device-checkpoint.cuh"
struct SearchStream {
 cudaStream_t value{};SearchStream(){ck(cudaStreamCreateWithFlags(&value,cudaStreamNonBlocking));}
 ~SearchStream(){cudaStreamSynchronize(value);cudaStreamDestroy(value);}
 SearchStream(const SearchStream&)=delete;
};
struct SearchFence {cudaStream_t stream;~SearchFence(){cudaStreamSynchronize(stream);}};
class Search {
 const Game& g;u32 n,kw,capacity,table_size,actions,fuel,probe_budget,hash_bits,generation,parents,slots;SearchStream stream_owner;cudaStream_t stream;Gpu gpu;
 DevMem<Query> queries;DevMem<u32> pristine,keys,table,terminal,answer;DevMem<uint64_t> hashes;DevMem<Node> nodes;DevMem<PathState> paths;DevMem<u32> reverse_paths;std::vector<std::vector<u32>> decoded_paths;std::vector<bool> path_ready;
 HostPinned<Query> host;HostPinned<u32> assist_key;std::vector<History> histories;std::vector<u32> slot_generations;uint64_t history_bytes=0;
 cudaEvent_t begin{},end{},metadata_begin{},pending_done{};cudaGraph_t graphs[9]{};cudaGraphExec_t executions[9]{};
 u32 pending_waves=0;bool poisoned=false;uint64_t async_submissions=0,async_retirements=0;double pending_launch_ms=0,last_unit_credit_ms=0,async_wait_ms=0;
 cudaEvent_t stage_events[profile_stage_count+1]{};double stage_ms[profile_stage_count]{};
 uint64_t waves=0,units=0,metadata_bytes=0,cycle_bytes=0,export_bytes=0,assignments=0,assignment_upload_bytes=0;double compute_ms=0,upload_ms=0,readback_ms=0,host_ms=0,reset_ms=0,reset_upload_device_ms=0,reset_clear_device_ms=0,metadata_device_ms=0,assignment_ms=0;uint64_t allocated_bytes=0;Config settings;
 std::shared_ptr<const RuleData> checkpoint_rules;uint64_t takes=0,returns=0,transfer_readback_bytes=0,transfer_upload_bytes=0,transfer_rehash_probes=0;double transfer_take_ms=0,transfer_put_ms=0;
 uint64_t device_moves=0,device_move_bytes=0,device_rehash_probes=0,device_rehash_launches=0,device_move_metadata_bytes=0;double device_move_ms=0;int device_ordinal=0;
 DevMem<u32> scratch_keys;DevMem<uint64_t> scratch_hashes;
#ifdef PS_PRODUCTION_SEARCH
 DevMem<ParallelLane> parallel_lanes;DevMem<u32> heuristic_values,priority_values,priority_heaps;
 std::unique_ptr<DevMem<u32>> novelty_seen;
#endif
 // Also fences a constructor-body failure before member buffers are returned.
 SearchFence construction_fence;
 void clear_novelty(u32 which=nil){
#ifdef PS_PRODUCTION_SEARCH
  if(novelty_seen){const size_t words=novelty_seen->n/n;ck(cudaMemsetAsync(novelty_seen->p+(which==nil?0:size_t(which)*words),0,(which==nil?novelty_seen->n:words)*4,stream));}
#endif
 }
 void mark(u32 i){if(settings.profile)ck(cudaEventRecord(stage_events[i],stream));}
 void wave(){u32 b=(n+31)/32,lanes=n*slots;mark(0);
#ifdef PS_PRODUCTION_SEARCH
  production_prepare<<<b,32,0,stream>>>(queries.p,parallel_lanes.p,priority_heaps.p,priority_values.p,capacity,n,parents,actions);
#else
  prepare<<<b,32,0,stream>>>(queries.p,n,parents,actions);
#endif
  mark(1);restore_lanes<<<(lanes+31)/32,32,0,stream>>>(g.l,queries.p,gpu.s.p,gpu.ops.p,pristine.p,keys.p,scratch_keys.p,kw,capacity,n,parents,actions);mark(2);
  if(settings.scalar_interpreter){
   // Each CUDA thread owns one complete interpreter. Inactive cursors and
   // receipt clocks have the same contract as the cooperative mapping.
   if(g.l.OBJ_WORDS==1&&g.l.MOV_WORDS==1)execute<1,1,true><<<(lanes+31)/32,32,0,stream>>>(g.l,g.sparse,gpu.g.p,gpu.s.p,gpu.cache.p,gpu.status.p,gpu.ops.p,1,fuel|0x80000000u,lanes,gpu.receipts.p);
   else if(g.l.OBJ_WORDS==1&&g.l.MOV_WORDS==3)execute<1,3,true><<<(lanes+31)/32,32,0,stream>>>(g.l,g.sparse,gpu.g.p,gpu.s.p,gpu.cache.p,gpu.status.p,gpu.ops.p,1,fuel|0x80000000u,lanes,gpu.receipts.p);
   else execute<0,0,true><<<(lanes+31)/32,32,0,stream>>>(g.l,g.sparse,gpu.g.p,gpu.s.p,gpu.cache.p,gpu.status.p,gpu.ops.p,1,fuel|0x80000000u,lanes,gpu.receipts.p);
  }else if(g.l.OBJ_WORDS==1&&g.l.MOV_WORDS==1)execute_cooperative<1,1,true><<<lanes,32,0,stream>>>(g.l,g.sparse,gpu.g.p,gpu.s.p,gpu.cache.p,gpu.status.p,gpu.ops.p,1,fuel|0x80000000u,lanes,gpu.receipts.p,settings.line_compaction,settings.parallel_ellipses,settings.parallel_finish);
  else if(g.l.OBJ_WORDS==1&&g.l.MOV_WORDS==3)execute_cooperative<1,3,true><<<lanes,32,0,stream>>>(g.l,g.sparse,gpu.g.p,gpu.s.p,gpu.cache.p,gpu.status.p,gpu.ops.p,1,fuel|0x80000000u,lanes,gpu.receipts.p,settings.line_compaction,settings.parallel_ellipses,settings.parallel_finish);
  else if(settings.word_specialization&&g.l.OBJ_WORDS==4&&g.l.MOV_WORDS==5)execute_cooperative<4,5,true><<<lanes,32,0,stream>>>(g.l,g.sparse,gpu.g.p,gpu.s.p,gpu.cache.p,gpu.status.p,gpu.ops.p,1,fuel|0x80000000u,lanes,gpu.receipts.p,settings.line_compaction,settings.parallel_ellipses,settings.parallel_finish);
  else execute_cooperative<0,0,true><<<lanes,32,0,stream>>>(g.l,g.sparse,gpu.g.p,gpu.s.p,gpu.cache.p,gpu.status.p,gpu.ops.p,1,fuel|0x80000000u,lanes,gpu.receipts.p,settings.line_compaction,settings.parallel_ellipses,settings.parallel_finish);
  mark(3);uint64_t mask=hash_bits==64?~uint64_t(0):(uint64_t(1)<<hash_bits)-1;
  pack_active<<<(lanes+31)/32,32,0,stream>>>(g.l,gpu.s.p,gpu.ops.p,gpu.status.p,scratch_keys.p,scratch_hashes.p,kw,lanes,mask);
  mark(4);
#ifdef PS_PRODUCTION_SEARCH
  production_settle<<<n,32,0,stream>>>(queries.p,gpu.status.p,gpu.receipts.p,scratch_keys.p,scratch_hashes.p,keys.p,hashes.p,nodes.p,table.p,terminal.p,kw,capacity,table_size,parents,actions);
  for(u32 pass=0;pass<settings.commit_passes;pass++)production_insert<<<lanes,32,0,stream>>>(queries.p,parallel_lanes.p,scratch_keys.p,scratch_hashes.p,keys.p,hashes.p,nodes.p,table.p,kw,capacity,table_size,parents,actions,probe_budget);
  production_finish<<<n,32,0,stream>>>(queries.p,parallel_lanes.p,scratch_keys.p,terminal.p,kw,parents,actions);
#else
  if(settings.cooperative_commit)finish_warp<<<n,32,0,stream>>>(queries.p,gpu.status.p,gpu.receipts.p,scratch_keys.p,scratch_hashes.p,keys.p,hashes.p,nodes.p,table.p,terminal.p,kw,capacity,table_size,n,parents,actions,probe_budget);
  else finish<<<b,32,0,stream>>>(queries.p,gpu.status.p,gpu.receipts.p,scratch_keys.p,scratch_hashes.p,keys.p,hashes.p,nodes.p,table.p,terminal.p,kw,capacity,table_size,n,parents,actions,probe_budget);
#endif
  mark(5);
#ifdef PS_PRODUCTION_SEARCH
  if(settings.guided)production_rank<<<lanes,32,0,stream>>>(gpu.g.p,g.l,queries.p,keys.p,nodes.p,heuristic_values.p,priority_values.p,novelty_seen?novelty_seen->p:nullptr,capacity,kw,slots);
  mark(6);
  if(settings.guided)production_enqueue<<<n,32,0,stream>>>(queries.p,priority_heaps.p,priority_values.p,capacity);
  mark(7);
#endif
  ck(cudaGetLastError());
 }
 void quiescent()const{require(!poisoned,"Device search failed; create a fresh search");require(!pending_waves,"Device search has an advance awaiting retirement");}
 void validate_snapshot(u32 first,u32 count){for(u32 i=first;i<first+count;i++){require(host.p[i].generation==generation,"Device query generation mismatch");require(host.p[i].slot_generation==slot_generations[i],"Device slot generation mismatch");require(host.p[i].receipt_round==waves&&!host.p[i].receipt_error,"Missing device-search interpreter receipts");require(host.p[i].status!=Failure,"Device-search execution failure "+std::to_string(host.p[i].detail));}}
 void snapshot(u32 only=nil){quiescent();require(only==nil||only<n,"Snapshot slot out of bounds");u32 first=only==nil?0:only,count=only==nil?n:1;auto t=Clock::now();ck(cudaEventRecord(begin,stream));ck(cudaMemcpyAsync(host.p+first,queries.p+first,count*sizeof(Query),cudaMemcpyDeviceToHost,stream));ck(cudaEventRecord(end,stream));ck(cudaStreamSynchronize(stream));float ms=0;ck(cudaEventElapsedTime(&ms,begin,end));metadata_device_ms+=ms;readback_ms+=elapsed(t);metadata_bytes+=count*sizeof(Query);validate_snapshot(first,count);}
 void assist(){auto started=Clock::now();bool pending=false;std::vector<u32> decisions_host(n*slots,0);
  const uint64_t cost=uint64_t(kw)*8+128,limit=256ull*1024*1024;u32 ring_cap=u32(std::max(uint64_t(1),std::min(uint64_t(1024),64ull*1024*1024/cost)));
  for(u32 i=0;i<n*slots;i++){const auto& q=host.p[i/slots];u32 a=i%slots,tag=q.stage==Root?nil:search_parent(q,a);auto& h=histories[i];if(h.parent!=tag||(q.status!=Running&&!(q.status==Memory&&(q.detail==DeviceCapacity||q.detail==HashCapacity)))){history_bytes-=h.ring.size()*cost;h.seen.clear();h.ring.clear();h.parent=tag;}u32 active=q.stage==Root?1:q.stage==Parent?q.batch_count*5:0;if(q.status!=Running||a>=active||q.lanes[a].phase!=Assist)continue;pending=true;auto t=Clock::now();ck(cudaMemcpyAsync(assist_key.p,scratch_keys.p+size_t(i)*kw,kw*4,cudaMemcpyDeviceToHost,stream));ck(cudaStreamSynchronize(stream));readback_ms+=elapsed(t);cycle_bytes+=kw*4;std::string key(reinterpret_cast<char*>(assist_key.p),kw*4);
   if(h.seen.contains(key)){decisions_host[i]=2;continue;}if(h.ring.size()>=ring_cap){h.seen.erase(h.ring.front());h.ring.pop_front();history_bytes-=cost;}if(history_bytes+cost>limit){decisions_host[i]=3;continue;}h.seen.insert(key);h.ring.push_back(std::move(key));history_bytes+=cost;decisions_host[i]=1;
  }if(pending){auto t=Clock::now();ck(cudaMemcpyAsync(answer.p,decisions_host.data(),n*slots*4,cudaMemcpyHostToDevice,stream));decisions<<<(n+31)/32,32,0,stream>>>(queries.p,answer.p,n,slots);ck(cudaStreamSynchronize(stream));upload_ms+=elapsed(t);}host_ms+=elapsed(started);
 }
 void decode_paths(){quiescent();bool needed=false;for(u32 i=0;i<n;i++)needed|=host.p[i].status==Solved&&!path_ready[i];if(!needed)return;u32 limit=std::min(capacity,65536u);std::vector<PathState> p(n);
  for(u32 round=0;;round++){require(round<=limit/256+1,"Device path continuation capacity");ck(cudaEventRecord(begin,stream));backtrace<<<(n+31)/32,32,0,stream>>>(queries.p,nodes.p,paths.p,reverse_paths.p,n,capacity,limit);ck(cudaGetLastError());ck(cudaEventRecord(end,stream));ck(cudaMemcpyAsync(p.data(),paths.p,n*sizeof(PathState),cudaMemcpyDeviceToHost,stream));ck(cudaStreamSynchronize(stream));float path_ms=0;ck(cudaEventElapsedTime(&path_ms,begin,end));compute_ms+=path_ms;export_bytes+=n*sizeof(PathState);bool done=true;for(u32 i=0;i<n;i++)if(host.p[i].status==Solved){require(!p[i].error,"Device solution exceeds path capacity or has invalid parent");done&=bool(p[i].done);}if(done)break;}
  for(u32 i=0;i<n;i++)if(host.p[i].status==Solved&&!path_ready[i]){decoded_paths[i].resize(p[i].length);if(p[i].length){ck(cudaMemcpyAsync(decoded_paths[i].data(),reverse_paths.p+size_t(i)*limit,p[i].length*4,cudaMemcpyDeviceToHost,stream));ck(cudaStreamSynchronize(stream));export_bytes+=p[i].length*4;}path_ready[i]=true;}
 }
public:
 const char* interpreter_variant()const{if(g.l.OBJ_WORDS==1&&g.l.MOV_WORDS==1)return "fixed-1-1";if(g.l.OBJ_WORDS==1&&g.l.MOV_WORDS==3)return "fixed-1-3";if(!settings.scalar_interpreter&&settings.word_specialization&&g.l.OBJ_WORDS==4&&g.l.MOV_WORDS==5)return "fixed-4-5";return "generic";}
 std::unique_ptr<Checkpoint> reserve_paused(u32 index,u32 token,uint64_t limit,u32 probe_limit=16777216,bool physical_index=false);
 void read_paused(u32 index,u32 token,Checkpoint& reservation,bool transfer);
 std::unique_ptr<Checkpoint> take(u32 index,u32 token,uint64_t limit,bool terminal_ok=false,bool compact_ready=false);
 u32 put(u32 index,u32 token,Checkpoint& checkpoint,uint64_t available=512ull*1024*1024);
 u32 move_to(u32 index,u32 token,Search& destination,u32 target,u32 target_token,u32 rehash_limit=16777216);
 const Query& view(u32 index)const{quiescent();require(index<n,"Device query index");return host.p[index];}
 bool in_flight()const{return pending_waves!=0;}
 double unit_credit_ms()const{quiescent();return last_unit_credit_ms;}
 bool advance_ready()const{require(in_flight(),"No advance awaiting retirement");const auto status=cudaEventQuery(pending_done);if(status==cudaErrorNotReady)return false;ck(status);return true;}
 void begin_advance(u32 take,cudaHostFn_t notify=nullptr,void* notification_context=nullptr){
  quiescent();require(!settings.profile,"Asynchronous advance requires graph execution; use synchronous advance for stage profiling");
  require(take&&take<=8&&waves+take<1000000000,"Device-search wave capacity");const auto started=Clock::now();
  try{if(!executions[take]){ck(cudaStreamBeginCapture(stream,cudaStreamCaptureModeThreadLocal));for(u32 i=0;i<take;i++)wave();ck(cudaStreamEndCapture(stream,&graphs[take]));ck(cudaGraphInstantiate(&executions[take],graphs[take],nullptr,nullptr,0));}
  // No caller may read the pinned metadata or mutate this pool until retirement.
  // Copies, receipt clocks and completion events are private to this Search.
  pending_waves=take;ck(cudaEventRecord(begin,stream));ck(cudaGraphLaunch(executions[take],stream));ck(cudaEventRecord(end,stream));
  ck(cudaEventRecord(metadata_begin,stream));ck(cudaMemcpyAsync(host.p,queries.p,n*sizeof(Query),cudaMemcpyDeviceToHost,stream));ck(cudaEventRecord(pending_done,stream));
  if(notify)ck(cudaLaunchHostFunc(stream,notify,notification_context));
  pending_launch_ms=elapsed(started);async_submissions++;}catch(...){poisoned=true;throw;}
 }
 void retire_advance(){
  require(!poisoned,"Device search failed; create a fresh search");require(in_flight(),"No advance awaiting retirement");const auto started=Clock::now();try{ck(cudaEventSynchronize(pending_done));const double wait_ms=elapsed(started);async_wait_ms+=wait_ms;
  float kernel_ms=0,copy_ms=0,device_unit_ms=0;ck(cudaEventElapsedTime(&kernel_ms,begin,end));ck(cudaEventElapsedTime(&copy_ms,metadata_begin,pending_done));ck(cudaEventElapsedTime(&device_unit_ms,begin,pending_done));
  compute_ms+=kernel_ms;metadata_device_ms+=copy_ms;metadata_bytes+=n*sizeof(Query);readback_ms+=wait_ms;
  waves+=pending_waves;pending_waves=0;units++;async_retirements++;validate_snapshot(0,n);assist();
  // A peer's retirement must not charge this query after its own device unit
  // finished. Count its device interval plus its own non-wait host work. Launch
  // and device work can overlap, hence max rather than their sum.
  last_unit_credit_ms=std::max(double(device_unit_ms),pending_launch_ms)+std::max(0.0,elapsed(started)-wait_ms);
  }catch(...){poisoned=true;throw;}
 }
 struct Metrics {uint64_t waves,units,device_bytes,metadata_bytes,cycle_bytes,export_bytes,takes,returns,read_bytes,write_bytes,receipts;double compute_ms,upload_ms,readback_ms,take_ms,put_ms,metadata_device_ms;uint64_t assignments,assignment_bytes;double assignment_ms;uint64_t device_moves,device_move_bytes,device_rehash_probes,device_rehash_launches,device_move_metadata_bytes;double device_move_ms;};
 Metrics metrics()const{return {waves,units,allocated_bytes,metadata_bytes,cycle_bytes,export_bytes,takes,returns,transfer_readback_bytes,transfer_upload_bytes,waves*uint64_t(n)*slots*2,compute_ms,upload_ms,readback_ms,transfer_take_ms,transfer_put_ms,metadata_device_ms,assignments,assignment_upload_bytes,assignment_ms,device_moves,device_move_bytes,device_rehash_probes,device_rehash_launches,device_move_metadata_bytes,device_move_ms};}
 J solution(u32 index){quiescent();require(index<n,"Device solution index");if(host.p[index].status!=Solved)return J();decode_paths();J::Array path;const char* tokens[]={"up","left","down","right","action"};for(auto a=decoded_paths[index].rbegin();a!=decoded_paths[index].rend();a++)path.emplace_back(std::string(tokens[*a]));return J(std::move(path));}
 J startup_trace(u32 index){
  const auto& q=view(index);require(q.cap==1&&q.status!=Running&&q.status!=Unfinished&&q.generated<=actions&&q.count<=6,"Startup trace requires a terminal one-parent search");
  J::Array trace;if(!q.count)return J(std::move(trace));
  std::vector<u32> data(size_t(1+q.generated)*kw);ck(cudaMemcpyAsync(data.data(),keys.p+size_t(index)*capacity*kw,kw*4,cudaMemcpyDeviceToHost,stream));
  if(q.generated)ck(cudaMemcpyAsync(data.data()+kw,scratch_keys.p+size_t(index)*slots*kw,size_t(q.generated)*kw*4,cudaMemcpyDeviceToHost,stream));ck(cudaStreamSynchronize(stream));export_bytes+=data.size()*4;
  trace.emplace_back(J::Object{{"parent",ji(nil)},{"action",ji(8)},{"cycle",J(bool(q.root_cycle))},{"key",arr(data.data(),kw)},{"score",ji(0)}});
  for(u32 a=0;a<q.generated;a++)trace.emplace_back(J::Object{{"parent",ji(0)},{"action",ji(input_action(a))},{"cycle",J(bool(q.lanes[a].cyclic))},{"key",arr(data.data()+size_t(a+1)*kw,kw)},{"score",ji(0)}});
  return J(std::move(trace));
 }
 Search(const Game& game,const J& req,u32 token):Search(game,token,configuration(game,req)){}
 Search(const Game& game,u32 token,const Config& cfg,ByteArena* arena=nullptr,ByteArena* pinned=nullptr):g(game),n(cfg.n),kw(cfg.kw),capacity(cfg.capacity),table_size(cfg.table_size),actions((g.g[11]&16)?4:5),fuel(cfg.fuel),probe_budget(cfg.probe_budget),hash_bits(cfg.hash_bits),generation(token),parents(cfg.parents),slots(parents*5),stream(stream_owner.value),gpu(game,n*slots,true,arena,cfg.stream_init?stream:nullptr),queries(n,arena),pristine(size_t(n)*kw,arena),keys(size_t(n)*capacity*kw,arena),table(size_t(n)*table_size,arena),terminal(size_t(n)*kw,arena),answer(n*slots,arena),hashes(size_t(n)*capacity,arena),nodes(size_t(n)*capacity,arena),paths(n,arena),reverse_paths(size_t(n)*std::min(capacity,65536u),arena),decoded_paths(n),path_ready(n,false),host(n,pinned),assist_key(kw,pinned),histories(n*slots),slot_generations(n,cfg.idle_pool?0:1),scratch_keys(size_t(n)*slots*kw,arena),scratch_hashes(size_t(n)*slots,arena),
#ifdef PS_PRODUCTION_SEARCH
 parallel_lanes(size_t(n)*slots,arena),heuristic_values(size_t(n)*capacity,arena),priority_values(size_t(n)*capacity,arena),priority_heaps(size_t(n)*16*((capacity+15)/16),arena),novelty_seen(cfg.guided>=3?std::make_unique<DevMem<u32>>(size_t(n)*novelty_words(g.l.CELL_CAP,g.l.OBJ_WORDS),arena):nullptr),
#endif
 construction_fence{stream}{
  try{
  ck(cudaGetDevice(&device_ordinal));u32 cap=cfg.cap,grant=cfg.grant,maximum=cfg.maximum;allocated_bytes=cfg.bytes;settings=cfg;
  std::vector<u32> roots(size_t(n)*kw);std::vector<Query> q(n);for(u32 i=0;i<n;i++){capture_key(g.l,g.roots[g.roots.size()==1?0:i].data(),roots.data()+size_t(i)*kw);q[i].generation=generation;
#ifdef PS_PRODUCTION_SEARCH
 q[i].guided=cfg.guided;q[i].heuristic_weight=cfg.heuristic_weight;
#endif
 q[i].status=cfg.idle_pool?Vacant:Running;q[i].slot_generation=slot_generations[i];q[i].cap=cap;q[i].grant_end=std::min(cap,grant);q[i].max_states=maximum;}
  std::vector<PathState> path_state(n);SearchFence upload_fence{stream};
  if(cfg.stream_init){ck(cudaMemcpyAsync(paths.p,path_state.data(),n*sizeof(PathState),cudaMemcpyHostToDevice,stream));ck(cudaMemcpyAsync(queries.p,q.data(),q.size()*sizeof(Query),cudaMemcpyHostToDevice,stream));ck(cudaMemcpyAsync(pristine.p,roots.data(),roots.size()*4,cudaMemcpyHostToDevice,stream));ck(cudaMemsetAsync(table.p,0,table.n*4,stream));ck(cudaMemsetAsync(scratch_keys.p,0,scratch_keys.n*4,stream));}
  else{ck(cudaMemcpy(paths.p,path_state.data(),n*sizeof(PathState),cudaMemcpyHostToDevice));ck(cudaMemcpy(queries.p,q.data(),q.size()*sizeof(Query),cudaMemcpyHostToDevice));ck(cudaMemcpy(pristine.p,roots.data(),roots.size()*4,cudaMemcpyHostToDevice));ck(cudaMemset(table.p,0,table.n*4));ck(cudaMemset(scratch_keys.p,0,scratch_keys.n*4));ck(cudaDeviceSynchronize());}
  clear_novelty();ck(cudaEventCreate(&begin));ck(cudaEventCreateWithFlags(&end,settings.blocking_wait?cudaEventBlockingSync:cudaEventDefault));ck(cudaEventCreate(&metadata_begin));ck(cudaEventCreateWithFlags(&pending_done,settings.blocking_wait?cudaEventBlockingSync:cudaEventDefault));if(settings.profile)for(auto& e:stage_events)ck(cudaEventCreate(&e));snapshot();
  }catch(...){cudaStreamSynchronize(stream);release_handles();throw;}
 }
 void release_handles(){for(u32 i=1;i<=8;i++){if(executions[i])cudaGraphExecDestroy(executions[i]);if(graphs[i])cudaGraphDestroy(graphs[i]);}for(auto e:stage_events)if(e)cudaEventDestroy(e);for(auto e:{begin,end,metadata_begin,pending_done})if(e)cudaEventDestroy(e);}
 ~Search(){cudaStreamSynchronize(stream);release_handles();}
 void reset(u32 token){quiescent();require(token&&token!=generation,"Fresh device generation required");require(g.roots.size()==1||g.roots.size()==n,"Reset board count must match batch");auto start=Clock::now();ck(cudaStreamSynchronize(stream));std::vector<Query> q(n);std::vector<PathState> p(n);std::vector<u32> root_keys(size_t(n)*kw);for(u32 i=0;i<n;i++){q[i].generation=token;
#ifdef PS_PRODUCTION_SEARCH
 q[i].guided=settings.guided;q[i].heuristic_weight=settings.heuristic_weight;
#endif
 q[i].status=settings.idle_pool?Vacant:Running;slot_generations[i]=q[i].slot_generation=settings.idle_pool?0:1;q[i].cap=settings.cap;q[i].grant_end=std::min(settings.cap,settings.grant);q[i].max_states=settings.maximum;decoded_paths[i].clear();path_ready[i]=false;capture_key(g.l,g.roots[g.roots.size()==1?0:i].data(),root_keys.data()+size_t(i)*kw);}ck(cudaEventRecord(begin,stream));ck(cudaMemcpyAsync(queries.p,q.data(),q.size()*sizeof(Query),cudaMemcpyHostToDevice,stream));ck(cudaMemcpyAsync(paths.p,p.data(),p.size()*sizeof(PathState),cudaMemcpyHostToDevice,stream));ck(cudaMemcpyAsync(pristine.p,root_keys.data(),root_keys.size()*4,cudaMemcpyHostToDevice,stream));ck(cudaEventRecord(end,stream));ck(cudaStreamSynchronize(stream));float upload=0,clear=0;ck(cudaEventElapsedTime(&upload,begin,end));ck(cudaEventRecord(begin,stream));ck(cudaMemsetAsync(table.p,0,table.n*4,stream));clear_novelty();ck(cudaMemsetAsync(gpu.s.p,0,gpu.s.n*4,stream));ck(cudaMemsetAsync(gpu.receipts.p,0,gpu.receipts.n*4,stream));ck(cudaMemsetAsync(scratch_keys.p,0,scratch_keys.n*4,stream));ck(cudaEventRecord(end,stream));ck(cudaStreamSynchronize(stream));ck(cudaEventElapsedTime(&clear,begin,end));for(auto& h:histories){h.seen.clear();h.ring.clear();h.parent=nil;}generation=token;async_submissions=async_retirements=0;async_wait_ms=last_unit_credit_ms=pending_launch_ms=0;history_bytes=waves=units=metadata_bytes=cycle_bytes=export_bytes=assignments=assignment_upload_bytes=0;assignment_ms=transfer_take_ms=transfer_put_ms=0;takes=returns=transfer_readback_bytes=transfer_upload_bytes=transfer_rehash_probes=0;device_moves=device_move_bytes=device_rehash_probes=device_rehash_launches=device_move_metadata_bytes=0;device_move_ms=0;compute_ms=upload_ms=readback_ms=host_ms=metadata_device_ms=0;for(auto& v:stage_ms)v=0;reset_upload_device_ms=upload;reset_clear_device_ms=clear;reset_ms=elapsed(start);snapshot();}
 void advance(u32 take){
  quiescent();if(!settings.profile){begin_advance(take);retire_advance();return;}
  require(take&&take<=8&&waves+take<1000000000,"Device-search wave capacity");
  for(u32 round=0;round<take;round++){ck(cudaEventRecord(begin,stream));wave();ck(cudaEventRecord(end,stream));ck(cudaEventSynchronize(end));float ms=0;ck(cudaEventElapsedTime(&ms,begin,end));compute_ms+=ms;for(u32 k=0;k<profile_stage_count;k++){ck(cudaEventElapsedTime(&ms,stage_events[k],stage_events[k+1]));stage_ms[k]+=ms;}}
  waves+=take;units++;snapshot();assist();
 }
 bool running()const{quiescent();for(u32 i=0;i<n;i++)if(host.p[i].status==Running)return true;return false;}
 void extend(u32 grant){quiescent();require(grant&&grant<=1000000,"Invalid resume grant");resume<<<(n+31)/32,32,0,stream>>>(queries.p,n,grant);ck(cudaStreamSynchronize(stream));snapshot();}
 void cancel(u32 which,u32 reason=Cancelled){quiescent();require(which==nil||which<n,"Query index out of bounds");stop<<<(n+31)/32,32,0,stream>>>(queries.p,n,which,reason);ck(cudaStreamSynchronize(stream));snapshot(which);}
 const Query& checked_slot(u32 index,u32 token)const{quiescent();
  require(index<n,"Query slot out of bounds");require(host.p[index].slot_generation==token,"Stale query slot generation");return host.p[index];
 }
 u32 assign(u32 index,u32 token,const std::vector<u32>& root,const J& req){
  const auto& old=checked_slot(index,token);
  require(old.status!=Running&&old.status!=Unfinished,"Query slot is live; cancel it before replacement");
  require(token<0x7fffffffu,"Query slot generation overflow");require(root.size()==g.l.STATE_WORDS,"Assignment root layout mismatch");
  for(const char* field:{"nodes","batch","parents_per_query","table_entries","fuel","probe_budget","hash_bits"})require(!req.find(field),std::string("Assignment cannot change allocated configuration: ")+field);
  auto bounded=[&](const char* field,u32 fallback,u32 maximum){int value=num(req,field,int(fallback));require(value>0&&u32(value)<=maximum,std::string("Invalid assignment capacity: ")+field);return u32(value);};
  Query q;
#ifdef PS_PRODUCTION_SEARCH
 q.guided=settings.guided;q.heuristic_weight=settings.heuristic_weight;
#endif
 q.generation=generation;q.slot_generation=token+1;q.cap=bounded("max_expanded",settings.cap,1000000);q.grant_end=std::min(q.cap,bounded("grant",settings.grant,1000000));q.max_states=bounded("max_states",settings.maximum,1000000);q.receipt_round=u32(waves);
  PathState p;std::vector<u32> key(kw);capture_key(g.l,root.data(),key.data());auto started=Clock::now();
  // Receipts keep the global wave clock; only this query's visited namespace,
  // pristine key, path cursor and metadata are recycled. Other queries continue.
  ck(cudaMemsetAsync(table.p+size_t(index)*table_size,0,size_t(table_size)*4,stream));clear_novelty(index);
  ck(cudaMemcpyAsync(pristine.p+size_t(index)*kw,key.data(),kw*4,cudaMemcpyHostToDevice,stream));
  ck(cudaMemcpyAsync(paths.p+index,&p,sizeof(p),cudaMemcpyHostToDevice,stream));
  ck(cudaMemcpyAsync(queries.p+index,&q,sizeof(q),cudaMemcpyHostToDevice,stream));ck(cudaStreamSynchronize(stream));
  const uint64_t cost=uint64_t(kw)*8+128;for(u32 a=0;a<slots;a++){auto& h=histories[size_t(index)*slots+a];history_bytes-=h.ring.size()*cost;h.seen.clear();h.ring.clear();h.parent=nil;}
  slot_generations[index]=q.slot_generation;decoded_paths[index].clear();path_ready[index]=false;
  // Assignment changes this slot only. Reading the full pool after every
  // admission makes a batch perform n*n query-metadata copies.
  assignments++;assignment_upload_bytes+=kw*4+sizeof(q)+sizeof(p);assignment_ms+=elapsed(started);snapshot(index);return q.slot_generation;
 }
 void extend_slot(u32 index,u32 token,u32 grant){
  require(checked_slot(index,token).status==Unfinished,"Query slot is not unfinished");require(grant&&grant<=1000000,"Invalid resume grant");
  resume_slot<<<1,1,0,stream>>>(queries.p,index,grant);ck(cudaGetLastError());snapshot(index);
 }
 void cancel_slot(u32 index,u32 token){checked_slot(index,token);cancel(index);}
 J report(bool export_state=false){decode_paths();J::Array rows;uint64_t debug_bytes=0;for(u32 i=0;i<n;i++){const auto& q=host.p[i];J::Array path;const auto& reverse=decoded_paths[i];const char* tokens[]={"up","left","down","right","action"};for(auto a=reverse.rbegin();a!=reverse.rend();a++)path.emplace_back(std::string(tokens[*a]));
   const char* names[]={"running","unfinished","work_limit","candidate_solution","exhausted","memory_limit","cancelled","timeout","runtime_error","vacant","transferred"};J::Object row{{"job_index",ji(i)},{"status",J(std::string(names[q.status]))},{"detail",ji(q.detail)},{"solution",q.status==Solved?J(std::move(path)):J()},{"expanded",ji(q.expanded)},{"generated",ji(q.generated)},{"unique_states",ji(q.count)},{"duplicates",ji(q.duplicates)},{"max_frontier",ji(q.max_frontier)},{"again_cycles",ji(q.cycles)},{"root_nonquiescent",J(bool(q.root_cycle))},{"gpu_expanded",ji(q.gpu_expanded)},{"cpu_expanded",ji(q.cpu_expanded)},{"grant_end",ji(q.grant_end)},{"partial_parent",J(q.stage==Parent)},{"commit_cursor",ji(q.cursor)},{"hash_probes",ji(q.probes)},{"interpreter_invocations",ji(q.invocations)}};
   row["logical_max_states"]=ji(q.max_states);row["node_capacity"]=ji(capacity);row["hash_capacity"]=ji(table_size);row["gpu_interpreter_invocations"]=ji(q.gpu_invocations);row["cpu_interpreter_invocations"]=ji(q.cpu_invocations);row["pending_probe"]=J(bool(q.probing));row["slot_generation"]=ji(q.slot_generation);row["physical_parents"]=ji(q.physical_parents);row["batch_cursor"]=ji(q.batch_cursor);row["batch_count"]=ji(q.batch_count);
#ifdef PS_PRODUCTION_SEARCH
   row["search_mode"]=J(std::string(q.guided==1?"greedy":q.guided==2?"weighted":q.guided==3?"novelty":q.guided==4?"novelty-tie":"parallel-bfs"));row["shortest_path_guaranteed"]=J(q.guided==0);row["heuristic_weight"]=ji(q.heuristic_weight);row["commit_passes"]=ji(settings.commit_passes);row["level_end"]=ji(q.level_end);row["contention_yields"]=ji(q.contention_yields);row["novelty_buckets"]=ji(q.guided>=3?novelty_buckets:0);row["novelty_bytes_per_query"]=ji(q.guided>=3?novelty_words(g.l.CELL_CAP,g.l.OBJ_WORDS)*4:0);
#endif
   if(export_state){u32 active=q.status==Running?(q.stage==Root?1:q.stage==Parent?q.batch_count*5:0):0;debug_bytes+=uint64_t(q.count)*(kw*4+sizeof(Node))+uint64_t(active)*g.l.STATE_WORDS*4;require(debug_bytes<=64ull*1024*1024,"Explicit debug export exceeds64MiB");std::vector<u32> k(size_t(q.count)*kw),state(size_t(active)*g.l.STATE_WORDS);std::vector<Node> nd(q.count);if(q.count){ck(cudaMemcpy(k.data(),keys.p+size_t(i)*capacity*kw,k.size()*4,cudaMemcpyDeviceToHost));ck(cudaMemcpy(nd.data(),nodes.p+size_t(i)*capacity,nd.size()*sizeof(Node),cudaMemcpyDeviceToHost));}if(active)ck(cudaMemcpy(state.data(),gpu.s.p+size_t(i*slots)*g.l.STATE_WORDS,state.size()*4,cudaMemcpyDeviceToHost));export_bytes+=k.size()*4+nd.size()*sizeof(Node)+state.size()*4;J::Array entries,fifo;for(u32 j=0;j<q.count;j++)entries.emplace_back(J::Object{{"key",arr(k.data()+size_t(j)*kw,kw)},{"parent",ji(nd[j].parent)},{"action",ji(nd[j].action)},{"depth",ji(nd[j].depth)}});for(u32 j=q.head;j<q.count;j++)fifo.push_back(ji(j));row["nodes"]=J(std::move(entries));row["fifo"]=J(std::move(fifo));row["execution_states"]=arr(state.data(),state.size());}
#ifdef PS_PRODUCTION_SEARCH
   if(export_state&&q.guided){
    debug_bytes+=uint64_t(q.count)*12;require(debug_bytes<=64ull*1024*1024,"Guided debug export exceeds64MiB");
    std::vector<u32> h(q.count),p(q.count),open;const u32 queue_capacity=(capacity+15)/16;
    if(q.count){ck(cudaMemcpy(h.data(),heuristic_values.p+size_t(i)*capacity,q.count*4,cudaMemcpyDeviceToHost));ck(cudaMemcpy(p.data(),priority_values.p+size_t(i)*capacity,q.count*4,cudaMemcpyDeviceToHost));}
    for(u32 k=0;k<16;k++)if(q.heap_count[k]){const size_t start=open.size();open.resize(start+q.heap_count[k]);ck(cudaMemcpy(open.data()+start,priority_heaps.p+(size_t(i)*16+k)*queue_capacity,q.heap_count[k]*4,cudaMemcpyDeviceToHost));}
    export_bytes+=q.count*8+open.size()*4;row["heuristic_values"]=arr(h.data(),h.size());row["priorities"]=arr(p.data(),p.size());row["queued_count"]=ji(q.queued_count);row.erase("fifo");row["open_nodes"]=arr(open.data(),open.size());row["batch_parents"]=arr(q.batch_parents,q.stage==Parent?q.batch_count:0);
   }
#endif
   rows.emplace_back(std::move(row));}
  FILETIME created,exited,kernel,user;require(GetProcessTimes(GetCurrentProcess(),&created,&exited,&kernel,&user),"Cannot read driver CPU accounting");auto cpu_ticks=[](FILETIME t){return (uint64_t(t.dwHighDateTime)<<32)|t.dwLowDateTime;};double process_cpu=double(cpu_ticks(kernel)+cpu_ticks(user))/10000;
#ifdef PS_PRODUCTION_SEARCH
  const char* commit_label="parallel_commit";const char* commit_mode=settings.guided?"parallel-guided":"parallel-level-bfs";
#else
  const char* commit_label="ordered_commit";const char* commit_mode=settings.cooperative_commit?"warp":"scalar";
#endif
  J::Object prof;const char* labels[]={"prepare","restore","interpreter","pack_hash",commit_label
#ifdef PS_PRODUCTION_SEARCH
  ,"heuristic","queue_insert"
#endif
  };for(u32 i=0;i<profile_stage_count;i++)prof[labels[i]]=J(stage_ms[i]);
  return J(J::Object{
#ifdef PS_CUDA_PHASE_PROFILE
   {"interpreter_phase_profile",phase_profile_report()},
   {"interpreter_phase_profile_scope",J(std::string("Process-lifetime instrumented warp SM-clock sums including suspension; subtract baseline; not utilization"))},
#endif
   {"task",J(std::string("device-search"))},{"parallel_finish",J(settings.parallel_finish)},{"interpreter_mapping",J(std::string(settings.scalar_interpreter?"scalar":"warp"))},{"interpreter_variant",J(std::string(interpreter_variant()))},{"backend",J(std::string("CUDA"))},{"generation",ji(generation)},{"process_cpu_ms",J(process_cpu)},{"blocking_wait",J(settings.blocking_wait)},{"parents_per_query",ji(parents)},{"ownership_takes",ji(takes)},{"ownership_returns",ji(returns)},{"ownership_rehash_probes",ji(transfer_rehash_probes)},{"ownership_readback_bytes",ji(transfer_readback_bytes)},{"ownership_upload_bytes",ji(transfer_upload_bytes)},{"ownership_take_ms",J(transfer_take_ms)},{"ownership_put_ms",J(transfer_put_ms)},{"slot_assignments",ji(assignments)},{"slot_assignment_ms",J(assignment_ms)},{"slot_assignment_upload_bytes",ji(assignment_upload_bytes)},{"profile_stages",J(settings.profile)},{ "commit_mode",J(std::string(commit_mode))},{"stage_profile_ms",J(std::move(prof))},{"device_owned_visited",J(true)},{"device_owned_fifo",J(true)},{"kernel_receipts_checked",J(true)},{"waves",ji(waves)},{"units",ji(units)},{"async_submissions",ji(async_submissions)},{"async_retirements",ji(async_retirements)},{"async_wait_ms",J(async_wait_ms)},{"last_unit_credit_ms",J(last_unit_credit_ms)},{"allocated_device_bytes",ji(allocated_bytes)},{"reset_ms",J(reset_ms)},{"reset_upload_device_ms",J(reset_upload_device_ms)},{"reset_clear_device_ms",J(reset_clear_device_ms)},{"metadata_readback_device_ms",J(metadata_device_ms)},{"reset_upload_bytes",ji(uint64_t(n)*(kw*4+sizeof(Query)+sizeof(PathState)))},{"compute_ms",J(compute_ms)},{"upload_ms",J(upload_ms)},{"readback_ms",J(readback_ms)},{"cycle_host_intervals_ms",J(host_ms)},{"metadata_readback_bytes",ji(metadata_bytes)},{"cycle_key_readback_bytes",ji(cycle_bytes)},{"explicit_export_bytes",ji(export_bytes)},{"ordinary_successor_readback_bytes",ji(0)},{"key_words",ji(kw)},{"jobs",J(std::move(rows))}});
 }
};
#include "device-transfer.cuh"
#include "device-parking/storage.cuh"
}
