// Retain several independent compiled-game pools. A context switch schedules
// another bounded unit; it does not detach the previous game's queries.
static bool resident_live(const ResidentPool& p){return std::any_of(p.leases.begin(),p.leases.end(),[](const auto& q){return bool(q);});}
static bool resident_fits(const ResidentPool& p,const Query& q){return p.context==q.context&&p.bits==q.visited.hash_function().bits&&resident_accepted_count(q)<p.nodes&&(!q.trace_enabled||p.nodes>=6);}
static u32 resident_free_slot(const ResidentPool& p){if(p.search->in_flight())return resident::nil;for(u32 i=0;i<p.leases.size();i++)if(!p.leases[i]&&!p.parked[i].generation)return i;return resident::nil;}
u32 resident_old_slot(const ResidentPool& p)const{
    if(p.search->in_flight())return resident::nil;
    u32 oldest=resident::nil;for(u32 i=0;i<p.leases.size();i++)if(p.leases[i]&&elapsed(p.lease_since[i])>=resident_slot_rotation_ms&&(oldest==resident::nil||p.lease_since[i]<p.lease_since[oldest]))oldest=i;return oldest;
}
bool resident_evictable(const ResidentPool& p)const{return !p.search->in_flight()&&(!resident_live(p)||elapsed(p.admitted)>=resident_rotation_ms);}
void resident_gpu_resource(const std::shared_ptr<Query>& q,const std::string& message){
    if(mode=="hybrid"&&!q->pinned_executor){resident_set_cpu(*q);return_query(q);}
    else{q->status="memory_limit";q->detail=message;complete_query(q);}
}
std::unique_ptr<ResidentPool> resident_plan_pool(const std::shared_ptr<Query>& q,u32 accepted=resident::nil,bool reject=true,bool root_sizing=true){
    auto p=std::make_unique<ResidentPool>();p->context=q->context;p->game=std::make_unique<Game>(*q->context->game);p->game->roots={p->game->initial};p->bits=q->visited.hash_function().bits;
    u32 physical=std::min(gpu_queries,gpu_lanes/(gpu_parents*5));
    const u32 fixed_physical=physical;
    if(root_sizing&&resident_slot_policy=="roots")physical=std::min(physical,u32(std::max(size_t(1),q->context->roots.size())));
    auto capacity_failure=[&](const std::string& message)->std::unique_ptr<ResidentPool>{
        // Wider initial node slices are optional. Preserve every layout that
        // the fixed policy supports if the larger slice cannot be allocated.
        if(physical<fixed_physical){resident_root_sizing_fallbacks++;return resident_plan_pool(q,accepted,reject,false);}
        if(reject)resident_gpu_resource(q,message);return {};
    };
    u32 base=std::max(1u,pool_capacity/(physical*gpu_context_limit)),count=accepted==resident::nil?resident_accepted_count(*q):accepted;
    p->nodes=u32(std::min(uint64_t(1000000),std::bit_ceil(std::max(uint64_t(base),uint64_t(count)+std::max(1u,base/4)))));
    if(q->trace_enabled)p->nodes=std::max(p->nodes,8u);
    uint64_t per_key=q->pristine.size()*4;
    if(p->nodes>pool_capacity||uint64_t(p->nodes)*per_key>resident_key_limit)return capacity_failure("Resident aggregate node/key budget cannot hold query");
    u32 node_share=std::max(p->nodes,pool_capacity/gpu_context_limit);
    u32 slots=u32(std::min({uint64_t(physical),uint64_t(node_share/p->nodes),resident_key_limit/(uint64_t(p->nodes)*per_key)}));
    for(;;){
        try{
            J request(J::Object{{"batch",ji(slots)},{"nodes",ji(p->nodes)},{"parents_per_query",ji(gpu_parents)},{"fuel",ji(fuel)},{"hash_bits",ji(p->bits)},{"idle_pool",J(true)},{"blocking_wait",J(gpu_event_wait)}});
            p->config=resident::configuration(*p->game,request,false);
            p->config.stream_init=resident_memory=="arena";
            p->config.word_specialization=resident_word_specialization;
            p->config.line_compaction=resident_line_compaction;
            p->config.parallel_ellipses=resident_parallel_ellipses;
        }catch(const std::exception& e){
            auto message=std::string(e.what());bool capacity=message.find("Device-search storage exceeds")==0||message.find("Device-search interpreter pool exceeds")==0;
            if(!capacity)throw;if(slots>1){slots=std::max(1u,slots/2);continue;}return capacity_failure(message);
        }
        p->key_bytes=uint64_t(slots)*p->nodes*per_key;p->node_slots=uint64_t(slots)*p->nodes;
        bool exceeds=p->config.bytes>resident_device_limit||p->key_bytes>resident_key_limit;
        bool share=p->config.bytes>resident_device_limit/gpu_context_limit||p->key_bytes>resident_key_limit/gpu_context_limit;
        if(slots>1&&(exceeds||share)){slots=std::max(1u,slots/2);continue;}
        if(exceeds)return capacity_failure("Resident aggregate device budget cannot hold query");
        p->pinned_bytes=resident_memory=="arena"?resident::allocation_bytes(resident::pinned_allocations(p->config)):((uint64_t(slots)*sizeof(resident::Query)+65535)/65536+((uint64_t(p->config.kw)*4+65535)/65536))*65536;
        p->parked.resize(p->config.n);return p;
    }
}
void resident_publish_pools(const std::vector<std::unique_ptr<ResidentPool>>& pools){
    uint64_t device=0,keys=0,nodes=0,pinned=0,lanes=0;u32 live=0;
    for(const auto& p:pools){device+=p->config.bytes;keys+=p->key_bytes;nodes+=p->node_slots;pinned+=p->pinned_bytes;lanes+=p->config.n*gpu_parents*5;live+=resident_live(*p);}
    require(device<=resident_device_limit&&keys<=resident_key_limit&&nodes<=pool_capacity&&pinned<=512ull*1024*1024,"Resident aggregate storage exceeded");
    gpu_resident_contexts=u32(pools.size());gpu_contexts_peak.store(std::max(gpu_contexts_peak.load(),u32(pools.size())));
    resident_active_contexts_peak.store(std::max(resident_active_contexts_peak.load(),uint64_t(live)));
    effective_pool=u32(nodes);effective_lanes=u32(lanes);
    std::lock_guard<std::mutex> lock(stats_mutex);
    if(resident_arena){require(resident_arena->used==device&&resident_pinned_arena->used==pinned,"Resident arena accounting mismatch");gpu_reserved_device=resident_arena->capacity;gpu_reserved_pinned=resident_pinned_arena->capacity;resident_arena_used=resident_arena->used;resident_arena_largest_free=resident_arena->largest_free();resident_arena_peak=std::max(resident_arena_peak,uint64_t(resident_arena->peak));}
    else{gpu_reserved_device=device;gpu_reserved_pinned=pinned;resident_arena_used=resident_arena_largest_free=0;}
    gpu_reserved_frontier=keys;
    resident_peak_device_bytes=std::max(resident_peak_device_bytes,device);resident_peak_key_bytes=std::max(resident_peak_key_bytes,keys);resident_peak_nodes=std::max(resident_peak_nodes,nodes);
}
void resident_begin_pool(ResidentPool& p){
    gpu_context=p.context->handle;
    p.stopped.assign(p.leases.size(),{});
    for(u32 slot=0;slot<p.leases.size();slot++)if(auto q=p.leases[slot]){
        q->begin();if(q->stop_requested()||!memory_ok(*q)){p.stopped[slot]={q->status,q->detail};p.search->cancel_slot(slot,p.search->view(slot).slot_generation);}
    }
    p.unit_started=Clock::now();p.search->begin_advance(resident_waves,resident_submission=="pipelined"?resident_notify_completion:nullptr,this);
    const auto pending=resident_pending_units.fetch_add(1)+1;require(pending<=gpu_context_limit,"Pending resident unit capacity");
    resident_pending_units_peak.store(std::max(resident_pending_units_peak.load(),pending));
}
void resident_finish_pool(ResidentPool& p){
    p.search->retire_advance();require(resident_pending_units.fetch_sub(1)>0,"Pending resident unit underflow");double ms=resident_submission=="legacy"?elapsed(p.unit_started):p.search->unit_credit_ms();gpu_batches++;
    // Completion publication must include the unit's receipts and metadata.
    // A client may request statistics as soon as it receives that event.
    resident_collect(p);
    p.touched=Clock::now();
    for(u32 slot=0;slot<p.leases.size();slot++)if(auto q=p.leases[slot]){
        auto r=p.search->view(slot);q->gpu_active_ms+=ms;q->gpu_ms+=ms;q->sync_resident(r);q->resident_sample_ms+=ms;
        if(q->gpu_root_ready_ms<0&&r.count)q->gpu_root_ready_ms=elapsed(q->submitted);
        if(q->gpu_first_expand_ms<0&&r.expanded)q->gpu_first_expand_ms=elapsed(q->submitted);
        if(!p.stopped[slot].first.empty()){q->status=p.stopped[slot].first;q->detail=p.stopped[slot].second;}
        else if(q->cancelled)q->status="cancelled";else if(q->expired())q->status="timeout";
        bool boundary=r.stage==resident::Ready||r.status==resident::Unfinished||r.status==resident::WorkLimit||r.status==resident::Solved||r.status==resident::Exhausted;
        if(boundary&&(q->status=="running"||q->status=="unfinished"||q->status=="work_limit"||q->status=="candidate_solution"||q->status=="exhausted")){
            auto& c=*q->context;auto n=q->gpu_expanded-q->resident_sample_expanded;
            if(n){double sample=q->resident_sample_ms/n,old=c.gpu_parent_latency_ms.load();c.gpu_parent_latency_ms.store(c.gpu_latency_samples.load()?old*.9+sample*.1:sample);c.gpu_latency_samples++;}
            else if(r.count&&!q->resident_root_sampled){double old=c.gpu_root_latency_ms.load();c.gpu_root_latency_ms.store(c.gpu_root_samples.load()?old*.9+q->resident_sample_ms*.1:q->resident_sample_ms);c.gpu_root_samples++;q->resident_root_sampled=true;}
            q->resident_sample_ms=0;q->resident_sample_expanded=q->gpu_expanded;
        }
        bool soft=r.status==resident::Memory&&(r.detail==resident::DeviceCapacity||r.detail==resident::HashCapacity);
        if(soft&&q->status=="memory_limit"){
            // Resolve after all completions are retired: adding/retiring a
            // destination must not invalidate the pool iteration in progress.
            if(resident_device_growth){q->status="running";continue;}
            bool detached=resident_detach(p,slot);p.leases[slot].reset();
            resident_collect(p);if(detached){resident_physical_recoveries++;q->sync_resident(q->owned_search->q);if(mode=="hybrid"&&!q->pinned_executor)resident_set_cpu(*q);return_query(q);}else complete_query(q);continue;
        }
        if(q->status=="running"&&q->yield_gpu(0,std::min(q->open,gpu_parents))){
            bool detached=resident_detach(p,slot,false,13);p.leases[slot].reset();resident_collect(p);if(detached){resident_set_cpu(*q);return_query(q);}else complete_query(q);continue;
        }
        if(q->status=="running")continue;
        // A deadline/cancellation can replace an Unfinished grant at retirement.
        // Releasing its scheduler lease must also release device ownership;
        // otherwise the next assignment finds a live slot. Keep valid grants.
        if(r.status==resident::Running||(r.status==resident::Unfinished&&q->status!="unfinished"))p.search->cancel_slot(slot,r.slot_generation);
        q->resident_result["solution"]=p.search->solution(slot);
        if(q->trace_enabled){q->trace=p.search->startup_trace(slot).asArray();q->trace_bytes=uint64_t(1+r.generated)*p.config.kw*4;}
        if(!resident_park(p,slot,q)&&(q->status=="unfinished"||q->digest_enabled))resident_detach(p,slot,true,q->status=="unfinished"?12:11);
        resident_record(2,p,slot);
        p.leases[slot].reset();resident_collect(p);complete_query(q);
    }
    resident_collect(p);
}
#include "service-resident-growth.inc"
void gpu_loop_resident(){
    std::vector<std::unique_ptr<ResidentPool>> pools;std::shared_ptr<Query> admitting;u32 last_context=0;
    auto retire=[&](size_t i,u32 reason=10,const Query* peer=nullptr){resident_record(reason,*pools[i],resident::nil,peer);resident_rotate(*pools[i]);auto start=Clock::now();pools.erase(pools.begin()+i);std::lock_guard<std::mutex> lock(stats_mutex);gpu_retire_ms+=elapsed(start);};
    auto victim=[&](const Query* requested)->size_t{
        size_t chosen=pools.size();
        for(size_t i=0;i<pools.size();i++)if(resident_evictable(*pools[i])){
            if(chosen==pools.size()){chosen=i;continue;}
            bool idle=!resident_live(*pools[i]),prior_idle=!resident_live(*pools[chosen]);
            bool same=requested&&pools[i]->context==requested->context&&pools[i]->bits==requested->visited.hash_function().bits;
            bool prior_same=requested&&pools[chosen]->context==requested->context&&pools[chosen]->bits==requested->visited.hash_function().bits;
            if((idle&&!prior_idle)||(idle==prior_idle&&((same&&!prior_same)||(same==prior_same&&pools[i]->touched<pools[chosen]->touched))))chosen=i;
        }return chosen;
    };
    try{ck(cudaSetDevice(adapter));
#ifdef PS_SHARED_LIBRARY
        ps_shared::bind_owner();
#endif
        for(;;){
        const auto completion_epoch=resident_completion_signals.load(std::memory_order_acquire);uint64_t admission_epoch=0;
        expire_ready(nullptr);for(auto& p:pools)resident_clean_parked(*p);{std::lock_guard<std::mutex> lock(mutex);if(stopping)break;admission_epoch=serial;}
        bool completed=false;
        if(resident_submission=="pipelined")for(auto& p:pools)if(p->search->in_flight()&&p->search->advance_ready()){resident_finish_pool(*p);completed=true;}
        if(resident_device_growth)resident_recover_device(pools);
        // Unload may remove an idle context while its CUDA buffers are cached.
        for(size_t i=pools.size();i-->0;){bool exists;{std::lock_guard<std::mutex> lock(mutex);exists=contexts.contains(pools[i]->context->handle);}if(!exists&&!resident_live(*pools[i]))retire(i);}
        auto feasible=[&](const Query& q){
            if(q.parked_search&&q.parked_search->device_owned){
                for(const auto& p:pools)if(p->trace_id==q.parked_search->pool)return !p->search->in_flight();
                require(false,"Ready query lost its parked source pool");
            }
            bool fits=false;for(const auto& p:pools)if(resident_fits(*p,q)){fits=true;if(resident_free_slot(*p)!=resident::nil||resident_paused_slot(*p)!=resident::nil||resident_old_slot(*p)!=resident::nil)return true;}
            if(fits)return false;return pools.size()<gpu_context_limit||victim(&q)<pools.size();
        };
        admitting=resident_take_ready(nullptr,feasible);
        if(admitting&&resident_resume_parked(pools,admitting))admitting.reset();
        if(admitting){
            ResidentPool* target=nullptr;u32 slot=resident::nil;
            for(auto& p:pools)if(resident_fits(*p,*admitting)&&(slot=resident_free_slot(*p))!=resident::nil){target=p.get();break;}
            if(!target)for(auto& p:pools)if(resident_fits(*p,*admitting)&&(slot=resident_paused_slot(*p))!=resident::nil){resident_evict_parked(*p,slot);target=p.get();break;}
            if(!target)for(auto& p:pools)if(resident_fits(*p,*admitting)&&(slot=resident_old_slot(*p))!=resident::nil){
                auto old=p->leases[slot];old->sync_resident(p->search->view(slot));bool detached=resident_detach(*p,slot,false,4,admitting.get());p->leases[slot].reset();resident_slot_preemptions++;
                resident_collect(*p);if(detached)return_query(old);else complete_query(old);target=p.get();break;
            }
            if(!target){
                auto plan=resident_plan_pool(admitting);
                if(plan){
                    auto fits_budget=[&]{uint64_t bytes=plan->config.bytes,keys=plan->key_bytes,nodes=plan->node_slots;for(const auto& p:pools){bytes+=p->config.bytes;keys+=p->key_bytes;nodes+=p->node_slots;}return pools.size()<gpu_context_limit&&bytes<=resident_device_limit&&keys<=resident_key_limit&&nodes<=pool_capacity;};
                    while(!fits_budget()){auto i=victim(admitting.get());if(i==pools.size())break;retire(i,8,admitting.get());}
                    if(fits_budget()){
                        if(resident_memory=="arena"&&!resident_arena){
                            size_t free=0,total=0;ck(cudaMemGetInfo(&free,&total));require(resident_device_limit+64ull*1024*1024<=free,"Insufficient free hardware GPU memory for resident arena reservation");
                            auto start=Clock::now();resident_arena=std::make_unique<ByteArena>(resident_device_limit,ByteArena::Device);resident_pinned_arena=std::make_unique<ByteArena>(512ull*1024*1024,ByteArena::Pinned);
                            std::lock_guard<std::mutex> lock(stats_mutex);resident_arena_setup_ms+=elapsed(start);resident_arena_reservations++;
                        }
                        size_t free=0,total=0;ck(cudaMemGetInfo(&free,&total));
                        auto storage_fits=[&]{return resident_arena?resident_arena->fits(resident::device_allocations(*plan->game,plan->config))&&resident_pinned_arena->fits(resident::pinned_allocations(plan->config)):plan->config.bytes+64ull*1024*1024<=free;};
                        while(!storage_fits()){auto i=victim(admitting.get());if(i==pools.size())break;if(resident_arena)resident_arena_fragmentation_evictions++;retire(i,9,admitting.get());if(!resident_arena)ck(cudaMemGetInfo(&free,&total));}
                        if(storage_fits()){
                            auto start=Clock::now();plan->search=std::make_unique<resident::Search>(*plan->game,1,plan->config,resident_arena.get(),resident_pinned_arena.get());resident_pool_slot_counts[plan->config.n]++;plan->trace_id=++resident_pool_serial;require(resident_pool_serial!=0,"Resident pool generation overflow");plan->leases.resize(plan->config.n);plan->parked.resize(plan->config.n);plan->lease_since.resize(plan->config.n);plan->admitted=Clock::now();
                            {std::lock_guard<std::mutex> lock(stats_mutex);gpu_setup_ms+=elapsed(start);}target=plan.get();slot=0;pools.push_back(std::move(plan));
                        }else if(resident_arena){return_query(admitting);admitting.reset();}
                        else{resident_gpu_resource(admitting,"Insufficient free hardware GPU memory for resident query");admitting.reset();}
                    }else{return_query(admitting);admitting.reset();}
                }else admitting.reset();
            }
            if(target&&admitting){resident_admit(*target,slot,admitting);admitting.reset();}
        }
        // Fill compatible slots without rebuilding a pool or reading peers.
        for(auto& p:pools)if(!p->search->in_flight())for(u32 pass=0;pass<p->leases.size();pass++){
            u32 slot=resident_free_slot(*p);if(slot==resident::nil)slot=resident_paused_slot(*p);
            admitting=resident_take_ready(p.get(),[&](const Query& q){return slot!=resident::nil||(q.parked_search&&q.parked_search->device_owned&&q.parked_search->pool==p->trace_id);});
            if(!admitting)break;
            if(!resident_resume_parked(pools,admitting)){if(p->parked[slot].generation)resident_evict_parked(*p,slot);resident_admit(*p,slot,admitting);}
            admitting.reset();
        }
        resident_publish_pools(pools);bool progress=completed;
        u32 in_flight=0;
        for(auto& p:pools)if(resident_live(*p)&&!p->search->in_flight()){
            if(last_context&&last_context!=p->context->handle)resident_context_switches++;last_context=p->context->handle;
            resident_begin_pool(*p);progress=true;in_flight++;
            // Submit every independent stream before waiting on any stream.
            if(resident_submission!="concurrent"&&resident_submission!="pipelined"){resident_finish_pool(*p);in_flight--;}
        }
        // Pending is an ownership fact, not evidence of simultaneous execution.
        // Nsight timelines separately verify whether kernels actually overlap.
        gpu_parallel_contexts_peak.store(std::max(gpu_parallel_contexts_peak.load(),progress?1u:0u));
        if(resident_pending_units>1)resident_concurrent_batches++;
        if(resident_submission=="concurrent")for(auto& p:pools)if(p->search->in_flight())resident_finish_pool(*p);
        if(resident_device_growth)resident_recover_device(pools);
        resident_publish_pools(pools);
        if(!progress){gpu_context=0;std::unique_lock<std::mutex> lock(mutex);
            if(resident_submission=="pipelined"&&resident_pending_units)gpu_cv.wait_for(lock,std::chrono::milliseconds(10),[&]{return stopping||serial!=admission_epoch||resident_completion_signals.load(std::memory_order_acquire)!=completion_epoch;});
            else gpu_cv.wait_for(lock,std::chrono::milliseconds(10),[&]{return stopping||!resident_parking_drained_locked()||std::any_of(ready.begin(),ready.end(),[&](const auto& q){return q->resident_eligible&&(q->owner==2||promotable(*q));});});
        }
    }}catch(const std::exception& e){
        resident_pending_units=0;
        std::vector<std::shared_ptr<Query>> failed;if(admitting)failed.push_back(admitting);for(auto& p:pools)for(auto& q:p->leases)if(q)failed.push_back(q);
        {std::lock_guard<std::mutex> lock(mutex);gpu_error=e.what();if(resident_park_continuations){continuations.clear();continuation_bytes=0;}for(auto i=ready.begin();i!=ready.end();)if((*i)->owner==2){failed.push_back(*i);i=ready.erase(i);}else ++i;}
        std::unordered_set<Query*> seen;for(auto& q:failed)if(seen.insert(q.get()).second){q->status="runtime_error";q->detail=e.what();complete_query(q);}cv.notify_all();
    }
    for(auto& p:pools)resident_collect(*p);pools.clear();resident_parked_slots=0;resident_parked_reserved_bytes=0;cv.notify_all();gpu_context=0;resident_publish_pools(pools);
    if(resident_arena){require(!resident_arena->used&&!resident_pinned_arena->used,"Resident arena still has live leases at shutdown");auto start=Clock::now();resident_pinned_arena.reset();resident_arena.reset();{std::lock_guard<std::mutex> lock(stats_mutex);resident_arena_teardown_ms+=elapsed(start);}resident_publish_pools(pools);}
}
