// Isolated retained guided GPU service. Native Auto remains an independent peer.
// One owner mutates every CUDA pool; the input thread only publishes immutable
// roots/cancellation. Ordinary successors and priority queues never leave CUDA.
#include <cuda/atomic>
#define PS_PRODUCTION_SEARCH 1
#define PS_DEVICE_NO_MAIN 1
#include "device-runner.cu"
#include <functional>
#include <future>

#ifdef PS_SHARED_LIBRARY
#include "shared-context/library-hooks.hpp"
#endif

namespace guided_service {
int64_t integer(const J& r,const char* name,int64_t fallback,int64_t minimum,int64_t maximum){
 const auto* value=r.find(name);const int64_t n=value?value->asInteger():fallback;
 require(n>=minimum&&n<=maximum,std::string("Guided integer capacity: ")+name);return n;
}
struct Context {
 std::string policy;
 u32 handle=0;std::shared_ptr<Game> game;std::vector<std::vector<u32>> roots;
 uint64_t bytes=0;std::string unsupported;
};
struct Job {
 std::string id;std::shared_ptr<Context> context;std::vector<u32> key;
 u32 cap=0,maximum=0;bool debug=false,assigned=false;std::atomic<bool> cancelled{false};
 Clock::time_point submitted=Clock::now(),deadline,started{};uint64_t first_wave=0;
};
struct Pool {
 std::shared_ptr<Context> context;resident::Config config;std::unique_ptr<resident::Search> search;
 std::vector<std::shared_ptr<Job>> jobs;resident::Search::Metrics previous{};
 uint64_t keys=0;Clock::time_point used=Clock::now();
 bool live()const{return std::any_of(jobs.begin(),jobs.end(),[](const auto& j){return bool(j);});}
};
class Service {
 std::mutex mutex,output_mutex,info_mutex;std::condition_variable cv;
 std::unordered_map<u32,std::shared_ptr<Context>> contexts;
 std::unordered_map<std::string,std::shared_ptr<Job>> active;
 std::deque<std::shared_ptr<Job>> queued;std::deque<std::function<void()>> controls;
 std::vector<std::unique_ptr<Pool>> pools;std::unique_ptr<Device> device;
 std::unique_ptr<ByteArena> arena,pinned;std::thread driver;
 std::atomic<bool> stopping{false};std::atomic<uint64_t> wake{0};bool configured=false;
 u32 handle=0,generation=0,parents=16,pool_limit=8,pool_slots=8,node_capacity=4096,context_nodes=0,waves=4,fuel=2048,probe=256,hash_bits=64;
 std::string policy="greedy",failure;u32 weight=3;u32 peak_pools=0,peak_live_pools=0;
 bool word_specialization=true,line_compaction=true,parallel_ellipses=true,root_count_slots=false;
 uint64_t device_limit=6ull<<30,key_limit=2ull<<30,host_bytes=0;
 static constexpr uint64_t host_limit=512ull<<20,queue_limit=64ull<<20;
 uint64_t queued_bytes=0;
 J device_report;J::Object counters;
 uint64_t total_receipts=0,total_waves=0,total_metadata=0,total_cycle=0,total_export=0,total_upload=0,completed=0,admitted=0,created=0,evicted=0,peak_active=0;
 double compute_ms=0,readback_device_ms=0,upload_host_ms=0,readback_host_ms=0;
 void notify(){wake.fetch_add(1,std::memory_order_release);cv.notify_all();}
 template<class F>void control(F f){
  auto promise=std::make_shared<std::promise<void>>();auto result=promise->get_future();
  {std::lock_guard lock(mutex);controls.emplace_back([promise,f=std::move(f)]{try{f();promise->set_value();}catch(...){promise->set_exception(std::current_exception());}});}notify();result.get();
 }
 static u32 bounded(const J& r,const char* name,u32 fallback,u32 maximum){return u32(integer(r,name,fallback,1,maximum));}
 void collect(Pool& p){
  const auto m=p.search->metrics(),a=p.previous;
  total_receipts+=m.receipts-a.receipts;total_waves+=m.waves-a.waves;
  total_metadata+=m.metadata_bytes-a.metadata_bytes;total_cycle+=m.cycle_bytes-a.cycle_bytes;
  total_export+=m.export_bytes-a.export_bytes;total_upload+=m.assignment_bytes-a.assignment_bytes;
  compute_ms+=m.compute_ms-a.compute_ms;readback_device_ms+=m.metadata_device_ms-a.metadata_device_ms;
  upload_host_ms+=m.assignment_ms-a.assignment_ms;readback_host_ms+=m.readback_ms-a.readback_ms;p.previous=m;
 }
 void publish(){
  uint64_t peak;{std::lock_guard lock(mutex);peak=peak_active;}
  uint64_t keys=0,nodes=0;u32 live=0;for(const auto& p:pools){keys+=p->keys;nodes+=uint64_t(p->config.n)*p->config.capacity;live+=p->live();}
  require(keys<=key_limit,"Guided aggregate key capacity invariant");
  require(pools.size()<=pool_limit,"Guided aggregate pool capacity invariant");
  peak_pools=std::max(peak_pools,u32(pools.size()));peak_live_pools=std::max(peak_live_pools,live);
  J::Object row{{"gpu_receipts",ji(total_receipts)},{"gpu_dispatches",ji(total_waves)},{"gpu_compute_ms",J(compute_ms)},
   {"gpu_readback_device_ms",J(readback_device_ms)},{"gpu_upload_host_ms",J(upload_host_ms)},{"gpu_readback_host_ms",J(readback_host_ms)},
   {"gpu_metadata_readback_bytes",ji(total_metadata)},{"gpu_cycle_readback_bytes",ji(total_cycle)},{"gpu_explicit_export_bytes",ji(total_export)},
   {"gpu_root_upload_bytes",ji(total_upload)},{"ordinary_successor_readback_bytes",ji(0)},
   {"pool_count",ji(pools.size())},{"live_pools",ji(live)},{"peak_pool_count",ji(peak_pools)},{"peak_live_pools",ji(peak_live_pools)},{"pools_created",ji(created)},{"pool_evictions",ji(evicted)},
   {"device_bytes",ji(arena?arena->used:0)},{"peak_device_bytes",ji(arena?arena->peak:0)},{"key_bytes",ji(keys)},{"node_slots",ji(nodes)},
   {"device_reserved_bytes",ji(device_limit)},{"pinned_reserved_bytes",ji(32ull<<20)},
   {"completed",ji(completed)},{"admitted_to_gpu",ji(admitted)},{"peak_active",ji(peak)}};
  std::lock_guard lock(info_mutex);counters=std::move(row);
 }
 std::string stop_reason(const Job& j)const{if(j.cancelled.load())return "cancelled";return Clock::now()>=j.deadline?"timeout":"";}
 void complete(const std::shared_ptr<Job>& j,J::Object row,uint64_t receipts){
  row["gpu_receipts"]=ji(receipts);row["cpu_expanded"]=ji(0);row["cpu_interpreter_invocations"]=ji(0);row["gpu_fallbacks"]=ji(0);row["driver_cpu_quanta"]=ji(0);
  row["search_engine"]=J(std::string(j->context->policy=="parallel-bfs"?"device-exact-bfs":"device-guided"));row["search_mode"]=J(j->context->policy);row["shortest_path_guaranteed"]=J(j->context->policy=="parallel-bfs");
  row["ordinary_successor_readback_bytes"]=ji(0);row["elapsed_ms"]=J(elapsed(j->submitted));row["budget_spent_ms"]=J(elapsed(j->submitted));
  row["queue_ms"]=J(j->assigned?std::chrono::duration<double,std::milli>(j->started-j->submitted).count():elapsed(j->submitted));
  // Removal and publication share the output lock. A caller receiving this
  // frame may immediately unload; drain acknowledgements cannot overtake it.
  J frame(J::Object{{"event",J(std::string("completed"))},{"query",J(j->id)},{"ok",J(true)},{"report",J(std::move(row))},
   {"hardware",J(receipts!=0)},{"kernel_receipts_checked",J(receipts!=0)},{"device",device_report}});
  {std::lock_guard output(output_mutex);{std::lock_guard lock(mutex);require(active.erase(j->id)==1,"Guided completion ownership");queued_bytes-=j->key.size()*4;}
#ifdef PS_SHARED_LIBRARY
   ps_shared::emit(frame.asObject());
#else
   json(std::cout,frame);std::cout<<'\n'<<std::flush;
#endif
  }
  completed++;notify();
 }
 void unknown(const std::shared_ptr<Job>& j,const std::string& status,const std::string& detail=""){
  complete(j,{{"status",J(status)},{"detail",J(detail)},{"solution",J()},{"expanded",ji(0)},{"gpu_expanded",ji(0)},
   {"unique_states",ji(0)},{"generated",ji(0)},{"duplicates",ji(0)}},0);
 }
 void terminal(Pool& p,u32 slot){
  const auto job=p.jobs[slot];const auto& q=p.search->view(slot);
  const char* names[]={"running","unfinished","work_limit","candidate_solution","exhausted","memory_limit","cancelled","timeout","runtime_error","vacant","transferred"};
  require(q.status!=resident::Running&&q.status!=resident::Unfinished,"Guided terminal state required");
  J::Object row{{"status",J(std::string(names[q.status]))},{"detail",ji(q.detail)},{"solution",p.search->solution(slot)},
   {"expanded",ji(q.expanded)},{"gpu_expanded",ji(q.gpu_expanded)},{"generated",ji(q.generated)},{"unique_states",ji(q.count)},
   {"duplicates",ji(q.duplicates)},{"max_frontier",ji(q.max_frontier)},{"again_cycles",ji(q.cycles)},{"root_nonquiescent",J(bool(q.root_cycle))},
   {"interpreter_invocations",ji(q.invocations)},{"gpu_interpreter_invocations",ji(q.gpu_invocations)},
   {"node_capacity",ji(p.config.capacity)},{"pool_slots",ji(p.config.n)},{"context_roots",ji(p.context->roots.size())},{"logical_max_states",ji(q.max_states)},{"slot_generation",ji(q.slot_generation)}};
  row["novelty_buckets"]=ji((policy=="novelty"||policy=="novelty-tie")?resident::novelty_buckets:0);row["novelty_bytes_per_query"]=ji((policy=="novelty"||policy=="novelty-tie")?resident::novelty_words(p.context->game->l.CELL_CAP,p.context->game->l.OBJ_WORDS)*4:0);
  if(job->debug){const auto all=p.search->report(true);row=at(all,"jobs").asArray()[slot].asObject();}
  const uint64_t receipts=(uint64_t(q.receipt_round)-job->first_wave)*p.config.parents*5*2;
  collect(p);p.jobs[slot].reset();p.used=Clock::now();complete(job,std::move(row),receipts);
 }
 std::unique_ptr<Pool> plan(const std::shared_ptr<Context>& c){
  auto p=std::make_unique<Pool>();p->context=c;u32 slots=root_count_slots?u32(std::min<size_t>(pool_slots,c->roots.size())):pool_slots;
  require(slots>0,"Guided context has no roots");
  u32 capacity=context_nodes?std::min(node_capacity,context_nodes/slots):node_capacity;
  require(capacity>0,"Guided context node budget is too small");
  for(;;){
   J req(J::Object{{"batch",ji(slots)},{"nodes",ji(capacity)},{"max_expanded",ji(1000000)},
    {"parents_per_query",ji(c->policy=="parallel-bfs"?1:parents)},{"fuel",ji(fuel)},{"probe_budget",ji(probe)},{"hash_bits",ji(hash_bits)},
    {"idle_pool",J(true)},{"search_mode",J(c->policy)},{"heuristic_weight",ji(weight)},{"blocking_wait",J(true)}});
   try{p->config=resident::configuration(*c->game,req,false);}
   catch(const std::exception& e){if(slots>1){slots=std::max(1u,slots/2);continue;}if(context_nodes&&capacity>1){capacity=std::max(1u,capacity/2);continue;}throw;}
   p->config.stream_init=true;p->config.word_specialization=word_specialization;p->config.line_compaction=line_compaction;p->config.parallel_ellipses=parallel_ellipses;
   p->keys=uint64_t(slots)*p->config.capacity*p->config.kw*4;
   const bool over_share=p->config.bytes>device_limit/pool_limit||p->keys>key_limit/pool_limit;
   // Reductions never redistribute the budget again: halving width must free
   // memory. Large one-root games can then reduce depth to honor the pool share.
   if(over_share&&slots>1){slots=std::max(1u,slots/2);continue;}
   if(over_share&&context_nodes&&capacity>1){capacity=std::max(1u,capacity/2);continue;}
   if(context_nodes)require(uint64_t(slots)*capacity<=context_nodes,"Guided context node budget exceeded");
   require(p->keys<=key_limit&&p->config.bytes<=device_limit,"Guided pool exceeds declared capacity");
   p->jobs.resize(slots);return p;
  }
 }
 Pool* pool_for(const std::shared_ptr<Job>& job){
  for(const auto& p:pools)if(p->context==job->context)return p.get();
  auto p=plan(job->context);const auto allocations=resident::device_allocations(*p->context->game,p->config),pin=resident::pinned_allocations(p->config);
  auto fits=[&](){uint64_t keys=p->keys;for(const auto& a:pools)keys+=a->keys;return pools.size()<pool_limit&&keys<=key_limit&&arena->fits(allocations)&&pinned->fits(pin);};
  while(!fits()){
   auto victim=pools.end();for(auto i=pools.begin();i!=pools.end();i++)if(!(*i)->live()&&!(*i)->search->in_flight()&&(victim==pools.end()||(*i)->used<(*victim)->used))victim=i;
   if(victim==pools.end())return nullptr;collect(**victim);pools.erase(victim);evicted++;
  }
  require(generation!=0xffffffffu,"Guided pool generation overflow");++generation;
  p->search=std::make_unique<resident::Search>(*p->context->game,generation,p->config,arena.get(),pinned.get());
  collect(*p);created++;pools.push_back(std::move(p));return pools.back().get();
 }
 void dispatch(){
  // First retire completed units. Mutations always wait for the owning event;
  // other pools remain independent while a slow board continues its interpreter.
  for(auto& p:pools)if(p->search->in_flight()&&p->search->advance_ready()){p->search->retire_advance();collect(*p);}
  for(auto& p:pools)if(!p->search->in_flight())for(u32 i=0;i<p->jobs.size();i++)if(p->jobs[i]){
   auto& q=p->search->view(i);const auto reason=stop_reason(*p->jobs[i]);
   if(q.status==resident::Running&&!reason.empty())p->search->cancel(i,reason=="timeout"?resident::Timeout:resident::Cancelled);
   if(p->search->view(i).status!=resident::Running)terminal(*p,i);
  }
  std::deque<std::shared_ptr<Job>> pending;{std::lock_guard lock(mutex);pending.swap(queued);}
  for(auto& j:pending){
   auto reason=stop_reason(*j);if(!reason.empty()){unknown(j,reason);continue;}
   if(!j->context->unsupported.empty()){unknown(j,"unsupported",j->context->unsupported);continue;}
   Pool* p=nullptr;try{p=pool_for(j);}catch(const std::exception& e){const std::string error=e.what();if(error.find("capacity")==std::string::npos&&error.find("storage")==std::string::npos&&error.find("out of memory")==std::string::npos&&error.find("Arena")==std::string::npos)throw;unknown(j,"memory_limit",error);continue;}
   if(!p||p->search->in_flight()){std::lock_guard lock(mutex);queued.push_back(j);continue;}
   u32 slot=0;while(slot<p->jobs.size()&&p->jobs[slot])slot++;
   if(slot==p->jobs.size()){std::lock_guard lock(mutex);queued.push_back(j);continue;}
   if(!(reason=stop_reason(*j)).empty()){unknown(j,reason);continue;}
   auto root=j->context->game->initial;restore_key(j->context->game->l,root.data(),j->key.data());
   j->started=Clock::now();j->assigned=true;j->first_wave=p->search->metrics().waves;
   J request(J::Object{{"max_expanded",ji(j->cap)},{"grant",ji(j->cap)},{"max_states",ji(j->maximum)}});
   p->search->assign(slot,p->search->view(slot).slot_generation,root,request);p->jobs[slot]=j;p->used=Clock::now();admitted++;collect(*p);
  }
  for(auto& p:pools)if(p->live()&&!p->search->in_flight())p->search->begin_advance(waves,[](void* owner){static_cast<Service*>(owner)->notify();},this);
  publish();
 }
 void loop(){
  while(!stopping.load()){
   const auto seen=wake.load(std::memory_order_acquire);
   std::deque<std::function<void()>> tasks;{std::lock_guard lock(mutex);tasks.swap(controls);}for(auto& task:tasks)task();
   try{if(device&&failure.empty())dispatch();}
   catch(const std::exception& e){
    {std::lock_guard lock(mutex);failure=e.what();}
    std::vector<std::shared_ptr<Job>> jobs;{std::lock_guard lock(mutex);for(const auto& [id,j]:active)jobs.push_back(j);queued.clear();}
    for(const auto& j:jobs)unknown(j,"runtime_error",failure);
   }
   std::unique_lock lock(mutex);cv.wait_for(lock,std::chrono::milliseconds(1),[&]{return stopping.load()||wake.load(std::memory_order_acquire)!=seen;});
  }
 }
public:
 Service(){driver=std::thread([this]{loop();});}
 ~Service(){if(driver.joinable()){try{stop();}catch(...){stopping=true;notify();driver.join();}}}
 void write(J::Object row){std::lock_guard lock(output_mutex);
#ifdef PS_SHARED_LIBRARY
  ps_shared::emit(std::move(row));
#else
  json(std::cout,J(std::move(row)));std::cout<<'\n'<<std::flush;
#endif
 }
 J statistics(){
  J::Object r;{std::lock_guard lock(info_mutex);r=counters;}{std::lock_guard lock(mutex);r["active"]=ji(active.size());r["queued"]=ji(queued.size());r["context_count"]=ji(contexts.size());r["context_bytes"]=ji(host_bytes);r["queued_key_bytes"]=ji(queued_bytes);r["gpu_error"]=J(failure);}
  r["contexts"]=r["context_count"];r["continuations"]=ji(0);r["resident_cpu_quanta"]=ji(0);r["routing_fallbacks"]=ji(0);r["device"]=device_report;
  r["backend"]=J(std::string("guided-cuda-service"));r["search_mode"]=J(policy);r["parents_per_query"]=ji(parents);r["nodes_per_query"]=ji(node_capacity);r["nodes_per_context"]=ji(context_nodes);r["root_count_slots"]=J(root_count_slots);r["max_pool_slots"]=ji(pool_slots);r["gpu_context_limit"]=ji(pool_limit);r["host_context_limit"]=ji(32);return J(std::move(r));
 }
 void configure(const J& r){
  require(!configured,"Guided configuration is immutable");require(str(r,"mode","cuda")=="cuda","Guided service forbids CPU/software fallback");
  parents=bounded(r,"parents_per_job",16,16);pool_limit=bounded(r,"gpu_contexts",8,32);pool_slots=bounded(r,"batch",8,256);
  node_capacity=bounded(r,"nodes_per_query",4096,1000000);waves=bounded(r,"waves",4,8);fuel=bounded(r,"fuel",2048,2048);probe=bounded(r,"probe_budget",256,256);hash_bits=bounded(r,"hash_bits",64,64);
  context_nodes=u32(integer(r,"nodes_per_context",0,0,1000000));root_count_slots=flag(r,"root_count_slots",false);
  require(!context_nodes||context_nodes>=pool_slots,"Guided context node budget must cover every configured slot");
  policy=str(r,"search_mode","greedy");require(policy=="greedy"||policy=="weighted"||policy=="novelty"||policy=="novelty-tie","Guided service requires greedy/weighted/novelty/novelty-tie search");weight=bounded(r,"heuristic_weight",3,16);
  device_limit=uint64_t(bounded(r,"device_mb",6144,6144))<<20;key_limit=uint64_t(bounded(r,"key_mb",2048,2048))<<20;
  word_specialization=flag(r,"word_specialization",true);line_compaction=flag(r,"line_compaction",true);parallel_ellipses=flag(r,"parallel_ellipses",true);
  #ifdef PS_SHARED_LIBRARY
  ps_shared::validate_configuration(r);
#else
  if(auto a=r.find("affinity_mask")){auto text=a->asString();require(!text.empty()&&text.size()<=16&&text.find_first_not_of("0123456789abcdefABCDEF")==std::string::npos,"Hex affinity required");auto bits=std::stoull(text,nullptr,16);require(bits&&SetProcessAffinityMask(GetCurrentProcess(),DWORD_PTR(bits)),"Guided affinity failed");}
#endif
  const int adapter=int(integer(r,"adapter",-1,-1,2147483647));control([&,adapter]{device=std::make_unique<Device>(adapter);
#ifdef PS_SHARED_LIBRARY
   ps_shared::bind_owner();
#endif
   device_report=device->report();size_t free,total;ck(cudaMemGetInfo(&free,&total));require(device_limit+(64ull<<20)<=free,"Insufficient hardware GPU memory for guided arena");arena=std::make_unique<ByteArena>(device_limit,ByteArena::Device);pinned=std::make_unique<ByteArena>(32ull<<20,ByteArena::Pinned);publish();});configured=true;
 }
 u32 load(const J& r){
  require(configured,"Configure guided service first");
  auto c=std::make_shared<Context>();c->policy=str(r,"search_mode",policy);require(c->policy=="greedy"||c->policy=="parallel-bfs","Unsupported shared context search policy");c->game=std::make_shared<Game>(puzzlescript::json::parse(read_limited(at(r,"file").asString(),128ull<<20)));
  if(auto p=r.find("boards_file"))compact_boards(*c->game,p->asString());
  try{canonical_guard(*c->game);require(c->game->l.CELL_CAP<=512&&c->game->g[22]<=16&&c->game->l.OBJ_WORDS<=4,"Guided capacity:512 cells,16 wins,4 object words");require(key_words(c->game->l)<=resident::max_key_words,"Guided key capacity");}catch(const std::exception& e){c->unsupported=e.what();}
  for(const auto& root:c->game->roots){std::vector<u32> key(key_words(c->game->l));capture_key(c->game->l,root.data(),key.data());c->roots.push_back(std::move(key));}
  c->game->roots={c->game->initial};c->bytes=uint64_t(c->game->g.size()+c->game->initial.size()*2)*4;for(const auto& root:c->roots)c->bytes+=root.size()*4;
  {std::lock_guard lock(mutex);require(failure.empty(),"Guided GPU owner failed: "+failure);require(contexts.size()<32&&c->bytes<=host_limit-host_bytes,"Guided context storage capacity");require(handle!=0xffffffffu,"Guided handle overflow");c->handle=++handle;contexts.emplace(handle,c);host_bytes+=c->bytes;}return c->handle;
 }
 void unload(u32 id){
  std::shared_ptr<Context> c;{std::lock_guard lock(mutex);auto at=contexts.find(id);require(at!=contexts.end(),"Unknown guided handle");c=at->second;for(const auto& [name,j]:active)require(j->context!=c,"Guided context has active queries");}
  control([&,c]{for(auto i=pools.begin();i!=pools.end();)if((*i)->context==c){require(!(*i)->live()&&!(*i)->search->in_flight(),"Guided context still owned");collect(**i);i=pools.erase(i);evicted++;}else ++i;publish();});
  std::lock_guard lock(mutex);host_bytes-=c->bytes;contexts.erase(id);
 }
 void submit(const J& r){
  auto j=std::make_shared<Job>();j->id=at(r,"query").asString();require(!j->id.empty()&&j->id.size()<=256,"Guided query identity capacity");
  {std::lock_guard lock(mutex);require(failure.empty(),"Guided GPU owner failed: "+failure);auto it=contexts.find(u32(integer(r,"handle",-1,1,0xffffffffll)));require(it!=contexts.end(),"Unknown guided handle");j->context=it->second;require(active.size()<512&&!active.contains(j->id),"Guided active/identity capacity");}
  require(str(r,"executor","cuda")=="cuda","Guided service requires CUDA executor");require(!r.find("strategy")||str(r,"strategy",j->context->policy)==j->context->policy,"Guided query cannot request exact BFS or change its policy");
  require(!r.find("continuation")&&!r.find("grant")&&!r.find("resumable")&&!r.find("work_grant"),"Guided service does not expose exact-BFS continuations");
  const auto& g=*j->context->game;const u32 index=u32(integer(r,"root_index",0,0,0xffffffffll));require(index<j->context->roots.size(),"Guided root index");j->key=j->context->roots[index];
  if(auto p=r.find("objects")){auto objects=words(*p);require(objects.size()==g.l.CELL_CAP*g.l.OBJ_WORDS,"Guided object shape");for(u32 i=0;i<objects.size();i++)if(g.g[4]%32&&i%g.l.OBJ_WORDS==g.l.OBJ_WORDS-1)require(!(objects[i]&~((1u<<(g.g[4]%32))-1)),"Guided object mask");std::copy(objects.begin(),objects.end(),j->key.begin()+72);std::copy(objects.begin(),objects.end(),j->key.end()-objects.size());}
  if(auto p=r.find("rng")){auto rng=words(*p),sorted=rng;require(rng.size()==256,"Guided RNG length");std::sort(sorted.begin(),sorted.end());for(u32 i=0;i<256;i++)require(sorted[i]==i,"Guided RNG permutation");for(u32 i=0;i<64;i++)j->key[8+i]=rng[i*4]|rng[i*4+1]<<8|rng[i*4+2]<<16|rng[i*4+3]<<24;}
  j->cap=bounded(r,"max_expanded",1000000,1000000);j->maximum=bounded(r,"max_states",1000000,1000000);j->debug=flag(r,"debug_export",false);
  if(j->debug){
   require(pool_slots==1&&node_capacity<=4096,"Guided debug export requires one-slot small pools");
   // Terminal exports contain no live execution scratch. Bound decimal keys,
   // node/heap metadata and the frame before allocating a debug result. The
   // client permits16MiB; reserve ample space below that protocol ceiling.
   const uint64_t frame_bound=uint64_t(node_capacity)*(uint64_t(key_words(g.l))*11+256)+(1ull<<20);
   require(frame_bound<=8ull*1024*1024,"Guided debug JSON capacity exceeds8MiB");
  }
  const u32 timeout=bounded(r,"timeout_ms",1000,60000);j->deadline=j->submitted+std::chrono::milliseconds(timeout);
  {std::lock_guard lock(mutex);require(j->key.size()*4<=queue_limit-queued_bytes,"Guided queued root storage capacity");queued_bytes+=j->key.size()*4;active.emplace(j->id,j);queued.push_back(j);peak_active=std::max(peak_active,uint64_t(active.size()));}notify();
 }
 void cancel(const std::string& id){std::lock_guard lock(mutex);if(auto at=active.find(id);at!=active.end())at->second->cancelled=true;notify();}
 void cancel_all(){std::lock_guard lock(mutex);for(auto& [id,j]:active)j->cancelled=true;notify();}
 void drain(){
  {std::unique_lock lock(mutex);cv.wait(lock,[&]{return active.empty();});}
  // A terminal frame can reach the reader before dispatch publishes its final
  // counters. Fence the owner before acknowledging a drained statistics snapshot.
  control([&]{publish();});
 }
 void stop(){if(!driver.joinable())return;cancel_all();drain();control([&]{for(auto& p:pools){if(p->search->in_flight())try{p->search->retire_advance();}catch(...){}collect(*p);}pools.clear();publish();pinned.reset();arena.reset();device.reset();});stopping=true;notify();driver.join();}
};
bool process_line(Service& s,const std::string& line,bool overflow=false){
 std::string id;
 try{require(!overflow,"Guided request exceeds1MiB");const auto r=puzzlescript::json::parse(line);id=at(r,"id").asString();const auto op=at(r,"op").asString();J report;
  if(op=="configure"){s.configure(r);report=s.statistics();}
  else if(op=="load")report=J(J::Object{{"handle",ji(s.load(r))}});
  else if(op=="unload"){s.unload(u32(integer(r,"handle",-1,1,0xffffffffll)));report=J(J::Object{{"unloaded",J(true)}});}
  else if(op=="submit"){s.submit(r);report=J(J::Object{{"accepted",J(true)}});}
  else if(op=="cancel")s.cancel(at(r,"query").asString());
  else if(op=="cancel_all")s.cancel_all();
  else if(op=="drain"){s.drain();report=s.statistics();}
  else if(op=="info")report=s.statistics();
  else if(op=="shutdown"){s.stop();s.write({{"id",J(id)},{"ok",J(true)},{"report",s.statistics()}});return true;}
  else throw std::runtime_error("Unsupported guided service operation: "+op);
  s.write({{"id",J(id)},{"ok",J(true)},{"report",std::move(report)}});
 }catch(const std::exception& e){s.write({{"id",J(id)},{"ok",J(false)},{"error",J(std::string(e.what()))}});}
 return false;
}
int worker(){Service s;std::cout<<std::setprecision(12);for(;;){
 std::string line;bool overflow=false;char c;while(std::cin.get(c)&&c!='\n'){if(line.size()<1024*1024)line.push_back(c);else overflow=true;}if(line.empty()&&!std::cin)break;
 if(process_line(s,line,overflow))return 0;
 }
 return 0;
}
}
#ifdef PS_CUDA_ACTIVITY_TRACE
#include "activity-trace.hpp"
#endif
int main(int argc,char** argv){try{
#ifdef PS_CUDA_ACTIVITY_TRACE
 ps_activity::Recorder trace;
#endif
if(argc==2&&std::string(argv[1])=="--list-adapters")return legacy_cuda_main(argc,argv);require(argc==2&&std::string(argv[1])=="--service","Usage: puzzlescript-guided-service --service | --list-adapters");const int result=guided_service::worker();
#ifdef PS_CUDA_ACTIVITY_TRACE
 trace.finish();
#endif
 return result;}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
