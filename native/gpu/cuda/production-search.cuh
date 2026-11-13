// Included inside namespace resident, after the exact BFS kernels.
// One warp per successor. Within-depth order is deliberately unspecified.
// No claim survives a kernel, and a contended hash slot yields instead of spinning.
__global__ void production_prepare(Query* queries,ParallelLane* parallel,u32* heaps,const u32* priority,u32 capacity,u32 count,u32 parents,u32 actions){
 const u32 qi=blockIdx.x*blockDim.x+threadIdx.x;if(qi>=count)return;
 auto& q=queries[qi];if(q.status!=Running)return;
 if(q.stage==NeedRoot){prepare_one(q,parents,actions,true);return;}
 if(q.stage==Ready){
  if(q.head==q.count){q.status=Exhausted;return;}
  if(q.expanded>=q.cap){q.status=WorkLimit;return;}
  if(q.expanded>=q.grant_end){q.status=Unfinished;return;}
  if(!q.guided&&q.head==q.level_end)q.level_end=q.count;
  if(!q.guided&&(q.head>q.level_end||q.level_end>q.count)){q.status=Failure;q.detail=Receipt;return;}
  const u32 remaining=u32((q.cap<q.grant_end?q.cap:q.grant_end)-q.expanded);
  q.batch_count=min(parents,min((q.guided?q.count:q.level_end)-q.head,remaining));
  if(q.guided){
   if(q.queued_count!=q.count){q.status=Failure;q.detail=Receipt;return;}
   const u32 queue_capacity=(capacity+15)/16;const u32* scores=priority+size_t(qi)*capacity;
   for(u32 p=0;p<q.batch_count;p++){
    u32 best=nil,best_queue=0;
    for(u32 k=0;k<16;k++)if(q.heap_count[k]){u32 id=heaps[(size_t(qi)*16+k)*queue_capacity];if(best==nil||priority_less(id,best,scores)){best=id;best_queue=k;}}
    if(best==nil){q.status=Failure;q.detail=Receipt;return;}
    q.batch_parents[p]=priority_pop(heaps+(size_t(qi)*16+best_queue)*queue_capacity,q.heap_count[best_queue],scores);
   }
  }
  q.batch_start=q.head;q.parent=q.guided?q.batch_parents[0]:q.head;q.head+=q.batch_count;
  q.batch_cursor=0;q.cursor=0;q.batch_owner=2;q.stage=Parent;
  q.expanded+=q.batch_count;q.gpu_expanded+=q.batch_count;q.physical_parents+=q.batch_count;
  for(u32 a=0;a<q.batch_count*5;a++){
   parallel[size_t(qi)*parents*5+a]={};
   q.lanes[a]={Execute,input_action(a%5),0,0,0,1};
  }
 }
 const u32 active=q.stage==Root?1:q.stage==Parent?q.batch_count*5:0;
 for(u32 a=0;a<active;a++){
  if(q.stage==Parent&&a%5>=actions)continue;
  auto& lane=q.lanes[a];
  if(lane.phase==Tick){lane.phase=Execute;lane.op=5;lane.rounds=0;lane.fresh=2;}
  if(lane.phase==Execute){q.invocations++;q.gpu_invocations++;}
 }
}

__global__ void production_settle(Query* queries,const u32* status,const u32* receipts,
 const u32* packed,const uint64_t* packed_hashes,u32* keys,uint64_t* hashes,Node* nodes,
 u32* table,u32* terminal,u32 kw,u32 capacity,u32 table_size,u32 parents,u32 actions){
 const u32 qi=blockIdx.x,slots=parents*5;auto& q=queries[qi];
 if(threadIdx.x==0){
  const u32 expected=(++q.receipt_round)*2;
  for(u32 a=0;a<slots;a++)if(receipts[qi*slots+a]!=expected){q.receipt_error=1;q.status=Failure;q.detail=Receipt;}
  if(q.status==Running){
   const u32 active=q.stage==Root?1:q.stage==Parent?q.batch_count*5:0;
   for(u32 a=0;a<active;a++){
    if(q.stage==Parent&&a%5>=actions)continue;
    auto& lane=q.lanes[a];if(lane.phase!=Execute)continue;
    if(++lane.rounds>100000){q.status=Failure;q.detail=ContinuationLimit;break;}
    const u32 i=qi*slots+a;
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
 __syncwarp();if(q.status!=Running||q.stage!=Root||q.lanes[0].phase!=Settled)return;
 const u32* key=packed+size_t(qi*slots)*kw;const uint64_t h=packed_hashes[qi*slots];
 copy_key_warp(keys+size_t(qi)*capacity*kw,key,kw);
 if(key[1])copy_key_warp(terminal+size_t(qi)*kw,key,kw);
 if(threadIdx.x==0){
  hashes[size_t(qi)*capacity]=h;nodes[size_t(qi)*capacity]={nil,0,0};
  table[size_t(qi)*table_size+(u32(h)&(table_size-1))]=1;
  q.count=1;q.level_end=1;q.stage=Ready;
  if(key[1]){q.status=Solved;q.head=1;}
  else if(q.lanes[0].cyclic){q.status=Exhausted;q.head=1;q.root_cycle=1;q.cycles++;}
  else q.max_frontier=1;
 }
}

__global__ void production_insert(Query* queries,ParallelLane* parallel,const u32* packed,const uint64_t* packed_hashes,
 u32* keys,uint64_t* hashes,Node* nodes,u32* table,u32 kw,u32 capacity,u32 table_size,
 u32 parents,u32 actions,u32 probe_budget){
 const u32 slots=parents*5,qi=blockIdx.x/slots,a=blockIdx.x%slots,tid=threadIdx.x;
 auto& q=queries[qi];auto& p=parallel[size_t(qi)*slots+a];
 if(q.status!=Running||q.stage!=Parent||a>=q.batch_count*5||a%5>=actions||
    q.lanes[a].phase!=Settled||p.state==2||p.error)return;
 const size_t i=size_t(qi)*slots+a;const u32* key=packed+i*kw;const uint64_t h=packed_hashes[i];
 if(tid==0&&p.state==0){
  p.generated=1;p.state=1;p.slot=u32(h)&(table_size-1);
  if(q.lanes[a].cyclic){p.cycles=1;p.state=2;}
  else if(key[1]){p.winner=1;p.state=2;}
 }
 __syncwarp();if(p.state==2)return;
 for(u32 step=0;step<probe_budget;step++){
  u32* slot=table+size_t(qi)*table_size+p.slot;
  cuda::atomic_ref<u32,cuda::thread_scope_device> entry_atomic(*slot);
  u32 entry=0;
  if(tid==0){entry=entry_atomic.load(cuda::memory_order_acquire);p.probes++;}
  entry=__shfl_sync(0xffffffffu,entry,0);
  if(entry==nil){if(tid==0)p.yields++;return;}
  if(entry==0){
   u32 claimed=0;
   if(tid==0){u32 expected=0;claimed=entry_atomic.compare_exchange_strong(expected,nil,cuda::memory_order_acq_rel);}
   claimed=__shfl_sync(0xffffffffu,claimed,0);
   if(!claimed){if(tid==0)p.yields++;return;}
   u32 id=nil;
   if(tid==0){
    cuda::atomic_ref<u32,cuda::thread_scope_device> count_atomic(q.count);
    u32 next=count_atomic.load(cuda::memory_order_relaxed);
    // Bounded contention retry. Never increment beyond the declared capacity.
    for(u32 attempt=0;attempt<128;attempt++){
     if(next>=q.max_states||next>=capacity){p.error=next>=q.max_states?NodeCapacity:DeviceCapacity;break;}
     if(count_atomic.compare_exchange_weak(next,next+1,cuda::memory_order_relaxed)){id=next;break;}
    }
    if(id==nil){entry_atomic.store(0,cuda::memory_order_release);p.yields++;}
   }
   id=__shfl_sync(0xffffffffu,id,0);if(id==nil)return;
   const size_t index=size_t(qi)*capacity+id;
   copy_key_warp(keys+index*kw,key,kw);
   if(tid==0){
    hashes[index]=h;const u32 parent=search_parent(q,a);
    nodes[index]={parent,input_action(a%5),nodes[size_t(qi)*capacity+parent].depth+1};
   }
   // Every writer publishes its words before the leader releases the hash slot.
   cuda::atomic_thread_fence(cuda::memory_order_release,cuda::thread_scope_device);
   __syncwarp();
   if(tid==0){entry_atomic.store(id+1,cuda::memory_order_release);p.state=2;}
   return;
  }
  // Published entries are immutable. Acquire on every reader, not only lane0.
  (void)entry_atomic.load(cuda::memory_order_acquire);
  const size_t index=size_t(qi)*capacity+entry-1;
  if(hashes[index]==h&&equal_key_warp(keys+index*kw,key,kw)){
   if(tid==0){p.duplicates=1;p.state=2;}return;
  }
  if(tid==0){p.slot=(p.slot+1)&(table_size-1);if(++p.probe_count>=table_size)p.error=HashCapacity;}
  __syncwarp();if(p.error)return;
 }
}

__global__ void production_finish(Query* queries,ParallelLane* parallel,const u32* packed,u32* terminal,u32 kw,u32 parents,u32 actions){
 const u32 qi=blockIdx.x,slots=parents*5;auto& q=queries[qi];
 if(q.status!=Running||q.stage!=Parent)return;
 u32 winner=nil,error=0;bool done=true;
 // All warps have finished inserting. No slot is locked between dispatches.
 for(u32 a=0;a<q.batch_count*5;a++){
  if(a%5>=actions)continue;
  auto& p=parallel[size_t(qi)*slots+a];done&=p.state==2;
  if(p.winner&&winner==nil)winner=a;
  if(p.error&&!error)error=p.error;
  if(threadIdx.x==0){
   q.generated+=p.generated;q.duplicates+=p.duplicates;q.cycles+=p.cycles;
   q.probes+=p.probes;q.contention_yields+=p.yields;
   p.generated=p.duplicates=p.cycles=p.probes=p.yields=0;
  }
 }
 // A valid winning edge is conclusive even if a sibling runs out of storage.
 // Interpreter failures were checked by settle before any insertion occurs.
 if(winner!=nil){
  copy_key_warp(terminal+size_t(qi)*kw,packed+(size_t(qi)*slots+winner)*kw,kw);
  if(threadIdx.x==0){q.status=Solved;q.winner_parent=search_parent(q,winner);q.winner_action=input_action(winner%5);}
 }else if(threadIdx.x==0){
  const u32 open=q.count-q.head;if(open>q.max_frontier)q.max_frontier=open;
  if(error){q.status=Memory;q.detail=error;}
  else if(done){
   q.stage=Ready;
   if(q.head==q.count)q.status=Exhausted;
   else if(q.expanded>=q.cap)q.status=WorkLimit;
   else if(q.expanded>=q.grant_end)q.status=Unfinished;
  }
 }
}
