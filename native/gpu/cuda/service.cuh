#pragma once
#include "service-search.hpp"
#include "service-gpu.cuh"

#ifdef PS_SHARED_LIBRARY
#include "shared-context/library-hooks.hpp"
#endif

namespace continuous {
struct Service {
    std::mutex mutex,output_mutex,stats_mutex;
    std::condition_variable cv,gpu_cv;
    std::unordered_map<u32,std::shared_ptr<Context>> contexts;
    uint64_t context_bytes=0;
    std::unordered_map<std::string,std::shared_ptr<Query>> active;
    std::unordered_set<std::string> identifiers;
    std::deque<std::shared_ptr<Query>> ready;
    std::vector<std::thread> workers;
    std::thread gpu_thread;
    std::atomic<unsigned> idle_cpu{0};
    bool configured=false,started=false,stopping=false;
    std::string mode="hybrid",gpu_error;
    std::string routing_policy="latency";
    std::atomic<uint64_t> routing_promotions{0},routing_fallbacks{0},routing_denied{0},routing_gpu_admissions{0};
    u32 handle=0,threads=8,cpu_quantum=32,gpu_parents=16,gpu_queries=64,gpu_lanes=2048,pool_capacity=262144,streams=2,adapter=0,fuel=2048,max_dispatches=100000;
    std::atomic<double> cpu_parent_ms{0.03},gpu_parent_ms{0.01};
    uint64_t serial=0,completed=0,rss_limit=4096ull*1024*1024;
    double gpu_compute=0,gpu_upload=0,gpu_readback=0,gpu_enqueue=0,gpu_ingest=0;
    uint64_t gpu_dispatches=0,gpu_receipts=0;
    std::atomic<uint64_t> gpu_batches{0},overlap_submissions{0};
    std::atomic<u32> effective_lanes{0},effective_pool{0};
    std::atomic<u32> gpu_context{0};
    u32 gpu_context_limit=1;
    bool gpu_prehashed=true,verify_gpu_hash=false,gpu_event_wait=false,gpu_pool_allocator=true,gpu_fused_pack=true;
    std::unique_ptr<ServiceArenas> gpu_arenas;
    std::atomic<u32> gpu_resident_contexts{0},gpu_contexts_peak{0},gpu_parallel_contexts_peak{0};
    double gpu_setup_ms=0,gpu_retire_ms=0,gpu_driver_wait_ms=0;
    uint64_t gpu_partial_retirements=0;
    uint64_t gpu_verified_hashes=0,gpu_ingest_parents=0,gpu_ingest_children=0;
    uint64_t gpu_reserved_device=0,gpu_reserved_pinned=0,gpu_reserved_frontier=0;
    std::unique_ptr<Device> selected;
#ifdef PS_DEVICE_SERVICE
    #include "service-resident.inc"
#endif
    #include "service-continuations.inc"
    #include "service-completion.inc"
    ~Service(){stop();}
    static std::string encode(J::Object row){
#ifdef PS_SHARED_LIBRARY
        ps_shared::decorate(row);
#endif
        std::ostringstream frame;frame<<std::setprecision(12);json(frame,J(std::move(row)));auto text=frame.str();require(text.size()<=16*1024*1024,"Service reply exceeds 16 MiB");
        return text;
    }
    void write_frame(const std::string& text){
        std::lock_guard<std::mutex> lock(output_mutex);
#ifdef PS_SHARED_LIBRARY
        ps_shared::host.emit(ps_shared::host.user,text.data(),text.size());
#else
        std::cout<<text<<'\n'<<std::flush;
#endif
    }
    void write(J::Object row){write_frame(encode(std::move(row)));}
    void reply(const std::string& id,J::Object fields={}){fields["id"]=J(id);fields["ok"]=J(true);write(std::move(fields));}
    void configure(const J& req){
        require(!configured&&!started,"Service configuration is immutable");
        mode=str(req,"mode","hybrid");require(mode=="cpu"||mode=="cuda"||mode=="hybrid","Service mode cpu/cuda/hybrid required");
        routing_policy=str(req,"routing_policy","latency");require(routing_policy=="latency"||routing_policy=="legacy","Routing policy latency/legacy required");
        completion_locking=str(req,"completion_locking","publish");require(completion_locking=="legacy"||completion_locking=="publish","Completion locking legacy/publish required");
        threads=num(req,"threads",8);cpu_quantum=num(req,"cpu_quantum",32);gpu_parents=num(req,"parents_per_job",16);gpu_queries=num(req,"batch",64);gpu_lanes=num(req,"gpu_lanes",2048);pool_capacity=num(req,"pool_capacity",262144);streams=num(req,"streams",2);
        require(threads&&threads<=16&&(mode!="hybrid"||threads>=2)&&cpu_quantum&&cpu_quantum<=4096&&gpu_parents&&gpu_parents<=128&&gpu_queries&&gpu_queries<=256&&gpu_lanes>=5&&gpu_lanes<=65536&&pool_capacity>=5&&pool_capacity<=1048576&&streams&&streams<=3,"Invalid service capacities");
        gpu_context_limit=num(req,"gpu_contexts",1);gpu_prehashed=flag(req,"gpu_prehashed",true);verify_gpu_hash=flag(req,"verify_gpu_hash",false);
        gpu_event_wait=flag(req,"gpu_event_wait",false);
        gpu_fused_pack=flag(req,"gpu_fused_pack",true);
        gpu_pool_allocator=flag(req,"gpu_pool_allocator",true);
#ifdef PS_DEVICE_SERVICE
        resident_configure(req);
#else
        require(str(req,"gpu_engine","host")=="host","Resident GPU engine needs puzzlescript-resident-service");
#endif
        bool multiple_pools=mode=="cuda";
#ifdef PS_DEVICE_SERVICE
        multiple_pools|=gpu_engine=="resident";
#endif
        require(gpu_context_limit>=1&&gpu_context_limit<=8&&(gpu_context_limit==1||multiple_pools),"Multiple GPU pools require CUDA/resident mode and1..8 contexts");
        fuel=num(req,"fuel",2048);max_dispatches=num(req,"max_dispatches",100000);require(fuel&&fuel<=65536&&max_dispatches&&max_dispatches<=100000,"Invalid service continuation bounds");
        int memory=num(req,"memory_mb",4096);require(memory>=64&&memory<=16384,"Service RSS budget 64..16384 MiB");rss_limit=uint64_t(memory)*1024*1024;
        continuation_capacity=num(req,"continuation_capacity",128);u32 retained_mb=num(req,"continuation_memory_mb",512);
        require(continuation_capacity&&continuation_capacity<=2048&&retained_mb&&retained_mb<=4096,"Invalid continuation capacity");continuation_limit=uint64_t(retained_mb)*1024*1024;
        #ifdef PS_SHARED_LIBRARY
        ps_shared::validate_configuration(req);require(gpu_engine=="resident","Shared exact service requires resident engine");
#else
        if(auto p=req.find("affinity_mask")){auto mask=std::stoull(p->asString(),nullptr,16);require(mask&&SetProcessAffinityMask(GetCurrentProcess(),DWORD_PTR(mask)),"Cannot set requested CPU affinity");}
#endif
        bool use_arenas=gpu_pool_allocator&&gpu_context_limit>1;
#ifdef PS_DEVICE_SERVICE
        if(gpu_engine=="resident")use_arenas=false;
#endif
        if(mode!="cpu"){selected=std::make_unique<Device>(num(req,"adapter",-1));adapter=selected->id;if(use_arenas)gpu_arenas=std::make_unique<ServiceArenas>(gpu_context_limit);}
        configured=true;
    }
    u32 cpu_worker_count()const{
#ifdef PS_DEVICE_SERVICE
        if(gpu_engine=="resident"&&mode=="hybrid")return resident_cpu_workers;
#endif
        return mode=="cpu"?threads:mode=="hybrid"?threads-1:0;
    }
    void start(){
        if(started)return;require(configured&&!contexts.empty(),"Configure and load before execution");started=true;
        u32 count=cpu_worker_count();
        for(u32 i=0;i<count;i++)workers.emplace_back([this]{cpu_loop();});
        if(mode!="cpu")gpu_thread=std::thread([this]{
#ifdef PS_DEVICE_SERVICE
            if(gpu_engine=="resident"){gpu_loop_resident();return;}
#endif
            if(gpu_context_limit>1)gpu_loop_multi();else gpu_loop();});
    }
    static uint64_t current_rss(){PROCESS_MEMORY_COUNTERS p{};p.cb=sizeof(p);require(GetProcessMemoryInfo(GetCurrentProcess(),&p,sizeof(p)),"Cannot inspect service RSS");return p.WorkingSetSize;}
    bool memory_ok(Query& q){if(current_rss()<=rss_limit)return true;q.status="memory_limit";q.detail="Service RSS budget";return false;}
    void return_query(const std::shared_ptr<Query>& q){
        if(q->status=="running"&&!q->stop_requested()){std::lock_guard<std::mutex> lock(mutex);ready.push_back(q);cv.notify_all();gpu_cv.notify_one();}
        else complete_query(q);
    }
    std::shared_ptr<Query> take_cpu(){
        auto wait=Clock::now();std::lock_guard<std::mutex> lock(mutex);cpu_take_wait_ns+=nanoseconds(wait);
        auto found=std::find_if(ready.begin(),ready.end(),[&](const auto& q){return q->owner!=2||(mode=="hybrid"&&!q->pinned_executor&&q->context->handle!=gpu_context.load());});
        if(found==ready.end())return {};
        auto q=*found;ready.erase(found);q->owner=1;return q;
    }
    bool promotable(Query& q){
#ifdef PS_DEVICE_SERVICE
        if(gpu_engine=="resident"&&!q.resident_eligible)return false;
#endif
        if(q.owner!=1||q.pinned_executor||q.strategy!="bfs"||!q.initialized||q.open<256||elapsed(q.last_migration)<=50)return false;
        if(routing_policy=="legacy")return true;
        const double n=std::min(q.open,gpu_parents),remaining=std::max(0.0,double(q.timeout_ms)-q.cpu_ms-q.gpu_active_ms);
        const double cpu_chunk=q.cpu_chunk_cost(u32(n));
        const bool cold_probe=q.cpu_latency_samples>=2&&q.context->gpu_latency_samples.load()<4&&q.context->gpu_probe_attempts.load()<4&&cpu_chunk>=LatencyRouting::cpu_quantum_ms&&remaining>cpu_chunk*4;
        bool accept=!q.gpu_fallbacks&&(cold_probe||LatencyRouting::promotion(cpu_chunk,q.context->gpu_parent_latency_ms.load()*n,remaining,q.cpu_latency_samples,q.context->gpu_latency_samples.load()));
        if(!accept&&!q.gpu_promotion_denied){q.gpu_promotion_denied=true;routing_denied++;}return accept;
    }
    int initial_owner(Query& q,u32 cpu,u32 gpu){
        const u32 slots=cpu_worker_count();bool other=gpu_context.load()&&gpu_context.load()!=q.context->handle;
        if((other&&routing_policy=="legacy")||cpu<slots)return 1;
        const double cpu_delay=double(cpu+1)/slots*cpu_quantum*q.context->cpu_parent_ms.load();
        if(routing_policy=="legacy")return cpu_delay<=0.2+double(gpu+1)*gpu_parents*q.context->gpu_parent_ms.load()?1:2;
        // Automatic work first obtains query-specific CPU measurements. Later
        // promotion must demonstrate a latency advantage. Explicit initial GPU
        // hints remain available for bounded exploration, with safe fallback.
        return 1;
    }
    void gpu_chunk_finished(const std::vector<BatchParent>& parents,double residence){
        struct Sample {u32 parents=0;bool discarded=false;};std::unordered_map<Query*,Sample> counts;for(const auto& p:parents){counts[p.query.get()].parents+=p.node!=0xffffffffu;counts[p.query.get()].discarded|=p.discard;}
        for(const auto& [q,sample]:counts){auto& c=*q->context;const auto n=sample.parents;
            // An abandoned/cancelled operation is a censored latency observation,
            // not a fast completion. Never train the completion predictor on it.
            if(sample.discarded||(q->status!="running"&&q->status!="candidate_solution"&&q->status!="exhausted"&&q->status!="work_limit"&&q->status!="unfinished")){c.gpu_censored_samples++;continue;}
            if(n){auto old=c.gpu_parent_latency_ms.load();c.gpu_parent_latency_ms.store(c.gpu_latency_samples.load()?old*.9+residence/n*.1:residence/n);c.gpu_latency_samples++;}
            else{auto old=c.gpu_root_latency_ms.load();c.gpu_root_latency_ms.store(c.gpu_root_samples.load()?old*.9+residence*.1:residence);c.gpu_root_samples++;}}
    }
    void return_gpu_query(const std::shared_ptr<Query>& q,AsyncPool& pool){
        if(q->gpu_return_cpu&&q->status=="running"&&!q->stop_requested()){
            pool.release_query(*q);std::lock_guard<std::mutex> lock(mutex);q->owner=1;q->migrations++;q->gpu_fallbacks++;q->last_migration=Clock::now();routing_fallbacks++;
        }else if(q->status!="running"||q->stop_requested())pool.release_query(*q);
        q->gpu_return_cpu=false;q->gpu_abort_chunk=false;return_query(q);
    }
    void cpu_work(const std::shared_ptr<Query>& q,CpuExecutor& cpu,const std::shared_ptr<NativePolicyGame>& policy,u32 quantum){
        auto t=Clock::now();auto expanded=q->expanded;q->begin();
        try{
            cpu.deadline=q->deadline;cpu.cancelled=&q->cancelled;
            if(!q->stop_requested()&&memory_ok(*q)&&!q->initialized){auto rt=Clock::now();auto initial=cpu.g.initial;restore_key(cpu.g.l,initial.data(),q->pristine.data());bool cyclic=false;auto key=cpu.root(initial,cyclic);auto old=q->context->cpu_root_ms.load();q->context->cpu_root_ms.store(old*.95+elapsed(rt)*.05);if(!q->stop_requested())q->root(KeyView(key),cyclic,policy);}
            auto parents_started=Clock::now();
            for(u32 n=0;n<quantum&&q->status=="running";n++){
                if(q->stop_requested())break;
                u32 parent=q->pop();if(parent==0xffffffffu){q->finish_quantum();break;}
                auto key=q->key(parent);q->expanded++;q->cpu_expanded++;
                for(u32 action:actions(cpu.g)){
                    bool cyclic=false;auto child=cpu.step(key,action,cyclic);if(q->stop_requested())break;
                    q->child(KeyView(child),parent,action,cyclic);if(q->status!="running")break;
                }
                q->stop_requested();q->finish_quantum();
                if(elapsed(t)>=2.0)break; // fairness is bounded by one complete parent expansion.
            }
            if(q->expanded>expanded){double sample=elapsed(parents_started)/(q->expanded-expanded);q->cpu_parent_latency_ms=q->cpu_latency_samples?q->cpu_parent_latency_ms*.8+sample*.2:sample;q->cpu_latency_samples++;}
        }catch(const DeadlineExpired&){q->status=q->cancelled?"cancelled":"timeout";}
        catch(const std::exception& e){q->status="runtime_error";q->detail=e.what();}
        double work=elapsed(t);q->cpu_ms+=work;if(q->expanded>expanded){double sample=work/(q->expanded-expanded),old=q->context->cpu_parent_ms.load();q->context->cpu_parent_ms.store(old*0.95+sample*0.05);cpu_parent_ms.store(old*0.95+sample*0.05);}return_query(q);
    }
    static std::vector<u32> actions(const Game& g){std::vector<u32> a{3,0,2,1};if(!(g.g[11]&16))a.push_back(4);return a;}
    void cpu_loop(){
        std::shared_ptr<Game> cached;std::unique_ptr<CpuExecutor> cpu;std::shared_ptr<NativePolicyGame> policy;
        for(;;){
            auto q=take_cpu();if(!q){std::unique_lock<std::mutex> lock(mutex);idle_cpu++;cv.wait(lock,[&]{return stopping||std::any_of(ready.begin(),ready.end(),[&](const auto& x){return x->owner!=2||(mode=="hybrid"&&!x->pinned_executor&&x->context->handle!=gpu_context.load());});});idle_cpu--;if(stopping)break;continue;}
#ifdef PS_DEVICE_SERVICE
            if(q->owned_search){resident_cpu_work(q);continue;}
#endif
            if(cached!=q->context->game){cached=q->context->game;policy=q->context->native;cpu=std::make_unique<CpuExecutor>(*cached);}
            cpu_work(q,*cpu,policy,cpu_quantum);
        }
    }
    void collect_releases(Query& q,AsyncPool& pool){for(u32 s:q.released)pool.release(s);q.released.clear();}
    std::vector<BatchParent> select_gpu(AsyncPool& pool,u32 capacity){
        std::vector<std::shared_ptr<Query>> queries;std::vector<BatchParent> result;u32 used=0;const u32 action_count=u32(actions(pool.game).size());
        {
            std::lock_guard<std::mutex> lock(mutex);
            // Migration happens only for an exclusively owned ready query.
            bool cpu_ready=std::any_of(ready.begin(),ready.end(),[](const auto& q){return q->owner!=2;});
            for(auto& q:ready)if(q->context->game.get()==&pool.game&&mode=="hybrid"&&!cpu_ready&&idle_cpu&&q->owner==2&&!q->pinned_executor&&q->initialized&&q->open<32){
                pool.release_query(*q);q->owner=1;q->migrations++;q->last_migration=Clock::now();cpu_ready=true;
            }
            for(auto i=ready.begin();i!=ready.end()&&queries.size()<gpu_queries;){
                auto q=*i;bool promote=promotable(*q);
                if(q->context->game.get()!=&pool.game){++i;continue;}
                if(q->owner==1&&!promote){++i;continue;}
                if(used+(q->initialized?action_count:1)>capacity)break;
                if(q->owner==1){q->migrations++;q->last_migration=Clock::now();routing_promotions++;if(q->context->gpu_latency_samples.load()<4)q->context->gpu_probe_attempts++;}
                q->owner=2;used+=q->initialized?action_count:1;queries.push_back(q);i=ready.erase(i);
            }
        }
        cv.notify_all();u32 reserved=used;used=0;
        for(auto& q:queries){
            reserved-=q->initialized?action_count:1;
            q->begin();if(q->stop_requested()||!memory_ok(*q)){pool.release_query(*q);complete_query(q);continue;}
            if(!q->initialized){result.push_back({q,0xffffffffu,0,1});used++;continue;}
            if(q->gpu_first_submit_ms<0)q->gpu_first_submit_ms=elapsed(q->submitted);
            u32 maximum=q->strategy=="bfs"?std::min(128u,gpu_parents*gpu_queries/std::max(1u,u32(queries.size()))):1;
            maximum=std::min({maximum,q->open,(q->resumable?q->grant_end:q->cap)-u32(q->expanded),(capacity-used-reserved)/action_count});
            for(u32 n=0;n<maximum;n++){u32 parent=q->pop();if(parent==0xffffffffu)break;result.push_back({q,parent,0,action_count});used+=action_count;}
            if(maximum==0){q->finish_quantum();if(q->status!="running")pool.release_query(*q);return_query(q);}
        }
        return result;
    }
    void commit_batch(AsyncBatch& batch,const std::shared_ptr<NativePolicyGame>& policy){
        auto t=Clock::now();std::fill(batch.hslots.p,batch.hslots.p+batch.active,0xffffffffu);
        const auto a=actions(batch.g);uint64_t parent_count=0,child_count=0;
        std::unordered_map<Query*,std::vector<u32>> returned_prefixes;
        for(auto& parent:batch.completed_parents){
            auto& q=*parent.query;
            if(parent.discard){if(parent.node==0xffffffffu)q.gpu_aborted_roots++;else{q.gpu_aborted_parents++;returned_prefixes[&q].push_back(parent.node);}continue;}
            if(parent.node!=0xffffffffu){pool_release_parent(q,parent.node,batch.pool);}
            if(q.stop_requested())continue;
            if(parent.node==0xffffffffu){
                q.root(KeyView(batch.hkeys.p+size_t(parent.lane)*batch.kw,batch.kw),batch.cyclic[parent.lane],policy);
                q.gpu_root_ready_ms=elapsed(q.submitted);
                if(q.status=="running"){u32 slot=batch.pool.allocate();if(slot==0xffffffffu){q.status="memory_limit";q.detail="GPU frontier capacity";}else{q.nodes[0].slot=slot;batch.hslots.p[parent.lane]=slot;}}
            }else{
                if(q.gpu_first_expand_ms<0)q.gpu_first_expand_ms=elapsed(q.submitted);
                q.expanded++;q.gpu_expanded++;parent_count++;
                for(u32 n=0;n<parent.count&&q.status=="running";n++){
                    u32 lane=parent.lane+n;child_count++;auto index=q.child(KeyView(batch.hkeys.p+size_t(lane)*batch.kw,batch.kw),parent.node,a[n],batch.cyclic[lane],batch.prehash?batch.hhashes.p[lane]:0,batch.prehash);
                    collect_releases(q,batch.pool);
                    if(index!=0xffffffffu){u32 slot=batch.pool.allocate();if(slot==0xffffffffu){q.status="memory_limit";q.detail="GPU frontier capacity";break;}q.nodes[index].slot=slot;batch.hslots.p[lane]=slot;}
                }
                q.stop_requested();
            }
        }
        for(auto& [q,prefix]:returned_prefixes)q->restore_bfs_prefix(prefix);
        for(auto& p:batch.completed_parents)if(p.query->initialized)p.query->finish_quantum();
        {std::lock_guard<std::mutex> lock(stats_mutex);gpu_ingest+=elapsed(t);gpu_ingest_parents+=parent_count;gpu_ingest_children+=child_count;}batch.retain();
    }
    static void pool_release_parent(Query& q,u32 node,AsyncPool& pool){pool.release(q.nodes[node].slot);q.nodes[node].slot=0xffffffffu;}
    void wait_gpu_event(AsyncBatch& b){auto t=Clock::now();ck(cudaEventSynchronize(b.complete));std::lock_guard<std::mutex> lock(stats_mutex);gpu_driver_wait_ms+=elapsed(t);}
    void expire_ready(AsyncPool* pool){
        std::vector<std::shared_ptr<Query>> expired;auto now=Clock::now();
        {std::lock_guard<std::mutex> lock(mutex);for(auto i=ready.begin();i!=ready.end();){auto& q=*i;bool timeout=!q->execution_budget&&(q->include_queue_time||q->has_started)&&now>=q->deadline;if(q->cancelled||timeout){expired.push_back(q);i=ready.erase(i);}else ++i;}}
        for(auto& q:expired){if(pool&&q->context->game.get()==&pool->game)pool->release_query(*q);q->stop_requested();complete_query(q);}
    }
    void gpu_loop(){
        std::shared_ptr<Game> cached,spare_game;std::shared_ptr<NativePolicyGame> policy;
        std::shared_ptr<Context> current_context;
        std::unique_ptr<AsyncPool> pool;std::vector<std::unique_ptr<AsyncBatch>> batches;
        std::unique_ptr<CpuExecutor> spare_cpu;
        double previous_compute=0,previous_upload=0,previous_readback=0,previous_enqueue=0;
        uint64_t previous_dispatches=0,previous_receipts=0,previous_verified=0,previous_partial=0;
        try{
            ck(cudaSetDevice(adapter));
            for(;;){
                expire_ready(pool.get());
                std::shared_ptr<Context> next_context=current_context;bool need_gpu=false;
                {std::unique_lock<std::mutex> lock(mutex);if(stopping)break;
                    bool resident=std::any_of(active.begin(),active.end(),[&](const auto& entry){return entry.second->owner==2&&entry.second->context==current_context;});
                    bool in_flight=std::any_of(batches.begin(),batches.end(),[](const auto& b){return b->phase!=AsyncBatch::Idle;});
                    if(!resident&&!in_flight){
                        std::unordered_map<u32,uint64_t> work;std::shared_ptr<Query> chosen;uint64_t maximum=0;
                        for(const auto& q:ready){bool eligible=q->owner==2||promotable(*q);if(!eligible)continue;auto score=(work[q->context->handle]+=std::max(1u,std::min(gpu_parents,q->open)));if(score>maximum){maximum=score;chosen=q;}}
                        if(chosen)next_context=chosen->context;
                    }
                    if(next_context){gpu_context=next_context->handle;need_gpu=std::any_of(ready.begin(),ready.end(),[&](const auto& q){return q->context==next_context&&(q->owner==2||promotable(*q));});}
                }
                auto next_game=next_context?next_context->game:std::shared_ptr<Game>{};
                if(cached!=next_game){
                    for(const auto& b:batches){previous_compute+=b->compute_ms;previous_upload+=b->upload_ms;previous_readback+=b->readback_ms;previous_enqueue+=b->enqueue_ms;previous_dispatches+=b->dispatches;previous_receipts+=b->checked_receipts;previous_verified+=b->verified_hashes;previous_partial+=b->partial_retirements;}
                    auto retired=Clock::now();batches.clear();pool.reset();{std::lock_guard<std::mutex> lock(stats_mutex);gpu_retire_ms+=elapsed(retired);}current_context=next_context;cached=next_game;policy=current_context->native;effective_lanes=0;effective_pool=0;
                }
                // Allocation is lazy and outside the scheduler lock. CPU work and
                // command admission continue while a new GPU shape is prepared.
                if(!pool&&need_gpu){
                        uint64_t keybytes=uint64_t(key_words(cached->l))*4;u32 slots=u32(std::min(uint64_t(pool_capacity),2ull*1024*1024*1024/keybytes));require(slots>=5,"Service frontier does not fit five successors");
                        uint64_t lane_bytes=uint64_t(cached->l.STATE_WORDS)*4+((cached->l.CELL_CAP+1)*cached->l.OBJ_WORDS+cached->l.MOV_WORDS)*4+keybytes*2+28;
                        uint64_t constant_bytes=uint64_t(cached->g.size())*4;
                        u32 lanes=u32(std::min(uint64_t(gpu_lanes),(8ull*1024*1024*1024-keybytes*slots-constant_bytes)/(lane_bytes*streams)));
                        lanes=u32(std::min(uint64_t(lanes),(512ull*1024*1024)/((keybytes*2+24)*streams)));
                        require(lanes>=5,"Game does not fit the 8 GiB service GPU budget");
                        require(uint64_t(lanes)*(keybytes*2+24)*streams<=512ull*1024*1024,"Service pinned key buffers exceed 512 MiB");
                        auto setup=Clock::now();pool=std::make_unique<AsyncPool>(*cached,slots,fuel,max_dispatches);effective_lanes=lanes;effective_pool=slots;for(u32 i=0;i<streams;i++)batches.push_back(std::make_unique<AsyncBatch>(*pool,lanes,&gpu_cv,gpu_prehashed,verify_gpu_hash,&mutex,(256ull*1024*1024)/streams,gpu_event_wait,gpu_fused_pack));
                        // Single-pool setup is outside query execution. Finish
                        // first-use clears here so one-time allocation work does
                        // not contaminate per-query latency calibration.
                        for(const auto& b:batches)ck(cudaStreamSynchronize(b->stream));
                        {std::lock_guard<std::mutex> lock(stats_mutex);gpu_setup_ms+=elapsed(setup);}gpu_resident_contexts=1;gpu_contexts_peak=1;
                }
                bool progress=false;
                for(auto& p:batches){auto& b=*p;
                    if(b.phase!=AsyncBatch::Idle&&b.ready()){
                        if(b.phase==AsyncBatch::Computing){if(b.collect())commit_batch(b,policy);}
                        else{
                            std::vector<std::shared_ptr<Query>> returned;std::unordered_set<Query*> unique;
                            u32 expanded=0;for(auto& parent:b.completed_parents){expanded+=parent.node!=0xffffffffu;if(unique.insert(parent.query.get()).second){parent.query->gpu_active_ms+=elapsed(b.started);returned.push_back(parent.query);}}
                            gpu_chunk_finished(b.completed_parents,elapsed(b.started));
                            if(expanded){double sample=elapsed(b.started)/expanded/streams,old=current_context->gpu_parent_ms.load();current_context->gpu_parent_ms.store(old*0.9+sample*0.1);gpu_parent_ms.store(old*0.9+sample*0.1);}
                            b.retained();for(auto& q:returned)return_gpu_query(q,*pool);
                        }
                        progress=true;
                    }
                    if(b.phase==AsyncBatch::Idle){auto selected=select_gpu(*pool,b.capacity);if(!selected.empty()){
                        bool overlapping=std::any_of(batches.begin(),batches.end(),[&](const auto& other){return other.get()!=&b&&other->phase!=AsyncBatch::Idle;});
                        b.start(std::move(selected),actions(*cached));gpu_batches++;overlap_submissions+=overlapping;progress=true;
                    }}
                }
                {std::lock_guard<std::mutex> lock(stats_mutex);gpu_compute=previous_compute;gpu_upload=previous_upload;gpu_readback=previous_readback;gpu_enqueue=previous_enqueue;gpu_dispatches=previous_dispatches;gpu_receipts=previous_receipts;gpu_verified_hashes=previous_verified;gpu_partial_retirements=previous_partial;
                    for(auto& b:batches){gpu_compute+=b->compute_ms;gpu_upload+=b->upload_ms;gpu_readback+=b->readback_ms;gpu_enqueue+=b->enqueue_ms;gpu_dispatches+=b->dispatches;gpu_receipts+=b->checked_receipts;gpu_verified_hashes+=b->verified_hashes;gpu_partial_retirements+=b->partial_retirements;}}
                if(!progress){
                    if(gpu_event_wait){auto pending=std::find_if(batches.begin(),batches.end(),[](const auto& b){return b->phase!=AsyncBatch::Idle;});if(pending!=batches.end()){wait_gpu_event(**pending);continue;}}
                    bool all_idle=std::all_of(batches.begin(),batches.end(),[](const auto& b){return b->phase==AsyncBatch::Idle;});
                    if(all_idle&&mode=="hybrid"){if(auto q=take_cpu()){
                        std::shared_ptr<NativePolicyGame> cpu_policy;
                        // A new load can arrive after the GPU cache check above.
                        // Claiming a query pins the currently loaded game until
                        // its terminal event; refresh the spare executor under
                        // that same ownership lock and retain its Game lifetime.
                        if(spare_game!=q->context->game){spare_game=q->context->game;spare_cpu=std::make_unique<CpuExecutor>(*spare_game);}cpu_policy=q->context->native;
                        q->driver_cpu_quanta++;cpu_work(q,*spare_cpu,cpu_policy,4);continue;
                    }}
                    std::unique_lock<std::mutex> lock(mutex);
                    gpu_cv.wait_for(lock,std::chrono::milliseconds(10),[&]{
                        if(stopping)return true;
                        if(std::any_of(batches.begin(),batches.end(),[](const auto& b){return b->phase!=AsyncBatch::Idle&&b->notified.load(std::memory_order_acquire);}))return true;
                        if(all_idle&&!ready.empty())return true;
                        bool buffer_free=std::any_of(batches.begin(),batches.end(),[](const auto& b){return b->phase==AsyncBatch::Idle;});
                        return buffer_free&&std::any_of(ready.begin(),ready.end(),[](const auto& q){return q->owner==2;});
                    });
                }
            }
        }catch(const std::exception& e){
            std::vector<std::shared_ptr<Query>> failed;
            // Logical interpreter failures discard scratch after outstanding bounded launches finish.
            for(auto& b:batches)cudaStreamSynchronize(b->stream);
            {std::lock_guard<std::mutex> lock(mutex);gpu_error=e.what();std::unordered_set<Query*> seen;
                for(auto& b:batches)for(auto* list:{&b->parents,&b->completed_parents})for(auto& p:*list)if(seen.insert(p.query.get()).second)failed.push_back(p.query);
                for(auto i=ready.begin();i!=ready.end();)if((*i)->owner==2||mode=="cuda"){if(seen.insert(i->get()).second)failed.push_back(*i);i=ready.erase(i);}else ++i;
            }
            for(auto& q:failed){q->status="runtime_error";q->detail=e.what();complete_query(q);}cv.notify_all();
        }
    }
    #include "service-multi.inc"
    void drain(){std::unique_lock<std::mutex> lock(mutex);cv.wait(lock,[&]{return active.empty()
#ifdef PS_DEVICE_SERVICE
        &&resident_parking_drained_locked()
#endif
        ;});}
    void stop(){
        if(!started)return;
        {std::lock_guard<std::mutex> lock(mutex);for(auto& [id,q]:active)q->cancelled=true;}cv.notify_all();gpu_cv.notify_one();drain();
        {std::lock_guard<std::mutex> lock(mutex);stopping=true;continuations.clear();continuation_bytes=0;}cv.notify_all();gpu_cv.notify_one();for(auto& w:workers)w.join();if(gpu_thread.joinable())gpu_thread.join();started=false;
    }
    J statistics(){
        std::scoped_lock lock(mutex,stats_mutex);J::Object row{{"loaded",J(!contexts.empty())},{"handle",ji(handle)},{"contexts",ji(contexts.size())},{"context_bytes",ji(context_bytes)},{"gpu_context",ji(gpu_context)},{"active",ji(active.size())},{"ready",ji(ready.size())},{"completed",ji(completed)},{"mode",J(mode)},
          {"cpu_budget",ji(threads)},{"cpu_workers",ji(cpu_worker_count())},{"gpu_error",J(gpu_error)},
          {"gpu_compute_ms",J(gpu_compute)},{"upload_device_ms",J(gpu_upload)},{"readback_device_ms",J(gpu_readback)},{"gpu_enqueue_host_ms",J(gpu_enqueue)},
          {"gpu_ingest_ms",J(gpu_ingest)},{"gpu_dispatches",ji(gpu_dispatches)},{"gpu_receipts",ji(gpu_receipts)},{"gpu_batches",ji(gpu_batches)},{"overlap_submissions",ji(overlap_submissions)},{"peak_rss_bytes",ji(gpu_memory::peak_rss_bytes())}};
        FILETIME created,exited,kernel,user;require(GetProcessTimes(GetCurrentProcess(),&created,&exited,&kernel,&user),"Cannot read service process CPU accounting");auto cpu_ms=[](FILETIME t){return double((uint64_t(t.dwHighDateTime)<<32)|t.dwLowDateTime)/10000;};
        row["process_kernel_cpu_ms"]=J(cpu_ms(kernel));row["process_user_cpu_ms"]=J(cpu_ms(user));row["process_cpu_ms"]=J(cpu_ms(kernel)+cpu_ms(user));
#ifdef PS_CUDA_PHASE_PROFILE
        if(selected){unsigned long long totals[48]{};unsigned int overflow=0;ck(cudaMemcpyFromSymbol(totals,interpreter_phase_totals,sizeof(totals)));ck(cudaMemcpyFromSymbol(&overflow,interpreter_phase_overflow,sizeof(overflow)));require(!overflow,"Interpreter phase diagnostic counter overflow");J::Array values;for(auto value:totals)values.push_back(ji(value));row["interpreter_phase_profile"]=J(std::move(values));row["interpreter_phase_profile_scope"]=J(std::string("Instrumented per-warp SM-clock sums,including suspension;not occupancy or utilization"));}
#endif
        row["cpu_parent_ms_estimate"]=J(cpu_parent_ms.load());row["gpu_parent_ms_estimate"]=J(gpu_parent_ms.load());
        row["effective_gpu_lanes"]=ji(effective_lanes);row["effective_pool_capacity"]=ji(effective_pool);
        row["gpu_context_limit"]=ji(gpu_context_limit);row["gpu_resident_contexts"]=ji(gpu_resident_contexts);row["gpu_contexts_peak"]=ji(gpu_contexts_peak);
        row["gpu_parallel_contexts_peak"]=ji(gpu_parallel_contexts_peak);
        row["gpu_prehashed"]=J(gpu_prehashed);row["gpu_verified_hashes"]=ji(gpu_verified_hashes);row["gpu_setup_ms"]=J(gpu_setup_ms);
        row["gpu_partial_retirements"]=ji(gpu_partial_retirements);row["gpu_fused_pack"]=J(gpu_fused_pack);row["gpu_event_wait"]=J(gpu_event_wait);row["gpu_retire_ms"]=J(gpu_retire_ms);row["gpu_driver_wait_ms"]=J(gpu_driver_wait_ms);
        row["routing_policy"]=J(routing_policy);row["routing_promotions"]=ji(routing_promotions);row["routing_fallbacks"]=ji(routing_fallbacks);row["routing_promotion_denials"]=ji(routing_denied);row["routing_gpu_admissions"]=ji(routing_gpu_admissions);
        row["gpu_pool_allocator"]=J(bool(gpu_arenas));
        row["completion_locking"]=J(completion_locking);row["completion_lock_wait_ms"]=J(double(completion_wait_ns.load())/1e6);row["completion_locked_ms"]=J(double(completion_locked_ns.load())/1e6);row["completion_report_ms"]=J(double(completion_report_ns.load())/1e6);row["completion_encode_ms"]=J(double(completion_encode_ns.load())/1e6);row["cpu_take_lock_wait_ms"]=J(double(cpu_take_wait_ns.load())/1e6);
        row["continuations"]=ji(continuations.size());row["continuation_bytes"]=ji(continuation_bytes);row["continuation_capacity"]=ji(continuation_capacity);row["continuation_limit_bytes"]=ji(continuation_limit);
        row["gpu_ingest_parents"]=ji(gpu_ingest_parents);row["gpu_ingest_children"]=ji(gpu_ingest_children);
        row["gpu_reserved_device_bytes"]=ji(gpu_reserved_device);row["gpu_reserved_pinned_bytes"]=ji(gpu_reserved_pinned);row["gpu_reserved_frontier_bytes"]=ji(gpu_reserved_frontier);
#ifdef PS_DEVICE_SERVICE
        resident_statistics(row);
#endif
        if(selected)row["device"]=selected->report();return J(std::move(row));
    }
    void load(const J& req){
        require(configured,"Configure before loading");{std::lock_guard<std::mutex> lock(mutex);require(gpu_error.empty(),"GPU service failed; start a fresh worker");}
        auto loaded=std::make_shared<Game>(puzzlescript::json::parse(read_limited(at(req,"file").asString(),64*1024*1024)));canonical_guard(*loaded);
        if(auto p=req.find("boards_file"))compact_boards(*loaded,p->asString());
        std::shared_ptr<NativePolicyGame> policy;if(auto p=req.find("ir"))policy=native_policy_load(read_limited(p->asString(),64*1024*1024),num(req,"level",0),loaded->g[1],loaded->g[2],loaded->l.OBJ_WORDS,loaded->l.MOV_WORDS);
        auto context=std::make_shared<Context>();context->game=loaded;context->native=std::move(policy);context->roots.reserve(loaded->roots.size());
#ifdef PS_DEVICE_SERVICE
        if(gpu_engine=="resident")context->resident_rules=std::make_shared<resident::RuleData>(*loaded);
#endif
        for(const auto& root:loaded->roots){Key key(key_words(loaded->l));capture_key(loaded->l,root.data(),key.data());context->roots.push_back(std::move(key));}
        loaded->roots.clear();loaded->roots.shrink_to_fit();context->bytes=uint64_t(loaded->initial.size()+loaded->g.size())*4;for(const auto& root:context->roots)context->bytes+=root.size()*4;
#ifdef PS_DEVICE_SERVICE
        if(context->resident_rules)context->bytes+=context->resident_rules->game.size()*4;
#endif
        require(context->bytes<=512ull*1024*1024,"Compiled context exceeds 512 MiB");
        {std::lock_guard<std::mutex> lock(mutex);
            while(contexts.size()>=16||context_bytes+context->bytes>512ull*1024*1024){
                auto chosen=contexts.end();for(auto i=contexts.begin();i!=contexts.end();++i){bool busy=context_retained(i->second)||std::any_of(active.begin(),active.end(),[&](const auto& entry){return entry.second->context==i->second;});if(!busy&&(chosen==contexts.end()||i->first<chosen->first))chosen=i;}
                require(chosen!=contexts.end(),"Context cache full of active games; retry after a query completes");context_bytes-=chosen->second->bytes;contexts.erase(chosen);
            }
            require(++handle!=0,"Service handle overflow");context->handle=handle;contexts.emplace(handle,context);context_bytes+=context->bytes;
        }cv.notify_all();gpu_cv.notify_one();start();
    }
    std::shared_ptr<Query> prepare(const J& req){
        std::shared_ptr<Context> context;{std::lock_guard<std::mutex> lock(mutex);auto found=contexts.find(num(req,"handle",-1));require(configured&&found!=contexts.end(),"Service handle unavailable");require(gpu_error.empty(),"GPU service failed: "+gpu_error);require(active.size()<2048,"Service pending capacity 2048");require(identifiers.size()<1000000,"Service identifier capacity 1000000");context=found->second;}
        auto g=context->game;
        unsigned bits=num(req,"hash_bits",64);require(bits>=1&&bits<=64,"Hash bits 1..64");auto q=std::make_shared<Query>(bits);q->context=context;
        q->id=at(req,"query").asString();require(!q->id.empty()&&q->id.size()<=128,"Query identifier capacity");
        q->strategy=str(req,"strategy","bfs");require(q->strategy=="bfs"||q->strategy=="weighted"||q->strategy=="greedy"||q->strategy=="portfolio","Unknown service search strategy");require(q->strategy=="bfs"||context->native,"Load native IR for Auto ordering");
        q->trace_enabled=flag(req,"trace",false);
        auto executor=str(req,"executor","auto");require(executor=="auto"||executor=="cpu"||executor=="cuda","Unknown requested executor");q->pinned_executor=executor=="cpu"?1:executor=="cuda"?2:0;require(!(mode=="cpu"&&q->pinned_executor==2)&&!(mode=="cuda"&&q->pinned_executor==1),"Requested executor unavailable in configured mode");
        auto initial=str(req,"initial_executor","auto");require(initial=="auto"||initial=="cpu"||initial=="cuda","Unknown initial executor");q->initial_executor=initial=="cpu"?1:initial=="cuda"?2:0;
        require(!q->pinned_executor||!q->initial_executor,"Use either an executor pin or an initial placement hint");
        require(!(mode=="cpu"&&q->initial_executor==2)&&!(mode=="cuda"&&q->initial_executor==1),"Initial executor unavailable in configured mode");
        q->latency_routing=mode=="hybrid"&&routing_policy=="latency";
        auto budget_policy=str(req,"budget","wall");require(budget_policy=="wall"||budget_policy=="execution","Unknown query budget policy");q->execution_budget=budget_policy=="execution";
        q->cap=num(req,"max_expanded",1000);q->max_states=num(req,"max_states",65536);q->weight=num(req,"weight",2);int timeout=num(req,"timeout_ms",60000),memory=num(req,"memory_mb",256);
        q->resumable=flag(req,"resumable",false);q->digest_enabled=flag(req,"search_digest",false);
        require(!q->resumable||q->strategy=="bfs","Resumable assessments currently require exact BFS");
        q->grant_end=num(req,"work_grant",q->cap);require(q->grant_end&&q->grant_end<=1000000,"Work grant 1..1000000");require(q->resumable||!req.find("work_grant"),"Work grant requires resumable:true");q->grant_end=std::min(q->cap,q->grant_end);
        require(q->cap&&q->cap<=1000000&&q->max_states&&q->max_states<=1000000&&q->weight&&q->weight<=1024&&timeout>=1&&timeout<=600000&&memory>=1&&memory<=4096,"Invalid query bounds");q->memory_limit=uint64_t(memory)*1024*1024;q->timeout_ms=timeout;q->include_queue_time=!q->execution_budget&&flag(req,"include_queue_time",true);q->deadline=q->include_queue_time?q->submitted+std::chrono::milliseconds(timeout):Clock::time_point::max();
        int root=num(req,"root_index",0);require(root>=0&&size_t(root)<context->roots.size(),"Root index unavailable");q->pristine=context->roots[root];
        if(auto p=req.find("objects")){auto objects=words(*p);require(objects.size()==g->l.CELL_CAP*g->l.OBJ_WORDS,"Query object shape");for(u32 i=0;i<objects.size();i++)if(g->g[4]%32&&i%g->l.OBJ_WORDS==g->l.OBJ_WORDS-1)require(!(objects[i]&~((1u<<(g->g[4]%32))-1)),"Query object mask");std::copy(objects.begin(),objects.end(),q->pristine.begin()+72);std::copy(objects.begin(),objects.end(),q->pristine.end()-objects.size());}
        if(auto p=req.find("rng")){auto permutation=words(*p);require(permutation.size()==256,"Query RC4 length");auto sorted=permutation;std::sort(sorted.begin(),sorted.end());for(u32 i=0;i<256;i++)require(sorted[i]==i,"Query RC4 permutation");for(u32 i=0;i<64;i++)q->pristine[8+i]=permutation[i*4]|permutation[i*4+1]<<8|permutation[i*4+2]<<16|permutation[i*4+3]<<24;}
#ifdef PS_DEVICE_SERVICE
        resident_prepare(*q);
#endif
        {std::lock_guard<std::mutex> lock(mutex);require(!identifiers.contains(q->id),"Duplicate query identifier");identifiers.insert(q->id);q->ticket=++serial;require(serial!=0,"Query ticket overflow");active.emplace(q->id,q);}
        return q;
    }
};
bool process_line(Service& service,const std::string& line,bool overflow=false){
        std::string id;
        try{
            require(!overflow,"Service request exceeds 1 MiB");auto req=puzzlescript::json::parse(line);id=at(req,"id").asString();require(!id.empty()&&id.size()<=128,"Service request identifier capacity");auto op=at(req,"op").asString();
            if(op=="configure"){service.configure(req);service.reply(id,{{"report",service.statistics()}});}
            else if(op=="load"){service.load(req);service.reply(id,{{"report",service.statistics()}});}
            else if(op=="submit"){
                auto q=service.prepare(req);
                {std::lock_guard<std::mutex> lock(service.mutex);
                    // Publish atomically with GPU-failure collection. A failure
                    // between prepare/ACK and queue insertion must not orphan a
                    // query behind a driver that has already exited.
                    if(!service.gpu_error.empty()){service.active.erase(q->id);service.cv.notify_all();throw std::runtime_error("GPU service failed: "+service.gpu_error);}
                    service.reply(id,{{"query",J(q->id)},{"ticket",ji(q->ticket)}});
                    service.assign_owner_locked(*q);
                    service.ready.push_back(q);if(service.active.size()>1)service.overlap_submissions++;}service.cv.notify_all();service.gpu_cv.notify_one();
            }
            else if(op=="resume")service.resume(req,id);
            else if(op=="release")service.reply(id,service.release_continuation(req,false).asObject());
            else if(op=="cancel"&&req.find("continuation"))service.reply(id,service.release_continuation(req,true).asObject());
            else if(op=="cancel"){
                bool found=false;{std::lock_guard<std::mutex> lock(service.mutex);auto q=service.active.find(at(req,"query").asString());if(q!=service.active.end()&&!q->second->finishing){q->second->cancelled=true;found=true;}}service.cv.notify_all();service.gpu_cv.notify_one();service.reply(id,{{"found",J(found)}});
            }
            else if(op=="cancel_all"){{std::lock_guard<std::mutex> lock(service.mutex);for(auto& [key,q]:service.active)q->cancelled=true;service.continuations.clear();service.continuation_bytes=0;}service.cv.notify_all();service.gpu_cv.notify_one();service.reply(id);}
            else if(op=="info")service.reply(id,{{"report",service.statistics()}});
#ifdef PS_DEVICE_SERVICE
            else if(op=="resident_trace"){require(service.gpu_engine=="resident","Resident trace needs device-owned engine");service.reply(id,{{"report",service.resident_schedule_trace()}});}
#endif
            else if(op=="unload"){
                {std::lock_guard<std::mutex> lock(service.mutex);auto i=service.contexts.find(num(req,"handle",-1));require(i!=service.contexts.end(),"Service handle unavailable");require(!service.context_retained(i->second)&&std::none_of(service.active.begin(),service.active.end(),[&](const auto& entry){return entry.second->context==i->second;}),"Context still has active or retained queries");service.context_bytes-=i->second->bytes;service.contexts.erase(i);}
                service.reply(id);
            }
            else if(op=="drain"){service.drain();service.reply(id,{{"report",service.statistics()}});}
            else if(op=="shutdown"){service.stop();service.reply(id,{{"report",service.statistics()}});return true;}
            else throw std::runtime_error("Unknown service operation");
        }catch(const std::exception& e){service.write({{"id",J(id)},{"ok",J(false)},{"error",J(std::string(e.what()))}});}
    return false;
}
int main(){
    Service service;std::string line;
    for(;;){
        line.clear();bool overflow=false;char ch;while(std::cin.get(ch)&&ch!='\n'){if(line.size()<1024*1024)line.push_back(ch);else overflow=true;}if(line.empty()&&!std::cin)break;
        if(process_line(service,line,overflow))return 0;
    }
    service.stop();return 0;
}
}
