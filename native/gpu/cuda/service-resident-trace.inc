// Diagnostic only. Call on the single GPU owner, outside scheduler/stats locks,
// and only after a pool's pending unit is retired. No board/state reads occur.
void resident_record(u32 reason,const ResidentPool& p,u32 slot=resident::nil,const Query* peer=nullptr){
    if(!resident_trace_capacity)return;
    require(!p.search->in_flight(),"Cannot trace mutable pending pool metadata");
    const auto* q=slot<p.leases.size()?p.leases[slot].get():nullptr;
    resident::Query r;if(q)r=p.search->view(slot);
    std::scoped_lock lock(mutex,stats_mutex);
    if(resident_trace.size()==resident_trace_capacity){resident_trace_dropped++;return;}
    u32 total=0,same=0,fit=0;
    for(const auto& candidate:ready)if(candidate->resident_eligible&&candidate->owner==2&&!candidate->cancelled){
        total++;if(candidate->context==p.context&&candidate->visited.hash_function().bits==p.bits){same++;fit+=resident_accepted_count(*candidate)<p.nodes;}
    }
    resident_trace.push_back({elapsed(resident_trace_started),q?elapsed(p.lease_since[slot]):0.0,q?q->ticket:0,peer?peer->ticket:0,p.trace_id,
        p.context->handle,peer?peer->context->handle:0,reason,slot,u32(p.leases.size()),p.nodes,q?r.count:0,q?u32(r.expanded):0,q?r.status:resident::Vacant,q?r.stage:resident::NeedRoot,total,same,fit});
}
J resident_schedule_trace(){
    std::lock_guard lock(stats_mutex);J::Array rows;
    for(const auto& r:resident_trace)rows.emplace_back(J::Array{J(r.at_ms),J(r.age_ms),ji(r.ticket),ji(r.peer),ji(r.pool),ji(r.context),ji(r.peer_context),ji(r.reason),ji(r.slot),ji(r.slots),ji(r.nodes),ji(r.count),ji(r.expanded),ji(r.status),ji(r.stage),ji(r.ready),ji(r.ready_same),ji(r.ready_fit)});
    J::Array columns;for(const auto* c:{"at_ms","lease_ms","ticket","peer_ticket","pool","context","peer_context","reason","slot","slots","node_capacity","accepted","expanded","status","stage","ready_gpu","ready_same","ready_fit"})columns.emplace_back(std::string(c));
    return J(J::Object{{"capacity",ji(resident_trace_capacity)},{"dropped",ji(resident_trace_dropped)},{"columns",J(std::move(columns))},{"rows",J(std::move(rows))},
      {"reasons",J(J::Object{{"1",J(std::string("admit"))},{"2",J(std::string("complete"))},{"3",J(std::string("physical_recovery"))},{"4",J(std::string("slot_preempt"))},{"5",J(std::string("pool_rotate"))},{"8",J(std::string("budget_evict"))},{"9",J(std::string("fragment_evict"))},{"10",J(std::string("unload"))},{"11",J(std::string("digest_export"))},{"12",J(std::string("grant_export"))},{"13",J(std::string("cpu_yield"))}})},
      {"scope",J(std::string("Bounded host scheduling metadata;no gameplay/key readback. Dropped events are explicit. Diagnostic overhead is not ordinary throughput."))}});
}
