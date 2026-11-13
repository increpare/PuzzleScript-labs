// Generated cooperative helpers. WGSL SHA-256 944440a0aa5acfa71cd8101b29781944f12ab80e94db9776d621e243a4cf019b






static constexpr u32 COOPERATIVE_SERIAL_PHASES=8u;
static constexpr bool COOPERATIVE_CROSS_LINES=true;
static constexpr bool PHASE_TIMESTAMPS=false;
static constexpr bool UNIFORM_WORKGROUPS=false;
static constexpr bool ATOMIC_ELIGIBILITY=false;




















PS_HD bool cooperative_line_possible(u32 line){
  const auto d=game[shared->cooperative_rule];const auto vertical=d==1u || d==2u;
  const auto lines=select(game[G_HEIGHT],game[G_WIDTH],vertical);
  if(line>=lines){return false;}
  const auto offset=line_base+(line+select(game[G_WIDTH],0u,vertical))*object_words();
  const auto rp=shared->cooperative_rp;const auto required=game[rp+3u];
  for(auto w=0u;w<object_words();w++){
    if((line_objects[offset+w]&game[required+w])!=game[required+w]){return false;}
  }
  for(auto i=0u;i<game[rp+1u];i++){
    const auto c=cell_ptr(game[rp]+i);if(game[c+17u]!=0u){continue;}
    for(auto property=0u;property<game[c+4u];property++){
      auto any_member=false;
      for(auto w=0u;w<object_words();w++){any_member=any_member || (line_objects[offset+w]&game[game[c+5u+property]+w])!=0u;}
      if(!any_member){return false;}
    }
  }
  return true;
}
PS_HD u32 cooperative_line_jump(u32 scan,u32 span){
  if(scan>=cells()){return cells();}
  if(LINE_PRUNE && shared->eligible_line_valid!=0u && shared->eligible_line_row==shared->cooperative_rp){
    const auto line=scan/span;
    const auto bits=shared->eligible_line_bits&(0xffffffffu<<line);
    if(bits==0u){return cells();}
    const auto next_line=firstTrailingBit(bits);
    if(next_line>line){return next_line*span;}
  }
  return scan;
}

PS_HD u32 cooperative_eligibility_target(){
  if(!SPARSE_RULES){return 0xffffffffu;}
  if(cursor_PHASE==9u){const auto gp=group_ptr();if(cursor_RULE+1u<game[gp]+game[gp+1u]){return cursor_RULE;}return 0xffffffffu;}
  if(cursor_PHASE==1u){
    const auto end=select(game[G_EARLY_GROUPS],game[G_GROUPS],cursor_LATE!=0u);
    if(cursor_GROUP<end && sparse_possible_group(cursor_GROUP)){return game[group_ptr()];}
  }
  return 0xffffffffu;
}
PS_HD void cooperative_zero_rule(){
  const auto rule=cursor_RULE;
  if(eligible_rule_cached(rule)){
    const auto gp=group_ptr();const auto end=game[gp]+game[gp+1u];
    auto next=min(shared->eligible_rule_start+32u,end);
    const auto offset=rule-shared->eligible_rule_start;
    if(offset<31u){
      const auto bits=shared->eligible_rule_bits&(0xffffffffu<<(offset+1u));
      if(bits!=0u){next=min(next,shared->eligible_rule_start+firstTrailingBit(bits));}
    }
    if(next>rule+1u){cursor_put_RULE(next-1u);}
  }
  
  
  finish_rule(0u);
}

PS_HD void cooperative_prepare(){
  shared->cooperative_row=cursor_SCAN_ROW;
  shared->cooperative_rp=row_ptr(shared->cooperative_row);
  shared->cooperative_rule=rule_ptr();
  shared->cooperative_row_end=0u;
  shared->cooperative_direct=0u;
  shared->cooperative_range_count=0u;
  const auto rp=shared->cooperative_rp;const auto d=game[shared->cooperative_rule];
  const auto span=select(game[G_WIDTH],game[G_HEIGHT],d==1u || d==2u);
  const auto cached_lines=shared->eligible_line_valid!=0u && shared->eligible_line_row==rp;
  if(compact_lines && cached_lines && game[rp+2u]==0u){prepare_compact_lines(span);return;}
  if(parallel_ellipses && game[rp+2u]!=0u){prepare_parallel_ellipses(span,cached_lines);return;}
  if(COOPERATIVE_CROSS_LINES && game[rp+2u]==0u){
    
    
    for(auto visits=0u;visits<32u && shared->cooperative_count<32u;visits++){
      const auto scan=cooperative_line_jump(cursor_SCAN_CELL,span);cursor_put_SCAN_CELL(scan);
      if(scan>=cells()){shared->cooperative_row_end=1u;break;}
      const auto end=min(cells(),(scan/span+1u)*span);
      if(LINE_PRUNE && !cached_lines && !possible_line(shared->cooperative_row,scan,d)){
        cursor_put_SCAN_CELL(end);continue;
      }
      const auto take=min(32u-shared->cooperative_count,end-scan);
      if(shared->cooperative_count==0u){shared->cooperative_direct_start=scan;}
      shared->cooperative_ranges[shared->cooperative_range_count]=v4(scan,shared->cooperative_count,take,0u);
      shared->cooperative_range_count++;shared->cooperative_count+=take;cursor_put_SCAN_CELL(scan+take);
      shared->cooperative_direct=1u;
    }
    add_work(17u,shared->cooperative_range_count);
    if(cursor_SCAN_CELL>=cells()){shared->cooperative_row_end=1u;}
    return;
  }
  if(game[rp+2u]==0u){
    
    
    for(auto line=0u;line<32u;line++){
      const auto scan=cooperative_line_jump(cursor_SCAN_CELL,span);cursor_put_SCAN_CELL(scan);
      if(scan>=cells()){shared->cooperative_row_end=1u;return;}
      const auto end=min(cells(),(scan/span+1u)*span);
      if(LINE_PRUNE && !cached_lines && !possible_line(shared->cooperative_row,scan,d)){cursor_put_SCAN_CELL(end);continue;}
      shared->cooperative_direct=1u;shared->cooperative_direct_start=scan;
      shared->cooperative_count=min(32u,end-scan);cursor_put_SCAN_CELL(scan+shared->cooperative_count);
      if(cursor_SCAN_CELL>=cells()){shared->cooperative_row_end=1u;}
      return;
    }
    return;
  }
  
  
  for(auto work=0u;work<32u;work++){
    auto scan=cooperative_line_jump(cursor_SCAN_CELL,span);
    if(scan!=cursor_SCAN_CELL){cursor_put_SCAN_CELL(scan);cursor_put_SCAN_GAP(0u);}
    const auto gap=cursor_SCAN_GAP;
    if(scan>=cells()){shared->cooperative_row_end=1u;break;}
    if(LINE_PRUNE && !cached_lines && gap==0u && !possible_line(shared->cooperative_row,scan,d)){
      cursor_put_SCAN_CELL((scan/span+1u)*span);continue;
    }
    const auto start=scan_origin(scan,d);const auto ellipses=game[rp+2u];
    const auto x=i32(start/game[G_HEIGHT]);const auto y=i32(start%game[G_HEIGHT]);
    const auto length=i32(game[rp+1u]-ellipses);auto limit=1u;
    if(ellipses!=0u){switch(d){
      case 1u:{limit=u32(max(0,y-length+2));}break;
      case 2u:{limit=u32(max(0,i32(game[G_HEIGHT])-y-length+1));}break;
      case 4u:{limit=u32(max(0,x-length+2));}break;
      case 8u:{limit=u32(max(0,i32(game[G_WIDTH])-x-length+1));}break;
      default:{limit=0u;}break;
    }}
    const auto divisor=max(1u,limit);
    const auto gaps=select(v2(gap,0u),v2(gap/divisor,gap%divisor),ellipses==2u);
    const auto impossible=MATCH_PREFIX_PRUNE && ellipses!=0u && gap==0u && !matches_prefix(shared->cooperative_row,start);
    if(!impossible && limit>0u){
      shared->cooperative_candidates[shared->cooperative_count]=v4(start,gaps,0u);shared->cooperative_count++;
    }
    const auto maxgap=select(divisor,divisor*divisor,ellipses==2u);
    auto next=gap+1u;
    if(ellipses==2u && gaps.x+gaps.y+1u>=limit){next=(gaps.x+1u)*divisor;}
    if(impossible){next=maxgap;}
    if(next<maxgap){cursor_put_SCAN_GAP(next);}else{cursor_put_SCAN_GAP(0u);cursor_put_SCAN_CELL(scan+1u);}
  }
  if(cursor_SCAN_CELL>=cells()){shared->cooperative_row_end=1u;}
}
PS_HD bool cooperative_match(Vec4<u32> candidate){
  const auto rp=shared->cooperative_rp;const auto d=game[shared->cooperative_rule];
  if(FLAT_ROW_MATCHING && game[rp+2u]==0u && (d==1u || d==2u || d==4u || d==8u)){
    return matches_flat_row(rp,d,candidate.x);
  }
  const auto step=direction(d);
  auto p=v2(i32(candidate.x/game[G_HEIGHT]),i32(candidate.x%game[G_HEIGHT]));
  auto ellipse=0u;const auto gaps=candidate.yz();
  for(auto i=0u;i<game[rp+1u];i++){
    const auto c=cell_ptr(game[rp]+i);
    if(game[c+17u]!=0u){p+=step*i32(gaps[ellipse]);ellipse++;continue;}
    if(any(p<v2(0)) || p.x>=i32(game[G_WIDTH]) || p.y>=i32(game[G_HEIGHT])){return false;}
    if(!matches_cell(c,u32(p.x)*game[G_HEIGHT]+u32(p.y))){return false;}
    p+=step;
  }
  return true;
}
PS_HD void cooperative_commit(){
  for(auto i=0u;i<shared->cooperative_count;i++){
    if(shared->cooperative_matches[i]==0u){continue;}
    const auto count=rd(MATCH_COUNTS+shared->cooperative_row);
    if(count>=MATCH_CAP){fail(3u);return;}
    const auto at=MATCHES+(shared->cooperative_row*MATCH_CAP+count)*3u;
    const auto candidate=shared->cooperative_candidates[i];
    put(at,candidate.x);put(at+1u,candidate.y);put(at+2u,candidate.z);
    put(MATCH_COUNTS+shared->cooperative_row,count+1u);
  }
  if(shared->cooperative_row_end!=0u){finish_matching_row(shared->cooperative_row);}
}
PS_HD void cooperative_serial_phase(){
  count_work(cursor_PHASE);count_work(16u);
  switch(cursor_PHASE){
    case 1u:{
      const auto end=select(game[G_EARLY_GROUPS],game[G_GROUPS],cursor_LATE!=0u);
      if(cursor_GROUP>=end){
        if(cursor_LATE==0u){cursor_put_MOVE_CURSOR(0u);cursor_put_MOVED_THIS_PASS(0u);cursor_put_PHASE(5u);}
        else{cursor_put_PHASE(7u);}
      }else if(cursor_LATE==0u && (rd(BANNED_GROUPS+cursor_GROUP/32u)&(1u<<(cursor_GROUP%32u)))!=0u){cursor_put_PHASE(4u);}
      else{begin_group();}
    }break;
    case 3u:{apply_tick();}break;
    case 4u:{end_group();}break;
    case 5u:{movement_tick();}break;
    case 6u:{rigid_tick();}break;
    case 7u:{finish_turn();}break;
    case 8u:{finish_result(!same(BOARD,BEFORE));}break;
    case 9u:{
      cooperative_zero_rule();
    }break;
    default:{fail(8u);}break;
  }
}
