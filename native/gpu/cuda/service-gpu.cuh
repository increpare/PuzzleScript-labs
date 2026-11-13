#pragma once
namespace continuous {
__device__ uint64_t compact_hash(const u32* key,u32 kw){
    uint64_t h=0;u32 k=0;
    for(;k+1<kw;k+=2){uint64_t word=uint64_t(key[k])|(uint64_t(key[k+1])<<32);h=(((h<<5)|(h>>59))^word)*0x517cc1b727220a95ull;}
    if(k<kw)h=(((h<<5)|(h>>59))^uint64_t(key[k]))*0x517cc1b727220a95ull;
    return h;
}
__global__ void hash_compact(const u32* keys,uint64_t* hashes,u32 kw,u32 n){
    u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=n)return;
    hashes[i]=compact_hash(keys+size_t(i)*kw,kw);
}
__global__ void pack_hashed_states(Layout l,const u32* states,u32* keys,uint64_t* hashes,u32 kw,u32 n){
    u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=n)return;
    u32* key=keys+size_t(i)*kw;capture_key(l,states+size_t(i)*l.STATE_WORDS,key);hashes[i]=compact_hash(key,kw);
}
__global__ void restore_compact(Layout l,u32* states,const u32* keys,const u32* slots,const u32* pool,u32 n){
    u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i<n){const u32* key=slots[i]==0xffffffffu?keys+size_t(i)*key_words(l):pool+size_t(slots[i])*key_words(l);restore_key(l,states+size_t(i)*l.STATE_WORDS,key);}
}
struct BatchParent {std::shared_ptr<Query> query;u32 node,lane,count;bool discard=false;};
struct AsyncPool {
    const Game& game;u32 kw,capacity,fuel,max_dispatches;DevMem<u32> constant,pool;std::vector<u32> free;ArenaLease* lease;
    cudaStream_t upload_stream{};cudaEvent_t constant_ready{};
    AsyncPool(const Game& g,u32 cap,u32 fuel=2048,u32 maximum=100000,ArenaLease* lease=nullptr):game(g),kw(key_words(g.l)),capacity(cap),fuel(fuel),max_dispatches(maximum),constant(g.g.size(),lease?&lease->workspace:nullptr),pool(size_t(cap)*kw,lease?&lease->frontier:nullptr),lease(lease){
        require(uint64_t(cap)*kw*4<=2ull*1024*1024*1024,"Service frontier pool exceeds 2 GiB");
        // Pageable HtoD cudaMemcpy may return after staging, before the device
        // copy finishes. Nonblocking interpreter streams must wait explicitly;
        // allocator synchronization used to mask this dependency.
        ck(cudaStreamCreateWithFlags(&upload_stream,cudaStreamNonBlocking));
        ck(cudaEventCreateWithFlags(&constant_ready,cudaEventDisableTiming));
        ck(cudaMemcpyAsync(constant.p,g.g.data(),g.g.size()*4,cudaMemcpyHostToDevice,upload_stream));
        ck(cudaEventRecord(constant_ready,upload_stream));
        free.reserve(cap);for(u32 i=cap;i>0;i--)free.push_back(i-1);
    }
    ~AsyncPool(){cudaStreamSynchronize(upload_stream);cudaEventDestroy(constant_ready);cudaStreamDestroy(upload_stream);}
    u32 allocate(){if(free.empty())return 0xffffffffu;u32 s=free.back();free.pop_back();return s;}
    void release(u32 slot){if(slot!=0xffffffffu){require(slot<capacity,"Invalid resident slot");free.push_back(slot);}}
    void release_query(Query& q){for(auto& n:q.nodes){release(n.slot);n.slot=0xffffffffu;}for(u32 s:q.released)release(s);q.released.clear();}
};
struct AsyncBatch {
    AsyncPool& pool;const Game& g;u32 capacity,kw,active=0,epoch=1,round=0,ticks=0;
    DevMem<u32> states,cache,status,ops,receipts,slots,keys,input_keys;
    DevMem<uint64_t> hashes;
    HostPinned<u32> hslots,hops,hstatus,hreceipts,hkeys,hinput;
    HostPinned<uint64_t> hhashes;
    cudaStream_t stream{};cudaEvent_t complete{},marks[8]{};
    std::atomic<bool> notified{false};std::condition_variable* completion_signal=nullptr;
    std::mutex* completion_mutex=nullptr;
    enum Phase {Idle,Computing,Retaining} phase=Idle;
    std::vector<BatchParent> parents;
    std::vector<BatchParent> completed_parents;
    std::vector<Query*> lane_queries;
    std::vector<bool> cyclic;
    std::vector<std::unique_ptr<CycleHistory>> history;
    std::vector<u32> expected;
    double compute_ms=0,upload_ms=0,readback_ms=0,enqueue_ms=0;
    uint64_t dispatches=0,checked_receipts=0;
    Clock::time_point started;
    bool prehash=true,verify_hash=false,event_wait=false,fused_pack=true;
    uint64_t verified_hashes=0,partial_retirements=0;
    uint64_t cycle_history_limit=256ull*1024*1024;
    explicit AsyncBatch(AsyncPool& p,u32 n,std::condition_variable* signal=nullptr,bool prehash=true,bool verify=false,std::mutex* signal_mutex=nullptr,uint64_t cycle_limit=256ull*1024*1024,bool event_wait=false,bool fused_pack=true):pool(p),g(p.game),capacity(n),kw(p.kw),states(state_pool_words(g,n),p.lease?&p.lease->workspace:nullptr),
      cache(size_t(n)*((g.l.CELL_CAP+1)*g.l.OBJ_WORDS+g.l.MOV_WORDS),p.lease?&p.lease->workspace:nullptr),status(n,p.lease?&p.lease->workspace:nullptr),ops(n,p.lease?&p.lease->workspace:nullptr),receipts(n,p.lease?&p.lease->workspace:nullptr),slots(n,p.lease?&p.lease->workspace:nullptr),keys(size_t(n)*kw,p.lease?&p.lease->workspace:nullptr),input_keys(size_t(n)*kw,p.lease?&p.lease->workspace:nullptr),
      hashes(n,p.lease?&p.lease->workspace:nullptr),hslots(n,p.lease?&p.lease->pinned:nullptr),hops(n,p.lease?&p.lease->pinned:nullptr),hstatus(n,p.lease?&p.lease->pinned:nullptr),hreceipts(n,p.lease?&p.lease->pinned:nullptr),hkeys(size_t(n)*kw,p.lease?&p.lease->pinned:nullptr),hinput(size_t(n)*kw,p.lease?&p.lease->pinned:nullptr),hhashes(n,p.lease?&p.lease->pinned:nullptr),expected(n,0),completion_signal(signal),completion_mutex(signal_mutex),prehash(prehash),verify_hash(verify),cycle_history_limit(cycle_limit),event_wait(event_wait),fused_pack(fused_pack){
        ck(cudaStreamCreateWithFlags(&stream,cudaStreamNonBlocking));ck(cudaEventCreateWithFlags(&complete,cudaEventDisableTiming|(event_wait?cudaEventBlockingSync:0)));
        ck(cudaStreamWaitEvent(stream,p.constant_ready,0));
        for(auto& e:marks)ck(cudaEventCreate(&e));
        // Nonblocking streams do not inherit ordering from default-stream
        // cudaMemset. Initialization must precede restore/execute on this stream.
        ck(cudaMemsetAsync(receipts.p,0,n*4,stream));ck(cudaMemsetAsync(states.p,0,states.n*4,stream));
    }
    ~AsyncBatch(){cudaStreamSynchronize(stream);for(auto e:marks)cudaEventDestroy(e);cudaEventDestroy(complete);cudaStreamDestroy(stream);}
    void mark(int n){ck(cudaEventRecord(marks[n],stream));}
    double interval(int a,int b){float ms=0;ck(cudaEventElapsedTime(&ms,marks[a],marks[b]));return ms;}
    static void CUDART_CB notify(void* pointer){auto* batch=static_cast<AsyncBatch*>(pointer);
        // The predicate and notification share the waiter's mutex. An atomic
        // flag alone can lose a notification between predicate check and sleep.
        if(batch->completion_mutex){std::lock_guard<std::mutex> lock(*batch->completion_mutex);batch->notified.store(true,std::memory_order_release);}
        else batch->notified.store(true,std::memory_order_release);
        if(batch->completion_signal)batch->completion_signal->notify_one();}
    void completion(){notified.store(false,std::memory_order_release);ck(cudaEventRecord(complete,stream));if(!event_wait)ck(cudaLaunchHostFunc(stream,&AsyncBatch::notify,this));}
    bool ready(){if(!event_wait&&notified.load(std::memory_order_acquire))return true;auto r=cudaEventQuery(complete);if(r==cudaErrorNotReady)return false;ck(r);return event_wait;}
    void launch(){
        auto t=Clock::now();require(++round<=pool.max_dispatches,"Service turn continuation limit");
        mark(0);ck(cudaMemcpyAsync(ops.p,hops.p,active*4,cudaMemcpyHostToDevice,stream));mark(1);
        if(g.l.OBJ_WORDS==1&&g.l.MOV_WORDS==1)execute_cooperative<1,1><<<active,32,0,stream>>>(g.l,g.sparse,pool.constant.p,states.p,cache.p,status.p,ops.p,epoch,pool.fuel|0x80000000u,active,receipts.p);
        else if(g.l.OBJ_WORDS==1&&g.l.MOV_WORDS==3)execute_cooperative<1,3><<<active,32,0,stream>>>(g.l,g.sparse,pool.constant.p,states.p,cache.p,status.p,ops.p,epoch,pool.fuel|0x80000000u,active,receipts.p);
        else execute_cooperative<0,0><<<active,32,0,stream>>>(g.l,g.sparse,pool.constant.p,states.p,cache.p,status.p,ops.p,epoch,pool.fuel|0x80000000u,active,receipts.p);
        ck(cudaGetLastError());mark(2);
        if(prehash&&fused_pack){pack_hashed_states<<<(active+31)/32,32,0,stream>>>(g.l,states.p,keys.p,hashes.p,kw,active);ck(cudaGetLastError());}
        else{pack_states<<<(active+31)/32,32,0,stream>>>(g.l,states.p,keys.p,active);ck(cudaGetLastError());if(prehash){hash_compact<<<(active+31)/32,32,0,stream>>>(keys.p,hashes.p,kw,active);ck(cudaGetLastError());}}mark(3);
        ck(cudaMemcpyAsync(hkeys.p,keys.p,size_t(active)*kw*4,cudaMemcpyDeviceToHost,stream));
        ck(cudaMemcpyAsync(hstatus.p,status.p,active*4,cudaMemcpyDeviceToHost,stream));
        ck(cudaMemcpyAsync(hreceipts.p,receipts.p,active*4,cudaMemcpyDeviceToHost,stream));
        if(prehash)ck(cudaMemcpyAsync(hhashes.p,hashes.p,active*8,cudaMemcpyDeviceToHost,stream));
        mark(4);
        completion();phase=Computing;dispatches++;enqueue_ms+=elapsed(t);
    }
    void start(std::vector<BatchParent> selected,const std::vector<u32>& actions){
        require(phase==Idle&&!selected.empty(),"Batch ownership error");started=Clock::now();parents=std::move(selected);active=0;epoch=1;round=0;ticks=0;
        for(auto& p:parents){p.lane=active;p.count=p.node==0xffffffffu?1:u32(actions.size());active+=p.count;}
        require(active<=capacity,"Service GPU lane overflow");lane_queries.assign(active,nullptr);cyclic.assign(active,false);history.clear();history.resize(active);
        bool upload=false;
        for(const auto& p:parents)for(u32 a=0;a<p.count;a++){
            u32 lane=p.lane+a;lane_queries[lane]=p.query.get();hops.p[lane]=p.node==0xffffffffu?8:actions[a];
            u32 slot=p.node==0xffffffffu?0xffffffffu:p.query->nodes[p.node].slot;hslots.p[lane]=slot;
            if(slot==0xffffffffu){upload=true;const auto& source=p.node==0xffffffffu?identity(p.query->pristine):*p.query->nodes[p.node].key;std::memcpy(hinput.p+size_t(lane)*kw,source.data(),kw*4);}
        }
        // One upload/restore phase precedes bounded interpreter continuations.
        mark(5);ck(cudaMemcpyAsync(slots.p,hslots.p,active*4,cudaMemcpyHostToDevice,stream));
        if(upload)ck(cudaMemcpyAsync(input_keys.p,hinput.p,size_t(active)*kw*4,cudaMemcpyHostToDevice,stream));mark(6);
        restore_compact<<<(active+31)/32,32,0,stream>>>(g.l,states.p,input_keys.p,slots.p,pool.pool.p,active);ck(cudaGetLastError());mark(7);launch();
    }
    // Returns true when at least one whole query can be committed independently.
    bool collect(){
        require(phase==Computing&&ready(),"Collect before GPU completion");
        if(prehash&&verify_hash)for(u32 i=0;i<active;i++){auto key=KeyView(hkeys.p+size_t(i)*kw,kw);require(hhashes.p[i]==WordHash{}(std::string_view(reinterpret_cast<const char*>(key.data()),key.size_bytes())),"GPU hash differs from full CPU hash");verified_hashes++;}
        double work=interval(1,3);upload_ms+=interval(0,1);readback_ms+=interval(3,4);
        if(round==1&&epoch==1){upload_ms+=interval(5,6);work+=interval(6,7);}compute_ms+=work;
        u32 owned=0;for(const auto& p:parents)owned+=p.count;
        for(const auto& p:parents)p.query->gpu_ms+=work*p.count/owned;
        bool continuation=false;
        for(u32 i=0;i<active;i++){
            require(hreceipts.p[i]==(expected[i]+=2),"Missing asynchronous CUDA kernel receipt");checked_receipts++;if(!lane_queries[i]){hops.p[i]=0xffffffffu;continue;}lane_queries[i]->gpu_receipts++;
            require(hstatus.p[i]<=1,"Service interpreter failure status "+std::to_string(hstatus.p[i]));
            if(lane_queries[i]->stop_requested()){hops.p[i]=0xffffffffu;continue;}
            continuation|=hstatus.p[i]==0;
        }
        // An uncommitted chunk may yield to CPU at this bounded readback point.
        // No partial key is accepted: all popped parents are returned in their
        // original BFS order, with their original compact states and RNG.
        if(std::any_of(parents.begin(),parents.end(),[](const auto& p){return p.query->latency_routing&&!p.query->pinned_executor;})){
            struct Ownership {u32 parents=0;bool settled=true;};std::unordered_map<Query*,Ownership> own;
            for(const auto& p:parents)own[p.query.get()].parents+=p.node!=0xffffffffu;
            for(u32 i=0;i<active;i++)if(auto* q=lane_queries[i]){const auto* key=hkeys.p+size_t(i)*kw;if(hstatus.p[i]==0||(!cyclic[i]&&key[0]&&!key[1]))own[q].settled=false;}
            const double residence=elapsed(started);
            for(const auto& [q,n]:own)if(q->status=="running"&&q->yield_gpu(residence,n.parents)){q->gpu_return_cpu=true;q->gpu_abort_chunk=!n.settled;}
        }
        bool again=false;uint64_t cycle_bytes=0,cycle_entry_bytes=uint64_t(kw)*8+128;
        for(const auto& h:history)if(h)cycle_bytes+=uint64_t(h->ring.size())*cycle_entry_bytes;
        if(!continuation)for(u32 i=0;i<active;i++){
            auto* key=hkeys.p+size_t(i)*kw;hops.p[i]=0xffffffffu;
            if(!lane_queries[i]||lane_queries[i]->stop_requested()||lane_queries[i]->gpu_abort_chunk||cyclic[i]||!key[0]||key[1])continue;
            require(ticks<10000,"Service AGAIN continuation limit");
            if(ticks>=64){if(!history[i])history[i]=std::make_unique<CycleHistory>();auto id=identity(KeyView(key,kw));
                if(history[i]->seen.contains(id)){cyclic[i]=true;continue;}
                uint64_t growth=history[i]->ring.size()<1024?cycle_entry_bytes:0;
                if(cycle_bytes+growth>cycle_history_limit){lane_queries[i]->status="memory_limit";lane_queries[i]->detail="GPU cycle-history slice";continue;}
                cycle_bytes+=growth;history[i]->repeated(std::move(id));}
            hops.p[i]=5;again=true;
        }
        require(cycle_bytes<=cycle_history_limit,"Service cycle history exceeds its slice");
        if(again){ticks++;require(++epoch!=0,"Service operation epoch overflow");round=0;}
        // A batch is a dispatch container, not an operation barrier. A long
        // continuation/AGAIN chain in one query must not hold settled peers.
        std::unordered_set<Query*> pending;
        for(u32 i=0;i<active;i++)if(auto* q=lane_queries[i]){
            const auto* key=hkeys.p+size_t(i)*kw;
            if(!q->stop_requested()&&!q->gpu_abort_chunk&&(hstatus.p[i]==0||(!cyclic[i]&&key[0]&&!key[1])))pending.insert(q);
        }
        completed_parents.clear();std::vector<BatchParent> remaining;
        for(auto& p:parents){if(pending.contains(p.query.get()))remaining.push_back(std::move(p));else{p.discard=p.query->gpu_abort_chunk;completed_parents.push_back(std::move(p));}}parents=std::move(remaining);
        if(!completed_parents.empty()){partial_retirements+=!parents.empty();return true;}
        require(continuation||again,"Unsettled query without a continuation");launch();return false;
    }
    void retain(){
        auto t=Clock::now();mark(0);ck(cudaMemcpyAsync(slots.p,hslots.p,active*4,cudaMemcpyHostToDevice,stream));mark(1);
        retain_keys<<<(active+31)/32,32,0,stream>>>(pool.pool.p,keys.p,slots.p,kw,active);ck(cudaGetLastError());mark(2);completion();phase=Retaining;enqueue_ms+=elapsed(t);
    }
    void retained(){require(phase==Retaining&&ready(),"Retain before completion");upload_ms+=interval(0,1);double work=interval(1,2);compute_ms+=work;
        for(const auto& p:completed_parents){p.query->gpu_ms+=work*p.count/active;for(u32 a=0;a<p.count;a++){u32 i=p.lane+a;lane_queries[i]=nullptr;hops.p[i]=0xffffffffu;history[i].reset();}}
        completed_parents.clear();if(parents.empty())phase=Idle;else launch();
    }
};
}

