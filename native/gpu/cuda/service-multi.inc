// Service members. CUDA-only workers may keep several shapes in flight; all
// pools share the existing device/frontier/pinned limits by bounded slices.
struct GpuResident {
    std::shared_ptr<Context> context;
    std::unique_ptr<ArenaLease> lease;
    std::unique_ptr<AsyncPool> pool;
    std::vector<std::unique_ptr<AsyncBatch>> batches;
    uint64_t device_bytes=0,pinned_bytes=0,frontier_bytes=0;
    bool idle()const{return std::all_of(batches.begin(),batches.end(),[](const auto& b){return b->phase==AsyncBatch::Idle;});}
};
void gpu_loop_multi(){
    std::vector<std::unique_ptr<GpuResident>> residents;
    double retired_compute=0,retired_upload=0,retired_readback=0,retired_enqueue=0;
    uint64_t retired_dispatches=0,retired_receipts=0,retired_verified=0,retired_partial=0;
    auto find=[&](u32 handle)->GpuResident*{for(auto& r:residents)if(r->context->handle==handle)return r.get();return nullptr;};
    auto active_context=[&](const GpuResident& r){return std::any_of(active.begin(),active.end(),[&](const auto& entry){return entry.second->context==r.context;});};
    auto retire=[&](GpuResident& r){
        require(r.pool->free.size()==r.pool->capacity,"Resident frontier slots leaked before eviction");
        for(auto& b:r.batches){retired_compute+=b->compute_ms;retired_upload+=b->upload_ms;retired_readback+=b->readback_ms;retired_enqueue+=b->enqueue_ms;retired_dispatches+=b->dispatches;retired_receipts+=b->checked_receipts;retired_verified+=b->verified_hashes;retired_partial+=b->partial_retirements;}
    };
    auto publish=[&]{
        std::lock_guard<std::mutex> lock(stats_mutex);
        gpu_compute=retired_compute;gpu_upload=retired_upload;gpu_readback=retired_readback;gpu_enqueue=retired_enqueue;
        gpu_dispatches=retired_dispatches;gpu_receipts=retired_receipts;gpu_verified_hashes=retired_verified;gpu_partial_retirements=retired_partial;
        gpu_reserved_device=0;gpu_reserved_pinned=0;gpu_reserved_frontier=0;
        for(auto& r:residents){gpu_reserved_device+=r->device_bytes;gpu_reserved_pinned+=r->pinned_bytes;gpu_reserved_frontier+=r->frontier_bytes;
            for(auto& b:r->batches){gpu_compute+=b->compute_ms;gpu_upload+=b->upload_ms;gpu_readback+=b->readback_ms;gpu_enqueue+=b->enqueue_ms;gpu_dispatches+=b->dispatches;gpu_receipts+=b->checked_receipts;gpu_verified_hashes+=b->verified_hashes;gpu_partial_retirements+=b->partial_retirements;}}
        if(gpu_arenas){gpu_reserved_device=gpu_arenas->workspace.capacity+gpu_arenas->frontier.capacity;gpu_reserved_frontier=gpu_arenas->frontier.capacity;gpu_reserved_pinned=gpu_arenas->pinned.capacity;}
        require(gpu_reserved_device<=8ull*1024*1024*1024&&gpu_reserved_frontier<=2ull*1024*1024*1024&&gpu_reserved_pinned<=512ull*1024*1024,"Aggregate GPU pool budget exceeded");
        gpu_resident_contexts=u32(residents.size());gpu_contexts_peak.store(std::max(gpu_contexts_peak.load(),u32(residents.size())));
        u32 in_flight=0;for(const auto& r:residents)in_flight+=!r->idle();gpu_parallel_contexts_peak.store(std::max(gpu_parallel_contexts_peak.load(),in_flight));
    };
    try{
        ck(cudaSetDevice(adapter));
        for(;;){
            // Cancelled ready queries may own slots in any resident shape.
            std::vector<std::shared_ptr<Query>> expired;
            {std::lock_guard<std::mutex> lock(mutex);if(stopping)break;auto now=Clock::now();
                for(auto i=ready.begin();i!=ready.end();){auto& q=*i;bool timeout=!q->execution_budget&&(q->include_queue_time||q->has_started)&&now>=q->deadline;
                    if(q->cancelled||timeout){expired.push_back(q);i=ready.erase(i);}else ++i;}}
            for(auto& q:expired){if(auto* r=find(q->context->handle))r->pool->release_query(*q);q->stop_requested();complete_query(q);}
            bool progress=!expired.empty();
            for(auto& r:residents)for(auto& p:r->batches){auto& b=*p;
                if(b.phase!=AsyncBatch::Idle&&b.ready()){
                    if(b.phase==AsyncBatch::Computing){if(b.collect())commit_batch(b,r->context->native);}
                    else{
                        std::vector<std::shared_ptr<Query>> returned;std::unordered_set<Query*> unique;u32 expanded=0;
                        for(auto& parent:b.completed_parents){expanded+=parent.node!=0xffffffffu;if(unique.insert(parent.query.get()).second){parent.query->gpu_active_ms+=elapsed(b.started);returned.push_back(parent.query);}}
                        if(expanded){double sample=elapsed(b.started)/expanded/streams,old=r->context->gpu_parent_ms.load();r->context->gpu_parent_ms.store(old*.9+sample*.1);gpu_parent_ms.store(old*.9+sample*.1);}
                        b.retained();for(auto& q:returned){if(q->status!="running"||q->stop_requested())r->pool->release_query(*q);return_query(q);}
                    }
                    progress=true;
                }
                if(b.phase==AsyncBatch::Idle){auto selected=select_gpu(*r->pool,b.capacity);if(!selected.empty()){
                    bool overlap=std::any_of(residents.begin(),residents.end(),[](const auto& other){return !other->idle();});
                    b.start(std::move(selected),actions(r->pool->game));gpu_batches++;overlap_submissions+=overlap;progress=true;
                }}
            }
            // Admit one new shape per iteration, so already allocated shapes
            // launch and collect while subsequent pools are being prepared.
            std::shared_ptr<Context> next;size_t victim=residents.size();
            {std::lock_guard<std::mutex> lock(mutex);
                for(const auto& q:ready)if(!q->cancelled&&!find(q->context->handle)){next=q->context;break;}
                if(next&&residents.size()>=gpu_context_limit){for(size_t i=0;i<residents.size();i++)if(residents[i]->idle()&&!active_context(*residents[i])){victim=i;break;}if(victim==residents.size())next.reset();}}
            if(next){
                if(victim<residents.size()){auto t=Clock::now();retire(*residents[victim]);residents.erase(residents.begin()+victim);std::lock_guard<std::mutex> lock(stats_mutex);gpu_retire_ms+=elapsed(t);}
                auto setup=Clock::now();auto r=std::make_unique<GpuResident>();r->context=next;if(gpu_arenas)r->lease=gpu_arenas->acquire();
                const auto& game=*next->game;uint64_t keybytes=uint64_t(key_words(game.l))*4,constant=uint64_t(game.g.size())*4;
                uint64_t device_limit=(8ull*1024*1024*1024)/gpu_context_limit,frontier_limit=(2ull*1024*1024*1024)/gpu_context_limit,pinned_limit=(512ull*1024*1024)/gpu_context_limit;
                uint64_t workspace_limit=0;if(r->lease){workspace_limit=r->lease->workspace.capacity-65536;frontier_limit=r->lease->frontier.capacity-65536;pinned_limit=r->lease->pinned.capacity-65536;}
                u32 slots=u32(std::min(uint64_t(pool_capacity),frontier_limit/keybytes));require(slots>=5,"Shape does not fit resident frontier slice");
                uint64_t lane_bytes=uint64_t(game.l.STATE_WORDS)*4+((game.l.CELL_CAP+1)*game.l.OBJ_WORDS+game.l.MOV_WORDS)*4+keybytes*2+28;
                require(constant+keybytes*slots<device_limit,"Shape constants exceed resident device slice");
                u32 lanes=u32(std::min({uint64_t(gpu_lanes),(r->lease?workspace_limit-constant:device_limit-constant-keybytes*slots)/(lane_bytes*streams),pinned_limit/((keybytes*2+24)*streams)}));
                require(lanes>=5,"Shape does not fit resident interpreter/pinned slice");
                r->pool=std::make_unique<AsyncPool>(game,slots,fuel,max_dispatches,r->lease.get());
                for(u32 i=0;i<streams;i++)r->batches.push_back(std::make_unique<AsyncBatch>(*r->pool,lanes,&gpu_cv,gpu_prehashed,verify_gpu_hash,&mutex,(256ull*1024*1024)/(gpu_context_limit*streams),gpu_event_wait,gpu_fused_pack));
                r->frontier_bytes=keybytes*slots;r->device_bytes=constant+r->frontier_bytes+uint64_t(lanes)*lane_bytes*streams;r->pinned_bytes=uint64_t(lanes)*(keybytes*2+24)*streams;
                residents.push_back(std::move(r));gpu_context=next->handle;effective_lanes=lanes;effective_pool=slots;
                {std::lock_guard<std::mutex> lock(stats_mutex);gpu_setup_ms+=elapsed(setup);}progress=true;
            }
            publish();
            if(!progress&&gpu_event_wait){AsyncBatch* pending=nullptr;for(const auto& r:residents)for(const auto& b:r->batches)if(!pending&&b->phase!=AsyncBatch::Idle)pending=b.get();if(pending){wait_gpu_event(*pending);continue;}}
            if(!progress){std::unique_lock<std::mutex> lock(mutex);gpu_cv.wait(lock,[&]{
                if(stopping)return true;
                for(const auto& r:residents)for(const auto& b:r->batches)if(b->phase!=AsyncBatch::Idle&&b->notified.load(std::memory_order_acquire))return true;
                for(const auto& q:ready){if(q->cancelled)return true;auto* r=find(q->context->handle);
                    if(r){if(std::any_of(r->batches.begin(),r->batches.end(),[](const auto& b){return b->phase==AsyncBatch::Idle;}))return true;}
                    else if(residents.size()<gpu_context_limit||std::any_of(residents.begin(),residents.end(),[&](const auto& other){return other->idle()&&!active_context(*other);}))return true;
                }return false;});}
        }
    }catch(const std::exception& e){
        for(auto& r:residents)for(auto& b:r->batches)cudaStreamSynchronize(b->stream);
        std::vector<std::shared_ptr<Query>> failed;
        {std::lock_guard<std::mutex> lock(mutex);gpu_error=e.what();for(auto& [id,q]:active)failed.push_back(q);ready.clear();}
        for(auto& q:failed){q->status="runtime_error";q->detail=e.what();complete_query(q);}cv.notify_all();gpu_cv.notify_one();
    }
}
