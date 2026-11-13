// Service members, after ResidentPool. All pool/lease changes occur on the
// single GPU owner. Token publication/resume/release still use Service::mutex.
// This first prototype accepts legacy submissions and CUDA-only exact search.
bool resident_park(ResidentPool& p,u32 slot,const std::shared_ptr<Query>& q){
    if(!resident_park_continuations||q->status!="unfinished")return false;
    const auto r=p.search->view(slot);
    if(r.status!=resident::Unfinished||r.stage!=resident::Ready||r.probing)return false;
    require(!q->owned_search&&!q->parked_search&&!p.parked[slot].generation,"Duplicate parked ownership");
    auto start=Clock::now();std::unique_ptr<resident::Checkpoint> cp;
    try{cp=p.search->reserve_paused(slot,r.slot_generation,resident_available(),16777216,resident_park_physical_index);}
    catch(const std::exception& e){
        const auto message=std::string(e.what());
        if(message.find("storage limit")==std::string::npos&&message.find("rehash work limit")==std::string::npos)throw;
        const double ms=elapsed(start);q->gpu_ms+=ms;q->gpu_active_ms+=ms;
        {std::lock_guard<std::mutex> lock(stats_mutex);resident_park_reserve_ms+=ms;}
        resident_park_reservation_fallbacks++;return false;
    }
    double reserve_ms=elapsed(start),diagnostic_ms=0;
    auto lease=std::make_shared<Query::ParkedCheckpoint>(p.trace_id,slot,r.slot_generation,std::move(cp));
    if(q->digest_enabled){
        start=Clock::now();p.search->read_paused(slot,r.slot_generation,*lease->reservation,false);
        lease->digest=q->resident_digest(lease->reservation.get());diagnostic_ms=elapsed(start);resident_park_diagnostic_reads++;
    }
    q->parked_search=lease;
    p.parked[slot]={lease,r.slot_generation,lease->reserved_bytes,Clock::now()};
    resident_parks++;
    const auto slots=resident_parked_slots.fetch_add(1)+1,bytes=resident_parked_reserved_bytes.fetch_add(lease->reserved_bytes)+lease->reserved_bytes;
    resident_parked_slots_peak.store(std::max(resident_parked_slots_peak.load(),slots));
    resident_parked_reserved_peak.store(std::max(resident_parked_reserved_peak.load(),bytes));
    // Reserve/control time is part of this query's execution budget too.
    q->gpu_ms+=reserve_ms+diagnostic_ms;q->gpu_active_ms+=reserve_ms+diagnostic_ms;
    {std::lock_guard<std::mutex> lock(stats_mutex);resident_park_reserve_ms+=reserve_ms;resident_park_diagnostic_ms+=diagnostic_ms;}
    return true;
}
void resident_forget_parked(ResidentPool& p,u32 slot){
    std::lock_guard<std::mutex> lock(mutex);
    auto& entry=p.parked[slot];require(entry.generation,"Missing parked slot");
    require(resident_parked_slots.fetch_sub(1)>0,"Parked slot accounting underflow");
    require(resident_parked_reserved_bytes.fetch_sub(entry.reserved_bytes)>=entry.reserved_bytes,"Parked reservation accounting underflow");
    entry={};cv.notify_all();
}
void resident_evict_parked(ResidentPool& p,u32 slot){
    require(!p.search->in_flight(),"Cannot evict a pending pool");const auto& entry=p.parked[slot];
    require(entry.generation&&!p.leases[slot],"Invalid parked eviction");
    if(auto lease=entry.lease.lock()){
        require(lease->pool==p.trace_id&&lease->slot==slot&&lease->generation==entry.generation&&lease->device_owned,"Stale parked lease");
        const auto start=Clock::now();p.search->read_paused(slot,entry.generation,*lease->reservation,true);
        lease->materialize_ms=elapsed(start);
        // The token still owns this same record and its preallocated graph.
        lease->device_owned.store(false,std::memory_order_release);resident_park_evictions++;
    }else{p.search->cancel_slot(slot,entry.generation);resident_park_releases++;}
    resident_forget_parked(p,slot);resident_collect(p);
}
void resident_clean_parked(ResidentPool& p){
    if(p.search->in_flight())return;
    for(u32 slot=0;slot<p.parked.size();slot++)if(p.parked[slot].generation&&p.parked[slot].lease.expired())resident_evict_parked(p,slot);
}
static u32 resident_paused_slot(const ResidentPool& p){
    if(p.search->in_flight())return resident::nil;
    u32 oldest=resident::nil;
    for(u32 slot=0;slot<p.parked.size();slot++)if(p.parked[slot].generation&&(oldest==resident::nil||p.parked[slot].since<p.parked[oldest].since))oldest=slot;
    return oldest;
}
bool resident_resume_parked(std::vector<std::unique_ptr<ResidentPool>>& pools,const std::shared_ptr<Query>& q){
    if(!q->parked_search||!q->parked_search->device_owned)return false;
    const auto lease=q->parked_search;
    auto found=std::find_if(pools.begin(),pools.end(),[&](const auto& p){return p->trace_id==lease->pool;});
    require(found!=pools.end(),"Parked source pool disappeared");auto& p=**found;const auto slot=lease->slot;
    require(!p.search->in_flight()&&slot<p.parked.size()&&!p.leases[slot]&&p.parked[slot].generation==lease->generation&&p.parked[slot].lease.lock()==lease,"Parked resume ownership mismatch");
    q->begin();
    if(q->stop_requested()||!memory_ok(*q)){
        p.search->cancel_slot(slot,lease->generation);lease->device_owned=false;
        resident_forget_parked(p,slot);q->parked_search.reset();resident_park_releases++;complete_query(q);return true;
    }
    const auto control=Clock::now();require(q->grant_end>q->expanded,"Parked resume grant did not advance");
    p.search->extend_slot(slot,lease->generation,u32(q->grant_end-q->expanded));
    lease->device_owned=false;resident_forget_parked(p,slot);q->parked_search.reset();
    // Include freeing the fallback graph in this grant's control cost. The
    // local lease reference otherwise postpones it until after elapsed().
    lease->reservation.reset();
    p.leases[slot]=q;p.lease_since[slot]=p.touched=Clock::now();
    q->resident_sample_expanded=q->gpu_expanded;q->resident_sample_ms=0;
    const double ms=elapsed(control);q->gpu_ms+=ms;q->gpu_active_ms+=ms;
    resident_park_hits++;resident_record(1,p,slot);resident_collect(p);return true;
}
bool resident_parking_drained_locked()const{
    if(!resident_park_continuations||!gpu_error.empty())return true;
    uint64_t retained=0;
    for(const auto& [token,c]:continuations)if(c.query->parked_search&&c.query->parked_search->device_owned)retained++;
    // Drain allows valid retained continuations, but waits for physical slots
    // whose tokens were released, cancelled or rejected at publication.
    return resident_parked_slots.load()==retained;
}
