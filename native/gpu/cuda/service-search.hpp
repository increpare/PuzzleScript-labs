#pragma once
#include "native-policy.hpp"
#include "routing-policy.hpp"
#include <queue>
#include <unordered_map>
#include <functional>

namespace continuous {
struct Context {
    u32 handle=0;
    std::shared_ptr<Game> game;
    std::shared_ptr<NativePolicyGame> native;
    std::vector<Key> roots;
#ifdef PS_DEVICE_SERVICE
    std::shared_ptr<const resident::RuleData> resident_rules;
#endif
    uint64_t bytes=0;
    std::atomic<double> cpu_parent_ms{0.03},gpu_parent_ms{0.01};
    std::atomic<double> cpu_root_ms{0.05},gpu_root_latency_ms{2.0},gpu_parent_latency_ms{1.0};
    std::atomic<unsigned> gpu_root_samples{0},gpu_latency_samples{0};
    std::atomic<unsigned> gpu_probe_attempts{0},gpu_censored_samples{0};
};
struct PolicyEntry {u32 depth=0,node=0;};
struct PolicyKey {std::string bytes;uint64_t hash;};
struct PolicyProbe {std::string_view bytes;uint64_t hash;};
struct PolicyHash {
    using is_transparent=void;unsigned bits=64;
    size_t select(uint64_t h)const noexcept{return size_t(bits==64?h:h&((uint64_t(1)<<bits)-1));}
    size_t operator()(const PolicyKey& k)const noexcept{return select(k.hash);}
    size_t operator()(PolicyProbe k)const noexcept{return select(k.hash);}
};
struct PolicyEqual {
    using is_transparent=void;
    bool operator()(const PolicyKey& a,const PolicyKey& b)const noexcept{return a.bytes==b.bytes;}
    bool operator()(const PolicyKey& a,PolicyProbe b)const noexcept{return a.bytes==b.bytes;}
    bool operator()(PolicyProbe a,const PolicyKey& b)const noexcept{return a.bytes==b.bytes;}
};
struct SearchNode {
    const std::string* key=nullptr;
    PolicyEntry* best=nullptr;
    u32 parent=0xffffffffu,action=0,depth=0,slot=0xffffffffu;
    bool open=false;
};
struct QueueEntry {
    int64_t priority=0;u32 node=0;
    bool operator>(const QueueEntry& b)const{return priority!=b.priority?priority>b.priority:node>b.node;}
};
struct Query {
    std::shared_ptr<Context> context;
    std::string id,strategy,status="running",detail;
    uint64_t ticket=0;
    Clock::time_point submitted=Clock::now(),started{},deadline,last_migration{};
    std::atomic<bool> cancelled{false};
    int owner=0; // 0 unclaimed, 1 CPU, 2 GPU; only the ready-queue lock transfers ownership.
    int pinned_executor=0;
    int initial_executor=0; // One placement hint; unlike a pin, safe fallback is allowed.
    bool initialized=false,has_started=false,finishing=false;
    bool include_queue_time=true;
    bool execution_budget=false;
    u32 timeout_ms=60000;
    u32 cap=1000,max_states=65536,weight=2,open=0,winner=0xffffffffu;
    bool resumable=false,digest_enabled=false;
    u32 grant_end=1000;
    uint64_t grants=1,resumes=0;
    uint64_t memory_limit=256ull*1024*1024;
    std::vector<u32> pristine;
    std::vector<SearchNode> nodes;
    std::unordered_map<PolicyKey,PolicyEntry,PolicyHash,PolicyEqual> visited;
    std::deque<u32> fifo;
    using Heap=std::priority_queue<QueueEntry,std::vector<QueueEntry>,std::greater<QueueEntry>>;
    Heap heaps[3];
    std::shared_ptr<NativePolicyContext> heuristic;
    std::vector<u32> released;
    uint64_t expanded=0,generated=0,duplicates=0,cycles=0,cpu_expanded=0,gpu_expanded=0,reopened=0,stale=0,migrations=0,gpu_receipts=0,driver_cpu_quanta=0;
    u32 max_frontier=0;
    double cpu_ms=0,gpu_ms=0,gpu_active_ms=0,heuristic_ms=0,first_queue_ms=0;
    double gpu_root_ready_ms=-1,gpu_first_submit_ms=-1,gpu_first_expand_ms=-1;
    bool latency_routing=false,gpu_return_cpu=false,gpu_abort_chunk=false,gpu_promotion_denied=false;
    unsigned cpu_latency_samples=0,gpu_fallbacks=0;
    double cpu_parent_latency_ms=0;
    uint64_t gpu_aborted_parents=0,gpu_aborted_roots=0;
    bool trace_enabled=false;uint64_t trace_bytes=0;J::Array trace;
#ifdef PS_DEVICE_SERVICE
    #include "service-resident-query.inc"
#endif
    Query(unsigned bits):visited(0,PolicyHash{bits}){}
    bool expired()const{return Clock::now()>=deadline;}
    bool stop_requested(){if(cancelled){status="cancelled";return true;}if(expired()){status="timeout";return true;}return status!="running";}
    void begin(){if(!has_started){has_started=true;started=Clock::now();first_queue_ms=elapsed(submitted);if(!include_queue_time)deadline=started+std::chrono::milliseconds(timeout_ms);}if(execution_budget){auto remaining=std::max(0.0,double(timeout_ms)-cpu_ms-gpu_active_ms);deadline=Clock::now()+std::chrono::microseconds(int64_t(remaining*1000));}}
    double cpu_chunk_cost(u32 parents)const{
        double recent=cpu_latency_samples?cpu_parent_latency_ms:context->cpu_parent_ms.load();
        return parents?LatencyRouting::parent_cost(recent,cpu_ms,cpu_expanded)*parents:context->cpu_root_ms.load();
    }
    bool yield_gpu(double residence,u32 parents)const{
        const double cpu_equivalent=cpu_chunk_cost(u32(gpu_expanded)+parents)+((!initialized||gpu_root_ready_ms>=0)?context->cpu_root_ms.load():0.0);
        return latency_routing&&!pinned_executor&&strategy=="bfs"&&!gpu_fallbacks&&LatencyRouting::fallback(gpu_active_ms+residence,cpu_equivalent,timeout_ms);
    }
    void restore_bfs_prefix(const std::vector<u32>& prefix){
        require(strategy=="bfs","Only BFS parent prefixes can be returned before commit");
        for(auto i=prefix.rbegin();i!=prefix.rend();++i){auto& node=nodes.at(*i);require(!node.open&&node.best->node==*i,"Invalid uncommitted parent ownership");node.open=true;open++;fifo.push_front(*i);}
    }
    Key key(u32 index)const{const auto& bytes=*nodes.at(index).key;Key k(bytes.size()/4);std::memcpy(k.data(),bytes.data(),bytes.size());return k;}
    void push(u32 index,int32_t score){
        nodes[index].open=true;open++;max_frontier=std::max(max_frontier,open);
        auto depth=nodes[index].depth;
        if(strategy=="bfs")fifo.push_back(index);
        else if(strategy=="portfolio"){
            heaps[0].push({int64_t(depth)+2ll*score,index});
            heaps[1].push({int64_t(depth),index});heaps[2].push({int64_t(score),index});
        }else heaps[0].push({strategy=="greedy"?int64_t(score):int64_t(depth)+int64_t(weight)*score,index});
    }
    u32 pop(){
        for(;;){
            u32 index;
            if(strategy=="bfs"){if(fifo.empty())return 0xffffffffu;index=fifo.front();fifo.pop_front();}
            else{auto& heap=heaps[strategy=="portfolio"?(expanded/8)%3:0];if(heap.empty()){require(open==0,"Priority queue lost live nodes");return 0xffffffffu;}index=heap.top().node;heap.pop();}
            auto& node=nodes[index];if(!node.open||node.best->node!=index){stale++;continue;}
            node.open=false;open--;return index;
        }
    }
    int32_t score(const u32* objects){if(!heuristic)return 0;auto t=Clock::now();auto result=native_policy_score(*heuristic,objects);heuristic_ms+=elapsed(t);return result;}
    void observe(KeyView key,u32 parent,u32 action,bool cyclic){if(!trace_enabled)return;trace_bytes+=key.size_bytes();require(trace.size()<1024&&trace_bytes<=2*1024*1024,"Query trace capacity exceeded");trace.emplace_back(J::Object{{"parent",ji(parent)},{"action",ji(action)},{"cycle",J(cyclic)},{"key",arr(key.data(),key.size())},{"score",J(int64_t(score(key.data()+72)))}});}
    void root(KeyView key,bool cyclic,const std::shared_ptr<NativePolicyGame>& policy){
        initialized=true;
        auto bytes=identity(key);auto hash=WordHash{}(bytes);
        auto [it,inserted]=visited.emplace(PolicyKey{std::move(bytes),hash},PolicyEntry{0,0});
        nodes.push_back({&it->first.bytes,&it->second});
        if(strategy!="bfs"){require(bool(policy),"Native Auto ordering requires an IR at load");heuristic=native_policy_context(policy,key.data()+72);}
        observe(key,0xffffffffu,8,cyclic);
        if(key[1]){winner=0;status="candidate_solution";}
        else if(cyclic){cycles++;status="exhausted";detail="proven_autonomous_cycle_at_load";}
        else push(0,score(key.data()+72));
    }
    u32 child(KeyView key,u32 parent,u32 action,bool cyclic,uint64_t hash=0,bool prehashed=false){
        observe(key,parent,action,cyclic);generated++;if(cyclic){cycles++;return 0xffffffffu;}
        u32 depth=nodes[parent].depth+1;
        if(key[1]){winner=u32(nodes.size());nodes.push_back({nullptr,nullptr,parent,action,depth});status="candidate_solution";return 0xffffffffu;}
        auto bytes=std::string_view(reinterpret_cast<const char*>(key.data()),key.size_bytes());
        if(!prehashed)hash=WordHash{}(bytes);
        auto found=visited.find(PolicyProbe{bytes,hash});
        if(found!=visited.end()&&(strategy=="bfs"||found->second.depth<=depth)){duplicates++;return 0xffffffffu;}
        uint64_t estimate=(uint64_t(visited.size())+1)*(key.size_bytes()+128)+(uint64_t(nodes.size())+1)*(sizeof(SearchNode)+48);
        if((found==visited.end()&&visited.size()>=max_states)||nodes.size()>=1000000||estimate>memory_limit){status="memory_limit";return 0xffffffffu;}
        u32 index=u32(nodes.size());
        if(found==visited.end())found=visited.emplace(PolicyKey{std::string(bytes),hash},PolicyEntry{depth,index}).first;
        else{auto& old=nodes[found->second.node];if(old.open){old.open=false;open--;}if(old.slot!=0xffffffffu){released.push_back(old.slot);old.slot=0xffffffffu;}found->second={depth,index};reopened++;}
        nodes.push_back({&found->first.bytes,&found->second,parent,action,depth});push(index,score(key.data()+72));return index;
    }
    void finish_quantum(){if(status!="running")return;if(!open)status="exhausted";else if(expanded>=cap)status="work_limit";else if(resumable&&expanded>=grant_end)status="unfinished";}
    uint64_t retained_bytes()const{
        // Conservative accounted storage, including container overhead/slack.
        uint64_t bytes=sizeof(Query)+pristine.capacity()*4+nodes.capacity()*sizeof(SearchNode)+visited.bucket_count()*sizeof(void*)+fifo.size()*8+trace_bytes*16+trace.size()*2048;
        for(const auto& [k,v]:visited)bytes+=k.bytes.capacity()+sizeof(PolicyKey)+sizeof(PolicyEntry)+64;
        if(strategy!="bfs")bytes+=nodes.capacity()*sizeof(QueueEntry)*6;
        bytes+=released.capacity()*4+id.capacity()+strategy.capacity()+detail.capacity()+4096;
#ifdef PS_DEVICE_SERVICE
        if(owned_search)bytes+=owned_search->bytes();
        if(parked_search)bytes+=parked_search->reserved_bytes;
#endif
        return bytes;
    }
    std::string search_digest()const{
#ifdef PS_DEVICE_SERVICE
        if(parked_search)return parked_search->digest;
        if(owned_search)return resident_digest();
        if(resident_query)return {}; // A rejected snapshot has no exact digest.
#endif
        // Diagnostic only: ordered node keys/parent metadata and logical queues.
        // Physical executor, slots, elapsed time and hash bucket order are absent.
        uint64_t h=14695981039346656037ull;
        auto byte=[&](unsigned char b){h=(h^b)*1099511628211ull;};
        auto number=[&](uint64_t v){for(int i=0;i<8;i++)byte((v>>(i*8))&255);};
        number(initialized);number(expanded);number(generated);number(duplicates);number(cycles);number(open);number(winner);
        for(const auto& n:nodes){number(n.parent);number(n.action);number(n.depth);number(n.open);number(n.best?n.best->node:0xffffffffu);number(n.key?n.key->size():0);if(n.key)for(unsigned char b:*n.key)byte(b);}
        for(auto n:fifo)if(nodes[n].open&&nodes[n].best->node==n)number(n);
        for(auto heap:heaps)while(!heap.empty()){auto e=heap.top();heap.pop();if(nodes[e.node].open&&nodes[e.node].best->node==e.node){number(e.node);number(uint64_t(e.priority));}}
        std::ostringstream out;out<<std::hex<<std::setw(16)<<std::setfill('0')<<h;return out.str();
    }
    J report(uint64_t retained_estimate=0)const{
        J::Array path;std::vector<u32> reverse;const char* tokens[]={"up","left","down","right","action"};
        if(winner!=0xffffffffu)for(u32 p=winner;nodes[p].parent!=0xffffffffu;p=nodes[p].parent)reverse.push_back(nodes[p].action);
        for(auto p=reverse.rbegin();p!=reverse.rend();p++)path.emplace_back(std::string(tokens[*p]));
        // Deadlines include queueing, level-start rules and all continuation work.
        J::Object result{{"status",J(status)},{"detail",J(detail)},{"solution",status=="candidate_solution"?J(std::move(path)):J()},
          {"strategy",J(strategy)},{"heuristic",J(std::string(strategy=="bfs"?"zero":"native-auto"))},{"expanded",ji(expanded)},{"generated",ji(generated)},{"unique_states",ji(visited.size())},
          {"resumable",J(resumable)},{"grants",ji(grants)},{"resumes",ji(resumes)},{"grant_end",ji(grant_end)},{"retained_bytes",ji(retained_estimate?retained_estimate:retained_bytes())},{"search_digest",J(digest_enabled?search_digest():std::string())},
          {"duplicates",ji(duplicates)},{"again_cycles",ji(cycles)},{"max_frontier",ji(max_frontier)},{"cpu_expanded",ji(cpu_expanded)},{"gpu_expanded",ji(gpu_expanded)},
          {"root_nonquiescent",J(initialized&&detail=="proven_autonomous_cycle_at_load")},
          {"driver_cpu_quanta",ji(driver_cpu_quanta)},
          {"gpu_root_ready_ms",J(gpu_root_ready_ms)},{"gpu_first_submit_ms",J(gpu_first_submit_ms)},{"gpu_first_expand_ms",J(gpu_first_expand_ms)},
          {"reopened",ji(reopened)},{"stale",ji(stale)},{"migrations",ji(migrations)},{"gpu_receipts",ji(gpu_receipts)},{"elapsed_ms",J(elapsed(submitted))},{"queue_ms",J(first_queue_ms)},
          {"gpu_fallbacks",ji(gpu_fallbacks)},{"gpu_aborted_parents",ji(gpu_aborted_parents)},{"gpu_aborted_roots",ji(gpu_aborted_roots)},{"gpu_promotion_denied",J(gpu_promotion_denied)},
          {"cpu_parent_latency_ms",J(cpu_parent_latency_ms)},
          {"gpu_parent_latency_ms",J(context->gpu_parent_latency_ms.load())},{"gpu_root_latency_ms",J(context->gpu_root_latency_ms.load())},
          {"gpu_latency_samples",ji(context->gpu_latency_samples.load())},
          {"active_elapsed_ms",J(has_started?elapsed(started):0.0)},{"includes_queue_time",J(include_queue_time)},{"budget",J(std::string(execution_budget?"execution":"wall"))},{"budget_spent_ms",J(cpu_ms+gpu_active_ms)},{"trace",J(trace)},
          {"cpu_ms",J(cpu_ms)},{"gpu_ms",J(gpu_ms)},{"heuristic_ms",J(heuristic_ms)}};
#ifdef PS_DEVICE_SERVICE
        if(resident_query){
            auto r=owned_search?owned_search->report().asObject():resident_result;
            for(const char* k:{"solution","unique_states","root_nonquiescent","interpreter_invocations","gpu_interpreter_invocations","cpu_interpreter_invocations","pending_probe","partial_parent","commit_cursor","hash_probes"})if(auto i=r.find(k);i!=r.end())result[k]=i->second;
            if(status!="candidate_solution")result["solution"]=J();
            result["search_engine"]=J(std::string("device-resident"));
            result["ordinary_successor_readback_bytes"]=ji(0);
            result["checkpoint_owned"]=J(bool(owned_search)||bool(parked_search));
            result["checkpoint_location"]=J(std::string(parked_search?(parked_search->device_owned?"device":"host"):owned_search?"host":"none"));
            if(parked_search){const double deferred=parked_search->materialize_ms.load();result["gpu_ms"]=J(gpu_ms+deferred);result["budget_spent_ms"]=J(cpu_ms+gpu_active_ms+deferred);}
            result["logical_max_states"]=ji(max_states);
            if(!gpu_interpreter_variant.empty())result["gpu_interpreter_variant"]=J(gpu_interpreter_variant);
        }
#endif
        return J(std::move(result));
    }
};
}
