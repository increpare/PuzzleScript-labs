// Isolated native runner; existing service binaries/defaults remain unchanged.
#include <bit>
#include <unordered_map>
#define main unused_legacy_entry
#include "runner.cu"
#undef main
#include "device-search.cuh"
namespace resident {
__global__ void compact_boundary(Layout l,u32* states,u32* keys){if(blockIdx.x||threadIdx.x)return;capture_key(l,states,keys);restore_key(l,states,keys);}
J boundary(const Game& game,const J& req){for(u32 op:game.ops)require(op!=6,"Compact search boundary rejects undo; full interpreter retains history");Device device(num(req,"adapter",-1));Gpu normal(game,1),compact(game,1);normal.load(game.initial);compact.load(game.initial);DevMem<u32> key(key_words(game.l));J::Array observations;u32 fuel=num(req,"fuel",2048);require(fuel&&fuel<=2048,"Boundary fuel1..2048");for(u32 i=0;i<game.ops.size();i++){if(i){compact_boundary<<<1,1>>>(game.l,compact.s.p,key.p);ck(cudaGetLastError());ck(cudaDeviceSynchronize());}normal.operation({game.ops[i]},i+1,fuel,100000);compact.operation({game.ops[i]},1,fuel,100000);auto a=normal.download(),b=compact.download();std::vector<u32> ak(key_words(game.l)),bk(ak.size());capture_key(game.l,a.data(),ak.data());capture_key(game.l,b.data(),bk.data());require(ak==bk,"Settled compact boundary changed persistent key at operation "+std::to_string(i));observations.emplace_back(J::Object{{"operation",ji(game.ops[i])},{"key",arr(bk.data(),bk.size())},{"normal",observe(game,a.data())}});}return J(J::Object{{"task",J(std::string("boundary"))},{"device",device.report()},{"kernel_receipts_checked",J(true)},{"normal_dispatches",ji(normal.dispatches)},{"compact_dispatches",ji(compact.dispatches)},{"observations",J(std::move(observations))}});}
struct Session {std::unique_ptr<Device> device;std::unique_ptr<Game> game;std::unique_ptr<Search> search;u32 generation=0;uint64_t checkpoint_serial=0;std::unordered_map<std::string,std::unique_ptr<Checkpoint>> checkpoints;
 uint64_t checkpoint_bytes()const{uint64_t bytes=0;for(const auto& entry:checkpoints)if(entry.second)bytes+=entry.second->bytes();return bytes;}
};
J ownership_command(Session& s,const J& req){
 constexpr uint64_t maximum=512ull*1024*1024;auto op=at(req,"op").asString();
 if(op=="cpu_statistics"){J::Array ids;for(const auto& entry:s.checkpoints)ids.emplace_back(entry.first);return J(J::Object{{"count",ji(s.checkpoints.size())},{"retained_bytes",ji(s.checkpoint_bytes())},{"limit_bytes",ji(maximum)},{"capacity",ji(128)},{"checkpoints",J(std::move(ids))}});}
 if(op=="take"){
  require(s.checkpoints.size()<128,"CPU checkpoint registry capacity");u32 memory=num(req,"memory_mb",256);require(memory&&memory<=4096,"Checkpoint memory1..4096MiB");
  uint64_t used=s.checkpoint_bytes();require(used<maximum,"CPU checkpoint aggregate storage limit");require(++s.checkpoint_serial<1000000000,"Checkpoint identity overflow");
  auto id="p"+std::to_string(s.checkpoint_serial);auto entry=s.checkpoints.emplace(id,nullptr).first;
  try{entry->second=s.search->take(num(req,"slot",-1),num(req,"slot_generation",-1),std::min(uint64_t(memory)*1024*1024,maximum-used));}
  catch(...){s.checkpoints.erase(entry);throw;}
  return J(J::Object{{"checkpoint",J(id)},{"report",entry->second->report()}});
 }
 auto id=at(req,"checkpoint").asString();auto found=s.checkpoints.find(id);require(found!=s.checkpoints.end()&&bool(found->second),"Checkpoint unavailable or already consumed");auto& cp=*found->second;
 if(op=="release_checkpoint"){s.checkpoints.erase(found);return J(J::Object{{"released",J(true)}});}
 if(op=="return_checkpoint"){u32 slot=num(req,"slot",-1),token=s.search->put(slot,num(req,"slot_generation",-1),cp,maximum-(s.checkpoint_bytes()-cp.bytes()));s.checkpoints.erase(found);return J(J::Object{{"slot",ji(slot)},{"slot_generation",ji(token)},{"checkpoint_consumed",J(id)}});}
 if(op=="cpu_advance"){auto used=s.checkpoint_bytes();require(used<=maximum,"CPU checkpoint aggregate storage limit");cp.advance(num(req,"waves",1),maximum-(used-cp.bytes()));}
 else if(op=="cpu_resume")cp.extend(num(req,"grant",0));
 else if(op=="cpu_cancel"){if(cp.q.status==Running||cp.q.status==Unfinished)cp.q.status=Cancelled;}
 else require(op=="cpu_report","Unknown checkpoint operation");
 return J(J::Object{{"checkpoint",J(id)},{"report",cp.report(flag(req,"debug_export",false))}});
}
void assign_slot(Session& s,const J& req){
 u32 index=num(req,"slot",-1),token=num(req,"slot_generation",-1);s.search->checked_slot(index,token);
 require(bool(req.find("boards_file")),"Assignment requires a one-board PSGB file");
 auto previous=std::move(s.game->roots);
 try{compact_boards(*s.game,at(req,"boards_file").asString());require(s.game->roots.size()==1,"Assignment requires exactly one root board");s.search->assign(index,token,s.game->roots[0],req);}
 catch(...){s.game->roots=std::move(previous);throw;}
 s.game->roots=std::move(previous);
}
J load(Session& s,const J& req){if(s.search)require(!s.search->in_flight(),"Device search has an advance awaiting retirement");require(str(req,"mode","cuda")=="cuda","Device search has no CPU/software fallback");if(auto a=req.find("affinity_mask")){const auto text=a->asString();require(!text.empty()&&text.size()<=16&&text.find_first_not_of("0123456789abcdefABCDEF")==std::string::npos,"Hex affinity mask required");auto mask=std::stoull(text,nullptr,16);require(mask&&SetProcessAffinityMask(GetCurrentProcess(),DWORD_PTR(mask)),"Cannot set device driver affinity");}if(!s.device)s.device=std::make_unique<Device>(num(req,"adapter",-1));else require(num(req,"adapter",s.device->id)==s.device->id,"Create a fresh worker to change CUDA adapter");auto game=std::make_unique<Game>(puzzlescript::json::parse(read_limited(at(req,"game").asString(),128*1024*1024)));if(auto p=req.find("boards_file"))compact_boards(*game,p->asString());u32 generation=s.generation+1;require(generation!=0,"Device session generation overflow");auto search=std::make_unique<Search>(*game,req,generation);s.search.reset();s.game.reset();s.game=std::move(game);s.search=std::move(search);s.generation=generation;return J(J::Object{{"generation",ji(s.generation)},{"device",s.device->report()},{"report",s.search->report()}});}
// A bounded host-side slice avoids serializing all query rows after every graph.
// It uses the same retirement/receipt/cycle checks as advance. Slice exhaustion
// preserves the live continuation; it is not a solver timeout or cancellation.
J run_slice(Session& s,const J& req){
 u32 waves=num(req,"waves",8),maximum=num(req,"max_units",100000),milliseconds=num(req,"slice_ms",100);
 require(waves&&waves<=8&&maximum&&maximum<=1000000&&milliseconds&&milliseconds<=1000,"Run slice requires waves1..8,max_units1..1000000,slice_ms1..1000");
 const auto started=Clock::now();u32 units=0;
 while(s.search->running()&&units<maximum&&elapsed(started)<milliseconds){s.search->advance(waves);units++;}
 const bool live=s.search->running();const double work_ms=elapsed(started);
 auto result=s.search->report(flag(req,"debug_export",false)).asObject();
 result["run_slice"]=J(J::Object{{"units",ji(units)},{"elapsed_ms",J(work_ms)},
  {"continuation",J(live)},{"stop",J(std::string(!live?"settled":units==maximum?"unit_limit":"time_slice"))}});
 return J(std::move(result));
}
J command(Session& s,const J& req){auto op=str(req,"op","report");
#ifdef PS_PRODUCTION_SEARCH
 require(op!="take"&&op!="return_checkpoint"&&op!="release_checkpoint"&&op.rfind("cpu_",0)!=0,"Production search rejects exact-BFS ownership/checkpoint operations");
#endif
if(op=="load")return load(s,req);if(op=="cpu_advance"||op=="cpu_report"||op=="cpu_resume"||op=="cpu_cancel"||op=="cpu_statistics"||op=="release_checkpoint")return ownership_command(s,req);require(bool(s.search),"Load a game first");require(num(req,"generation",-1)==s.generation,"Stale or missing device session generation");if(op=="advance_begin"){s.search->begin_advance(num(req,"waves",1));return J(J::Object{{"pending",J(true)}});}if(op=="advance_ready")return J(J::Object{{"pending",J(s.search->in_flight())},{"ready",J(s.search->advance_ready())}});if(op=="advance_retire"){s.search->retire_advance();return s.search->report(flag(req,"debug_export",false));}require(!s.search->in_flight(),"Device search has an advance awaiting retirement");if(op=="run")return run_slice(s,req);if(op=="take"||op=="return_checkpoint")return ownership_command(s,req);if(op=="assign")assign_slot(s,req);else if(op=="resume_slot")s.search->extend_slot(num(req,"slot",-1),num(req,"slot_generation",-1),num(req,"grant",0));else if(op=="cancel_slot")s.search->cancel_slot(num(req,"slot",-1),num(req,"slot_generation",-1));else if(op=="reset"){u32 token=s.generation+1;require(token!=0,"Device generation overflow");if(auto p=req.find("boards_file")){auto previous=std::move(s.game->roots);try{compact_boards(*s.game,p->asString());s.search->reset(token);}catch(...){s.game->roots=std::move(previous);throw;}}else s.search->reset(token);s.generation=token;}else if(op=="advance")s.search->advance(num(req,"waves",1));else if(op=="resume")s.search->extend(num(req,"grant",0));else if(op=="cancel")s.search->cancel(num(req,"query",-1));else require(op=="report"||op=="export","Unknown device search operation");return s.search->report(op=="export");}
int worker(){Session session;for(;;){std::string line,id;bool overflow=false;char c;while(std::cin.get(c)&&c!='\n'){if(line.size()<1024*1024)line.push_back(c);else overflow=true;}if(line.empty()&&!std::cin)break;bool shutdown=false;J response;try{require(!overflow,"Device worker request exceeds1MiB");const auto req=puzzlescript::json::parse(line);id=at(req,"id").asString();shutdown=str(req,"op","")=="shutdown";if(shutdown){session.checkpoints.clear();session.search.reset();session.game.reset();session.device.reset();response=J(J::Object{{"id",J(id)},{"ok",J(true)}});}else response=J(J::Object{{"id",J(id)},{"ok",J(true)},{"report",command(session,req)}});}catch(const std::exception& e){response=J(J::Object{{"id",J(id)},{"ok",J(false)},{"error",J(std::string(e.what()))}});}json(std::cout,response);std::cout<<'\n'<<std::flush;if(shutdown)break;}return 0;}
}
#ifndef PS_DEVICE_NO_MAIN
int main(int argc,char**argv){try{if(argc==2&&std::string(argv[1])=="--list-adapters")return legacy_cuda_main(argc,argv);if(argc==2&&std::string(argv[1])=="--worker")return resident::worker();require(argc==3,"Usage: puzzlescript-device-search request.json report.json | --worker | --list-adapters");auto req=puzzlescript::json::parse(read_limited(argv[1],2*1024*1024));J result;if(str(req,"task","")=="boundary"){Game game(puzzlescript::json::parse(read_limited(at(req,"game").asString(),128*1024*1024)));result=resident::boundary(game,req);}else{require(str(req,"mode","cuda")=="cuda","Device search has no CPU/software fallback");resident::Session session;auto setup=Clock::now();resident::load(session,req);double setup_ms=elapsed(setup);u32 waves=num(req,"waves",4),maximum=num(req,"max_units",100000),timeout=num(req,"timeout_ms",60000);require(waves&&waves<=8&&maximum&&maximum<=1000000&&timeout&&timeout<=600000,"Invalid bounded device search run");if(auto p=req.find("resume_grants")){require(p->asArray().size()<=1024,"Resume list exceeds1024 grants");for(const auto& v:p->asArray())require(v.asInteger()>0&&v.asInteger()<=1000000,"Invalid resume grant");}auto start=Clock::now();J::Array snapshots;auto run=[&](){for(u32 u=0;session.search->running();u++){require(u<maximum,"Device search unit continuation limit");if(elapsed(start)>=timeout){session.search->cancel(resident::nil,resident::Timeout);break;}session.search->advance(waves);}};run();snapshots.push_back(session.search->report(flag(req,"debug_export",false)));if(auto p=req.find("resume_grants"))for(const auto& grant:p->asArray()){require(grant.asInteger()>0&&grant.asInteger()<=1000000,"Invalid resume grant");session.search->extend(u32(grant.asInteger()));run();snapshots.push_back(session.search->report(flag(req,"debug_export",false)));}auto obj=session.search->report(flag(req,"debug_export",false)).asObject();obj["device"]=session.device->report();obj["setup_ms"]=J(setup_ms);obj["elapsed_ms"]=J(elapsed(start));obj["snapshots"]=J(std::move(snapshots));result=J(std::move(obj));}std::ofstream file(argv[2]);require(bool(file),"Cannot create device report");file<<std::setprecision(12);json(file,result);return 0;}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}

#endif
