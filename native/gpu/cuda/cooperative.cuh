// One warp owns one board. Pure matching runs in parallel; lane zero alone
// commits gameplay, commands, RNG, movement and history. All rendezvous are
// uniform across the complete warp, including terminal/error continuations.
#ifdef PS_CUDA_PHASE_PROFILE
// Diagnostic builds only. Each warp accumulates privately and merges once per
// dispatch. SM clocks include suspension; these are not utilization counters.
__device__ unsigned long long interpreter_phase_totals[48];
__device__ unsigned int interpreter_phase_overflow;
#define PS_PHASE_LEADER_START const u32 profile_phase=r.cursor_PHASE;const u32 profile_ellipses=profile_phase==2?g[r.row_ptr(r.cursor_SCAN_ROW)+2]:0;const auto profile_started=clock64()
#define PS_PHASE_LEADER_END do{const auto delta=clock64()-profile_started;if(profile_phase<10){profile[profile_phase]+=delta;profile[10+profile_phase]++;}if(profile_phase==2){const u32 bucket=profile_ellipses?34:32;profile[bucket]+=delta;profile[bucket+1]++;if(shared.cooperative_mode==1&&shared.cooperative_direct==2){profile[36]+=delta;profile[37]++;}}}while(false)
#else
#define PS_PHASE_LEADER_START
#define PS_PHASE_LEADER_END
#endif
template<int OW,int MW,bool PreserveIdle=false>__global__ void execute_cooperative(Layout l,Params sparse,const u32*g,u32*s,u32*cache,u32*status,const u32*ops,u32 epoch,u32 fuel_limit,u32 n,u32*receipts,bool compact_lines=false,bool parallel_ellipses=false,bool parallel_finish=false){
 u32 board=blockIdx.x,lane=threadIdx.x;if(board>=n)return;
 if constexpr(PreserveIdle){
  // A resource-paused query may still own unfinished interpreter cursors.
  // Service waves for its peers must not overwrite STATUS/EPOCH in those lanes.
  if(ops[board]==0xffffffffu){if(lane==0){status[board]=1;receipts[board]+=2;}return;}
 }
#ifdef PS_CUDA_PHASE_PROFILE
 unsigned long long profile[48]{};unsigned long long worker_started=0,dispatch_started=0;if(lane==0)dispatch_started=clock64();
#endif
 __shared__ CooperativeShared shared;
 Engine<OW,MW,true>r{};static_cast<Layout&>(r)=l;r.shared=&shared;r.compact_lines=compact_lines;
 // Prefix witnesses live only in this launch. With one fuel step, rebuilding
 // them would consume the entire dispatch forever. The original matcher stores
 // its scan/gap cursors and therefore makes progress even at fuel=1.
 r.parallel_ellipses=parallel_ellipses&&(fuel_limit&0x7fffffffu)>1;
 r.game=g;r.sparse_metadata=sparse;r.states=s+size_t(board)*l.STATE_WORDS;r.line_objects=cache+size_t(board)*((l.CELL_CAP+1)*l.OBJ_WORDS+l.MOV_WORDS);
 r.base=0;r.line_base=0;r.opcode=ops[board];r.params={0,epoch,1,fuel_limit};
 if(lane==0){r.load_execution_registers();shared.eligible_rule_valid=0;shared.prefix_valid=0;shared.eligible_line_valid=r.rd(r.COOP_LINE_VALID);shared.eligible_line_row=r.rd(r.COOP_LINE_ROW);shared.eligible_line_bits=r.rd(r.COOP_LINE_BITS);
  if(r.opcode==0xffffffffu){r.cursor_put_EPOCH(epoch);r.cursor_put_STATUS(1);}
  else if(r.cursor_EPOCH!=epoch)r.start_operation();
 }
 for(u32 fuel=0;fuel<(fuel_limit&0x7fffffffu);fuel++){
  if(lane==0){
   shared.cooperative_count=0;shared.cooperative_row_end=0;shared.cooperative_mode=0;
   for(u32 serial=0;serial<r.COOPERATIVE_SERIAL_PHASES;serial++){
    if(r.cursor_STATUS)break;
    PS_PHASE_LEADER_START;
    // These guards leave every branch that can restore/change the board before
    // finish_result on the original serial path. In particular, vanilla AGAIN
    // probing never consumes a previously computed win or modification result.
    if(parallel_finish&&r.cursor_PHASE==7&&r.cursor_PROBING==0&&!(r.cursor_COMMANDS&3u)&&!(g[r.G_FLAGS]&4u)){
     shared.cooperative_mode=6;shared.finish_commands=r.cursor_COMMANDS;PS_PHASE_LEADER_END;break;
    }
    if(r.cursor_PHASE==2){u32 rp=r.row_ptr(r.cursor_SCAN_ROW),rule=r.rule_ptr(),d=g[rule],lines=(d==1||d==2)?g[r.G_WIDTH]:g[r.G_HEIGHT];
     if(r.LINE_PRUNE&&lines<=32&&(!shared.eligible_line_valid||shared.eligible_line_row!=rp)){shared.cooperative_mode=3;shared.cooperative_rp=rp;shared.cooperative_rule=rule;}
     else{shared.cooperative_mode=1;r.cooperative_prepare();}PS_PHASE_LEADER_END;break;
    }
    u32 candidate=r.cooperative_eligibility_target();if(candidate!=0xffffffffu&&!r.eligible_rule_cached(candidate)){shared.cooperative_mode=2;shared.cooperative_rule_start=candidate;PS_PHASE_LEADER_END;break;}
    r.cooperative_serial_phase();
    PS_PHASE_LEADER_END;
   }
   if(r.cursor_STATUS)shared.cooperative_mode=4;
#ifdef PS_CUDA_PHASE_PROFILE
   worker_started=clock64();profile[31]++;
#endif
  }
  __syncwarp();u32 mode=shared.cooperative_mode;if(mode==4)break;
  if(mode){bool possible=false;
   if(mode==6){
    bool changed=false;for(u32 i=lane;i<l.CELL_CAP*r.object_words();i+=32)changed|=r.rd(r.BOARD+i)!=r.rd(r.BEFORE+i);
    const bool modified=__any_sync(0xffffffffu,changed);
    bool won=(shared.finish_commands&4u)!=0;
    if(!won&&g[r.G_WINS]){
     won=true;for(u32 w=0;w<g[r.G_WINS];w++){
      const u32 p=g[r.G_WIN_BASE]+w*5;bool some=false,bad=false;
      for(u32 i=lane;i<r.cells();i+=32){const bool a=r.selected(i,g[p+1],g[p+3]!=0),b=r.selected(i,g[p+2],g[p+4]!=0);some|=a&&b;bad|=a&&!b;}
      const bool any=__any_sync(0xffffffffu,some),not_all=__any_sync(0xffffffffu,bad);
      if((g[p]==0&&any)||(g[p]==1&&!any)||(g[p]==2&&not_all)){won=false;break;}
     }
    }
    if(lane==0){shared.finish_modified=u32(modified);shared.finish_won=u32(won);}
   }
   if(mode==1&&lane<shared.cooperative_count){bool valid=true;
    if(shared.cooperative_direct>=3){auto v=shared.cooperative_ranges[0];const u32 gap=v.y+lane;const auto gaps=shared.cooperative_direct==4?v2(gap/v.z,gap%v.z):v2(gap,0u);valid=shared.cooperative_direct!=4||gaps.x+gaps.y+1<=v.w;shared.cooperative_candidates[lane]=v4(v.x,gaps,0u);}
    else if(shared.cooperative_direct){u32 scan=shared.cooperative_direct_start+lane;
     if(shared.cooperative_direct==2){auto v=shared.cooperative_ranges[0];const u32 index=v.y+lane;scan=nthSetBit(v.x,index/v.z)*v.z+index%v.z;}
     else if(shared.cooperative_range_count>1){for(u32 range=0;range<shared.cooperative_range_count;range++){auto v=shared.cooperative_ranges[range];if(lane>=v.y&&lane-v.y<v.z){scan=v.x+lane-v.y;break;}}}
     shared.cooperative_candidates[lane]=v4(r.scan_origin(scan,g[shared.cooperative_rule]),0u,0u,0u);
    }
    possible=valid&&r.cooperative_match(shared.cooperative_candidates[lane]);shared.cooperative_matches[lane]=u32(possible);
   }
   if(mode==2){u32 rule=shared.cooperative_rule_start+lane;possible=rule<g[r.G_RULES]&&r.sparse_possible_rule(rule);}
   if(mode==3)possible=r.cooperative_line_possible(lane);
   if(mode==5){const u32 scan=shared.prefix_start+lane;if(scan<shared.prefix_end)possible=r.prefix_candidate_matches(shared.cooperative_rp,r.scan_origin(scan,g[shared.cooperative_rule]),g[shared.cooperative_rule]);}
   u32 bits=__ballot_sync(0xffffffffu,possible);__syncwarp();
#ifdef PS_CUDA_PHASE_PROFILE
   unsigned long long commit_started=0;if(lane==0){const auto bucket=mode==1?20u:mode==2?22u:mode==5?40u:mode==6?42u:24u;profile[bucket]+=clock64()-worker_started;profile[bucket+1]++;profile[30]+=__popc(bits);if(mode==1){profile[38]+=shared.cooperative_count;if(!shared.cooperative_count)profile[39]++;}commit_started=clock64();}
#endif
   if(lane==0&&!r.cursor_STATUS){
    if(mode==1)r.cooperative_commit();
    if(mode==2){shared.eligible_rule_start=shared.cooperative_rule_start;shared.eligible_rule_bits=bits;shared.eligible_rule_valid=1;r.cooperative_serial_phase();}
    if(mode==3){shared.eligible_line_row=shared.cooperative_rp;shared.eligible_line_bits=bits;shared.eligible_line_valid=1;if(!bits){r.cursor_put_SCAN_CELL(r.cells());r.cursor_put_SCAN_GAP(0);r.finish_matching_row(r.cursor_SCAN_ROW);}}
    if(mode==5){shared.prefix_bits=bits;shared.prefix_valid=1;}
    if(mode==6){r.finish_win_value=shared.finish_won!=0;r.finish_win_valid=true;r.finish_result(shared.finish_modified!=0);r.finish_win_valid=false;}
   }
#ifdef PS_CUDA_PHASE_PROFILE
   if(lane==0){profile[26]+=clock64()-commit_started;profile[27]++;}
#endif
  }
  __syncwarp();
 }
 if(lane==0){r.put(r.COOP_LINE_ROW,shared.eligible_line_row);r.put(r.COOP_LINE_BITS,shared.eligible_line_bits);r.put(r.COOP_LINE_VALID,shared.eligible_line_valid);r.save_execution_registers();status[board]=r.rd(r.STATUS);receipts[board]+=2;}
#ifdef PS_CUDA_PHASE_PROFILE
 if(lane==0){profile[28]+=clock64()-dispatch_started;profile[29]++;for(u32 i=0;i<48;i++){auto prior=atomicAdd(interpreter_phase_totals+i,profile[i]);if(prior>~0ull-profile[i])atomicExch(&interpreter_phase_overflow,1u);}}
#endif
}
#undef PS_PHASE_LEADER_START
#undef PS_PHASE_LEADER_END
