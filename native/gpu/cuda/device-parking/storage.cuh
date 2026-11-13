// Included inside namespace resident after Search and device-transfer.cuh.
// A reservation is storage, not a second execution owner. These APIs are used
// only by the GPU owner at a quiescent, settled unfinished boundary.
std::unique_ptr<Checkpoint> Search::reserve_paused(u32 index,u32 token,uint64_t limit,u32 probe_limit,bool physical_index){
#ifdef PS_PRODUCTION_SEARCH
 require(false,"Production search rejects exact-BFS parked checkpoints");
#endif
 const auto& q=checked_slot(index,token);
 require(q.status==Unfinished&&q.stage==Ready&&!q.probing,"Parking requires a settled unfinished grant");
 require(limit<=512ull*1024*1024,"Parked checkpoint reservation bound");
 require(probe_limit&&probe_limit<=16777216,"Parked checkpoint rehash bound");
 for(u32 a=0;a<slots;a++){
  const auto& h=histories[size_t(index)*slots+a];
  require(h.ring.empty()&&h.seen.empty(),"Settled parking still owns cycle witnesses");
 }
 Config cfg=settings;cfg.capacity=q.max_states;cfg.table_size=physical_index?table_size:std::max(table_size,std::bit_ceil(q.max_states*2));
 // Reserve the final host index as well as the graph. A larger host index is
 // built now, before publication: its bounded collision walk must not fail
 // later when new work needs to evict a valid retained lease. The opt-in
 // physical-index path instead reserves the existing device table verbatim:
 // eviction needs no allocation or rehash. Only actual CPU execution expands
 // that index, transactionally, in Checkpoint::ensure_index().
 const uint64_t estimate=sizeof(Checkpoint)+g.g.capacity()*4+uint64_t(slots)*sizeof(History)+
  uint64_t(q.count)*(uint64_t(kw)*4+sizeof(Node)+8)+uint64_t(cfg.table_size)*4+uint64_t(kw)*8+8192;
 require(estimate<=limit,"Parked checkpoint storage limit before reservation");
 if(!checkpoint_rules)checkpoint_rules=std::make_shared<RuleData>(g);
 auto cp=std::make_unique<Checkpoint>(checkpoint_rules,cfg,q,limit,true);
 cp->index_deferred=physical_index&&cfg.table_size<std::bit_ceil(cfg.capacity*2);
 cp->owned=false;cp->source_slot=index;cp->source_gpu_waves=waves;
 require(cp->bytes()<=limit,"Parked checkpoint reserved storage limit");
 if(cfg.table_size!=table_size){
  const size_t bytes=cp->hashes.size()*sizeof(uint64_t);
  if(bytes)ck(cudaMemcpyAsync(cp->hashes.data(),hashes.p+size_t(index)*capacity,bytes,cudaMemcpyDeviceToHost,stream));
  ck(cudaStreamSynchronize(stream));transfer_readback_bytes+=bytes;
  for(u32 id=0;id<q.count;id++){
   u32 at=u32(cp->hashes[id])&(cfg.table_size-1);
   while(cp->table[at]){require(++cp->rehash_probes<=probe_limit,"Parked checkpoint rehash work limit");at=(at+1)&(cfg.table_size-1);}
   require(++cp->rehash_probes<=probe_limit,"Parked checkpoint rehash work limit");cp->table[at]=id+1;
  }
  transfer_rehash_probes+=cp->rehash_probes;
 }
 return cp;
}

void Search::read_paused(u32 index,u32 token,Checkpoint& cp,bool transfer){
#ifdef PS_PRODUCTION_SEARCH
 require(false,"Production search rejects exact-BFS parked checkpoints");
#endif
 snapshot(index);const auto current=checked_slot(index,token);
 require(!cp.owned&&cp.compact_ready,"Parked reservation is already owned or not compact");
 require(current.status==Unfinished&&current.stage==Ready&&!current.probing,"Parked source is no longer settled");
 require(cp.source_slot==index&&cp.q.generation==generation&&cp.q.slot_generation==token,"Stale parked reservation identity");
 require(cp.q.expanded==current.expanded&&cp.q.grant_end==current.grant_end&&cp.q.count==current.count&&cp.q.head==current.head,"Parked source advanced after reservation");
 require(cp.rules==checkpoint_rules&&cp.config.parents==parents&&cp.config.kw==kw&&cp.config.hash_bits==hash_bits,"Parked reservation game/geometry mismatch");
 require(cp.config.table_size>=table_size&&cp.config.capacity==current.max_states,"Parked reservation capacity mismatch");
 require(cp.keys.size()==size_t(current.count)*kw&&cp.nodes.size()==current.count&&cp.hashes.size()==current.count&&cp.table.size()==cp.config.table_size,"Parked reservation arrays changed");
 require(cp.pristine.size()==kw&&cp.terminal.size()==kw&&cp.history.size()==slots,"Parked reservation metadata changed");
 require(cp.bytes()<=cp.limit_bytes,"Parked reservation exceeded its storage limit");
 for(u32 a=0;a<slots;a++){
  const auto& h=histories[size_t(index)*slots+a];
  require(h.ring.empty()&&h.seen.empty()&&cp.history[a].ring.empty()&&cp.history[a].seen.empty(),"Parked cycle-history ownership changed");
 }
 auto started=Clock::now();uint64_t bytes=0;
 auto copy=[&](auto& dest,const auto* source){if(!dest.empty()){const size_t size=dest.size()*sizeof(dest[0]);ck(cudaMemcpyAsync(dest.data(),source,size,cudaMemcpyDeviceToHost,stream));bytes+=size;}};
 copy(cp.pristine,pristine.p+size_t(index)*kw);copy(cp.terminal,terminal.p+size_t(index)*kw);
 copy(cp.keys,keys.p+size_t(index)*capacity*kw);copy(cp.nodes,nodes.p+size_t(index)*capacity);
 if(cp.config.table_size==table_size){copy(cp.hashes,hashes.p+size_t(index)*capacity);copy(cp.table,table.p+size_t(index)*table_size);}
 ck(cudaStreamSynchronize(stream));
 cp.q=current;
 for(u32 a=0;a<slots;a++)cp.history[a].parent=histories[size_t(index)*slots+a].parent;
 if(!transfer){
  // Diagnostic only: the GPU remains the sole owner. A later transfer repeats
  // the checked read; callers cannot submit this reservation to CPU or put().
  export_bytes+=bytes;return;
 }
 Query detached=current;detached.status=Transferred;
 ck(cudaMemcpyAsync(queries.p+index,&detached,sizeof(detached),cudaMemcpyHostToDevice,stream));ck(cudaStreamSynchronize(stream));
 for(u32 a=0;a<slots;a++)histories[size_t(index)*slots+a].parent=nil;
 cp.owned=true;host.p[index]=detached;
 transfer_readback_bytes+=bytes;transfer_take_ms+=elapsed(started);takes++;
}
