// Service members for the private device-owned BFS backend. GPU leases never
// enter ready. Only a complete CPU-owned packet may be published or stolen.
std::string gpu_engine="resident";
// Legacy keeps the prior wall-credit boundary. Serial/concurrent use identical
// measured unit credits, isolating stream scheduling in matched experiments.
std::string resident_submission="legacy";
std::string resident_memory="legacy";
bool resident_word_specialization=false;
bool resident_line_compaction=false;
bool resident_parallel_ellipses=false;
bool resident_device_growth=false;
bool resident_park_continuations=false;
bool resident_park_physical_index=false;
std::atomic<uint64_t> resident_parks{0},resident_park_hits{0},resident_park_host_resumes{0},resident_park_evictions{0},resident_park_releases{0},resident_park_reservation_fallbacks{0},resident_park_diagnostic_reads{0};
std::atomic<uint64_t> resident_parked_slots{0},resident_parked_slots_peak{0},resident_parked_reserved_bytes{0},resident_parked_reserved_peak{0};
double resident_park_reserve_ms=0,resident_park_diagnostic_ms=0;
 bool resident_compact_checkpoints=false;
 std::atomic<uint64_t> resident_compact_takes{0},resident_compact_scratch_bytes{0};
std::string resident_slot_policy="fixed";
u32 resident_trace_capacity=0;
uint64_t resident_pool_serial=0,resident_trace_dropped=0;
Clock::time_point resident_trace_started=Clock::now();
struct ResidentScheduleEvent {
    double at_ms,age_ms;uint64_t ticket,peer,pool;
    u32 context,peer_context,reason,slot,slots,nodes,count,expanded,status,stage,ready,ready_same,ready_fit;
};
std::vector<ResidentScheduleEvent> resident_trace;
std::atomic<uint64_t> resident_root_sizing_fallbacks{0},resident_pool_slot_counts[257]{};
std::atomic<uint64_t> resident_device_moves{0},resident_device_move_bytes{0},resident_device_rehash_probes{0},resident_device_rehash_launches{0},resident_device_move_metadata_bytes{0},resident_device_growth_fallbacks{0};
double resident_device_move_ms=0;
std::unique_ptr<ByteArena> resident_arena,resident_pinned_arena;
uint64_t resident_arena_used=0,resident_arena_largest_free=0,resident_arena_peak=0,resident_arena_reservations=0;
std::atomic<uint64_t> resident_arena_fragmentation_evictions{0};
double resident_arena_setup_ms=0,resident_arena_teardown_ms=0;
u32 resident_waves=4,resident_rotation_ms=20,resident_cpu_workers=0;
u32 resident_slot_rotation_ms=20;
std::atomic<uint64_t> resident_cpu_quanta{0},resident_promotions{0},resident_takes{0},resident_returns{0},resident_physical_recoveries{0};
std::atomic<uint64_t> resident_live_cursor_takes{0},resident_pool_rotations{0};
std::atomic<uint64_t> resident_slot_preemptions{0},resident_context_switches{0},resident_active_contexts_peak{0};
std::atomic<uint64_t> resident_pending_units{0},resident_pending_units_peak{0},resident_concurrent_batches{0};
std::atomic<uint64_t> resident_completion_signals{0};
static void CUDART_CB resident_notify_completion(void* context){
    auto* service=static_cast<Service*>(context);
    // CUDA host functions may not call CUDA APIs. This callback only wakes the
    // single GPU owner; pool mutation and receipt checks remain on that owner.
    service->resident_completion_signals.fetch_add(1,std::memory_order_release);service->gpu_cv.notify_one();
}
uint64_t resident_device_limit=6ull*1024*1024*1024,resident_key_limit=2ull*1024*1024*1024;
uint64_t resident_peak_device_bytes=0,resident_peak_key_bytes=0,resident_peak_nodes=0;
uint64_t resident_root_upload_bytes=0,resident_explicit_export_bytes=0;
double resident_root_upload_host_ms=0,resident_readback_host_ms=0;
uint64_t resident_read_bytes=0,resident_write_bytes=0,resident_metadata_bytes=0,resident_cycle_bytes=0;
double resident_take_ms=0,resident_put_ms=0;
void resident_configure(const J& req){
    gpu_engine=str(req,"gpu_engine","resident");require(gpu_engine=="resident"||gpu_engine=="host","GPU engine resident/host required");
    resident_park_continuations=flag(req,"resident_park_continuations",false);
    resident_park_physical_index=flag(req,"resident_park_physical_index",false);
    require(!resident_park_physical_index||resident_park_continuations,"Physical parked index requires parked continuations");
    require(!resident_park_continuations||gpu_engine=="resident","Parking requires the resident GPU engine");
    if(gpu_engine!="resident")return;
    resident_submission=str(req,"resident_submission","legacy");require(resident_submission=="legacy"||resident_submission=="serial"||resident_submission=="concurrent"||resident_submission=="pipelined","Resident submission legacy/serial/concurrent/pipelined required");
    resident_memory=str(req,"resident_memory","legacy");require(resident_memory=="legacy"||resident_memory=="arena","Resident memory legacy/arena required");
    resident_word_specialization=flag(req,"resident_word_specialization",false);
    resident_line_compaction=flag(req,"resident_line_compaction",false);
    resident_parallel_ellipses=flag(req,"resident_parallel_ellipses",false);
    resident_device_growth=flag(req,"resident_device_growth",false);
    resident_compact_checkpoints=flag(req,"resident_compact_checkpoints",false);
    require(!resident_park_continuations||(mode=="cuda"&&resident_submission=="legacy"&&gpu_context_limit==1&&!resident_device_growth&&resident_compact_checkpoints),"Parking requires CUDA-only exact search, legacy submissions, one pool, compact checkpoints, and host-based capacity recovery");
    resident_slot_policy=str(req,"resident_slot_policy","fixed");require(resident_slot_policy=="fixed"||resident_slot_policy=="roots","Resident slot policy fixed/roots required");
    resident_trace_capacity=num(req,"resident_trace_capacity",0);require(resident_trace_capacity<=16384,"Resident schedule trace capacity0..16384");resident_trace.reserve(resident_trace_capacity);
    resident_cpu_workers=mode=="hybrid"?num(req,"resident_cpu_workers",threads-1):0;
    require((mode=="hybrid"&&resident_cpu_workers&&resident_cpu_workers<=threads)||(mode!="hybrid"&&!req.find("resident_cpu_workers")),"Resident CPU workers1..threads require hybrid mode");
    require(gpu_context_limit>=1&&gpu_context_limit<=8,"Resident GPU pools1..8");
    u32 device_mb=num(req,"resident_device_mb",6144),key_mb=num(req,"resident_key_mb",2048);
    require(device_mb>=64&&device_mb<=12288&&key_mb>=1&&key_mb<=2048,"Resident aggregate storage device64..12288MiB,keys1..2048MiB");
    resident_device_limit=uint64_t(device_mb)*1024*1024;resident_key_limit=uint64_t(key_mb)*1024*1024;
    if(!req.find("streams"))streams=1;
    require(streams==1&&gpu_parents<=16&&gpu_lanes>=gpu_parents*5,"Resident service requires streams1,parents1..16,and enough interpreter lanes");
    require(num(req,"fuel",2048)>0&&num(req,"fuel",2048)<=2048&&num(req,"max_dispatches",100000)==100000,"Resident fuel1..2048;operation continuation bound100000");
    resident_waves=num(req,"resident_waves",4);resident_rotation_ms=num(req,"resident_rotation_ms",20);
    resident_slot_rotation_ms=num(req,"resident_slot_rotation_ms",resident_rotation_ms);require(resident_slot_rotation_ms&&resident_slot_rotation_ms<=1000,"Resident slot quantum1..1000ms required");
    require(resident_waves&&resident_waves<=8&&resident_rotation_ms&&resident_rotation_ms<=1000,"Resident waves1..8,rotation1..1000ms");
    gpu_event_wait=flag(req,"gpu_event_wait",true);
}
void resident_prepare(Query& q){
    if(gpu_engine!="resident")return;
    bool startup_trace=q.trace_enabled&&q.cap==1&&q.max_states>=6;
    q.resident_eligible=q.strategy=="bfs"&&(!q.trace_enabled||startup_trace);
    // Reject a query before the GPU owner sees it. A declared input capacity
    // must not poison unrelated active shapes or the retained service process.
    if(mode!="cpu"&&q.resident_eligible)require(q.pristine.size()<=resident::max_key_words,"Unsupported resident key capacity: exceeds65536 words");
    if(!q.resident_eligible)require(mode!="cuda"&&q.pinned_executor!=2&&q.initial_executor!=2,"Resident GPU supports untraced BFS or a one-parent startup trace;use CPU for Auto/other trace queries");
}
void resident_set_cpu(Query& q){
    std::lock_guard<std::mutex> lock(mutex);q.owner=1;q.migrations++;q.gpu_fallbacks++;q.last_migration=Clock::now();routing_fallbacks++;
}
static u32 resident_accepted_count(const Query& q){return q.parked_search?q.parked_search->count:q.owned_search?q.owned_search->q.count:u32(q.nodes.size());}
static u32 resident_logical_limit(const Query& q){
    // Exactly the legacy BFS Query::child estimate, before inserting a unique
    // child. Root admission and winning-before-limit ordering are unchanged.
    uint64_t per_state=q.pristine.size()*4+128+sizeof(SearchNode)+48;
    return u32(std::min(uint64_t(q.max_states),q.memory_limit/per_state));
}
uint64_t resident_available(uint64_t already=0)const{
    auto rss=current_rss();return std::min(512ull*1024*1024,(rss<rss_limit?rss_limit-rss:0)+already);
}
void resident_import(Query& q){
    if(q.owned_search)return;
    require(q.strategy=="bfs"&&q.resident_eligible,"Only exact BFS can enter device ownership");
    resident::Config config{};config.n=1;config.kw=u32(q.pristine.size());config.capacity=resident_logical_limit(q);
    require(config.capacity,"Logical query memory cannot hold a search key");
    config.table_size=std::bit_ceil(config.capacity*2);config.fuel=fuel;config.probe_budget=256;
    config.hash_bits=q.visited.hash_function().bits;config.cap=q.cap;config.grant=q.grant_end;config.maximum=config.capacity;config.parents=gpu_parents;
    resident::Query r;r.cap=q.cap;r.grant_end=q.grant_end;r.max_states=config.capacity;
    r.count=u32(q.nodes.size());r.head=u32(q.expanded);r.stage=q.initialized?resident::Ready:resident::NeedRoot;
    require(r.count==q.visited.size()&&r.head<=r.count,"CPU BFS prefix is not a settled exact graph");
    require(q.fifo.size()==r.count-r.head,"CPU BFS frontier is not a contiguous prefix");
    for(u32 i=0;i<q.fifo.size();i++)require(q.fifo[i]==r.head+i,"CPU BFS frontier order mismatch");
    r.expanded=q.expanded;r.generated=q.generated;r.duplicates=q.duplicates;r.cycles=q.cycles;r.max_frontier=q.max_frontier;
    r.cpu_expanded=q.cpu_expanded;r.gpu_expanded=q.gpu_expanded;
    auto cp=std::make_unique<resident::Checkpoint>(q.context->resident_rules,config,r,resident_available());cp->pristine=q.pristine;
    require(cp->bytes()<=cp->limit_bytes,"CPU checkpoint storage limit before import");
    const uint64_t mask=config.hash_bits==64?~uint64_t(0):(uint64_t(1)<<config.hash_bits)-1;
    for(u32 i=0;i<r.count;i++){
        const auto& node=q.nodes[i];require(node.key&&node.slot==resident::nil&&node.key->size()==config.kw*4,"CPU BFS node cannot transfer");
        require(node.open==(i>=r.head),"CPU BFS open-state prefix mismatch");
        std::memcpy(cp->keys.data()+size_t(i)*config.kw,node.key->data(),config.kw*4);
        cp->nodes[i]={node.parent,node.action,node.depth};cp->hashes[i]=resident::hash_key(cp->keys.data()+size_t(i)*config.kw,config.kw,mask);
    }
    auto index=resident::checkpoint_table(cp->hashes,r.count,config.table_size);cp->table=std::move(index.entries);cp->rehash_probes=index.probes;
    require(cp->bytes()<=cp->limit_bytes,"CPU checkpoint storage limit after import");
    q.owned_search=std::move(cp);q.resident_query=true;
    // The packet is complete before releasing the former owner containers.
    std::vector<SearchNode>().swap(q.nodes);q.visited.clear();q.visited.rehash(0);std::deque<u32>().swap(q.fifo);
    std::vector<u32>().swap(q.released);resident_promotions++;
}
void resident_cpu_work(const std::shared_ptr<Query>& q){
    auto started=Clock::now();auto prior=q->expanded;q->begin();
    try{
        auto& cp=*q->owned_search;cp.config.fuel=std::min(fuel,64u);
        while(!q->stop_requested()&&memory_ok(*q)&&cp.q.status==resident::Running){
            cp.advance(1,resident_available(cp.bytes()));resident_cpu_quanta++;
            q->sync_resident(cp.q);
            if(q->expanded-prior>=cpu_quantum||elapsed(started)>=2.0)break;
        }
        if(q->status=="cancelled")cp.q.status=resident::Cancelled;
        else if(q->status=="timeout")cp.q.status=resident::Timeout;
    }catch(const std::exception& e){auto message=std::string(e.what());q->status=message.find("storage limit")!=std::string::npos?"resource_limit":"runtime_error";q->detail=message;}
    double ms=elapsed(started);q->cpu_ms+=ms;
    if(q->expanded>prior){double sample=ms/(q->expanded-prior);q->cpu_parent_latency_ms=q->cpu_latency_samples?q->cpu_parent_latency_ms*.8+sample*.2:sample;q->cpu_latency_samples++;auto old=q->context->cpu_parent_ms.load();q->context->cpu_parent_ms.store(old*.95+sample*.05);}
    return_query(q);
}
struct ParkedSlot {
    std::weak_ptr<Query::ParkedCheckpoint> lease;u32 generation=0;uint64_t reserved_bytes=0;Clock::time_point since{};
};
struct ResidentPool {
    std::shared_ptr<Context> context;std::unique_ptr<Game> game;std::unique_ptr<resident::Search> search;
    std::vector<std::shared_ptr<Query>> leases;u32 nodes=0,bits=64;Clock::time_point admitted=Clock::now();
    resident::Search::Metrics reported{};std::vector<ParkedSlot> parked;
    resident::Config config{};std::vector<Clock::time_point> lease_since;
    uint64_t key_bytes=0,node_slots=0,pinned_bytes=0;Clock::time_point touched=Clock::now();
    std::vector<std::pair<std::string,std::string>> stopped;Clock::time_point unit_started{};
    uint64_t trace_id=0;
};
#include "service-resident-trace.inc"
#include "device-parking/service-parking.inc"
void resident_collect(ResidentPool& pool){
    auto m=pool.search->metrics(),p=pool.reported;std::lock_guard<std::mutex> lock(stats_mutex);
    gpu_compute+=m.compute_ms-p.compute_ms;gpu_readback+=m.metadata_device_ms-p.metadata_device_ms;
    gpu_dispatches+=m.waves-p.waves;gpu_receipts+=m.receipts-p.receipts;
    resident_read_bytes+=m.read_bytes-p.read_bytes;resident_write_bytes+=m.write_bytes-p.write_bytes;
    resident_metadata_bytes+=m.metadata_bytes-p.metadata_bytes;resident_cycle_bytes+=m.cycle_bytes-p.cycle_bytes;
    resident_take_ms+=m.take_ms-p.take_ms;resident_put_ms+=m.put_ms-p.put_ms;
    resident_takes+=m.takes-p.takes;resident_returns+=m.returns-p.returns;
    resident_root_upload_bytes+=m.assignment_bytes-p.assignment_bytes;resident_root_upload_host_ms+=m.assignment_ms-p.assignment_ms;
    resident_explicit_export_bytes+=m.export_bytes-p.export_bytes;resident_readback_host_ms+=m.readback_ms-p.readback_ms;
    resident_device_moves+=m.device_moves-p.device_moves;resident_device_move_bytes+=m.device_move_bytes-p.device_move_bytes;
    resident_device_rehash_probes+=m.device_rehash_probes-p.device_rehash_probes;resident_device_rehash_launches+=m.device_rehash_launches-p.device_rehash_launches;
    resident_device_move_metadata_bytes+=m.device_move_metadata_bytes-p.device_move_metadata_bytes;resident_device_move_ms+=m.device_move_ms-p.device_move_ms;
    pool.reported=m;
}
std::shared_ptr<Query> resident_take_ready(const ResidentPool* compatible=nullptr,const std::function<bool(const Query&)>& feasible={}){
    std::lock_guard<std::mutex> lock(mutex);
    for(auto i=ready.begin();i!=ready.end();++i){const auto& q=*i;
        if(!q->resident_eligible||(q->owner!=2&&!promotable(*q)))continue;
        const bool same_park=compatible&&q->parked_search&&q->parked_search->device_owned&&q->parked_search->pool==compatible->trace_id;
        if(compatible&&q->parked_search&&q->parked_search->device_owned&&!same_park)continue;
        if(compatible&&!same_park&&(q->context!=compatible->context||q->visited.hash_function().bits!=compatible->bits||resident_accepted_count(*q)>=compatible->nodes))continue;
        if(compatible&&q->trace_enabled&&compatible->nodes<6)continue;
        if(feasible&&!feasible(*q))continue;
        if(q->owner!=2){q->owner=2;q->migrations++;q->last_migration=Clock::now();routing_promotions++;}
        auto result=q;ready.erase(i);return result;
    }
    return {};
}
bool resident_admit(ResidentPool& pool,u32 slot,const std::shared_ptr<Query>& q){
    auto control_started=Clock::now();const bool parked_import=bool(q->parked_search);
    if(q->parked_search&&!q->parked_search->device_owned){const double deferred=q->parked_search->materialize_ms.exchange(0);q->gpu_ms+=deferred;q->gpu_active_ms+=deferred;}
    q->begin();if(q->stop_requested()||!memory_ok(*q)){complete_query(q);return false;}
    try{
        if(q->parked_search){
            require(!q->parked_search->device_owned&&q->parked_search->reservation->owned&&!q->owned_search,"Device lease must resume in its own slot");
            q->owned_search=std::move(q->parked_search->reservation);q->parked_search.reset();
            require(q->grant_end>q->expanded,"Evicted resume grant did not advance");q->owned_search->extend(u32(q->grant_end-q->expanded));
        }
        if(q->initialized&&!q->owned_search)resident_import(*q);
        u32 token=pool.search->view(slot).slot_generation;
        if(q->owned_search){pool.search->put(slot,token,*q->owned_search,resident_available(q->owned_search->bytes()));q->owned_search.reset();if(parked_import)resident_park_host_resumes++;}
        else{
            auto root=pool.game->initial;restore_key(pool.game->l,root.data(),q->pristine.data());
            J limits(J::Object{{"max_expanded",ji(q->cap)},{"grant",ji(q->resumable?q->grant_end:q->cap)},{"max_states",ji(resident_logical_limit(*q))}});
            pool.search->assign(slot,token,root,limits);q->resident_query=true;
        }
    }catch(const std::exception& e){
        auto msg=std::string(e.what());if(msg.find("storage limit")==std::string::npos&&msg.find("rehash work limit")==std::string::npos)throw;
        q->status="resource_limit";q->detail=msg;complete_query(q);return false;
    }
    if(q->gpu_first_submit_ms<0)q->gpu_first_submit_ms=elapsed(q->submitted);
    q->gpu_interpreter_variant=pool.search->interpreter_variant();
    q->resident_sample_expanded=q->gpu_expanded;q->resident_sample_ms=0;
    double control_ms=elapsed(control_started);q->gpu_ms+=control_ms;q->gpu_active_ms+=control_ms;
    pool.leases[slot]=q;if(!pool.lease_since.empty())pool.lease_since[slot]=Clock::now();pool.touched=Clock::now();resident_record(1,pool,slot);return true;
}
bool resident_detach(ResidentPool& pool,u32 slot,bool terminal=false,u32 reason=3,const Query* peer=nullptr){
    auto q=pool.leases[slot];const auto r=pool.search->view(slot);
    resident_record(reason,pool,slot,peer);
    q->begin(); // Rebase execution-only allowance after waiting in another pool.
    auto started=Clock::now();
    try{
        q->owned_search=pool.search->take(slot,r.slot_generation,resident_available(),terminal,resident_compact_checkpoints);
        const auto& cp=*q->owned_search;u32 active=r.stage==resident::Root?1:r.stage==resident::Parent?r.batch_count*5:0;
        if(cp.compact_ready){const auto& l=cp.rules->layout;resident_compact_takes++;resident_compact_scratch_bytes+=uint64_t(cp.config.parents)*5*(uint64_t(l.STATE_WORDS)*4+((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS)*4+cp.config.kw*4+8);}
        bool live=false;for(u32 i=0;i<active;i++)live|=r.lanes[i].phase==resident::Execute&&!r.lanes[i].fresh&&cp.states[size_t(i)*cp.rules->layout.STATE_WORDS+1]==0;
        if(live)resident_live_cursor_takes++;
        double ms=elapsed(started);q->gpu_ms+=ms;q->gpu_active_ms+=ms;return true;
    }
    catch(const std::exception& e){
        auto msg=std::string(e.what());if(msg.find("storage limit")==std::string::npos&&msg.find("rehash work limit")==std::string::npos)throw;
        pool.search->cancel_slot(slot,r.slot_generation);q->status="resource_limit";q->detail=msg;return false;
    }
}
void resident_rotate(ResidentPool& pool){
    resident_pool_rotations++;
    for(u32 slot=0;slot<pool.parked.size();slot++)if(pool.parked[slot].generation)resident_evict_parked(pool,slot);
    for(u32 slot=0;slot<pool.leases.size();slot++)if(auto q=pool.leases[slot]){
        q->sync_resident(pool.search->view(slot));bool detached=resident_detach(pool,slot,false,5);pool.leases[slot].reset();
        resident_collect(pool);if(detached)return_query(q);else complete_query(q);
    }
    resident_collect(pool);
}
#include "service-resident-loop.inc"
void resident_statistics(J::Object& row)const{
    row["gpu_engine"]=J(gpu_engine);if(gpu_engine!="resident")return;
    row["resident_submission"]=J(resident_submission);row["resident_credit_scope"]=J(std::string(resident_submission=="legacy"?"synchronous host unit":"device unit plus own non-wait host work"));
    row["resident_memory"]=J(resident_memory);row["resident_stream_initialization"]=J(resident_memory=="arena");
    row["resident_word_specialization"]=J(resident_word_specialization);
    row["resident_line_compaction"]=J(resident_line_compaction);
    row["resident_parallel_ellipses"]=J(resident_parallel_ellipses);
    row["resident_compact_checkpoints"]=J(resident_compact_checkpoints);row["resident_compact_takes"]=ji(resident_compact_takes);row["resident_compact_scratch_bytes"]=ji(resident_compact_scratch_bytes);
    row["resident_park_continuations"]=J(resident_park_continuations);
    row["resident_park_physical_index"]=J(resident_park_physical_index);
    row["resident_parks"]=ji(resident_parks);row["resident_park_hits"]=ji(resident_park_hits);row["resident_park_host_resumes"]=ji(resident_park_host_resumes);row["resident_park_evictions"]=ji(resident_park_evictions);row["resident_park_releases"]=ji(resident_park_releases);
    row["resident_park_reservation_fallbacks"]=ji(resident_park_reservation_fallbacks);row["resident_park_diagnostic_reads"]=ji(resident_park_diagnostic_reads);
    row["resident_parked_slots"]=ji(resident_parked_slots);row["resident_parked_slots_peak"]=ji(resident_parked_slots_peak);row["resident_parked_reserved_bytes"]=ji(resident_parked_reserved_bytes);row["resident_parked_reserved_peak_bytes"]=ji(resident_parked_reserved_peak);
    row["resident_park_reserve_host_ms"]=J(resident_park_reserve_ms);row["resident_park_diagnostic_host_ms"]=J(resident_park_diagnostic_ms);
    row["resident_device_growth"]=J(resident_device_growth);row["resident_device_moves"]=ji(resident_device_moves);row["resident_device_move_bytes"]=ji(resident_device_move_bytes);
    row["resident_device_rehash_probes"]=ji(resident_device_rehash_probes);row["resident_device_rehash_launches"]=ji(resident_device_rehash_launches);
    row["resident_device_move_metadata_bytes"]=ji(resident_device_move_metadata_bytes);row["resident_device_move_host_ms"]=J(resident_device_move_ms);row["resident_device_growth_fallbacks"]=ji(resident_device_growth_fallbacks);
    row["resident_slot_policy"]=J(resident_slot_policy);row["resident_root_sizing_fallbacks"]=ji(resident_root_sizing_fallbacks);J::Object slot_counts;for(u32 i=1;i<=256;i++)if(resident_pool_slot_counts[i])slot_counts[std::to_string(i)]=ji(resident_pool_slot_counts[i]);row["resident_pool_slot_counts"]=J(std::move(slot_counts));
    row["resident_trace_capacity"]=ji(resident_trace_capacity);row["resident_trace_events"]=ji(resident_trace.size());row["resident_trace_dropped"]=ji(resident_trace_dropped);
    row["resident_slot_rotation_ms"]=ji(resident_slot_rotation_ms);row["resident_rotation_ms"]=ji(resident_rotation_ms);
    row["resident_arena_used_bytes"]=ji(resident_arena_used);row["resident_arena_largest_free_bytes"]=ji(resident_arena_largest_free);row["resident_arena_peak_used_bytes"]=ji(resident_arena_peak);
    row["resident_arena_reservations"]=ji(resident_arena_reservations);row["resident_arena_fragmentation_evictions"]=ji(resident_arena_fragmentation_evictions);row["resident_arena_setup_ms"]=J(resident_arena_setup_ms);row["resident_arena_teardown_ms"]=J(resident_arena_teardown_ms);
    row["resident_pending_units"]=ji(resident_pending_units);row["resident_pending_units_peak"]=ji(resident_pending_units_peak);row["resident_concurrent_batches"]=ji(resident_concurrent_batches);
    row["resident_completion_signals"]=ji(resident_completion_signals);
    row["kernel_overlap_measured"]=J(false); // Nsight timelines establish actual overlap.
    row["gpu_driver_threads"]=ji(mode=="cpu"?0:1);row["worker_threads"]=ji(cpu_worker_count()+(mode=="cpu"?0:1));
    if(mode=="hybrid")row["cpu_budget"]=ji(resident_cpu_workers+1);
    row["device_owned_visited"]=J(true);row["device_owned_fifo"]=J(true);row["ordinary_successor_readback_bytes"]=ji(0);
    row["resident_cpu_quanta"]=ji(resident_cpu_quanta);row["resident_imports"]=ji(resident_promotions);row["resident_takes"]=ji(resident_takes);row["resident_returns"]=ji(resident_returns);
    row["resident_physical_recoveries"]=ji(resident_physical_recoveries);row["ownership_readback_bytes"]=ji(resident_read_bytes);row["ownership_upload_bytes"]=ji(resident_write_bytes);
    row["resident_live_cursor_takes"]=ji(resident_live_cursor_takes);row["resident_pool_rotations"]=ji(resident_pool_rotations);
    row["resident_slot_preemptions"]=ji(resident_slot_preemptions);row["resident_context_switches"]=ji(resident_context_switches);row["resident_active_contexts_peak"]=ji(resident_active_contexts_peak);
    row["resident_device_limit_bytes"]=ji(resident_device_limit);row["resident_key_limit_bytes"]=ji(resident_key_limit);row["resident_node_limit"]=ji(pool_capacity);
    row["resident_peak_device_bytes"]=ji(resident_peak_device_bytes);row["resident_peak_key_bytes"]=ji(resident_peak_key_bytes);row["resident_peak_nodes"]=ji(resident_peak_nodes);
    row["upload_device_ms_supported"]=J(false);row["readback_device_ms_scope"]=J(std::string("query-metadata-only"));row["gpu_submission_mode"]=J(std::string("bounded-round-robin"));
    row["root_clear_upload_host_ms"]=J(resident_root_upload_host_ms);row["root_upload_bytes"]=ji(resident_root_upload_bytes);row["metadata_cycle_readback_host_ms"]=J(resident_readback_host_ms);row["explicit_export_bytes"]=ji(resident_explicit_export_bytes);
    row["ownership_take_host_ms"]=J(resident_take_ms);row["ownership_put_host_ms"]=J(resident_put_ms);row["metadata_readback_bytes"]=ji(resident_metadata_bytes);row["cycle_key_readback_bytes"]=ji(resident_cycle_bytes);
}
