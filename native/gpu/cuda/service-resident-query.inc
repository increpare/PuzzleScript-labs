// Query members. Access requires exclusive scheduler ownership, except cancelled.
bool resident_query=false,resident_eligible=true;
#include "device-parking/query-lease.inc"
std::unique_ptr<resident::Checkpoint> owned_search;
J::Object resident_result;
std::string gpu_interpreter_variant;
uint64_t resident_sample_expanded=0;
double resident_sample_ms=0;
bool resident_root_sampled=false;
void sync_resident(const resident::Query& r){
    static const char* names[]={"running","unfinished","work_limit","candidate_solution","exhausted","memory_limit","cancelled","timeout","runtime_error","vacant","transferred"};
    require(r.status!=resident::Transferred&&r.status!=resident::Vacant,"Cannot publish an unowned device query");
    resident_query=true;status=names[r.status];expanded=r.expanded;generated=r.generated;duplicates=r.duplicates;cycles=r.cycles;
    cpu_expanded=r.cpu_expanded;gpu_expanded=r.gpu_expanded;gpu_receipts=r.gpu_invocations*2;
    max_frontier=r.max_frontier;open=r.count-r.head;initialized=r.count>0;
    if(r.root_cycle||(r.status==resident::Solved&&r.winner_parent==resident::nil))open=0;
    if(r.detail)detail="Device search detail "+std::to_string(r.detail);else detail.clear();
    resident_result={{"unique_states",ji(r.count)},{"root_nonquiescent",J(bool(r.root_cycle))},{"interpreter_invocations",ji(r.invocations)},
      {"gpu_interpreter_invocations",ji(r.gpu_invocations)},{"cpu_interpreter_invocations",ji(r.cpu_invocations)},{"pending_probe",J(bool(r.probing))},
      {"partial_parent",J(r.stage==resident::Parent)},{"commit_cursor",ji(r.cursor)},{"hash_probes",ji(r.probes)}};
}
std::string resident_digest(const resident::Checkpoint* diagnostic=nullptr)const{
    require(diagnostic||bool(owned_search),"Resident digest requires a snapshot");const auto& cp=diagnostic?*diagnostic:*owned_search;const auto& r=cp.q;
    uint64_t h=14695981039346656037ull;auto byte=[&](unsigned char b){h=(h^b)*1099511628211ull;};
    auto number=[&](uint64_t v){for(int i=0;i<8;i++)byte((v>>(i*8))&255);};
    const bool solved=r.status==resident::Solved,extra=solved&&r.winner_parent!=resident::nil;
    const bool root_closed=r.root_cycle||(solved&&!extra);
    const u32 winner_id=solved?(extra?r.count:0):resident::nil;
    number(r.count>0);number(r.expanded);number(r.generated);number(r.duplicates);number(r.cycles);number(root_closed?0:r.count-r.head);number(winner_id);
    for(u32 i=0;i<r.count;i++){
        const auto& n=cp.nodes[i];number(n.parent);number(n.action);number(n.depth);number(!root_closed&&i>=r.head);number(i);number(cp.config.kw*4);
        const auto* data=reinterpret_cast<const unsigned char*>(cp.keys.data()+size_t(i)*cp.config.kw);for(u32 b=0;b<cp.config.kw*4;b++)byte(data[b]);
    }
    if(extra){number(r.winner_parent);number(r.winner_action);number(cp.nodes[r.winner_parent].depth+1);number(0);number(resident::nil);number(0);}
    if(!root_closed)for(u32 i=r.head;i<r.count;i++)number(i);
    std::ostringstream out;out<<std::hex<<std::setw(16)<<std::setfill('0')<<h;return out.str();
}
