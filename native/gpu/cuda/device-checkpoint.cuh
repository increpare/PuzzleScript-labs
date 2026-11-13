#pragma once
// Included inside namespace resident, after the device controller definitions.
// CPU execution is explicit. This is not a fallback for CUDA requests.
struct RuleData {
 Layout layout;Params sparse;std::vector<u32> game;
 explicit RuleData(const Game& g):layout(g.l),sparse(g.sparse),game(g.g){}
};
struct RehashedTable {std::vector<u32> entries;uint64_t probes=0;};
inline RehashedTable checkpoint_table(const std::vector<uint64_t>& hashes,u32 count,u32 size){
 require(count<=size&&std::has_single_bit(size),"Checkpoint destination hash capacity");RehashedTable result;result.entries.resize(size,0);
 // Loading/rebuilding an index is distinct from replaying gameplay. Bound even
 // deliberately pathological collision tests; a rejection retains the owner.
 for(u32 id=0;id<count;id++){u32 slot=u32(hashes[id])&(size-1);while(result.entries[slot]){require(++result.probes<=16777216,"Checkpoint rehash work limit");slot=(slot+1)&(size-1);}require(++result.probes<=16777216,"Checkpoint rehash work limit");result.entries[slot]=id+1;}
 return result;
}
struct Checkpoint {
 std::shared_ptr<const RuleData> rules;Config config;Query q;
 std::vector<u32> pristine,keys,table,terminal,states,cache,packed;
 std::vector<uint64_t> hashes,packed_hashes;std::vector<Node> nodes;std::vector<History> history;
 uint64_t limit_bytes,source_gpu_waves=0,cpu_waves=0,rehash_probes=0;u32 source_slot=0;
 bool owned=true,compact_ready=false,index_deferred=false;double cpu_ms=0;
 Checkpoint(std::shared_ptr<const RuleData> data,const Config& settings,const Query& query,uint64_t limit,bool compact=false):rules(std::move(data)),config(settings),q(query),limit_bytes(limit),compact_ready(compact){
  const auto& l=rules->layout;u32 slots=config.parents*5,kw=config.kw;
  require(!compact_ready||(q.stage==Ready&&q.status==Unfinished&&!q.probing),"Compact checkpoint requires a settled unfinished grant");
  pristine.resize(kw);terminal.resize(kw);table.resize(config.table_size);
  if(!compact_ready){states.resize(size_t(slots)*l.STATE_WORDS);cache.resize(size_t(slots)*((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS));packed.resize(size_t(slots)*kw);packed_hashes.resize(slots);}
  history.resize(slots);
  keys.resize(size_t(q.count)*kw);hashes.resize(q.count);nodes.resize(q.count);
 }
 Checkpoint(const Checkpoint&)=delete;Checkpoint& operator=(const Checkpoint&)=delete;
 uint64_t history_bytes()const{uint64_t n=0;for(const auto& h:history)n+=h.ring.size()*(uint64_t(config.kw)*8+128);return n;}
 uint64_t bytes()const{
  return sizeof(*this)+rules->game.capacity()*4+uint64_t(pristine.capacity()+keys.capacity()+table.capacity()+terminal.capacity()+states.capacity()+cache.capacity()+packed.capacity())*4+
   uint64_t(hashes.capacity()+packed_hashes.capacity())*8+nodes.capacity()*sizeof(Node)+history.capacity()*sizeof(History)+history_bytes()+8192;
 }
 void ensure_index(uint64_t available){
  if(!index_deferred)return;
  require(owned,"Cannot materialize an unowned checkpoint index");
  require(config.capacity&&config.capacity<=1000000,"CPU checkpoint logical capacity bound");
  require(q.stage==Ready&&!q.probing,"Deferred checkpoint index lost its settled boundary");
  const u32 needed=std::bit_ceil(config.capacity*2);
  if(config.table_size>=needed){index_deferred=false;return;}
  // A parked GPU graph may carry only its physical index. Keep both old and
  // prospective indices within the storage bound while rebuilding. Neither
  // allocation nor bounded rehash failure can mutate the search or its owner.
  require(bytes()+uint64_t(needed)*4<=std::min(limit_bytes,available),"CPU checkpoint index storage limit");
  auto rebuilt=checkpoint_table(hashes,q.count,needed);
  table.swap(rebuilt.entries);config.table_size=needed;rehash_probes+=rebuilt.probes;index_deferred=false;
 }
 void ensure_store(uint64_t available){
  ensure_index(available);
  // At Ready no operation cursor survives. CPU ownership materializes clean
  // scratch before starting a new parent; live transfers always carry scratch.
  if(compact_ready){
   require(q.stage==Ready&&!q.probing,"Compact checkpoint lost its settled boundary");
   const auto& l=rules->layout;uint64_t slots=config.parents*5;
   const uint64_t extra=slots*(uint64_t(l.STATE_WORDS)*4+((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS)*4+config.kw*4+8);
   require(bytes()+extra<=std::min(limit_bytes,available),"CPU checkpoint scratch storage limit");
   states.resize(size_t(slots)*l.STATE_WORDS);cache.resize(size_t(slots)*((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS));packed.resize(size_t(slots)*config.kw);packed_hashes.resize(slots);compact_ready=false;
  }
  u32 needed=std::min(config.capacity,q.count+config.parents*5+1);
  uint64_t fixed=bytes()-keys.capacity()*4-hashes.capacity()*8-nodes.capacity()*sizeof(Node);
  // Account conservatively for vector growth before changing gameplay/search.
  uint64_t projected=fixed+std::max(uint64_t(keys.capacity()),uint64_t(needed)*config.kw*2)*4+
   std::max(uint64_t(hashes.capacity()),uint64_t(needed)*2)*8+std::max(uint64_t(nodes.capacity()),uint64_t(needed)*2)*sizeof(Node);
  require(projected<=std::min(limit_bytes,available),"CPU checkpoint storage limit");
  if(keys.size()<size_t(needed)*config.kw)keys.resize(size_t(needed)*config.kw);
  if(hashes.size()<needed)hashes.resize(needed);if(nodes.size()<needed)nodes.resize(needed);
 }
 void assist(uint64_t available){
  u32 slots=config.parents*5,kw=config.kw,active=q.stage==Root?1:q.stage==Parent?q.batch_count*5:0;
  const uint64_t cost=uint64_t(kw)*8+128;u32 cap=u32(std::max(uint64_t(1),std::min(uint64_t(1024),64ull*1024*1024/cost)));
  for(u32 a=0;a<slots;a++){
   auto& h=history[a];u32 parent=q.stage==Root?nil:q.batch_start+a/5;
   if(h.parent!=parent||q.status!=Running){h.seen.clear();h.ring.clear();h.parent=parent;}
   if(q.status!=Running||a>=active||q.lanes[a].phase!=Assist)continue;
   std::string key(reinterpret_cast<const char*>(packed.data()+size_t(a)*kw),kw*4);
   if(h.seen.contains(key)){q.lanes[a].cyclic=1;q.lanes[a].phase=Settled;continue;}
   if(h.ring.size()>=cap){h.seen.erase(h.ring.front());h.ring.pop_front();}
   if(history_bytes()+cost>256ull*1024*1024||bytes()+cost>std::min(limit_bytes,available)){q.status=Memory;q.detail=CycleMemory;return;}
   h.seen.insert(key);h.ring.push_back(std::move(key));q.lanes[a].ticks++;q.lanes[a].phase=Tick;
  }
 }
 void advance(u32 waves,uint64_t available){
  require(owned,"Checkpoint already consumed");require(waves&&waves<=8&&cpu_waves+waves<1000000000,"CPU checkpoint wave bound");
  auto started=Clock::now();const auto& l=rules->layout;u32 kw=config.kw,slots=config.parents*5,actions=(rules->game[11]&16)?4:5;
  const uint64_t mask=config.hash_bits==64?~uint64_t(0):(uint64_t(1)<<config.hash_bits)-1;
  for(u32 round=0;round<waves&&q.status==Running;round++){
   ensure_store(available);prepare_one(q,config.parents,actions,false);std::vector<u32> status(slots,1);
   u32 active=q.stage==Root?1:q.stage==Parent?q.batch_count*5:0;
   for(u32 a=0;a<active;a++){
    if(q.stage==Parent&&a%5>=actions)continue;auto& lane=q.lanes[a];if(lane.phase!=Execute)continue;
    u32* state=states.data()+size_t(a)*l.STATE_WORDS;
    if(lane.fresh){const u32* key=lane.fresh==2?packed.data()+size_t(a)*kw:q.stage==Root?pristine.data():keys.data()+size_t(q.batch_start+a/5)*kw;restore_key(l,state,key);lane.fresh=0;}
    // The scalar CPU core preserves the semantic cursor. Its writes do not
    // maintain the warp-only line-eligibility cache, so invalidate that cache
    // before returning this live cursor to cooperative GPU execution.
    Runtime r{};static_cast<Layout&>(r)=l;r.game=rules->game.data();r.sparse_metadata=rules->sparse;r.states=state;
    r.line_objects=cache.data()+size_t(a)*((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS);
    state[r.COOP_LINE_VALID]=0;r.run(lane.op,1,config.fuel|0x80000000u);status[a]=state[1];
    if(status[a]==1){capture_key(l,state,packed.data()+size_t(a)*kw);packed_hashes[a]=hash_key(packed.data()+size_t(a)*kw,kw,mask);}
   }
   finish_one(q,status.data(),packed.data(),packed_hashes.data(),keys.data(),hashes.data(),nodes.data(),table.data(),terminal.data(),kw,config.capacity,config.table_size,config.parents,actions,config.probe_budget);
   assist(available);cpu_waves++;
  }
  cpu_ms+=elapsed(started);
 }
 void extend(u32 grant){require(owned&&q.status==Unfinished,"CPU checkpoint is not unfinished");require(grant&&grant<=1000000,"Invalid CPU grant");q.grant_end=u32(std::min(uint64_t(q.cap),q.expanded+grant));q.status=Running;}
 J report(bool debug=false)const{
  require(owned,"Checkpoint already consumed");const char* names[]={"running","unfinished","work_limit","candidate_solution","exhausted","memory_limit","cancelled","timeout","runtime_error","vacant","transferred"};
  const char* tokens[]={"up","left","down","right","action"};J::Array path;
  if(q.status==Solved&&q.winner_parent!=nil){std::vector<u32> reverse{q.winner_action};u32 id=q.winner_parent;
   for(u32 steps=0;id;steps++){require(steps<65536&&id<q.count,"CPU path capacity");const auto& node=nodes[id];require(node.parent<id&&node.action<=4,"CPU path parent");reverse.push_back(node.action);id=node.parent;}
   for(auto i=reverse.rbegin();i!=reverse.rend();i++)path.emplace_back(std::string(tokens[*i]));
  }
  J::Object row{{"status",J(std::string(names[q.status]))},{"detail",ji(q.detail)},{"solution",q.status==Solved?J(std::move(path)):J()},{"expanded",ji(q.expanded)},{"generated",ji(q.generated)},{"unique_states",ji(q.count)},{"duplicates",ji(q.duplicates)},{"again_cycles",ji(q.cycles)},{"max_frontier",ji(q.max_frontier)},{"root_nonquiescent",J(bool(q.root_cycle))},{"gpu_expanded",ji(q.gpu_expanded)},{"cpu_expanded",ji(q.cpu_expanded)},{"interpreter_invocations",ji(q.invocations)},{"gpu_interpreter_invocations",ji(q.gpu_invocations)},{"cpu_interpreter_invocations",ji(q.cpu_invocations)},{"grant_end",ji(q.grant_end)},{"partial_parent",J(q.stage==Parent)},{"commit_cursor",ji(q.cursor)},{"pending_probe",J(bool(q.probing))},{"hash_probes",ji(q.probes)},{"backend",J(std::string("CPU"))},{"ownership",J(std::string("cpu"))},{"source_gpu_waves",ji(source_gpu_waves)},{"gpu_source_receipts_checked",J(q.gpu_invocations!=0)},{"cpu_waves",ji(cpu_waves)},{"cpu_ms",J(cpu_ms)},{"retained_bytes",ji(bytes())},{ "logical_max_states",ji(q.max_states)},{"node_capacity",ji(config.capacity)},{"hash_capacity",ji(config.table_size)},{"transfer_rehash_probes",ji(rehash_probes)}};
  if(debug){u32 active=q.status==Running?(q.stage==Root?1:q.stage==Parent?q.batch_count*5:0):0;
   require(uint64_t(q.count)*(config.kw*4+sizeof(Node))+uint64_t(active)*rules->layout.STATE_WORDS*4<=64ull*1024*1024,"CPU debug export exceeds64MiB");
   J::Array entries,fifo;for(u32 i=0;i<q.count;i++)entries.emplace_back(J::Object{{"key",arr(keys.data()+size_t(i)*config.kw,config.kw)},{"parent",ji(nodes[i].parent)},{"action",ji(nodes[i].action)},{"depth",ji(nodes[i].depth)}});
   for(u32 i=q.head;i<q.count;i++)fifo.push_back(ji(i));row["nodes"]=J(std::move(entries));row["fifo"]=J(std::move(fifo));row["execution_states"]=arr(states.data(),size_t(active)*rules->layout.STATE_WORDS);
  }
  return J(std::move(row));
 }
};
