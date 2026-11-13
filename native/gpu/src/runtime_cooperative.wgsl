// One workgroup owns one board. The leader alone commits sequential gameplay;
// other lanes evaluate pure matching predicates against its unchanged board.
// Barriers are unconditional, including after completion and error states.
// Run at most eight leader-only transitions before another worker rendezvous.
// Each transition retains its existing bound. Matching stops this loop before
// any worker can observe a board that the leader is still changing.
const COOPERATIVE_SERIAL_PHASES:u32=8u;
const COOPERATIVE_CROSS_LINES:bool=false;
const PHASE_TIMESTAMPS:bool=false;
const UNIFORM_WORKGROUPS:bool=false;
const ATOMIC_ELIGIBILITY:bool=false;
var<workgroup> cooperative_guard_bits:atomic<u32>;
var<workgroup> profile_dispatch_phase:u32;
var<workgroup> cooperative_candidates:array<vec4<u32>,32u>;
var<workgroup> cooperative_matches:array<u32,32u>;
var<workgroup> cooperative_count:u32;
var<workgroup> cooperative_row:u32;
var<workgroup> cooperative_rp:u32;
var<workgroup> cooperative_rule:u32;
var<workgroup> cooperative_row_end:u32;
var<workgroup> cooperative_mode:u32;
var<workgroup> cooperative_rule_start:u32;
var<workgroup> cooperative_direct:u32;
var<workgroup> cooperative_direct_start:u32;
var<workgroup> cooperative_finished:u32;
var<workgroup> cooperative_profile_cells:array<vec2<u32>,32u>;
// Separate range descriptors remain immutable while workers populate their
// candidate slots. Reusing candidates for descriptors would race those stores.
var<workgroup> cooperative_ranges:array<vec4<u32>,32u>;
var<workgroup> cooperative_range_count:u32;

fn cooperative_line_possible(line:u32)->bool{
  let d=game[cooperative_rule];let vertical=d==1u || d==2u;
  let lines=select(game[G_HEIGHT],game[G_WIDTH],vertical);
  if(line>=lines){return false;}
  let offset=line_base+(line+select(game[G_WIDTH],0u,vertical))*OBJ_WORDS;
  let rp=cooperative_rp;let required=game[rp+3u];
  for(var w=0u;w<OBJ_WORDS;w++){
    if((line_objects[offset+w]&game[required+w])!=game[required+w]){return false;}
  }
  for(var i=0u;i<game[rp+1u];i++){
    let c=cell_ptr(game[rp]+i);if(game[c+17u]!=0u){continue;}
    for(var property=0u;property<game[c+4u];property++){
      var any_member=false;
      for(var w=0u;w<OBJ_WORDS;w++){any_member=any_member || (line_objects[offset+w]&game[game[c+5u+property]+w])!=0u;}
      if(!any_member){return false;}
    }
  }
  return true;
}
fn cooperative_line_jump(scan:u32,span:u32)->u32{
  if(scan>=cells()){return cells();}
  if(LINE_PRUNE && eligible_line_valid!=0u && eligible_line_row==cooperative_rp){
    let line=scan/span;
    let bits=eligible_line_bits&(0xffffffffu<<line);
    if(bits==0u){return cells();}
    let next_line=firstTrailingBit(bits);
    if(next_line>line){return next_line*span;}
  }
  return scan;
}

fn cooperative_eligibility_target()->u32{
  if(!SPARSE_RULES){return 0xffffffffu;}
  if(rd(PHASE)==9u){let gp=group_ptr();if(rd(RULE)+1u<game[gp]+game[gp+1u]){return rd(RULE);}return 0xffffffffu;}
  if(rd(PHASE)==1u){
    let end=select(game[G_EARLY_GROUPS],game[G_GROUPS],rd(LATE)!=0u);
    if(rd(GROUP)<end && sparse_possible_group(rd(GROUP))){return game[group_ptr()];}
  }
  return 0xffffffffu;
}
fn cooperative_zero_rule(){
  let rule=rd(RULE);
  if(eligible_rule_cached(rule)){
    let gp=group_ptr();let end=game[gp]+game[gp+1u];
    var next=min(eligible_rule_start+32u,end);
    let offset=rule-eligible_rule_start;
    if(offset<31u){
      let bits=eligible_rule_bits&(0xffffffffu<<(offset+1u));
      if(bits!=0u){next=min(next,eligible_rule_start+firstTrailingBit(bits));}
    }
    if(next>rule+1u){put(RULE,next-1u);}
  }
  // All jumped rules have zero matches. Adding/subtracting their zero totals
  // cannot change random choice, group passes, commands or live board writes.
  finish_rule(0u);
}

fn cooperative_prepare(){
  cooperative_row=rd(SCAN_ROW);
  cooperative_rp=row_ptr(cooperative_row);
  cooperative_rule=rule_ptr();
  cooperative_row_end=0u;
  cooperative_direct=0u;
  cooperative_range_count=0u;
  let rp=cooperative_rp;let d=game[cooperative_rule];
  let span=select(game[G_WIDTH],game[G_HEIGHT],d==1u || d==2u);
  let cached_lines=eligible_line_valid!=0u && eligible_line_row==rp;
  if(COOPERATIVE_CROSS_LINES && game[rp+2u]==0u){
    // At most 32 line visits and 32 candidates, including skipped lines.
    // Scan indices keep their original order across all ranges in this batch.
    for(var visits=0u;visits<32u && cooperative_count<32u;visits++){
      let scan=cooperative_line_jump(rd(SCAN_CELL),span);put(SCAN_CELL,scan);
      if(scan>=cells()){cooperative_row_end=1u;break;}
      let end=min(cells(),(scan/span+1u)*span);
      if(LINE_PRUNE && !cached_lines && !possible_line(cooperative_row,scan,d)){
        put(SCAN_CELL,end);continue;
      }
      let take=min(32u-cooperative_count,end-scan);
      if(cooperative_count==0u){cooperative_direct_start=scan;}
      cooperative_ranges[cooperative_range_count]=vec4(scan,cooperative_count,take,0u);
      cooperative_range_count++;cooperative_count+=take;put(SCAN_CELL,scan+take);
      cooperative_direct=1u;
    }
    add_work(17u,cooperative_range_count);
    if(rd(SCAN_CELL)>=cells()){cooperative_row_end=1u;}
    return;
  }
  if(game[rp+2u]==0u){
    // The common non-ellipsis case needs only a scan range. Each worker builds
    // its own origin; the leader need not generate 32 separate descriptors.
    for(var line=0u;line<32u;line++){
      let scan=cooperative_line_jump(rd(SCAN_CELL),span);put(SCAN_CELL,scan);
      if(scan>=cells()){cooperative_row_end=1u;return;}
      let end=min(cells(),(scan/span+1u)*span);
      if(LINE_PRUNE && !cached_lines && !possible_line(cooperative_row,scan,d)){put(SCAN_CELL,end);continue;}
      cooperative_direct=1u;cooperative_direct_start=scan;
      cooperative_count=min(32u,end-scan);put(SCAN_CELL,scan+cooperative_count);
      if(rd(SCAN_CELL)>=cells()){cooperative_row_end=1u;}
      return;
    }
    return;
  }
  // At most 32 cursor advances per bounded interpreter transition. Skipped
  // lines/prefixes count against this bound as well as actual candidates.
  for(var work=0u;work<32u;work++){
    var scan=cooperative_line_jump(rd(SCAN_CELL),span);
    if(scan!=rd(SCAN_CELL)){put(SCAN_CELL,scan);put(SCAN_GAP,0u);}
    let gap=rd(SCAN_GAP);
    if(scan>=cells()){cooperative_row_end=1u;break;}
    if(LINE_PRUNE && !cached_lines && gap==0u && !possible_line(cooperative_row,scan,d)){
      put(SCAN_CELL,(scan/span+1u)*span);continue;
    }
    let start=scan_origin(scan,d);let ellipses=game[rp+2u];
    let x=i32(start/game[G_HEIGHT]);let y=i32(start%game[G_HEIGHT]);
    let length=i32(game[rp+1u]-ellipses);var limit=1u;
    if(ellipses!=0u){switch d{
      case 1u:{limit=u32(max(0i,y-length+2i));}
      case 2u:{limit=u32(max(0i,i32(game[G_HEIGHT])-y-length+1i));}
      case 4u:{limit=u32(max(0i,x-length+2i));}
      case 8u:{limit=u32(max(0i,i32(game[G_WIDTH])-x-length+1i));}
      default:{limit=0u;}
    }}
    let divisor=max(1u,limit);
    let gaps=select(vec2(gap,0u),vec2(gap/divisor,gap%divisor),ellipses==2u);
    let impossible=MATCH_PREFIX_PRUNE && ellipses!=0u && gap==0u && !matches_prefix(cooperative_row,start);
    if(!impossible && limit>0u){
      cooperative_candidates[cooperative_count]=vec4(start,gaps,0u);cooperative_count++;
    }
    let maxgap=select(divisor,divisor*divisor,ellipses==2u);
    var next=gap+1u;
    if(ellipses==2u && gaps.x+gaps.y+1u>=limit){next=(gaps.x+1u)*divisor;}
    if(impossible){next=maxgap;}
    if(next<maxgap){put(SCAN_GAP,next);}else{put(SCAN_GAP,0u);put(SCAN_CELL,scan+1u);}
  }
  if(rd(SCAN_CELL)>=cells()){cooperative_row_end=1u;}
}
fn cooperative_match(candidate:vec4<u32>)->bool{
  let rp=cooperative_rp;let d=game[cooperative_rule];
  if(FLAT_ROW_MATCHING && game[rp+2u]==0u && (d==1u || d==2u || d==4u || d==8u)){
    return matches_flat_row(rp,d,candidate.x);
  }
  let step=direction(d);
  var p=vec2(i32(candidate.x/game[G_HEIGHT]),i32(candidate.x%game[G_HEIGHT]));
  var ellipse=0u;let gaps=candidate.yz;
  for(var i=0u;i<game[rp+1u];i++){
    let c=cell_ptr(game[rp]+i);
    if(game[c+17u]!=0u){p+=step*i32(gaps[ellipse]);ellipse++;continue;}
    if(any(p<vec2(0i)) || p.x>=i32(game[G_WIDTH]) || p.y>=i32(game[G_HEIGHT])){return false;}
    if(!matches_cell(c,u32(p.x)*game[G_HEIGHT]+u32(p.y))){return false;}
    p+=step;
  }
  return true;
}
fn cooperative_commit(){
  for(var i=0u;i<cooperative_count;i++){
    if(cooperative_matches[i]==0u){continue;}
    let count=rd(MATCH_COUNTS+cooperative_row);
    if(count>=MATCH_CAP){fail(3u);return;}
    let at=MATCHES+(cooperative_row*MATCH_CAP+count)*3u;
    let candidate=cooperative_candidates[i];
    put(at,candidate.x);put(at+1u,candidate.y);put(at+2u,candidate.z);
    put(MATCH_COUNTS+cooperative_row,count+1u);
  }
  if(cooperative_row_end!=0u){finish_matching_row(cooperative_row);}
}
fn cooperative_serial_phase(){
  count_work(rd(PHASE));count_work(16u);
  switch rd(PHASE){
    case 1u:{
      let end=select(game[G_EARLY_GROUPS],game[G_GROUPS],rd(LATE)!=0u);
      if(rd(GROUP)>=end){
        if(rd(LATE)==0u){put(MOVE_CURSOR,0u);put(MOVED_THIS_PASS,0u);put(PHASE,5u);}
        else{put(PHASE,7u);}
      }else if(rd(LATE)==0u && (rd(BANNED_GROUPS+rd(GROUP)/32u)&(1u<<(rd(GROUP)%32u)))!=0u){put(PHASE,4u);}
      else{begin_group();}
    }
    case 3u:{apply_tick();}
    case 4u:{end_group();}
    case 5u:{movement_tick();}
    case 6u:{rigid_tick();}
    case 7u:{finish_turn();}
    case 8u:{finish_result(!same(BOARD,BEFORE));}
    case 9u:{
      cooperative_zero_rule();
    }
    default:{fail(8u);}
  }
}
@compute @workgroup_size(32u)
fn main_cooperative(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
  if(group.x>=params.z){return;}
  base=group.x*STATE_WORDS;line_base=group.x*cache_stride();
  opcode=inputs[params.x*params.z+group.x];
  if(lane==0u){
    load_execution_registers();
    if(PHASE_TIMESTAMPS){profile_dispatch_phase=select(rd(PHASE),0u,rd(EPOCH)!=params.y);}
    eligible_rule_valid=0u;
    eligible_line_valid=rd(COOP_LINE_VALID);
    eligible_line_row=rd(COOP_LINE_ROW);eligible_line_bits=rd(COOP_LINE_BITS);
    if((params.w&0x80000000u)!=0u && opcode==0xffffffffu){put(EPOCH,params.y);put(STATUS,1u);}
    else if((params.w&0x80000000u)!=0u && (opcode==6u || opcode==7u)){fail(14u);}
    else if(rd(EPOCH)!=params.y){start_operation();}
  }
  for(var fuel=0u;fuel<(params.w&0x7fffffffu);fuel++){
    if(lane==0u){
      count_work(10u);
      cooperative_count=0u;cooperative_row_end=0u;cooperative_mode=0u;
      if(ATOMIC_ELIGIBILITY){atomicStore(&cooperative_guard_bits,0u);}
      for(var serial=0u;serial<COOPERATIVE_SERIAL_PHASES;serial++){
        if(rd(STATUS)!=0u){break;}
        if(PHASE_TIMESTAMPS && (profile_dispatch_phase==0u || rd(PHASE)!=profile_dispatch_phase)){break;}
        if(rd(PHASE)==2u){
          count_work(2u);
          let rp=row_ptr(rd(SCAN_ROW));let rule=rule_ptr();let d=game[rule];
          let lines=select(game[G_HEIGHT],game[G_WIDTH],d==1u || d==2u);
          if(LINE_PRUNE && lines<=32u && (eligible_line_valid==0u || eligible_line_row!=rp)){
            cooperative_mode=3u;cooperative_rp=rp;cooperative_rule=rule;
          }else{cooperative_mode=1u;cooperative_prepare();}
          break;
        }
        else{
          let candidate_rule=cooperative_eligibility_target();
          if(candidate_rule!=0xffffffffu && !eligible_rule_cached(candidate_rule)){
            cooperative_mode=2u;cooperative_rule_start=candidate_rule;
            break;
          }else{cooperative_serial_phase();}
        }
      }
      if(UNIFORM_WORKGROUPS && (rd(STATUS)!=0u || (PHASE_TIMESTAMPS && (profile_dispatch_phase==0u || rd(PHASE)!=profile_dispatch_phase)))){
        cooperative_mode=4u;
      }
    }
    if(PROFILE_WORK && lane==0u){
      if(cooperative_mode==1u){count_work(11u);add_work(12u,cooperative_count);add_work(13u,32u);}
      if(cooperative_mode==2u){count_work(14u);}
      if(cooperative_mode==3u){count_work(15u);}
    }
    var uniform_mode=0u;
    if(UNIFORM_WORKGROUPS){
      // The builtin publishes all leader-written workgroup descriptors and
      // supplies the same decision to every lane. Mode zero has no worker
      // storage reads/writes; defer storage synchronization until workers run.
      uniform_mode=workgroupUniformLoad(&cooperative_mode);
      if(uniform_mode==4u){break;}
    }else{workgroupBarrier();}
    // Matching lanes consume storage writes from the leader, in addition to
    // workgroup descriptors. Both address spaces require synchronization.
    if(!UNIFORM_WORKGROUPS || uniform_mode!=0u){
    storageBarrier();
    if(lane<cooperative_count){
      if(cooperative_direct!=0u){
        var scan=cooperative_direct_start+lane;
        if(COOPERATIVE_CROSS_LINES && cooperative_range_count>1u){
          for(var r=0u;r<cooperative_range_count;r++){
            let range=cooperative_ranges[r];
            if(lane>=range.y && lane-range.y<range.z){scan=range.x+lane-range.y;break;}
          }
        }
        cooperative_candidates[lane]=vec4(scan_origin(scan,game[cooperative_rule]),0u,0u,0u);
      }
      cooperative_matches[lane]=select(0u,1u,cooperative_match(cooperative_candidates[lane]));
    }
    if(cooperative_mode==2u){
      let rule=cooperative_rule_start+lane;
      var possible=false;if(rule<game[G_RULES]){possible=sparse_possible_rule(rule);}
      if(ATOMIC_ELIGIBILITY){if(possible){atomicOr(&cooperative_guard_bits,1u<<lane);}}
      else{cooperative_matches[lane]=select(0u,1u,possible);}
    }
    if(cooperative_mode==3u){
      let possible=cooperative_line_possible(lane);
      if(ATOMIC_ELIGIBILITY){if(possible){atomicOr(&cooperative_guard_bits,1u<<lane);}}
      else{cooperative_matches[lane]=select(0u,1u,possible);}
    }
    workgroupBarrier();
    storageBarrier();
    if(lane==0u && rd(STATUS)==0u){
      if(cooperative_mode==1u){cooperative_commit();}
      if(cooperative_mode==2u){
        var bits=0u;
        if(ATOMIC_ELIGIBILITY){bits=atomicLoad(&cooperative_guard_bits);}
        else{for(var i=0u;i<32u;i++){bits|=cooperative_matches[i]<<i;}}
        eligible_rule_start=cooperative_rule_start;eligible_rule_bits=bits;eligible_rule_valid=1u;
        cooperative_serial_phase();
      }
      if(cooperative_mode==3u){
        var bits=0u;
        if(ATOMIC_ELIGIBILITY){bits=atomicLoad(&cooperative_guard_bits);}
        else{for(var i=0u;i<32u;i++){bits|=cooperative_matches[i]<<i;}}
        eligible_line_row=cooperative_rp;eligible_line_bits=bits;eligible_line_valid=1u;
        if(bits==0u){put(SCAN_CELL,cells());put(SCAN_GAP,0u);finish_matching_row(rd(SCAN_ROW));}
      }
    }
    }
    if(lane==0u){
      cooperative_finished=rd(STATUS);
      if(PHASE_TIMESTAMPS && (profile_dispatch_phase==0u || rd(PHASE)!=profile_dispatch_phase)){cooperative_finished=1u;}
    }
    // This builtin gives every lane the same decision. Checking once per eight
    // work units avoids hundreds of idle barriers after a short turn finishes.
    // Loop control and all barriers remain uniform across the workgroup.
    if(!UNIFORM_WORKGROUPS && (fuel&7u)==7u){if(workgroupUniformLoad(&cooperative_finished)!=0u){break;}}
  }
  if(PROFILE_WORK){
    cooperative_profile_cells[lane]=vec2(profile_cell_calls,profile_cell_overflow);
    workgroupBarrier();
    if(lane==0u){
      var total=rd(40u);
      for(var i=0u;i<32u;i++){
        let counted=cooperative_profile_cells[i];
        if(counted.y!=0u || counted.x>0xffffffffu-total){fail(10u);break;}
        total+=counted.x;
      }
      put(40u,total);
    }
  }
  if(lane==0u){
    put(COOP_LINE_ROW,eligible_line_row);put(COOP_LINE_BITS,eligible_line_bits);put(COOP_LINE_VALID,eligible_line_valid);
    save_execution_registers();report_completion(group.x);
    if(PHASE_TIMESTAMPS){status[params.z+group.x]=profile_dispatch_phase;}
  }
}
