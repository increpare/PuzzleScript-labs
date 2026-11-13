#pragma once
// One retained game and GPU driver per process. Requests are serial; independent
// boards within each request run concurrently. Failed requests discard scratch.
int worker_main(){
 std::unique_ptr<Game>game;DriverCache cache;u32 handle=0;std::string line;
 while(std::getline(std::cin,line)){
  std::string id;
  try{
   require(line.size()<=1024*1024,"Worker request exceeds 1 MiB");auto req=puzzlescript::json::parse(line);id=at(req,"id").asString();require(!id.empty()&&id.size()<=128,"Worker id capacity");auto op=at(req,"op").asString();
   auto reply=[&](J::Object row){row["id"]=J(id);row["ok"]=J(true);std::ostringstream frame;frame<<std::setprecision(12);json(frame,J(std::move(row)));auto text=frame.str();require(text.size()<=16*1024*1024,"Worker reply exceeds 16 MiB");std::cout<<text<<'\n'<<std::flush;};
   if(op=="shutdown"){reply({});return 0;}
   if(op=="clear"){cache.clear_driver();game.reset();reply({});continue;}
   if(op=="load"){
    auto started=Clock::now();auto loaded=std::make_unique<Game>(puzzlescript::json::parse(read_limited(at(req,"file").asString(),64*1024*1024)));
    if(auto p=req.find("boards_file"))compact_boards(*loaded,p->asString());
    require(uint64_t(loaded->roots.size())*loaded->l.STATE_WORDS*4<=512ull*1024*1024,"Pristine root cache exceeds 512 MiB");
    cache.clear_driver();game=std::move(loaded);require(++handle!=0,"Handle overflow");reply({{"report",J(J::Object{{"handle",ji(handle)},{"roots",ji(game->roots.size())},{"elapsed_ms",J(elapsed(started))}})}});continue;
   }
   if(op=="info"){reply({{"report",J(J::Object{{"loaded",J(bool(game))},{"handle",ji(handle)},{"driver_cached",J(bool(cache.driver))},{"device_cached",J(bool(cache.device))}})}});continue;}
   require(op=="solve","Unknown worker operation");require(game&&num(req,"handle",-1)==int(handle),"Worker handle unavailable");
   if(auto p=req.find("affinity_mask")){auto mask=std::stoull(p->asString(),nullptr,16);require(mask&&SetProcessAffinityMask(GetCurrentProcess(),DWORD_PTR(mask)),"Cannot set requested CPU affinity");}
   auto started=Clock::now();if(auto p=req.find("boards_file"))compact_boards(*game,p->asString());
   auto result=search(*game,req,&cache).asObject();result["request_elapsed_ms"]=J(elapsed(started));result["peak_rss_bytes"]=ji(gpu_memory::peak_rss_bytes());reply({{"report",J(std::move(result))}});
  }catch(const std::exception&e){cache.clear_driver();json(std::cout,J(J::Object{{"id",J(id)},{"ok",J(false)},{"error",J(std::string(e.what()))}}));std::cout<<'\n'<<std::flush;}
 }return 0;
}
