// Only the single GPU scheduler can move slots. Pending pools never participate.
void resident_recover_device(std::vector<std::unique_ptr<ResidentPool>>& pools){
    std::vector<std::pair<ResidentPool*,u32>> waiting;
    for(auto& p:pools)if(!p->search->in_flight())for(u32 slot=0;slot<p->leases.size();slot++)if(p->leases[slot]){
        const auto& r=p->search->view(slot);if(r.status==resident::Memory&&(r.detail==resident::DeviceCapacity||r.detail==resident::HashCapacity))waiting.emplace_back(p.get(),slot);
    }
    for(auto [source,slot]:waiting){
        auto q=source->leases[slot];if(!q)continue;const auto r=source->search->view(slot);q->begin();
        if(q->stop_requested()||!memory_ok(*q)){
            source->search->cancel_slot(slot,r.slot_generation);source->leases[slot].reset();resident_collect(*source);complete_query(q);continue;
        }
        auto started=Clock::now();ResidentPool* target=nullptr;u32 destination=resident::nil;
        for(auto& p:pools)if(p.get()!=source&&!p->search->in_flight()&&p->context==source->context&&p->bits==source->bits&&p->nodes>r.count&&(destination=resident_free_slot(*p))!=resident::nil){target=p.get();break;}
        if(!target){
            auto plan=resident_plan_pool(q,r.count,false);
            if(plan){
                auto fits=[&]{uint64_t bytes=plan->config.bytes,keys=plan->key_bytes,nodes=plan->node_slots,pinned=plan->pinned_bytes;for(const auto& p:pools){bytes+=p->config.bytes;keys+=p->key_bytes;nodes+=p->node_slots;pinned+=p->pinned_bytes;}
                    if(pools.size()>=gpu_context_limit||bytes>resident_device_limit||keys>resident_key_limit||nodes>pool_capacity||pinned>512ull*1024*1024)return false;
                    if(resident_arena)return resident_arena->fits(resident::device_allocations(*plan->game,plan->config))&&resident_pinned_arena->fits(resident::pinned_allocations(plan->config));
                    size_t free=0,total=0;ck(cudaMemGetInfo(&free,&total));return plan->config.bytes+64ull*1024*1024<=free;
                };
                // Release only idle pools. Never export a peer's live state to
                // make this optimization fit or exceed temporary aggregate caps.
                while(!fits()){
                    auto victim=pools.end();for(auto i=pools.begin();i!=pools.end();++i)if(i->get()!=source&&!(*i)->search->in_flight()&&!resident_live(**i)&&(victim==pools.end()||(*i)->touched<(*victim)->touched))victim=i;
                    if(victim==pools.end())break;auto t=Clock::now();resident_collect(**victim);pools.erase(victim);{std::lock_guard<std::mutex> lock(stats_mutex);gpu_retire_ms+=elapsed(t);}
                }
                if(fits()){
                    auto t=Clock::now();plan->search=std::make_unique<resident::Search>(*plan->game,1,plan->config,resident_arena.get(),resident_pinned_arena.get());resident_pool_slot_counts[plan->config.n]++;plan->trace_id=++resident_pool_serial;require(resident_pool_serial!=0,"Resident pool generation overflow");plan->leases.resize(plan->config.n);plan->lease_since.resize(plan->config.n);plan->admitted=Clock::now();
                    {std::lock_guard<std::mutex> lock(stats_mutex);gpu_setup_ms+=elapsed(t);}target=plan.get();destination=0;pools.push_back(std::move(plan));resident_publish_pools(pools);
                }
            }
        }
        bool moved=false;
        if(target)try{
            source->search->move_to(slot,r.slot_generation,*target->search,destination,target->search->view(destination).slot_generation);
            source->leases[slot].reset();target->leases[destination]=q;target->lease_since[destination]=Clock::now();target->touched=Clock::now();q->sync_resident(target->search->view(destination));q->gpu_interpreter_variant=target->search->interpreter_variant();moved=true;
        }catch(const std::exception& e){if(std::string(e.what())!="Device move rehash work limit")throw;}
        const double control=elapsed(started);q->gpu_ms+=control;q->gpu_active_ms+=control;resident_collect(*source);
        if(moved){resident_collect(*target);continue;}
        resident_device_growth_fallbacks++;bool detached=resident_detach(*source,slot);source->leases[slot].reset();resident_collect(*source);
        if(detached){resident_physical_recoveries++;q->sync_resident(q->owned_search->q);if(mode=="hybrid"&&!q->pinned_executor)resident_set_cpu(*q);return_query(q);}else complete_query(q);
    }
}
