// Service members. The scheduler lock protects ownership/publication only.
// Key/container accounting and JSON construction run under exclusive Query
// ownership, outside the shared ready-queue lock.
std::string completion_locking="publish";
std::atomic<uint64_t> completion_wait_ns{0},completion_locked_ns{0},completion_report_ns{0},completion_encode_ns{0},cpu_take_wait_ns{0};
static uint64_t nanoseconds(Clock::time_point t){return uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now()-t).count());}
struct CompletionGuard {
    Service& service;std::unique_lock<std::mutex> lock;Clock::time_point acquired;
    CompletionGuard(Service& s):service(s),lock(s.mutex,std::defer_lock){auto t=Clock::now();lock.lock();service.completion_wait_ns+=nanoseconds(t);acquired=Clock::now();}
    ~CompletionGuard(){service.completion_locked_ns+=nanoseconds(acquired);}
};
J::Object completion_event(const Query& q,J::Object report){
    report["peak_rss_bytes"]=ji(gpu_memory::peak_rss_bytes());
    J::Object event{{"event",J(std::string("completed"))},{"query",J(q.id)},{"ticket",ji(q.ticket)},{"ok",J(true)},{"report",J(std::move(report))},
      {"hardware",J(q.gpu_receipts!=0)},{"kernel_receipts_checked",J(q.gpu_receipts!=0)}};
    if(q.gpu_receipts&&selected)event["device"]=selected->report();return event;
}
void completed_locked(const Query& q){require(active.erase(q.id)==1,"Duplicate terminal event");completed++;cv.notify_all();gpu_cv.notify_one();}
void complete_query_legacy(const std::shared_ptr<Query>& q){
    CompletionGuard lock(*this);q->finishing=true;q->stop_requested();std::string token;
    if(q->status=="unfinished"){
        require(q->resumable,"Unfinished nonresumable query");for(const auto& n:q->nodes)require(n.slot==0xffffffffu,"Retained query still owns a GPU slot");
        auto bytes=q->retained_bytes();
        if(continuations.size()>=continuation_capacity||bytes>continuation_limit-continuation_bytes){q->status="resource_limit";q->detail="Continuation retention capacity";}
        else{token="c"+std::to_string(++continuation_serial);require(continuation_serial!=0,"Continuation token overflow");continuations.emplace(token,RetainedQuery{q,bytes});continuation_bytes+=bytes;}
    }
    auto t=Clock::now();auto report=q->report().asObject();completion_report_ns+=nanoseconds(t);auto event=completion_event(*q,std::move(report));if(!token.empty())event["continuation"]=J(token);
    t=Clock::now();auto frame=encode(std::move(event));completion_encode_ns+=nanoseconds(t);write_frame(frame);completed_locked(*q);
}
void complete_query(const std::shared_ptr<Query>& q){
    if(completion_locking=="legacy"){complete_query_legacy(q);return;}
    std::string token;bool unfinished;
    {CompletionGuard lock(*this);q->finishing=true;q->stop_requested();unfinished=q->status=="unfinished";
        if(unfinished){token="c"+std::to_string(++continuation_serial);require(continuation_serial!=0,"Continuation token overflow");}}
    // No token is installed yet, so even a guessed token cannot resume a Query
    // whose previous event is still being built. Cancellation remains atomic.
    auto t=Clock::now();uint64_t bytes=0;
    if(unfinished){require(q->resumable,"Unfinished nonresumable query");for(const auto& n:q->nodes)require(n.slot==0xffffffffu,"Retained query still owns a GPU slot");bytes=q->retained_bytes();}
    auto report=q->report(bytes).asObject();completion_report_ns+=nanoseconds(t);
    t=Clock::now();std::string normal,resource,cancelled;
    if(unfinished){
        auto limited=report;limited["status"]=J(std::string("resource_limit"));limited["detail"]=J(std::string("Continuation retention capacity"));resource=encode(completion_event(*q,std::move(limited)));
        auto stopped=report;stopped["status"]=J(std::string("cancelled"));stopped["detail"]=J(std::string("Cancelled while completing grant"));cancelled=encode(completion_event(*q,std::move(stopped)));
    }
    auto event=completion_event(*q,std::move(report));if(unfinished)event["continuation"]=J(token);normal=encode(std::move(event));completion_encode_ns+=nanoseconds(t);
    {CompletionGuard lock(*this);
        const std::string* frame=&normal;
        if(unfinished){
            // cancel_all/stop may arrive during report construction. Never
            // publish a fresh retained token after their cancellation boundary.
            if(q->cancelled){q->status="cancelled";q->detail="Cancelled while completing grant";frame=&cancelled;}
            else if(continuations.size()>=continuation_capacity||bytes>continuation_limit-continuation_bytes){q->status="resource_limit";q->detail="Continuation retention capacity";frame=&resource;}
            else{continuations.emplace(token,RetainedQuery{q,bytes});continuation_bytes+=bytes;}
        }
        // Token installation, the already-encoded event and active removal are
        // atomic relative to resume. No Query access follows this publication.
        write_frame(*frame);completed_locked(*q);
    }
}
