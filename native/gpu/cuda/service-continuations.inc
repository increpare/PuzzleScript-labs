// Service members: single-use operation continuations, owned by the scheduler
// lock. A grant ends only after all actions of its last accepted parent settle.
// GPU slots are released after the retain fence before publication, so no
// paused query depends on a shape pool or an outstanding device continuation.
struct RetainedQuery {std::shared_ptr<Query> query;uint64_t bytes=0;};
std::unordered_map<std::string,RetainedQuery> continuations;
uint64_t continuation_bytes=0,continuation_serial=0;
u32 continuation_capacity=128;
uint64_t continuation_limit=512ull*1024*1024;

bool context_retained(const std::shared_ptr<Context>& c)const{
    return std::any_of(continuations.begin(),continuations.end(),[&](const auto& e){return e.second.query->context==c;});
}
void assign_owner_locked(Query& q){
    const int previous=q.owner;
#ifdef PS_DEVICE_SERVICE
    if(gpu_engine=="resident"&&!q.resident_eligible){q.owner=1;return;}
#endif
    if(q.pinned_executor)q.owner=q.pinned_executor;else if(mode=="cpu")q.owner=1;else if(mode=="cuda")q.owner=2;
    else if(q.initial_executor)q.owner=q.initial_executor;
    else{u32 cpu=0,gpu=0;for(const auto& [key,other]:active)if(other.get()!=&q){cpu+=other->owner==1;gpu+=other->owner==2&&other->context==q.context;}
        q.owner=initial_owner(q,cpu,gpu);if(q.owner==2)routing_gpu_admissions++;
    }
    if(previous&&previous!=q.owner){q.migrations++;q.last_migration=Clock::now();}
}
void resume(const J& req,const std::string& request_id){
    std::lock_guard<std::mutex> lock(mutex);
    require(gpu_error.empty(),"GPU service failed: "+gpu_error);
    auto token=at(req,"continuation").asString();auto found=continuations.find(token);
    require(found!=continuations.end(),"Continuation unavailable or already consumed");
    auto q=found->second.query;
    for(const char* key:{"objects","rng","handle","root_index","strategy","weight","hash_bits","max_expanded","max_states","memory_mb","budget","timeout_ms","include_queue_time","trace","resumable"})require(!req.find(key),"Resume cannot change search identity or lifetime bounds");
    auto name=at(req,"query").asString();require(!name.empty()&&name.size()<=128,"Query identifier capacity");
    require(!identifiers.contains(name),"Duplicate query identifier");require(identifiers.size()<1000000&&active.size()<2048,"Service query capacity");
    u32 grant=num(req,"work_grant",0);require(grant&&grant<=1000000,"Work grant 1..1000000 required");
    auto executor=str(req,"executor",q->pinned_executor==1?"cpu":q->pinned_executor==2?"cuda":"auto");
    require(executor=="auto"||executor=="cpu"||executor=="cuda","Unknown requested executor");
    int pin=executor=="cpu"?1:executor=="cuda"?2:0;
    auto initial=str(req,"initial_executor","auto");require(initial=="auto"||initial=="cpu"||initial=="cuda","Unknown initial executor");
    int hint=initial=="cpu"?1:initial=="cuda"?2:0;
    require(!pin||!hint,"Use either an executor pin or an initial placement hint");
    require(!(mode=="cpu"&&(pin==2||hint==2))&&!(mode=="cuda"&&(pin==1||hint==1)),"Requested executor unavailable in configured mode");
#ifdef PS_DEVICE_SERVICE
    if(gpu_engine=="resident"&&!q->resident_eligible)require(pin!=2&&hint!=2,"Resident GPU supports untraced BFS only; use CPU for this query");
#endif
    continuation_bytes-=found->second.bytes;continuations.erase(found);
    q->id=std::move(name);identifiers.insert(q->id);q->ticket=++serial;require(serial!=0,"Query ticket overflow");
    q->status="running";q->detail.clear();q->finishing=false;q->grants++;q->resumes++;
    q->grant_end=u32(std::min(uint64_t(q->cap),q->expanded+grant));q->pinned_executor=pin;q->initial_executor=hint;
#ifdef PS_DEVICE_SERVICE
    if(q->owned_search)q->owned_search->extend(grant);
#endif
    active.emplace(q->id,q);assign_owner_locked(*q);
    reply(request_id,{{"query",J(q->id)},{"ticket",ji(q->ticket)}});
    ready.push_back(q);if(active.size()>1)overlap_submissions++;
    cv.notify_all();gpu_cv.notify_one();
}
J release_continuation(const J& req,bool cancel){
    std::lock_guard<std::mutex> lock(mutex);auto i=continuations.find(at(req,"continuation").asString());
    J::Object result{{"found",J(i!=continuations.end())}};
    if(i!=continuations.end()){
        auto q=i->second.query;continuation_bytes-=i->second.bytes;continuations.erase(i);
        if(cancel){q->status="cancelled";q->detail="Cancelled while retained";result["report"]=q->report();}
        gpu_cv.notify_one();
    }
    return J(std::move(result));
}
