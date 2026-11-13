#pragma once
// Search member definitions; included inside namespace resident.
u32 Search::move_to(u32 index,u32 token,Search& dest,u32 target,u32 target_token,u32 rehash_limit){
#ifdef PS_PRODUCTION_SEARCH
 require(false,"Production search rejects exact-BFS ownership/checkpoint operations");
#endif
 require(this!=&dest,"Device move requires independent pools");
 const Query original=checked_slot(index,token),old=dest.checked_slot(target,target_token);
 const bool storage=original.status==Memory&&(original.detail==DeviceCapacity||original.detail==HashCapacity);
 require(original.status==Running||original.status==Unfinished||storage,"Device move requires a live query");
 require(old.status!=Running&&old.status!=Unfinished,"Device move destination is live");
 require(target_token<0x7fffffffu&&rehash_limit&&rehash_limit<=16777216,"Device move generation/rehash bound");
 require(device_ordinal==dest.device_ordinal,"Device move adapter mismatch");
 require(g.g==dest.g.g&&std::memcmp(&g.l,&dest.g.l,sizeof(Layout))==0&&std::memcmp(&g.sparse,&dest.g.sparse,sizeof(Params))==0,"Device move compiled game/layout mismatch");
 require(parents==dest.parents&&kw==dest.kw&&hash_bits==dest.hash_bits,"Device move hash/lane geometry mismatch");
 require(original.count<=dest.capacity&&original.count<=dest.table_size,"Device move destination capacity");
 const uint64_t cost=uint64_t(kw)*8+128;uint64_t incoming=0,outgoing=0;
 for(u32 a=0;a<slots;a++){incoming+=histories[size_t(index)*slots+a].ring.size()*cost;outgoing+=dest.histories[size_t(target)*slots+a].ring.size()*cost;}
 require(dest.history_bytes-outgoing+incoming<=256ull*1024*1024,"Device move cycle-history capacity");
 // Retirement's metadata event precedes its optional host callback. Fence both
 // streams before mutating buffers or transferring their host-side histories.
 ck(cudaStreamSynchronize(stream));ck(cudaStreamSynchronize(dest.stream));auto started=Clock::now();
 Query q=original;q.generation=dest.generation;q.slot_generation=target_token+1;q.receipt_round=u32(dest.waves);q.receipt_error=0;
 if(storage){q.status=Running;q.detail=None;}
 uint64_t bytes=0;auto copy=[&](auto* to,const auto* from,size_t count){if(count){ck(cudaMemcpyAsync(to,from,count*sizeof(*from),cudaMemcpyDeviceToDevice,dest.stream));bytes+=count*sizeof(*from);}};
 try{
  if(table_size==dest.table_size)copy(dest.table.p+size_t(target)*dest.table_size,table.p+size_t(index)*table_size,table_size);
  else{
   PathState p;p.cursor=0;p.length=nil;
   ck(cudaMemsetAsync(dest.table.p+size_t(target)*dest.table_size,0,size_t(dest.table_size)*4,dest.stream));
   ck(cudaMemcpyAsync(dest.paths.p+target,&p,sizeof(p),cudaMemcpyHostToDevice,dest.stream));
   u32 launches=0;while(p.cursor<q.count&&!p.error){
    require(++launches<=rehash_limit/4096+2,"Device move rehash continuation bound");const auto prior=p;
    rehash_move<<<1,1,0,dest.stream>>>(hashes.p+size_t(index)*capacity,q.count,dest.table.p+size_t(target)*dest.table_size,dest.table_size,dest.paths.p+target,4096,rehash_limit);ck(cudaGetLastError());device_rehash_launches++;
    ck(cudaMemcpyAsync(&p,dest.paths.p+target,sizeof(p),cudaMemcpyDeviceToHost,dest.stream));ck(cudaStreamSynchronize(dest.stream));device_move_metadata_bytes+=sizeof(p);
    require(p.cursor>=prior.cursor&&p.cursor<=q.count&&p.done>=prior.done&&p.done<=rehash_limit&&(p.done>prior.done||p.error),"Invalid device move rehash receipt");
   }
   device_rehash_probes+=p.done;
   if(p.error){
    // Source remains the owner. The unused destination namespace is consumed
    // and vacated; its partially rebuilt table can never execute.
    Query vacant=old;vacant.status=Vacant;vacant.slot_generation=target_token+1;
    ck(cudaMemcpyAsync(dest.queries.p+target,&vacant,sizeof(vacant),cudaMemcpyHostToDevice,dest.stream));ck(cudaStreamSynchronize(dest.stream));
    dest.host.p[target]=vacant;dest.slot_generations[target]=vacant.slot_generation;
    throw std::runtime_error("Device move rehash work limit");
   }
   if(q.probing){q.probe_slot=u32(q.hash)&(dest.table_size-1);q.probe_count=0;}
  }
  copy(dest.pristine.p+size_t(target)*kw,pristine.p+size_t(index)*kw,kw);copy(dest.terminal.p+size_t(target)*kw,terminal.p+size_t(index)*kw,kw);
  copy(dest.keys.p+size_t(target)*dest.capacity*kw,keys.p+size_t(index)*capacity*kw,size_t(q.count)*kw);
  copy(dest.hashes.p+size_t(target)*dest.capacity,hashes.p+size_t(index)*capacity,q.count);copy(dest.nodes.p+size_t(target)*dest.capacity,nodes.p+size_t(index)*capacity,q.count);
  copy(dest.gpu.s.p+size_t(target)*slots*g.l.STATE_WORDS,gpu.s.p+size_t(index)*slots*g.l.STATE_WORDS,size_t(slots)*g.l.STATE_WORDS);
  const size_t cache_words=size_t(slots)*((g.l.CELL_CAP+1)*g.l.OBJ_WORDS+g.l.MOV_WORDS);
  copy(dest.gpu.cache.p+size_t(target)*cache_words,gpu.cache.p+size_t(index)*cache_words,cache_words);
  copy(dest.scratch_keys.p+size_t(target)*slots*kw,scratch_keys.p+size_t(index)*slots*kw,size_t(slots)*kw);
  copy(dest.scratch_hashes.p+size_t(target)*slots,scratch_hashes.p+size_t(index)*slots,slots);
  PathState path;ck(cudaMemcpyAsync(dest.paths.p+target,&path,sizeof(path),cudaMemcpyHostToDevice,dest.stream));
  ck(cudaMemcpyAsync(dest.queries.p+target,&q,sizeof(q),cudaMemcpyHostToDevice,dest.stream));ck(cudaStreamSynchronize(dest.stream));
  Query detached=original;detached.status=Transferred;ck(cudaMemcpyAsync(queries.p+index,&detached,sizeof(detached),cudaMemcpyHostToDevice,stream));ck(cudaStreamSynchronize(stream));
  // Swapping allocated containers preserves exact cycle witnesses without
  // allocating/copying their strings or changing aggregate host storage.
  for(u32 a=0;a<slots;a++){auto& from=histories[size_t(index)*slots+a];auto& to=dest.histories[size_t(target)*slots+a];from.seen.swap(to.seen);from.ring.swap(to.ring);std::swap(from.parent,to.parent);from.seen.clear();from.ring.clear();from.parent=nil;}
  history_bytes-=incoming;dest.history_bytes=dest.history_bytes-outgoing+incoming;
  host.p[index]=detached;dest.host.p[target]=q;dest.slot_generations[target]=q.slot_generation;dest.decoded_paths[target].clear();dest.path_ready[target]=false;
  device_moves++;device_move_bytes+=bytes;device_move_ms+=elapsed(started);return q.slot_generation;
 }catch(const std::exception& e){if(std::string(e.what())!="Device move rehash work limit"){poisoned=true;dest.poisoned=true;}throw;}
}
std::unique_ptr<Checkpoint> Search::take(u32 index,u32 token,uint64_t limit,bool terminal_ok,bool compact_ready){
#ifdef PS_PRODUCTION_SEARCH
 require(false,"Production search rejects exact-BFS ownership/checkpoint operations");
#endif
 snapshot(index);const auto& current=checked_slot(index,token);
 bool storage_limit=current.status==Memory&&(current.detail==DeviceCapacity||current.detail==HashCapacity);
 bool allow_terminal=terminal_ok&&current.status!=Vacant&&current.status!=Transferred&&current.status!=Failure;
 require(current.status==Running||current.status==Unfinished||storage_limit||allow_terminal,"Only a live/unfinished or device-storage-limited query can transfer to CPU");
 const bool compact=compact_ready&&current.stage==Ready&&current.status==Unfinished&&!current.probing;
 u32 cpu_table_size=std::max(table_size,std::bit_ceil(current.max_states*2));
 const auto& l=g.l;uint64_t history_size=0;for(u32 a=0;a<slots;a++)history_size+=histories[size_t(index)*slots+a].ring.size()*(uint64_t(kw)*8+128);
 uint64_t estimate=sizeof(Checkpoint)+g.g.size()*4+uint64_t(slots)*(sizeof(History)+(compact?0:uint64_t(l.STATE_WORDS)*4+((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS)*4+kw*4+8))+
  uint64_t(current.count)*(kw*4+sizeof(Node)+8)+uint64_t(table_size)*4+kw*8+history_size+8192+(cpu_table_size==table_size?0:uint64_t(cpu_table_size)*4);
 require(estimate<=limit,"CPU checkpoint storage limit before ownership transfer");
 if(!checkpoint_rules)checkpoint_rules=std::make_shared<RuleData>(g);
 auto result=std::make_unique<Checkpoint>(checkpoint_rules,settings,current,limit,compact);result->source_slot=index;result->source_gpu_waves=waves;auto started=Clock::now();uint64_t bytes=0;
 auto read=[&](auto& dest,const auto* source){if(!dest.empty()){size_t count=dest.size()*sizeof(dest[0]);ck(cudaMemcpyAsync(dest.data(),source,count,cudaMemcpyDeviceToHost,stream));bytes+=count;}};
 read(result->pristine,pristine.p+size_t(index)*kw);read(result->terminal,terminal.p+size_t(index)*kw);
 read(result->keys,keys.p+size_t(index)*capacity*kw);read(result->hashes,hashes.p+size_t(index)*capacity);read(result->nodes,nodes.p+size_t(index)*capacity);read(result->table,table.p+size_t(index)*table_size);
 read(result->states,gpu.s.p+size_t(index)*slots*l.STATE_WORDS);read(result->cache,gpu.cache.p+size_t(index)*slots*((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS));
 read(result->packed,scratch_keys.p+size_t(index)*slots*kw);read(result->packed_hashes,scratch_hashes.p+size_t(index)*slots);ck(cudaStreamSynchronize(stream));
 for(u32 a=0;a<slots;a++)result->history[a]=histories[size_t(index)*slots+a];
 if(cpu_table_size!=table_size){auto rebuilt=checkpoint_table(result->hashes,result->q.count,cpu_table_size);result->table=std::move(rebuilt.entries);result->rehash_probes=rebuilt.probes;result->config.table_size=cpu_table_size;if(result->q.probing){result->q.probe_slot=u32(result->q.hash)&(cpu_table_size-1);result->q.probe_count=0;}}
 result->config.capacity=current.max_states;
 if(storage_limit){result->q.status=Running;result->q.detail=None;}
 require(result->bytes()<=limit,"CPU checkpoint retained storage limit");
 // All data is fenced and owned before disabling the source. No host search
 // is allowed while the source slot can still advance this same query.
 Query detached=current;detached.status=Transferred;ck(cudaMemcpyAsync(queries.p+index,&detached,sizeof(detached),cudaMemcpyHostToDevice,stream));ck(cudaStreamSynchronize(stream));
 for(u32 a=0;a<slots;a++){auto& h=histories[size_t(index)*slots+a];h.seen.clear();h.ring.clear();h.parent=nil;}history_bytes-=history_size;
 transfer_readback_bytes+=bytes;transfer_rehash_probes+=result->rehash_probes;transfer_take_ms+=elapsed(started);takes++;snapshot(index);return result;
}
u32 Search::put(u32 index,u32 token,Checkpoint& checkpoint,uint64_t available){
#ifdef PS_PRODUCTION_SEARCH
 require(false,"Production search rejects exact-BFS ownership/checkpoint operations");
#endif
 const auto& old=checked_slot(index,token);require(old.status!=Running&&old.status!=Unfinished,"Destination query slot is live");require(token<0x7fffffffu,"Query slot generation overflow");require(checkpoint.owned,"Checkpoint already consumed");
 require(checkpoint.q.status!=Failure&&checkpoint.q.status!=Transferred&&checkpoint.q.status!=Vacant,"Invalid checkpoint execution state");
 require(checkpoint.rules->game==g.g&&std::memcmp(&checkpoint.rules->layout,&g.l,sizeof(Layout))==0,"Checkpoint compiled game/layout mismatch");
 require(checkpoint.config.parents==parents&&checkpoint.config.kw==kw&&checkpoint.config.hash_bits==hash_bits,"Checkpoint hash/lane geometry mismatch");
 require(!checkpoint.compact_ready||(checkpoint.q.stage==Ready&&!checkpoint.q.probing),"Compact checkpoint return requires settled state");
 require(checkpoint.q.count<=capacity,"Checkpoint exceeds destination node capacity");
 uint64_t cost=uint64_t(kw)*8+128,old_history=0,new_history=checkpoint.history_bytes();for(u32 a=0;a<slots;a++)old_history+=histories[size_t(index)*slots+a].ring.size()*cost;
 require(history_bytes-old_history+new_history<=256ull*1024*1024,"Checkpoint exceeds destination cycle-history capacity");
 Query q=checkpoint.q;q.generation=generation;q.slot_generation=token+1;q.receipt_round=u32(waves);q.receipt_error=0;PathState path;
 bool rehash=checkpoint.config.table_size!=table_size;
 require(checkpoint.bytes()+new_history+slots*sizeof(History)+(rehash?uint64_t(table_size)*4:0)<=std::min(checkpoint.limit_bytes,available),"Checkpoint return staging storage limit");
 RehashedTable remapped;const u32* table_data=checkpoint.table.data();
 if(rehash){remapped=checkpoint_table(checkpoint.hashes,q.count,table_size);table_data=remapped.entries.data();if(q.probing){q.probe_slot=u32(q.hash)&(table_size-1);q.probe_count=0;}}
 // Allocate/copy host containers before any destination state is changed.
 std::vector<History> copied_history=checkpoint.history;auto started=Clock::now();uint64_t bytes=0;
 auto write=[&](auto* dest,const auto* source,size_t count){if(count){ck(cudaMemcpyAsync(dest,source,count*sizeof(*source),cudaMemcpyHostToDevice,stream));bytes+=count*sizeof(*source);}};
 write(pristine.p+size_t(index)*kw,checkpoint.pristine.data(),kw);write(terminal.p+size_t(index)*kw,checkpoint.terminal.data(),kw);
 write(keys.p+size_t(index)*capacity*kw,checkpoint.keys.data(),size_t(q.count)*kw);write(hashes.p+size_t(index)*capacity,checkpoint.hashes.data(),q.count);write(nodes.p+size_t(index)*capacity,checkpoint.nodes.data(),q.count);
 write(table.p+size_t(index)*table_size,table_data,table_size);
 if(checkpoint.compact_ready){
  // A resumed grant reconstructs every active lane from its canonical key.
  // Clear scratch locally so no previous slot occupant can affect execution.
  ck(cudaMemsetAsync(gpu.s.p+size_t(index)*slots*g.l.STATE_WORDS,0,size_t(slots)*g.l.STATE_WORDS*4,stream));
  const size_t cache_words=size_t(slots)*((g.l.CELL_CAP+1)*g.l.OBJ_WORDS+g.l.MOV_WORDS);
  ck(cudaMemsetAsync(gpu.cache.p+size_t(index)*cache_words,0,cache_words*4,stream));
  ck(cudaMemsetAsync(scratch_keys.p+size_t(index)*slots*kw,0,size_t(slots)*kw*4,stream));
  ck(cudaMemsetAsync(scratch_hashes.p+size_t(index)*slots,0,size_t(slots)*sizeof(uint64_t),stream));
 }else{
  write(gpu.s.p+size_t(index)*slots*g.l.STATE_WORDS,checkpoint.states.data(),checkpoint.states.size());write(gpu.cache.p+size_t(index)*slots*((g.l.CELL_CAP+1)*g.l.OBJ_WORDS+g.l.MOV_WORDS),checkpoint.cache.data(),checkpoint.cache.size());
 }
 write(scratch_keys.p+size_t(index)*slots*kw,checkpoint.packed.data(),checkpoint.packed.size());write(scratch_hashes.p+size_t(index)*slots,checkpoint.packed_hashes.data(),checkpoint.packed_hashes.size());write(paths.p+index,&path,1);write(queries.p+index,&q,1);ck(cudaStreamSynchronize(stream));
 for(u32 a=0;a<slots;a++)histories[size_t(index)*slots+a]=std::move(copied_history[a]);history_bytes=history_bytes-old_history+new_history;
 slot_generations[index]=q.slot_generation;decoded_paths[index].clear();path_ready[index]=false;
 checkpoint.owned=false;returns++;transfer_rehash_probes+=remapped.probes;transfer_upload_bytes+=bytes;transfer_put_ms+=elapsed(started);host.p[index]=q;return q.slot_generation;
}
