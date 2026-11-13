// Host BFS/visited/path management; gameplay runs only through core.cuh.
#include "host-key.hpp"
using Key=std::vector<u32>;
template<class K>std::string identity(const K& k){return {reinterpret_cast<const char*>(k.data()),k.size()*4};}
struct CycleHistory {
 std::unordered_set<std::string>seen;std::deque<std::string>ring;
 bool repeated(std::string id){if(!seen.insert(id).second)return true;ring.push_back(std::move(id));if(ring.size()>1024){seen.erase(ring.front());ring.pop_front();}return false;}
};
struct CpuExecutor {
 const Game&g;std::vector<u32>s,cache;Runtime r{};u32 epoch=0;uint64_t operations=0;Clock::time_point deadline=Clock::time_point::max();const std::atomic<bool>* cancelled=nullptr;
 CpuExecutor(const Game&g):g(g),s(g.l.STATE_WORDS),cache((g.l.CELL_CAP+1)*g.l.OBJ_WORDS+g.l.MOV_WORDS){static_cast<Layout&>(r)=g.l;r.game=g.g.data();r.sparse_metadata=g.sparse;r.states=s.data();r.line_objects=cache.data();}
 Key capture(){Key k(key_words(g.l));capture_key(g.l,s.data(),k.data());return k;}
 void op(u32 action){require(++epoch!=0,"Epoch overflow");u32 dispatch=0;do{if(Clock::now()>=deadline||(cancelled&&cancelled->load()))throw DeadlineExpired();r.run(action,epoch,2048|0x80000000u);require(++dispatch<=100000,"CPU turn continuation limit");}while(!r.rd(1));require(r.rd(1)==1,"CPU interpreter failure "+std::to_string(r.rd(1)));operations++;}
 bool settle(){std::unique_ptr<CycleHistory>history;for(u32 tick=0;s[4]&&!s[5];tick++){require(tick<10000,"AGAIN step limit");if(tick>=64){if(!history)history=std::make_unique<CycleHistory>();if(history->repeated(identity(capture())))return true;}op(5);}return false;}
 Key root(const std::vector<u32>&initial,bool&cyclic){s=initial;r.states=s.data();epoch=0;op(8);cyclic=settle();return capture();}
 Key step(const Key&key,u32 action,bool&cyclic){restore_key(g.l,s.data(),key.data());epoch=0;op(action);cyclic=settle();return capture();}
};
void canonical_guard(const Game&g){
 require(g.g[29]==0,"Search rejects audio rows: canonicalize the source first");for(u32 i=0;i<21;i++)require(g.g[g.g[28]+i]==0xffffffffu,"Search rejects audio events");
 for(u32 r=0;r<g.g[9];r++){u32 p=g.g[14]+r*8;require(!(g.g[p+3]&~23u),"Search rejects checkpoint/message/sfx commands: canonicalize first");}
}
struct Node{Key key;u32 parent=0xffffffffu,action=0,slot=0xffffffffu;const std::string* retained_key=nullptr;};
struct Search {
 size_t job;std::vector<Node>nodes;std::deque<u32>frontier;std::unordered_set<std::string,WordHash,std::equal_to<>>visited;std::string status="running",executor;
 uint64_t expanded=0,generated=0,duplicates=0,cycles=0,gpu_expanded=0,cpu_expanded=0;u32 max_frontier=0,winner=0xffffffffu;
 Search(size_t job,std::string executor,unsigned hashBits=64):job(job),visited(0,WordHash{hashBits}),executor(std::move(executor)){}
 void root(Key key,bool cyclic){nodes.push_back({executor=="cuda"?Key{}:key});auto [it,added]=visited.emplace(std::string_view(reinterpret_cast<const char*>(key.data()),key.size()*4));nodes[0].retained_key=&*it;if(key[1]){status="candidate_solution";winner=0;}else if(cyclic){status="again_cycle";}else frontier.push_back(0);max_frontier=u32(frontier.size());}
 template<class K>void child(K&&key,u32 parent,u32 action,bool cyclic,u32 max_states,u32 slot=0xffffffffu){generated++;if(cyclic){cycles++;return;}if(key[1]){nodes.push_back({Key{},parent,action,slot});winner=u32(nodes.size()-1);status="candidate_solution";return;}std::string_view id(reinterpret_cast<const char*>(key.data()),key.size()*4);if(visited.find(id)!=visited.end()){duplicates++;return;}if(visited.size()>=max_states){status="memory_limit";return;}auto [it,added]=visited.emplace(id);Key stored;if(executor!="cuda"){if constexpr(std::is_same_v<std::remove_cvref_t<K>,Key>)stored=std::move(key);else stored.assign(key.begin(),key.end());}nodes.push_back({std::move(stored),parent,action,slot,&*it});frontier.push_back(u32(nodes.size()-1));max_frontier=std::max(max_frontier,u32(frontier.size()));}
 void finish(u32 cap){if(status!="running")return;if(frontier.empty())status="exhausted";else if(expanded>=cap)status="work_limit";}
 J report()const {J::Array path;const char*tokens[]={"up","left","down","right","action"};std::vector<u32>reverse;if(winner!=0xffffffffu)for(u32 p=winner;nodes[p].parent!=0xffffffffu;p=nodes[p].parent)reverse.push_back(nodes[p].action);for(auto i=reverse.rbegin();i!=reverse.rend();i++)path.emplace_back(std::string(tokens[*i]));return J(J::Object{{"job_index",ji(job)},{"executor",J(executor)},{"status",J(status)},{"solution",status=="candidate_solution"?J(std::move(path)):J()},{"expanded",ji(expanded)},{"gpu_expanded",ji(gpu_expanded)},{"cpu_expanded",ji(cpu_expanded)},{"generated",ji(generated)},{"duplicates",ji(duplicates)},{"unique_states",ji(visited.size())},{"max_frontier",ji(max_frontier)},{"again_cycles",ji(cycles)}});}
};
__global__ void restore_pool(Layout l,u32*s,const u32*pool,const u32*slots,u32 n){u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i<n&&slots[i]!=0xffffffffu)restore_key(l,s+size_t(i)*l.STATE_WORDS,pool+size_t(slots[i])*key_words(l));}
__global__ void pack_states(Layout l,const u32*s,u32*keys,u32 n){u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i<n)capture_key(l,s+size_t(i)*l.STATE_WORDS,keys+size_t(i)*key_words(l));}
__global__ void retain_keys(u32*pool,const u32*keys,const u32*slots,u32 kw,u32 n){u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i<n&&slots[i]!=0xffffffffu)for(u32 w=0;w<kw;w++)pool[size_t(slots[i])*kw+w]=keys[size_t(i)*kw+w];}
struct GpuSearch {
 const Game&g;u32 lanes,kw,capacity;Gpu gpu;DevMem<u32>pool,keys,slots;HostPinned<u32> host_keys;std::vector<u32>free;uint64_t copies=0,physical_successors=0;double key_upload=0,key_readback=0,key_compute=0,host_decode_ms=0;Clock::time_point deadline=Clock::time_point::max();
 GpuSearch(const Game&g,u32 lanes,u32 capacity,bool cooperative=true):g(g),lanes(lanes),kw(key_words(g.l)),capacity(capacity),gpu(g,lanes,cooperative),pool(size_t(capacity)*kw),keys(size_t(lanes)*kw),slots(lanes),host_keys(size_t(lanes)*kw){for(u32 i=capacity;i>0;i--)free.push_back(i-1);}
 u32 alloc(){require(!free.empty(),"Device frontier capacity exceeded");u32 s=free.back();free.pop_back();return s;}
 void release(u32 slot){if(slot!=0xffffffffu)free.push_back(slot);}
 void reset_request(){free.clear();for(u32 i=capacity;i>0;i--)free.push_back(i-1);copies=0;physical_successors=0;key_upload=0;key_readback=0;key_compute=0;host_decode_ms=0;gpu.compute=0;gpu.upload=0;gpu.readback=0;gpu.dispatches=0;gpu.board_invocations=0;gpu.peak_active_lanes=0;std::fill(gpu.expected_receipts.begin(),gpu.expected_receipts.end(),0);ck(cudaMemset(gpu.receipts.p,0,gpu.n*4));deadline=Clock::time_point::max();}
 void root_to_pool(const Key&key,u32 slot){auto t=Clock::now();ck(cudaMemcpy(pool.p+size_t(slot)*kw,key.data(),kw*4,cudaMemcpyHostToDevice));key_upload+=elapsed(t);}
 template<class F>void kernel(F f){ck(cudaEventRecord(gpu.begin));f();ck(cudaGetLastError());ck(cudaEventRecord(gpu.end));ck(cudaEventSynchronize(gpu.end));float d=0;ck(cudaEventElapsedTime(&d,gpu.begin,gpu.end));key_compute+=d;copies++;}
 std::vector<KeyView> expand(const std::vector<u32>&parent,const std::vector<u32>&actions,std::vector<bool>&cyclic){
  u32 active=u32(actions.size());physical_successors+=active;auto t=Clock::now();ck(cudaMemcpy(slots.p,parent.data(),active*4,cudaMemcpyHostToDevice));key_upload+=elapsed(t);kernel([&]{restore_pool<<<(active+31)/32,32>>>(g.l,gpu.s.p,pool.p,slots.p,active);});
  gpu.operation(actions,1,2048|0x80000000u,100000,deadline);u32*packed=host_keys.p;std::vector<KeyView>result(active);std::vector<u32>next(active,0xffffffffu);cyclic.assign(active,false);std::vector<std::unique_ptr<CycleHistory>>histories(active);
  for(u32 tick=0;;tick++){
   kernel([&]{pack_states<<<(active+31)/32,32>>>(g.l,gpu.s.p,keys.p,active);});t=Clock::now();ck(cudaMemcpy(packed,keys.p,size_t(active)*kw*4,cudaMemcpyDeviceToHost));key_readback+=elapsed(t);auto decode=Clock::now();bool pending=false;
   for(u32 i=0;i<active;i++){if(actions[i]==0xffffffffu||cyclic[i])continue;result[i]=KeyView(packed+size_t(i)*kw,kw);next[i]=0xffffffffu;if(!result[i][0]||result[i][1])continue;require(tick<10000,"CUDA AGAIN step limit");if(tick>=64){if(!histories[i])histories[i]=std::make_unique<CycleHistory>();if(histories[i]->repeated(identity(result[i]))){cyclic[i]=true;continue;}}next[i]=5;pending=true;}
   host_decode_ms+=elapsed(decode);if(!pending)break;gpu.operation(next,tick+2,2048|0x80000000u,100000,deadline);
  }
  return result;
 }
 void retain(const std::vector<u32>&dest){u32 active=u32(dest.size());auto t=Clock::now();ck(cudaMemcpy(slots.p,dest.data(),active*4,cudaMemcpyHostToDevice));key_upload+=elapsed(t);kernel([&]{retain_keys<<<(active+31)/32,32>>>(pool.p,keys.p,slots.p,kw,active);});}
};
struct DriverCache {
 const Game*game=nullptr;std::unique_ptr<Device>device;std::unique_ptr<GpuSearch>driver;
 void clear_driver(){driver.reset();game=nullptr;}
};
// Device roots also execute on CUDA; CPU root work never seeds CUDA search.
std::vector<Key> cuda_roots(GpuSearch&driver,const Game&g,std::vector<bool>&cycles){std::vector<Key>result;cycles.assign(g.roots.size(),false);for(size_t offset=0;offset<g.roots.size();offset+=driver.lanes){u32 take=u32(std::min(size_t(driver.lanes),g.roots.size()-offset));std::vector<u32>data(size_t(take)*g.l.STATE_WORDS),actions(take,0xffffffffu);for(u32 i=0;i<take;i++){std::copy(g.roots[offset+i].begin(),g.roots[offset+i].end(),data.begin()+size_t(i)*g.l.STATE_WORDS);actions[i]=8;}driver.gpu.load(data);driver.gpu.operation(actions,1,2048|0x80000000u,100000);
 std::vector<u32>packed(size_t(take)*driver.kw);std::vector<u32>next(take,0xffffffffu);std::vector<std::unordered_set<std::string>>seen(take);std::vector<std::deque<std::string>>ring(take);
 for(u32 tick=0;;tick++){driver.kernel([&]{pack_states<<<(take+31)/32,32>>>(g.l,driver.gpu.s.p,driver.keys.p,take);});auto t=Clock::now();ck(cudaMemcpy(packed.data(),driver.keys.p,packed.size()*4,cudaMemcpyDeviceToHost));driver.key_readback+=elapsed(t);bool pending=false;for(u32 i=0;i<take;i++){next[i]=0xffffffffu;Key k(packed.begin()+size_t(i)*driver.kw,packed.begin()+size_t(i+1)*driver.kw);if(cycles[offset+i]||!k[0]||k[1])continue;require(tick<10000,"Root AGAIN limit");if(tick>=64){auto id=identity(k);if(!seen[i].insert(id).second){cycles[offset+i]=true;continue;}ring[i].push_back(id);if(ring[i].size()>1024){seen[i].erase(ring[i].front());ring[i].pop_front();}}next[i]=5;pending=true;}if(!pending)break;driver.gpu.operation(next,tick+2,2048|0x80000000u,100000);}
 for(u32 i=0;i<take;i++)result.emplace_back(packed.begin()+size_t(i)*driver.kw,packed.begin()+size_t(i+1)*driver.kw);
 }return result;}
J search(const Game&g,const J&req,DriverCache*cache=nullptr){
 canonical_guard(g);std::string mode=str(req,"mode","cuda");require(mode=="cpu"||mode=="cuda"||mode=="hybrid","Search mode cpu/cuda/hybrid required");u32 budget=num(req,"threads",8),hashBits=num(req,"hash_bits",64),cpuQuantum=num(req,"cpu_quantum",64),prefetch=num(req,"prefetch",4),parallel=num(req,"batch",32),parentsPerJob=num(req,"parents_per_job",32),cap=num(req,"max_expanded",1000),maxStates=num(req,"max_states",65536),poolCapacity=num(req,"pool_capacity",262144),wall=num(req,"timeout_ms",60000);require(cpuQuantum&&cpuQuantum<=4096&&prefetch&&prefetch<=16&&hashBits&&hashBits<=64&&budget&&budget<=16&&parallel&&parallel<=256&&parentsPerJob&&parentsPerJob<=128&&uint64_t(parallel)*parentsPerJob*5<=65536&&cap&&cap<=1000000&&maxStates&&maxStates<=1000000&&poolCapacity>=parallel*5&&poolCapacity<=1048576&&wall&&wall<=600000,"Invalid search bounds");require(mode!="hybrid"||budget>=2,"Hybrid needs at least two CPU slots (driver included)");
 const auto setup=Clock::now();std::unique_ptr<Device>ownedDevice;std::unique_ptr<GpuSearch>ownedDriver;Device*device=nullptr;GpuSearch*driver=nullptr;bool deviceReused=false,driverReused=false;
 if(mode!="cpu"){
  int adapter=num(req,"adapter",-1);require(adapter>=-1,"Adapter must be -1 or a CUDA index");bool cooperative=flag(req,"cooperative",true);u32 lanes=parallel*parentsPerJob*5;
  if(cache){
   if(cache->device&&adapter>=0&&cache->device->id!=adapter){cache->clear_driver();cache->device.reset();}
   deviceReused=bool(cache->device);if(!cache->device)cache->device=std::make_unique<Device>(adapter);device=cache->device.get();
   if(cache->driver&&cache->game==&g&&cache->driver->lanes==lanes&&cache->driver->capacity==poolCapacity&&cache->driver->gpu.cooperative==cooperative){driverReused=true;cache->driver->reset_request();}
   else{cache->clear_driver();cache->driver=std::make_unique<GpuSearch>(g,lanes,poolCapacity,cooperative);cache->game=&g;}
   driver=cache->driver.get();
  }else{ownedDevice=std::make_unique<Device>(adapter);device=ownedDevice.get();ownedDriver=std::make_unique<GpuSearch>(g,lanes,poolCapacity,cooperative);driver=ownedDriver.get();}
 }
 std::vector<u32>actions{3,0,2,1};if(!(g.g[11]&16))actions.push_back(4);
 // Prepare all roots on the selected executor before the common search clock.
 std::vector<Key>roots;std::vector<bool>rootCycles;if(driver)roots=cuda_roots(*driver,g,rootCycles);else{CpuExecutor e(g);for(auto&s:g.roots){bool cycle=false;roots.push_back(e.root(s,cycle));rootCycles.push_back(cycle);}}
 u32 cpuWorkers=mode=="cpu"?budget:mode=="hybrid"?budget-1:0;
 std::unique_ptr<CpuExecutor>driverCpu;if(mode=="hybrid")driverCpu=std::make_unique<CpuExecutor>(g);
 std::vector<std::unique_ptr<CpuExecutor>>executors;for(u32 i=0;i<cpuWorkers;i++)executors.push_back(std::make_unique<CpuExecutor>(g));
 std::vector<std::unique_ptr<Search>>jobs(g.roots.size());std::atomic<size_t>next{0};std::atomic<bool>startGate{false},abort{false};std::exception_ptr error;std::mutex errorMutex;std::mutex readyMutex;std::condition_variable readyCv;std::deque<std::unique_ptr<Search>>cpuReady;std::atomic<u32>idleWorkers{0},pendingCpu{0};bool gpuFinished=mode=="cpu";u32 handoffs=0;double handoffMs=0;
 auto claim=[&](){return next.fetch_add(1);};std::vector<std::unique_ptr<Search>>active;
 auto admit=[&](){while(active.size()<parallel){size_t j=claim();if(j>=roots.size())break;auto s=std::make_unique<Search>(j,"cuda",hashBits);s->root(roots[j],rootCycles[j]);if(s->status=="running"){s->nodes[0].slot=driver->alloc();driver->root_to_pool(roots[j],s->nodes[0].slot);active.push_back(std::move(s));}else jobs[j]=std::move(s);}};
 if(driver)admit();double setupMs=elapsed(setup);auto start=Clock::now();auto deadline=start+std::chrono::milliseconds(wall);if(driver)driver->deadline=deadline;for(auto&e:executors)e->deadline=deadline;if(driverCpu)driverCpu->deadline=deadline;double initialInterpreter=driver?driver->gpu.compute:0,initialKeyCompute=driver?driver->key_compute:0;double initialCompute=driver?driver->gpu.compute+driver->key_compute:0,initialUpload=driver?driver->gpu.upload+driver->key_upload:0,initialRead=driver?driver->gpu.readback+driver->key_readback:0;uint64_t initialDispatches=driver?driver->gpu.dispatches:0,initialInvocations=driver?driver->gpu.board_invocations:0;if(driver)driver->gpu.peak_active_lanes=0;


 double ingestMs=0,prepareMs=0;
 auto runCpu=[&](std::unique_ptr<Search>s,CpuExecutor&e){
  try{
   for(u32 work=0;work<cpuQuantum&&s->status=="running";work++){
    if(Clock::now()>=deadline){s->status="timeout";break;}
    u32 parent=s->frontier.front();s->frontier.pop_front();s->expanded++;s->cpu_expanded++;
    for(u32 action:actions){bool cycle=false;Key key=e.step(s->nodes[parent].key,action,cycle);if(Clock::now()>=deadline)throw DeadlineExpired();s->child(std::move(key),parent,action,cycle,maxStates);if(s->status!="running")break;}
    s->nodes[parent].key.clear();s->finish(cap);
   }
  }catch(const DeadlineExpired&){s->status="timeout";}
  if(s->status=="running"){std::lock_guard<std::mutex>lock(readyMutex);cpuReady.push_back(std::move(s));}
  else{jobs[s->job]=std::move(s);pendingCpu--;}
  readyCv.notify_all();
 };
 std::vector<std::thread>workers;
 for(u32 w=0;w<cpuWorkers;w++)workers.emplace_back([&,w]{
  try{
   auto&e=*executors[w];while(!startGate.load())std::this_thread::yield();
   while(!abort.load()){
    if(Clock::now()>=deadline)break;std::unique_ptr<Search>s;size_t j=claim();
    if(j<roots.size()){pendingCpu++;s=std::make_unique<Search>(j,"cpu",hashBits);s->root(roots[j],rootCycles[j]);}
    else{
     std::unique_lock<std::mutex>lock(readyMutex);idleWorkers++;
     readyCv.wait_until(lock,deadline,[&]{return !cpuReady.empty()||(gpuFinished&&pendingCpu.load()==0)||abort.load();});idleWorkers--;
     if(!cpuReady.empty()){s=std::move(cpuReady.front());cpuReady.pop_front();}else break;
    }
    runCpu(std::move(s),e);
   }
  }catch(...){std::lock_guard<std::mutex>lock(errorMutex);error=std::current_exception();abort=true;readyCv.notify_all();}
 });

 startGate=true;try{if(driver){while(!active.empty()&&!abort){if(Clock::now()>=deadline){for(auto&s:active)s->status="timeout";break;}
  if(mode=="hybrid"&&flag(req,"steal",true)&&next.load()>=roots.size()){
   auto handoffStart=Clock::now();u32 available=idleWorkers.load()*prefetch;{std::lock_guard<std::mutex>lock(readyMutex);u32 maximum=cpuWorkers*prefetch;available=std::min(available,maximum>cpuReady.size()?maximum-u32(cpuReady.size()):0u);}
   while(available>0&&!active.empty()){available--;
    auto chosen=std::min_element(active.begin(),active.end(),[](const auto&a,const auto&b){return a->frontier.size()<b->frontier.size();});
    auto search=std::move(*chosen);active.erase(chosen);
    // unordered_set rehash invalidates iterators, never references to keys.
    // Copy only the live frontier when ownership changes; visited/path stay put.
    for(u32 index:search->frontier){auto&node=search->nodes[index];require(node.retained_key!=nullptr,"Missing retained frontier key");const auto&record=*node.retained_key;node.key.resize(record.size()/4);std::memcpy(node.key.data(),record.data(),record.size());if(Clock::now()>=deadline){search->status="timeout";break;}}
    for(auto&node:search->nodes){driver->release(node.slot);node.slot=0xffffffffu;}
    search->executor="cuda+cpu";
    {std::lock_guard<std::mutex>lock(readyMutex);pendingCpu++;cpuReady.push_back(std::move(search));}
    handoffs++;
   }
   handoffMs+=elapsed(handoffStart);readyCv.notify_all();if(active.empty())break;
  }
  auto prepareStart=Clock::now();struct Parent{Search*s;u32 index,lane;};std::vector<Parent>parents;std::vector<u32>slots,ops;u32 lane=0;
  for(auto&s:active){u32 count=std::min({parentsPerJob,u32(s->frontier.size()),cap-u32(s->expanded)});for(u32 q=0;q<count;q++){u32 p=s->frontier.front();s->frontier.pop_front();parents.push_back({s.get(),p,lane});for(u32 a:actions){slots.push_back(s->nodes[p].slot);ops.push_back(a);lane++;}}}std::vector<u32>dest(lane,0xffffffffu);
  prepareMs+=elapsed(prepareStart);std::vector<bool>cycles;auto keys=driver->expand(slots,ops,cycles);if(Clock::now()>=deadline)throw DeadlineExpired();
  auto ingestStart=Clock::now();
  // Parents can be recycled only after all their children have been captured.
  for(auto&p:parents){driver->release(p.s->nodes[p.index].slot);p.s->nodes[p.index].slot=0xffffffffu;}
  for(auto&p:parents){auto&s=*p.s;if(s.status!="running")continue;s.expanded++;s.gpu_expanded++;for(u32 a=0;a<actions.size()&&s.status=="running";a++){u32 i=p.lane+a;size_t before=s.nodes.size();s.child(std::move(keys[i]),p.index,actions[a],cycles[i],maxStates);if(s.nodes.size()>before&&s.status=="running"){if(driver->free.empty()){s.status="memory_limit";break;}u32 slot=driver->alloc();s.nodes.back().slot=slot;dest[i]=slot;}}s.nodes[p.index].key.clear();}for(auto&s:active)s->finish(cap);
  ingestMs+=elapsed(ingestStart);driver->retain(dest);
  for(auto i=active.begin();i!=active.end();){if((*i)->status!="running"){for(auto&node:(*i)->nodes)driver->release(node.slot);jobs[(*i)->job]=std::move(*i);i=active.erase(i);}else ++i;}admit();
 }} }catch(const DeadlineExpired&){for(auto&s:active)s->status="timeout";}catch(...){std::lock_guard<std::mutex>lock(errorMutex);error=std::current_exception();abort=true;}
 {std::lock_guard<std::mutex>lock(readyMutex);gpuFinished=true;}readyCv.notify_all();
 if(driverCpu&&!abort.load())try{
  while(Clock::now()<deadline&&!abort.load()){
   std::unique_ptr<Search>s;{
    std::unique_lock<std::mutex>lock(readyMutex);readyCv.wait_until(lock,deadline,[&]{return !cpuReady.empty()||pendingCpu.load()==0||abort.load();});
    if(cpuReady.empty())break;s=std::move(cpuReady.front());cpuReady.pop_front();
   }runCpu(std::move(s),*driverCpu);
  }
 }catch(...){std::lock_guard<std::mutex>lock(errorMutex);error=std::current_exception();abort=true;readyCv.notify_all();}
 for(auto&w:workers)w.join();for(auto&s:cpuReady){s->status="timeout";jobs[s->job]=std::move(s);}if(error)std::rethrow_exception(error);for(auto&s:active)jobs[s->job]=std::move(s);
 double searchMs=elapsed(start);J::Array rows;uint64_t expanded=0,gpu_expanded=0,cpu_expanded=0,generated=0,solved=0,finite=0,missing=0;for(size_t j=0;j<jobs.size();j++){if(!jobs[j]){jobs[j]=std::make_unique<Search>(j,"unassigned");jobs[j]->status="not_started";missing++;}auto&s=*jobs[j];expanded+=s.expanded;gpu_expanded+=s.gpu_expanded;cpu_expanded+=s.cpu_expanded;generated+=s.generated;solved+=s.status=="candidate_solution";finite+=s.status=="candidate_solution"||s.status=="exhausted";rows.push_back(s.report());}
 J::Object report{{"task",J(std::string("search"))},{"mode",J(mode)},{"cpu_budget",ji(budget)},{"cpu_workers",ji(cpuWorkers)},{"gpu_to_cpu_handoffs",ji(handoffs)},{"handoff_ms",J(handoffMs)},{"gpu_driver_slots",ji(driver?1:0)},{"device_reused",J(deviceReused)},{"driver_reused",J(driverReused)},{"batch",ji(parallel)},{"parents_per_job",ji(parentsPerJob)},{"setup_ms",J(setupMs)},{"search_ms",J(searchMs)},{"timeout_ms",ji(wall)},{"max_expanded",ji(cap)},{"max_states_per_job",ji(maxStates)},{"pool_capacity",ji(poolCapacity)},{"key_bytes",ji(key_words(g.l)*4)},{"gpu_expanded",ji(gpu_expanded)},{"cpu_expanded",ji(cpu_expanded)},{"cpu_quantum",ji(cpuQuantum)},{"prefetch",ji(prefetch)},{"expanded",ji(expanded)},{"generated",ji(generated)},{"solved",ji(solved)},{"finite",ji(finite)},{"not_started",ji(missing)},{"jobs",J(std::move(rows))}};
 if(driver){report["device"]=device->report();report["compute_ms"]=J(driver->gpu.compute+driver->key_compute-initialCompute);report["upload_ms"]=J(driver->gpu.upload+driver->key_upload-initialUpload);report["readback_ms"]=J(driver->gpu.readback+driver->key_readback-initialRead);report["interpreter_dispatches"]=ji(driver->gpu.dispatches-initialDispatches);report["key_dispatches"]=ji(driver->copies);report["host_decode_ms"]=J(driver->host_decode_ms);report["host_ingest_ms"]=J(ingestMs);report["host_prepare_ms"]=J(prepareMs);report["interpreter_ms"]=J(driver->gpu.compute-initialInterpreter);report["key_kernels_ms"]=J(driver->key_compute-initialKeyCompute);report["physical_successors"]=ji(driver->physical_successors);report["peak_active_lanes"]=ji(driver->gpu.peak_active_lanes);report["interpreter_board_invocations"]=ji(driver->gpu.board_invocations-initialInvocations);report["device_allocated_bytes"]=ji((driver->gpu.g.n+driver->gpu.s.n+driver->gpu.cache.n+driver->gpu.status.n+driver->gpu.ops.n+driver->gpu.receipts.n+driver->pool.n+driver->keys.n+driver->slots.n)*4);report["kernel_receipts_checked"]=J(true);report["executed_kernel"]=J(std::string(driver->gpu.cooperative?"warp-cooperative":"scalar"));}return J(std::move(report));
}

J probe(const Game&g,const J&req){
 canonical_guard(g);std::string mode=str(req,"mode","cuda");require(mode=="cpu"||mode=="cuda","Probe mode cpu/cuda required");
 std::vector<u32>actions{3,0,2,1};if(!(g.g[11]&16))actions.push_back(4);J::Array rows;
 std::unique_ptr<Device>device;std::unique_ptr<GpuSearch>driver;std::vector<Key>roots;std::vector<bool>rootCycles;
 if(mode=="cuda"){device=std::make_unique<Device>(num(req,"adapter",-1));driver=std::make_unique<GpuSearch>(g,160,4096);roots=cuda_roots(*driver,g,rootCycles);}else{CpuExecutor e(g);for(auto&s:g.roots){bool c=false;roots.push_back(e.root(s,c));rootCycles.push_back(c);}}
 CpuExecutor e(g);
 for(size_t j=0;j<roots.size();j++){J::Array children,cycles;std::vector<Key>ownedKeys;std::vector<KeyView>keys;std::vector<bool>cyclic;
  if(driver){u32 slot=driver->alloc();driver->root_to_pool(roots[j],slot);keys=driver->expand(std::vector<u32>(actions.size(),slot),actions,cyclic);driver->release(slot);}else{for(u32 a:actions){bool c=false;ownedKeys.push_back(e.step(roots[j],a,c));cyclic.push_back(c);}}
  if(!driver)for(auto&key:ownedKeys)keys.emplace_back(key);for(size_t i=0;i<keys.size();i++){children.push_back(arr(keys[i].data(),keys[i].size()));cycles.emplace_back(bool(cyclic[i]));}
  rows.emplace_back(J::Object{{"job_index",ji(j)},{"root_key",arr(roots[j].data(),roots[j].size())},{"root_nonquiescent",J(bool(rootCycles[j]))},{"probe_keys",J(std::move(children))},{"probe_cycles",J(std::move(cycles))}});
 }
 J::Object r{{"task",J(std::string("probe"))},{"mode",J(mode)},{"key_format",J(std::string("PSCK1"))},{"jobs",J(std::move(rows))}};if(device){r["device"]=device->report();r["kernel_receipts_checked"]=J(true);}return J(std::move(r));
}
