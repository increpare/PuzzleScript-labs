#include "core.cuh"
#include "../cpp/memory.hpp"
#include "runtime/json.hpp"
#include <cuda_runtime.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <condition_variable>
#include <numeric>
#include <sstream>
#include <thread>
#include <vector>
#include <deque>
#include <unordered_set>
#include <iomanip>
#include <limits>
using namespace ps_cuda;
using J=puzzlescript::json::Value;
using Clock=std::chrono::steady_clock;
struct DeadlineExpired:std::exception{const char*what()const noexcept override{return "deadline";}};
double elapsed(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
void require(bool b,const std::string& m){if(!b)throw std::runtime_error(m);}
void require(bool b,const char* m){if(!b)throw std::runtime_error(m);}
void ck(cudaError_t e){if(e!=cudaSuccess)throw std::runtime_error(std::string("CUDA: ")+cudaGetErrorString(e));}
std::string read(const std::string& p){std::ifstream f(p,std::ios::binary);require(bool(f),"Cannot open "+p);return {std::istreambuf_iterator<char>(f),{}};}
const J& at(const J& j,const char* k){auto p=j.find(k);require(p!=nullptr,std::string("Missing ")+k);return *p;}
bool flag(const J&j,const char*k,bool d){auto p=j.find(k);return p?p->asBool():d;}
int num(const J& j,const char* k,int d){auto p=j.find(k);if(!p)return d;auto n=p->asInteger();require(n>=std::numeric_limits<int>::min()&&n<=std::numeric_limits<int>::max(),std::string("Integer option overflow: ")+k);return int(n);}
std::string str(const J& j,const char* k,std::string d){auto p=j.find(k);return p?p->asString():d;}
J ji(uint64_t n){return J(int64_t(n));}
J arr(const u32* p,size_t n){J::Array a;for(size_t i=0;i<n;i++)a.emplace_back(int64_t(p[i]));return J(std::move(a));}
std::vector<u32> words(const J& j){std::vector<u32> r;require(j.asArray().size()<=32*1024*1024,"Input exceeds 128 MiB");for(auto&v:j.asArray()){auto n=v.asInteger();require(n>=0&&uint64_t(n)<=0xffffffffu,"Not a u32");r.push_back(u32(n));}return r;}
void json(std::ostream& o,const J& j){
 if(j.isNull())o<<"null";else if(j.isBool())o<<(j.asBool()?"true":"false");else if(j.isInteger())o<<j.asInteger();else if(j.isDouble())o<<j.asDouble();
 else if(j.isString()){o<<'"';for(unsigned char c:j.asString()){if(c=='"'||c=='\\')o<<'\\'<<c;else if(c<32){const char*h="0123456789abcdef";o<<"\\u00"<<h[c>>4]<<h[c&15];}else o<<c;}o<<'"';}
 else if(j.isArray()){o<<'[';bool first=true;for(auto&v:j.asArray()){if(!first)o<<',';first=false;json(o,v);}o<<']';}
 else{o<<'{';bool first=true;for(auto&[k,v]:j.asObject()){if(!first)o<<',';first=false;json(o,J(k));o<<':';json(o,v);}o<<'}';}
}
#include "sparse.hpp"
struct Game {
 std::vector<u32> g,initial,ops;std::vector<std::vector<u32>> roots;std::vector<std::string> symbols;Layout l{};Params sparse{};
 explicit Game(const J& j){
 require(at(j,"format").asString()=="puzzlescript-gpu-v2"&&at(j,"authority").asString()=="5a94bde1a5127a3a45306ea28598eba2874d446d","Expected V2 pinned vanilla game");
 g=words(at(j,"game"));require(g.size()>=32&&g[0]==2,"Invalid header");
 for(auto&v:at(j,"symbols").asArray())symbols.push_back(v.asString());
 require(!symbols.empty()&&symbols.size()<=65536&&symbols[0].empty(),"Invalid symbols");
 require(g[1]&&g[2]&&uint64_t(g[1])*g[2]<=16384&&g[3]&&g[3]<=320&&g[4]&&g[4]<=1024&&g[6]<=1&&g[7]<=4096&&g[8]<=g[7]&&g[9]<=65536&&g[10]<=1048576&&!(g[11]&~31u)&&g[20]<=g[9]*16&&g[22]<=1024,"Game capacity exceeded");
 require(g[23]==(g[4]+31)/32&&g[24]==(g[3]+4)/5&&g[25]&&g[25]<=16384&&g[26]&&g[26]<=4194304&&g[27]&&g[27]<=16&&g[29]<=65536&&g[30]&&g[30]<=16384,"Stride/storage capacity exceeded");
 l.OBJ_WORDS=g[23];l.MOV_WORDS=g[24];l.CELL_CAP=g[1]*g[2];l.HISTORY_CAP=g[25];l.MATCH_CAP=g[26];l.ROW_CAP=g[27];l.SOUND_CAP=u32(symbols.size());l.EFFECT_CAP=g[30];
 uint64_t end=32;
 auto section=[&](u32 slot,u32 count,u32 stride){require(g[slot]==end,"Invalid section order");end+=uint64_t(count)*stride;require(end<=g.size(),"Section out of bounds");};
 section(12,g[3],g[23]);section(13,g[7],4);section(14,g[9],8);section(15,g[20],4);section(16,g[10],18);section(17,32,1);section(21,g[22],5);
 for(u32 r=0;r<g[9];r++){u32 p=g[14]+r*8;require(g[p+7]==end&&end<g.size()&&g[end]<=64,"Command bounds");u32 count=g[end];require(end+1+count*2<=g.size(),"Command bounds");u32 bits=0;for(u32 i=0;i<count;i++){u32 q=u32(end)+1+i*2;require(g[q]<=16&&g[q+1]<symbols.size(),"Command/symbol unsupported");bits|=1u<<g[q];}require(bits==g[p+3],"Command bitset mismatch");end+=1+count*2;}
 section(28,g[29],5);end+=21;require(end<=g.size()&&g[31]==end,"Mask arena bounds");
 auto mask=[&](u32 p,u32 n){require(p>=end&&uint64_t(p)+n<=g.size(),"Mask out of bounds");};mask(g[5],g[23]);
 for(u32 i=0;i<g[29];i++){u32 p=g[28]+i*5;require(g[p]<=3&&g[p+1]<g[3]&&g[p+4]<symbols.size(),"Invalid audio row");mask(g[p+2],g[23]);mask(g[p+3],g[24]);}
 for(u32 p=g[28]+g[29]*5;p<end;p++)require(g[p]==0xffffffffu||g[p]<symbols.size(),"Invalid sound symbol");
 for(u32 r=0;r<g[9];r++){u32 p=g[14]+r*8;require((g[p]==0||g[p]==1||g[p]==2||g[p]==4||g[p]==8)&&g[p+2]&&g[p+2]<=g[27]&&uint64_t(g[p+1])+g[p+2]<=g[20]&&!(g[p+3]&~0x1ffffu)&&g[p+4]<=31&&g[p+5]<=1,"Invalid rule");}
 for(u32 c=0;c<g[10];c++){u32 p=g[16]+c*18;if(g[p+17]==1)continue;require(g[p+4]<=4&&g[p+9]<=1&&g[p+17]==0,"Invalid cell");for(int k:{0,1,5,6,7,8,10,11,15})mask(g[p+k],g[23]);for(int k:{2,3,12,13,14,16})mask(g[p+k],g[24]);}
 for(u32 r=0;r<g[20];r++){u32 p=g[15]+r*4;require(g[p+1]&&g[p+1]<=64&&uint64_t(g[p])+g[p+1]<=g[10]&&g[p+2]<=2,"Invalid row");mask(g[p+3],g[23]);u32 ellipses=0;for(u32 c=0;c<g[p+1];c++)ellipses+=g[g[16]+(g[p]+c)*18+17]!=0;require(ellipses==g[p+2],"Ellipsis count mismatch");for(u32 w=0;w<g[23];w++){u32 bits=0;for(u32 i=0;i<g[p+1];i++){u32 c=g[16]+(g[p]+i)*18;if(!g[c+17])bits|=g[g[c]+w];}require(bits==g[g[p+3]+w],"Invalid row pruning certificate");}}
 for(u32 i=0;i<g[7];i++){u32 p=g[13]+i*4;require(g[p+1]&&uint64_t(g[p])+g[p+1]<=g[9]&&g[p+2]<=1&&(g[p+3]==0xffffffffu||(g[p+3]<g[7]&&(g[p+3]>=g[8])==(i>=g[8]))),"Invalid rule group");}
 for(u32 slot:{18u,19u})require(g[slot]==0xffffffffu||(g[slot]>=(slot==18?0:g[8])&&g[slot]<(slot==18?g[8]:g[7])),"Invalid loop");
 for(u32 o=0;o<32;o++)require(g[g[17]+o]==0xffffffffu||g[g[17]+o]<g[8],"Invalid rigid map");
 for(u32 i=0;i<g[22];i++){u32 p=g[21]+i*5;require(g[p]<=2&&g[p+3]<=1&&g[p+4]<=1,"Invalid win");mask(g[p+1],g[23]);mask(g[p+2],g[23]);}
 u32 os=l.CELL_CAP*l.OBJ_WORDS,ms=l.CELL_CAP*l.MOV_WORDS;
 uint64_t next=384;l.RNG_DATA=128;l.BOARD=384;
 auto alloc=[&](u32& field,uint64_t count){field=u32(next);next+=count;require(next<=32*1024*1024,"State exceeds 128 MiB");};
 next+=os;alloc(l.MOVEMENTS,ms);alloc(l.BEFORE,os);alloc(l.PARENT_BEFORE,os);alloc(l.RETRY_BOARD,os);alloc(l.RESTART_BOARD,os);alloc(l.RETRY_MOVEMENTS,ms);alloc(l.RIGID_OWNERS,ms);alloc(l.RIGID_APPLIED,ms);alloc(l.PLAYER_POSITIONS,l.CELL_CAP);l.BAN_WORDS=(g[7]+31)/32;alloc(l.BANNED_GROUPS,l.BAN_WORDS);alloc(l.CREATED_BITS,l.OBJ_WORDS);alloc(l.DESTROYED_BITS,l.OBJ_WORDS);alloc(l.GLOBAL_OBJECTS,l.OBJ_WORDS);alloc(l.HISTORY,uint64_t(l.HISTORY_CAP)*os);alloc(l.MATCHES,uint64_t(l.ROW_CAP)*l.MATCH_CAP*3);alloc(l.COMMAND_LIST,32);alloc(l.SOUND_CAN,l.SOUND_CAP);alloc(l.SOUND_CANT,l.SOUND_CAP);alloc(l.EVENTS,l.EFFECT_CAP*2);l.STATE_WORDS=u32(next);
 initial=words(at(j,"initial"));ops=words(at(j,"operations"));require(!ops.empty()&&ops.size()<=10000&&ops[0]==8&&std::all_of(ops.begin()+1,ops.end(),[](u32 x){return x<=7;}),"Invalid operation sequence");
 roots.push_back(initial);if(auto p=j.find("initial_boards"))for(auto&v:p->asArray())roots.push_back(words(v));
 require(roots.size()<=2049,"Too many roots");for(auto&s:roots){require(s.size()==l.STATE_WORDS,"Initial length mismatch");auto perm=std::vector<u32>(s.begin()+128,s.begin()+384);std::sort(perm.begin(),perm.end());for(u32 i=0;i<256;i++)require(perm[i]==i,"Invalid RC4 permutation");for(u32 i=0;i<l.STATE_WORDS;i++){bool obj=i>=l.BOARD&&i<l.BOARD+os,restart=i>=l.RESTART_BOARD&&i<l.RESTART_BOARD+os,rng=i>=128&&i<384;require(obj||restart||rng||!s[i],"Initial state must be pristine");if(restart)require(s[i]==s[l.BOARD+i-l.RESTART_BOARD],"Pristine restart mismatch");if(obj&&g[4]%32&&((i-l.BOARD)%g[23]==g[23]-1))require(!(s[i]&~((1u<<(g[4]%32))-1)),"Invalid object bit");}}
 if(roots.size()>1)roots.erase(roots.begin());
 if(auto p=j.find("board_operations"))require(p->asArray().empty(),"Per-board operation streams are not implemented in CUDA");
 sparse=prepare_sparse(g);
 }
};
#include "compact.hpp"
J observe(const Game& g,const u32*s){const auto&l=g.l;u32 os=l.CELL_CAP*l.OBJ_WORDS;J::Array hist,events;for(u32 i=0;i<s[3];i++)hist.push_back(arr(s+l.HISTORY+i*os,os));for(u32 i=0;i<s[75];i++){u32 p=l.EVENTS+i*2;require(s[p+1]<g.symbols.size(),"Bad output symbol");events.emplace_back(J::Object{{"kind",J(std::string(s[p]?"message":"sound"))},{s[p]?"text":"seed",J(g.symbols[s[p+1]])}});}
 return J(J::Object{{"board",arr(s+l.BOARD,os)},{"movements",arr(s+l.MOVEMENTS,l.CELL_CAP*l.MOV_WORDS)},{"restart",arr(s+l.RESTART_BOARD,os)},{"history",J(std::move(hist))},{"rng",J(J::Object{{"i",ji(s[6])},{"j",ji(s[7])},{"s",arr(s+128,256)}})},{"againing",J(bool(s[4]))},{"winning",J(bool(s[5]))},{"checkpoint",J(bool(s[8]))},{"effects",ji(s[9])},{"modified",J(bool(s[10]))},{"commands",ji(s[11])},{"created",arr(s+l.CREATED_BITS,l.OBJ_WORDS)},{"destroyed",arr(s+l.DESTROYED_BITS,l.OBJ_WORDS)},{"diagnostics",ji(s[38])},{"message",J(g.symbols.at(s[70]))},{"textMode",J(bool(s[71]))},{"events",J(std::move(events))}});
}
#include "digest.hpp"
template<int OW,int MW,bool PreserveIdle=false>__global__ void execute(Layout l,Params sparse,const u32*g,u32*s,u32*cache,u32*status,const u32*ops,u32 epoch,u32 fuel,u32 n,u32*receipts){u32 i=blockIdx.x*blockDim.x+threadIdx.x;if(i>=n)return;if constexpr(PreserveIdle){if(ops[i]==0xffffffffu){status[i]=1;receipts[i]+=2;return;}}Engine<OW,MW> r{};static_cast<Layout&>(r)=l;r.game=g;r.sparse_metadata=sparse;r.states=s+size_t(i)*l.STATE_WORDS;r.line_objects=cache+size_t(i)*((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS);if(ops[i]==0xffffffffu){r.put(0,epoch);r.put(1,1);}else r.run(ops[i],epoch,fuel);status[i]=r.rd(1);receipts[i]+=PreserveIdle?2u:1u;}
#include "cooperative.cuh"
struct Device {
 int id;cudaDeviceProp prop{};
 explicit Device(int requested){require(requested>=-1,"Adapter must be -1 or a CUDA index");int n=0;ck(cudaGetDeviceCount(&n));require(n>0,"No CUDA hardware adapter; CPU fallback is forbidden");id=requested;if(id<0){int score=-1;for(int i=0;i<n;i++){cudaDeviceProp p{};ck(cudaGetDeviceProperties(&p,i));if(p.multiProcessorCount>score){score=p.multiProcessorCount;id=i;}}}require(id>=0&&id<n,"CUDA adapter index unavailable");ck(cudaSetDevice(id));ck(cudaGetDeviceProperties(&prop,id));require(!prop.integrated&&prop.major>=7,"CUDA pilot requires a discrete hardware GPU (compute capability >=7)");}
 J report()const {int driver=0,runtime=0;ck(cudaDriverGetVersion(&driver));ck(cudaRuntimeGetVersion(&runtime));return J(J::Object{{"adapter",J(std::string(prop.name))},{"adapter_index",ji(id)},{"backend",J(std::string("CUDA"))},{"hardware",J(true)},{"compute_capability",J(std::to_string(prop.major)+"."+std::to_string(prop.minor))},{"driver_api",ji(driver)},{"runtime_api",ji(runtime)},{"vram_bytes",ji(prop.totalGlobalMem)},{"multiprocessors",ji(prop.multiProcessorCount)}});}
};
#include "service-arena.hpp"
template<class T>struct DevMem{T*p=nullptr;size_t n;ByteArena* arena;explicit DevMem(size_t count,ByteArena* arena=nullptr):n(count),arena(arena){if(arena)p=static_cast<T*>(arena->allocate(n*sizeof(T)));else ck(cudaMalloc(reinterpret_cast<void**>(&p),n*sizeof(T)));}~DevMem(){if(p){if(arena)arena->release(p,n*sizeof(T));else cudaFree(p);}}DevMem(const DevMem&)=delete;};
template<class T>struct HostPinned{T*p=nullptr;size_t n;ByteArena* arena;explicit HostPinned(size_t count,ByteArena* arena=nullptr):n(count),arena(arena){require(uint64_t(n)*sizeof(T)<=4ull*1024*1024*1024,"Pinned key staging exceeds 4 GiB");if(arena)p=static_cast<T*>(arena->allocate(n*sizeof(T)));else ck(cudaHostAlloc(reinterpret_cast<void**>(&p),n*sizeof(T),cudaHostAllocDefault));}~HostPinned(){if(p){if(arena)arena->release(p,n*sizeof(T));else cudaFreeHost(p);}}HostPinned(const HostPinned&)=delete;};
size_t state_pool_words(const Game&g,u32 n){uint64_t count=uint64_t(n)*g.l.STATE_WORDS;require(count*4<=4ull*1024*1024*1024,"GPU state pool exceeds 4 GiB");return size_t(count);}
struct Gpu {
 const Game& game;u32 n;bool cooperative;DevMem<u32>g,s,cache,status,ops,receipts;cudaEvent_t begin,end;double compute=0,upload=0,readback=0;uint64_t dispatches=0,board_invocations=0;u32 peak_active_lanes=0;std::vector<u32> expected_receipts;
 cudaStream_t initialization_stream{};
 Gpu(const Game& game,u32 n,bool cooperative=true,ByteArena* arena=nullptr,cudaStream_t init_stream=nullptr):game(game),n(n),cooperative(cooperative),g(game.g.size(),arena),s(state_pool_words(game,n),arena),cache(size_t(n)*((game.l.CELL_CAP+1)*game.l.OBJ_WORDS+game.l.MOV_WORDS),arena),status(n,arena),ops(n,arena),receipts(n,arena),expected_receipts(n,0),initialization_stream(init_stream){require(uint64_t(n)*game.l.STATE_WORDS*4<=4ull*1024*1024*1024,"GPU state pool exceeds 4 GiB");ck(cudaEventCreate(&begin));ck(cudaEventCreate(&end));auto t=Clock::now();try{if(init_stream){ck(cudaMemcpyAsync(g.p,game.g.data(),g.n*4,cudaMemcpyHostToDevice,init_stream));ck(cudaMemsetAsync(s.p,0,s.n*4,init_stream));ck(cudaMemsetAsync(receipts.p,0,n*4,init_stream));}else{ck(cudaMemcpy(g.p,game.g.data(),g.n*4,cudaMemcpyHostToDevice));ck(cudaMemset(s.p,0,s.n*4));ck(cudaMemset(receipts.p,0,n*4));}}catch(...){if(init_stream)cudaStreamSynchronize(init_stream);cudaEventDestroy(begin);cudaEventDestroy(end);throw;}upload+=elapsed(t);}
 ~Gpu(){if(initialization_stream)cudaStreamSynchronize(initialization_stream);cudaEventDestroy(begin);cudaEventDestroy(end);}
 void load(const std::vector<u32>& data){auto t=Clock::now();require(data.size()<=s.n,"State upload overflow");ck(cudaMemcpy(s.p,data.data(),data.size()*4,cudaMemcpyHostToDevice));upload+=elapsed(t);}
 std::vector<u32> download(){std::vector<u32> data(s.n);auto t=Clock::now();ck(cudaMemcpy(data.data(),s.p,s.n*4,cudaMemcpyDeviceToHost));readback+=elapsed(t);return data;}
 void operation(const std::vector<u32>& inputs,u32 epoch,u32 fuel,u32 max_dispatch,Clock::time_point deadline=Clock::time_point::max()){u32 active=u32(inputs.size());require(active>0&&active<=n,"Invalid active dispatch");auto t=Clock::now();ck(cudaMemcpy(ops.p,inputs.data(),active*4,cudaMemcpyHostToDevice));upload+=elapsed(t);std::vector<u32> result(active),receipt(active);bool done=false;for(u32 round=0;round<max_dispatch;round++){if(Clock::now()>=deadline)throw DeadlineExpired();
   ck(cudaEventRecord(begin));if(cooperative){if(game.l.OBJ_WORDS==1&&game.l.MOV_WORDS==1)execute_cooperative<1,1><<<active,32>>>(game.l,game.sparse,g.p,s.p,cache.p,status.p,ops.p,epoch,fuel,active,receipts.p);else if(game.l.OBJ_WORDS==1&&game.l.MOV_WORDS==3)execute_cooperative<1,3><<<active,32>>>(game.l,game.sparse,g.p,s.p,cache.p,status.p,ops.p,epoch,fuel,active,receipts.p);else execute_cooperative<0,0><<<active,32>>>(game.l,game.sparse,g.p,s.p,cache.p,status.p,ops.p,epoch,fuel,active,receipts.p);}else if(game.l.OBJ_WORDS==1&&game.l.MOV_WORDS==1)execute<1,1><<<(active+31)/32,32>>>(game.l,game.sparse,g.p,s.p,cache.p,status.p,ops.p,epoch,fuel,active,receipts.p);else if(game.l.OBJ_WORDS==1&&game.l.MOV_WORDS==3)execute<1,3><<<(active+31)/32,32>>>(game.l,game.sparse,g.p,s.p,cache.p,status.p,ops.p,epoch,fuel,active,receipts.p);else execute<0,0><<<(active+31)/32,32>>>(game.l,game.sparse,g.p,s.p,cache.p,status.p,ops.p,epoch,fuel,active,receipts.p);ck(cudaGetLastError());ck(cudaEventRecord(end));ck(cudaEventSynchronize(end));float d=0;ck(cudaEventElapsedTime(&d,begin,end));compute+=d;dispatches++;board_invocations+=active;peak_active_lanes=std::max(peak_active_lanes,active);
   t=Clock::now();ck(cudaMemcpy(result.data(),status.p,active*4,cudaMemcpyDeviceToHost));ck(cudaMemcpy(receipt.data(),receipts.p,active*4,cudaMemcpyDeviceToHost));readback+=elapsed(t);done=true;for(u32 i=0;i<active;i++){require(receipt[i]==(expected_receipts[i]+=cooperative?2u:1u),"Missing CUDA kernel receipt");require(result[i]<=1,"Interpreter failure status "+std::to_string(result[i]));done=done&&result[i]==1;}if(done)break;
  }require(done,"Continuation limit exceeded; execution remains incomplete");}
};
J transitions(const Game& game,const J& req){u32 n=num(req,"batch",1),fuel=num(req,"fuel",2048),maxDispatch=num(req,"max_dispatches",10000),threads=num(req,"threads",1);require(n&&n<=2048&&fuel&&fuel<=65536&&maxDispatch&&maxDispatch<=100000&&threads&&threads<=16,"Invalid dispatch capacities");std::string mode=str(req,"mode","cuda");require(mode=="cpu"||mode=="cuda","Transition mode must be cpu or cuda");std::vector<u32> data(size_t(n)*game.l.STATE_WORDS);for(u32 i=0;i<n;i++)std::copy(game.roots[i%game.roots.size()].begin(),game.roots[i%game.roots.size()].end(),data.begin()+size_t(i)*game.l.STATE_WORDS);
 auto start=Clock::now();J::Array observations;J::Object report{{"mode",J(mode)},{"cpu_budget",ji(threads)},{"batch",ji(n)},{"trace_digests",J(flag(req,"digests",false))}};std::unique_ptr<Gpu> gpu;std::unique_ptr<Device> device;if(mode=="cuda"){device=std::make_unique<Device>(num(req,"adapter",-1));report["device"]=device->report();gpu=std::make_unique<Gpu>(game,n,flag(req,"cooperative",true));gpu->load(data);}
 for(u32 opindex=0;opindex<game.ops.size();opindex++){u32 op=game.ops[opindex],epoch=opindex+1;
  if(gpu){gpu->operation(std::vector<u32>(n,op),epoch,fuel,maxDispatch);data=gpu->download();}
  else{std::atomic<u32>next{0};std::exception_ptr error;std::mutex mutex;std::vector<std::thread> workers;for(u32 t=0;t<threads;t++)workers.emplace_back([&]{try{for(u32 i;(i=next.fetch_add(1))<n;){std::vector<u32>cache((game.l.CELL_CAP+1)*game.l.OBJ_WORDS+game.l.MOV_WORDS);Runtime r{};static_cast<Layout&>(r)=game.l;r.game=game.g.data();r.sparse_metadata=game.sparse;r.states=data.data()+size_t(i)*game.l.STATE_WORDS;r.line_objects=cache.data();u32 round=0;do{r.run(op,epoch,fuel);require(++round<=maxDispatch,"CPU continuation limit exceeded");}while(!r.rd(1));require(r.rd(1)==1,"CPU interpreter failure "+std::to_string(r.rd(1)));}}catch(...){std::lock_guard<std::mutex>lock(mutex);error=std::current_exception();}});for(auto&w:workers)w.join();if(error)std::rethrow_exception(error);}
  J::Array boards;for(u32 i=0;i<n;i++)boards.push_back(flag(req,"digests",false)?observe_digest(game,data.data()+size_t(i)*game.l.STATE_WORDS):observe(game,data.data()+size_t(i)*game.l.STATE_WORDS));observations.emplace_back(J::Object{{"operation",ji(op)},{"boards",J(std::move(boards))}});
 }
 report["elapsed_ms"]=J(elapsed(start));report["observations"]=J(std::move(observations));if(gpu){report["compute_ms"]=J(gpu->compute);report["upload_ms"]=J(gpu->upload);report["readback_ms"]=J(gpu->readback);report["dispatches"]=ji(gpu->dispatches);report["kernel_receipts_checked"]=J(true);report["executed_kernel"]=J(std::string(gpu->cooperative?"warp-cooperative":"scalar"));}return J(std::move(report));}
#include "search.cuh"
#include "worker.cuh"
#ifdef PS_CUDA_SERVICE
#ifdef PS_DEVICE_SERVICE
#include <bit>
#include <unordered_map>
#include "device-search.cuh"
#endif
#include "service.cuh"
#endif
int legacy_cuda_main(int argc,char**argv){try{if(argc==2&&std::string(argv[1])=="--worker")return worker_main();if(argc==2&&std::string(argv[1])=="--list-adapters"){int n=0;ck(cudaGetDeviceCount(&n));J::Array a;for(int i=0;i<n;i++)a.push_back(Device(i).report());json(std::cout,J(std::move(a)));std::cout<<'\n';return 0;}require(argc==3,"Usage: puzzlescript-cuda request.json output.json | --list-adapters");auto start=Clock::now();J req=puzzlescript::json::parse(read(argv[1]));if(auto p=req.find("affinity_mask")){auto mask=std::stoull(p->asString(),nullptr,16);require(mask&&SetProcessAffinityMask(GetCurrentProcess(),DWORD_PTR(mask)),"Cannot set requested CPU affinity");}Game game(puzzlescript::json::parse(read(at(req,"game").asString())));if(auto p=req.find("boards_file"))compact_boards(game,p->asString());std::string task=str(req,"task","transitions");require(task=="search"||task=="transitions"||task=="probe","Unknown task");J result=task=="search"?search(game,req):task=="probe"?probe(game,req):transitions(game,req);auto obj=result.asObject();obj["process_elapsed_ms"]=J(elapsed(start));obj["peak_rss_bytes"]=ji(gpu_memory::peak_rss_bytes());FILETIME c,x,k,u;require(GetProcessTimes(GetCurrentProcess(),&c,&x,&k,&u),"Cannot read CPU accounting");auto ft=[](FILETIME t){return (uint64_t(t.dwHighDateTime)<<32)|t.dwLowDateTime;};obj["process_cpu_ms"]=J(double(ft(k)+ft(u))/10000);if(auto p=req.find("affinity_mask"))obj["affinity_mask"]=J(p->asString());std::ofstream out(argv[2]);require(bool(out),"Cannot open output");out<<std::setprecision(12);json(out,J(std::move(obj)));return 0;}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}

int main(int argc,char**argv){
#ifdef PS_CUDA_SERVICE
 if(argc==2&&std::string(argv[1])=="--service")try{return continuous::main();}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}
#endif
 return legacy_cuda_main(argc,argv);
}
