// Upload ABI and persistent board layout: see FORMAT-V2.md. Offsets are u32 words.
// Diagnostic-only specialization; the normal pipeline compiles counter writes out.
const PROFILE_WORK:bool=false;
const MATCH_PRUNE:bool=true;
const MATCH_PREFIX_PRUNE:bool=true;
const MATCH_CHUNK:u32=1u;
const ANCHOR_SCAN:u32=32u;
const LINE_PRUNE:bool=true;
const COOPERATIVE_MODE:bool=false;
const G_VERSION:u32=0u;
const G_WIDTH:u32=1u;
const G_HEIGHT:u32=2u;
const G_LAYERS:u32=3u;
const G_OBJECTS:u32=4u;
const G_PLAYER:u32=5u;
const G_AGGREGATE_PLAYER:u32=6u;
const G_GROUPS:u32=7u;
const G_EARLY_GROUPS:u32=8u;
const G_RULES:u32=9u;
const G_CELLS:u32=10u;
const G_FLAGS:u32=11u;
const G_LAYER_BASE:u32=12u;
const G_GROUP_BASE:u32=13u;
const G_RULE_BASE:u32=14u;
const G_ROW_BASE:u32=15u;
const G_CELL_BASE:u32=16u;
const G_RIGID_BASE:u32=17u;
const G_EARLY_END_LOOP:u32=18u;
const G_LATE_END_LOOP:u32=19u;
const G_ROWS:u32=20u;
const G_WIN_BASE:u32=21u;
const G_WINS:u32=22u;
const EPOCH:u32=0u;
const STATUS:u32=1u;
const PHASE:u32=2u;
const HISTORY_COUNT:u32=3u;
const AGAINING:u32=4u;
const WINNING:u32=5u;
const RNG_I:u32=6u;
const RNG_J:u32=7u;
const CHECKPOINT_USED:u32=8u;
const EFFECTS:u32=9u;
const MODIFIED:u32=10u;
const COMMANDS:u32=11u;
const GROUP:u32=13u;
const RULE:u32=14u;
const GROUP_PASSES:u32=15u;
const PASS_CHANGED:u32=16u;
const SCAN_ROW:u32=17u;
const SCAN_CELL:u32=18u;
const SCAN_GAP:u32=19u;
const TUPLE:u32=20u;
const TUPLE_COUNT:u32=21u;
const MOVE_CURSOR:u32=22u;
const MOVED_THIS_PASS:u32=23u;
const RETRY_NEEDED:u32=24u;
const PROBING:u32=25u;
const RANDOM_PASS:u32=26u;
const RANDOM_TOTAL:u32=27u;
const RANDOM_CHOICE:u32=28u;
const LATE:u32=29u;
const BANNED:u32=30u;
const RETRIES:u32=31u;
const LOOP_COUNT:u32=33u;
const LOOP_CHANGED:u32=34u;
const INPUT_MASK:u32=35u;
const CREATED:u32=36u;
const DESTROYED:u32=37u;
const DIAGNOSTICS:u32=38u;
const OUTER_MODIFIED:u32=39u;
const SUPPRESS_WIN:u32=64u;
const RESTARTING:u32=65u;
const RESTART_FRAME:u32=66u;
const PARENT_INPUT:u32=67u;
const PARENT_SUPPRESS_WIN:u32=68u;
const COMMAND_COUNT:u32=69u;
const MESSAGE_TEXT:u32=70u;
const TEXT_MODE:u32=71u;
const SAVED_MESSAGE:u32=72u;
const CAN_COUNT:u32=73u;
const CANT_COUNT:u32=74u;
const EVENT_COUNT:u32=75u;
const SCAN_LINE:u32=76u;
const SCAN_LINE_OK:u32=77u;
const MATCH_COUNTS:u32=80u;
// Cooperative line guards are derived cache data, persisted only so a one-unit
// continuation can make progress. They never enter persistent search identity.
const COOP_LINE_ROW:u32=96u;
const COOP_LINE_BITS:u32=97u;
const COOP_LINE_VALID:u32=98u;
// Persistent, bounded interpreter. One invocation owns one complete board.
@group(0u) @binding(0u) var<storage, read> game: array<u32>;
@group(0u) @binding(1u) var<storage, read_write> states: array<u32>;
@group(0u) @binding(2u) var<uniform> params: vec4<u32>;
@group(0u) @binding(3u) var<storage, read_write> status: array<u32>;
@group(0u) @binding(4u) var<storage, read> inputs: array<u32>;
@group(0u) @binding(7u) var<storage, read_write> line_objects: array<u32>;
@group(0u) @binding(9u) var<uniform> sparse_metadata:vec4<u32>;
var<private> base: u32;
var<private> opcode: u32;
var<private> line_base:u32;
// Per-invocation predicate counts avoid worker races. The cooperative leader
// reduces these only after a uniform workgroup rendezvous at dispatch end.
var<private> profile_cell_calls:u32;
var<private> profile_cell_overflow:u32;
var<workgroup> eligible_rule_start:u32;
var<workgroup> eligible_rule_bits:u32;
var<workgroup> eligible_rule_valid:u32;
var<workgroup> eligible_line_valid:u32;
var<workgroup> eligible_line_row:u32;
var<workgroup> eligible_line_bits:u32;
fn eligible_rule_cached(rule:u32)->bool{
  return COOPERATIVE_MODE && eligible_rule_valid!=0u && rule>=eligible_rule_start && rule-eligible_rule_start<32u;
}
fn sparse_possible_rule(rule:u32)->bool{
  let h=sparse_metadata.y+rule*2u;
  for(var i=0u;i<game[h+1u];i++){
    let p=game[h]+i*2u;
    if(!sparse_global_possible(game[p],game[p+1u])){return false;}
  }
  return true;
}
fn sparse_possible_group(group:u32)->bool{
  let h=sparse_metadata.z+group*2u;
  for(var i=0u;i<game[h+1u];i++){
    let p=game[h]+i*2u;
    if(!sparse_global_possible(game[p],game[p+1u])){return false;}
  }
  return true;
}
fn cache_stride()->u32{return (CELL_CAP+1u)*OBJ_WORDS+select(0u,MOV_WORDS,MOVEMENT_GUARDS);}
fn global_movement_base()->u32{return line_base+(CELL_CAP+1u)*OBJ_WORDS;}
fn sparse_global_possible(encoded:u32,mask:u32)->bool{
  if(MOVEMENT_GUARDS && (encoded&0x80000000u)!=0u){
    return (line_objects[global_movement_base()+(encoded&0x7fffffffu)]&mask)==mask;
  }
  return (rd(GLOBAL_OBJECTS+encoded)&mask)==mask;
}
fn cache_movement(word:u32,value:u32){
  if(MOVEMENT_GUARDS && value!=0u){
    let at=global_movement_base()+word;let old=line_objects[at];
    if((value&~old)!=0u){
      line_objects[at]=old|value;
      if(COOPERATIVE_MODE){eligible_rule_valid=0u;}
    }
  }
}
fn add_global_objects(word:u32,value:u32){
  let old=rd(GLOBAL_OBJECTS+word);
  if(COOPERATIVE_MODE && (value&~old)!=0u){eligible_rule_valid=0u;}
  put(GLOBAL_OBJECTS+word,old|value);
}
fn load_execution_registers(){}
fn save_execution_registers(){}
fn cache_object(idx:u32,w:u32,value:u32){
  if(LINE_PRUNE && value!=0u){
    if(COOPERATIVE_MODE){eligible_line_valid=0u;}
    let x=idx/game[G_HEIGHT]; let y=idx%game[G_HEIGHT];
    let column=line_base+x*OBJ_WORDS+w;
    let row=line_base+(game[G_WIDTH]+y)*OBJ_WORDS+w;
    line_objects[column]|=value; line_objects[row]|=value;
  }
}
fn possible_line(row:u32,scan:u32,d:u32)->bool{
  let vertical=d==1u || d==2u;
  let span=select(game[G_WIDTH],game[G_HEIGHT],vertical);
  let line=scan/span;
  if(rd(SCAN_LINE)==line){ return rd(SCAN_LINE_OK)!=0u; }
  put(SCAN_LINE,line); put(SCAN_LINE_OK,0u);
  let offset=line_base+(line+select(game[G_WIDTH],0u,vertical))*OBJ_WORDS;
  let rp=row_ptr(row); let required=game[rp+3u];
  for(var w=0u;w<OBJ_WORDS;w++){
    if((line_objects[offset+w]&game[required+w])!=game[required+w]){ return false; }
  }
  // Each property predicate must have at least one possible member somewhere
  // on this line. This is necessary, never sufficient, for a full row match.
  for(var i=0u;i<game[rp+1u];i++){
    let c=cell_ptr(game[rp]+i); if(game[c+17u]!=0u){ continue; }
    for(var property=0u;property<game[c+4u];property++){
      var any_member=false;
      for(var w=0u;w<OBJ_WORDS;w++){ any_member=any_member || (line_objects[offset+w]&game[game[c+5u+property]+w])!=0u; }
      if(!any_member){ return false; }
    }
  }
  put(SCAN_LINE_OK,1u); return true;
}
fn rd(i:u32)->u32{
  return states[base+i];
}
fn put(i:u32,v:u32){
  states[base+i]=v;
}
fn done(){
  if(rd(STATUS)>=2u){ return; }
  if(rd(PROBING)!=0u){ put(MESSAGE_TEXT,rd(SAVED_MESSAGE)); }
  if(rd(RESTART_FRAME)!=0u){
    let frame=rd(RESTART_FRAME);
    put(RESTART_FRAME,0u);
    put(RESTARTING,0u);
    put(PROBING,0u);
    put(COMMANDS,0u);
    put(COMMAND_COUNT,0u);
    if(frame==2u){
      put(MODIFIED,1u);
      put(STATUS,1u);
      return;
    }
    cp(BEFORE,PARENT_BEFORE);
    put(INPUT_MASK,rd(PARENT_INPUT));
    put(SUPPRESS_WIN,rd(PARENT_SUPPRESS_WIN));
    put(PHASE,8u);
    return;
  }
  if(opcode==8u){ put(MODIFIED,0u); }
  if(rd(STATUS)<2u){
    put(STATUS,1u);
  }
}
fn fail(code:u32){
  put(STATUS,code);
}
fn add_work(index:u32,amount:u32){
  if(PROFILE_WORK){
    if(COOPERATIVE_MODE && index==0u){
      if(amount>0xffffffffu-profile_cell_calls){profile_cell_overflow=1u;}
      else{profile_cell_calls+=amount;}
      return;
    }
    let value=rd(40u+index);
    if(index>=24u || amount>0xffffffffu-value){
      fail(10u);
    }
    else{
      put(40u+index,value+amount);
    }
  }
}
fn count_work(index:u32){add_work(index,1u);}
fn cells()->u32{
  return game[G_WIDTH]*game[G_HEIGHT];
}
// Cell arrays retain vanilla's word layout, including movement padding words.
fn shifted5(layer:u32,word:u32,value:u32)->u32{
  let bit=layer*5u;
  let index=bit/32u;
  let shift=bit%32u;
  if(word==index){ return value<<shift; }
  if(shift>27u && word==index+1u){ return value>>(32u-shift); }
  return 0u;
}
fn get5(at:u32,cell:u32,layer:u32)->u32{
  let bit=layer*5u;
  let index=at+cell*MOV_WORDS+bit/32u;
  let shift=bit%32u;
  var value=rd(index)>>shift;
  if(shift>27u){ value|=rd(index+1u)<<(32u-shift); }
  return value&31u;
}
fn set5(at:u32,cell:u32,layer:u32,value:u32){
  let bit=layer*5u;
  let index=at+cell*MOV_WORDS+bit/32u;
  let shift=bit%32u;
  put(index,(rd(index)&~(31u<<shift))|(value<<shift));
  if(shift>27u){
    let mask=31u>>(32u-shift);
    put(index+1u,(rd(index+1u)&~mask)|(value>>(32u-shift)));
  }
  if(MOVEMENT_GUARDS && at==MOVEMENTS && value!=0u){
    cache_movement(bit/32u,rd(index));
    if(shift>27u){cache_movement(bit/32u+1u,rd(index+1u));}
  }
}
fn selected(cell:u32,mask:u32,aggregate:bool)->bool{
  var any_bits=false;
  var all_bits=true;
  for(var w=0u;w<OBJ_WORDS;w++){
    let object=rd(BOARD+cell*OBJ_WORDS+w);
    any_bits=any_bits || (object&game[mask+w])!=0u;
    all_bits=all_bits && (object&game[mask+w])==game[mask+w];
  }
  return select(any_bits,all_bits,aggregate);
}
fn emit_event(kind:u32,parameter:u32){
  let count=rd(EVENT_COUNT);
  if(count>=EFFECT_CAP){ fail(11u); return; }
  put(EVENTS+count*2u,kind);
  put(EVENTS+count*2u+1u,parameter);
  put(EVENT_COUNT,count+1u);
}
fn simple_sound(event:u32){
  let seed=game[game[28u]+game[29u]*5u+event];
  if(seed!=0xffffffffu){ emit_event(0u,seed); }
}
fn movement_mask_any(cell:u32,mask:u32)->bool{
  var found=false;
  for(var w=0u;w<MOV_WORDS;w++){ found=found || (rd(MOVEMENTS+cell*MOV_WORDS+w)&game[mask+w])!=0u; }
  return found;
}
fn object_buffer_any(at:u32,mask:u32)->bool{
  var found=false;
  for(var w=0u;w<OBJ_WORDS;w++){ found=found || (rd(at+w)&game[mask+w])!=0u; }
  return found;
}
fn add_sound(at:u32,counter:u32,seed:u32){
  let count=rd(counter);
  for(var i=0u;i<count;i++){ if(rd(at+i)==seed){ return; } }
  if(count>=SOUND_CAP){ fail(12u); return; }
  put(at+count,seed); put(counter,count+1u);
}
fn movement_sound(cell:u32,layer:u32){
  for(var i=0u;i<game[29u];i++){
    let p=game[28u]+i*5u;
    if(game[p]==0u && game[p+1u]==layer && selected(cell,game[p+2u],false) && movement_mask_any(cell,game[p+3u])){
      add_sound(SOUND_CAN,CAN_COUNT,game[p+4u]);
    }
  }
}
fn failed_movement_sounds(cell:u32){
  for(var i=0u;i<game[29u];i++){
    let p=game[28u]+i*5u;
    if(game[p]==1u && selected(cell,game[p+2u],false) && movement_mask_any(cell,game[p+3u])){
      add_sound(SOUND_CANT,CANT_COUNT,game[p+4u]);
    }
  }
}
fn play_sounds(){
  for(var i=0u;i<rd(CANT_COUNT);i++){ emit_event(0u,rd(SOUND_CANT+i)); }
  for(var i=0u;i<rd(CAN_COUNT);i++){ emit_event(0u,rd(SOUND_CAN+i)); }
  for(var kind=2u;kind<=3u;kind++){
    let at=select(CREATED_BITS,DESTROYED_BITS,kind==3u);
    for(var i=0u;i<game[29u];i++){
      let p=game[28u]+i*5u;
      if(game[p]==kind && object_buffer_any(at,game[p+2u])){ emit_event(0u,game[p+4u]); }
    }
  }
}
fn output_commands(){
  for(var i=0u;i<rd(COMMAND_COUNT);i++){
    let command=rd(COMMAND_LIST+i);
    if(command>=6u){ simple_sound(command+4u); }
    else if(command==5u){
      emit_event(1u,rd(MESSAGE_TEXT));
      put(TEXT_MODE,1u);
      simple_sound(7u);
    }
  }
}
fn cp(dst:u32,src:u32){
  for(var i=0u;i<cells()*OBJ_WORDS;i++){
    put(dst+i,rd(src+i));
  }
}
fn cp_mov(dst:u32,src:u32){
  for(var i=0u;i<cells()*MOV_WORDS;i++){ put(dst+i,rd(src+i)); }
}
fn same(a:u32,b:u32)->bool{
  for(var i=0u;i<cells()*OBJ_WORDS;i++){
    if(rd(a+i)!=rd(b+i)){
      return false;
    }
  }
  return true;
}
fn clear_moves(){
  // Historical same-size restore clears one word per tile, not every word.
  for(var i=0u;i<cells();i++){
    put(MOVEMENTS+i,0u);
  }
  for(var i=0u;i<cells()*MOV_WORDS;i++){
    put(RIGID_OWNERS+i,0u);
    put(RIGID_APPLIED+i,0u);
  }
  put(COMMANDS,0u);
  put(COMMAND_COUNT,0u);
  put(AGAINING,0u);
}
fn history(src:u32){
  // A guarded canonical-search mode exposes only directional/action successors.
  // No checkpoint/message/sound commands or Undo/Restart inputs are accepted by
  // that host. History is not observable through its successor interface.
  if((params.w&0x80000000u)!=0u){ return; }
  if(rd(HISTORY_COUNT)>=HISTORY_CAP){
    fail(2u);
    return;
  }
  cp(HISTORY+rd(HISTORY_COUNT)*CELL_CAP*OBJ_WORDS,src);
  put(HISTORY_COUNT,rd(HISTORY_COUNT)+1u);
}
fn restore(src:u32){
  if(COOPERATIVE_MODE){eligible_rule_valid=0u;eligible_line_valid=0u;}
  cp(BOARD,src);
  for(var i=0u;i<cells();i++){
    for(var w=0u;w<OBJ_WORDS;w++){
      put(GLOBAL_OBJECTS+w,rd(GLOBAL_OBJECTS+w)|rd(BOARD+i*OBJ_WORDS+w));
      cache_object(i,w,rd(BOARD+i*OBJ_WORDS+w));
    }
  }
  clear_moves();
}
fn group_ptr()->u32{
  return game[G_GROUP_BASE]+rd(GROUP)*4u;
}
fn rule_ptr()->u32{
  return game[G_RULE_BASE]+rd(RULE)*8u;
}
fn row_ptr(row:u32)->u32{
  return game[G_ROW_BASE]+(game[rule_ptr()+1u]+row)*4u;
}
fn cell_ptr(c:u32)->u32{
  return game[G_CELL_BASE]+c*18u;
}
fn direction(d:u32)->vec2<i32>{
  switch d{
    case 1u:{
      return vec2(0i,-1i);
    }
    case 2u:{
      return vec2(0i,1i);
    }
    case 4u:{
      return vec2(-1i,0i);
    }
    case 8u:{
      return vec2(1i,0i);
    }
    default:{
      return vec2(0i,0i);
    }
  }
}
const FAST_SINGLE_WORD_MATCHING:bool=false;
fn matches_cell(c:u32,idx:u32)->bool{
  count_work(0u);
  if(FAST_SINGLE_WORD_MATCHING && OBJ_WORDS==1u){
    // Complete original predicates with constant single-word object addressing.
    // Movement masks retain their validated width and property order.
    let o=rd(BOARD+idx);
    let required=game[game[c]];let absent=game[game[c+1u]];
    if((o&required)!=required || (o&absent)!=0u){return false;}
    if(MOV_WORDS==1u){
      let m=rd(MOVEMENTS+idx);
      let moving=game[game[c+2u]];let stationary=game[game[c+3u]];
      if((m&moving)!=moving || (m&stationary)!=0u){return false;}
    }else if(SPARSE_RULES){
      let h=sparse_metadata.x+(c-game[G_CELL_BASE])/18u*8u;
      for(var i=0u;i<game[h+3u];i++){
        let p=game[h+2u]+i*3u;let m=rd(MOVEMENTS+idx*MOV_WORDS+game[p]);
        if((m&game[p+1u])!=game[p+1u] || (m&game[p+2u])!=0u){return false;}
      }
    }else{
      for(var w=0u;w<MOV_WORDS;w++){
        let m=rd(MOVEMENTS+idx*MOV_WORDS+w);
        if((m&game[game[c+2u]+w])!=game[game[c+2u]+w] || (m&game[game[c+3u]+w])!=0u){return false;}
      }
    }
    for(var a=0u;a<game[c+4u];a++){
      if(!selected(idx,game[c+5u+a],false)){return false;}
    }
    return true;
  }
  if(SPARSE_RULES){
    let h=sparse_metadata.x+(c-game[G_CELL_BASE])/18u*8u;
    for(var i=0u;i<game[h+1u];i++){
      let p=game[h]+i*3u;let o=rd(BOARD+idx*OBJ_WORDS+game[p]);
      if((o&game[p+1u])!=game[p+1u] || (o&game[p+2u])!=0u){return false;}
    }
    for(var i=0u;i<game[h+3u];i++){
      let p=game[h+2u]+i*3u;let m=rd(MOVEMENTS+idx*MOV_WORDS+game[p]);
      if((m&game[p+1u])!=game[p+1u] || (m&game[p+2u])!=0u){return false;}
    }
    for(var a=0u;a<game[c+4u];a++){
      if(!selected(idx,game[c+5u+a],false)){return false;}
    }
    return true;
  }
  for(var w=0u;w<OBJ_WORDS;w++){
    let o=rd(BOARD+idx*OBJ_WORDS+w);
    if((o&game[game[c]+w])!=game[game[c]+w] || (o&game[game[c+1u]+w])!=0u){ return false; }
  }
  for(var w=0u;w<MOV_WORDS;w++){
    let m=rd(MOVEMENTS+idx*MOV_WORDS+w);
    if((m&game[game[c+2u]+w])!=game[game[c+2u]+w] || (m&game[game[c+3u]+w])!=0u){ return false; }
  }
  for(var a=0u;a<game[c+4u];a++){
    if(!selected(idx,game[c+5u+a],false)){ return false; }
  }
  return true;
}
// Before the first ellipsis every predicate is independent of both gap sizes.
// Matching gathers candidates before any write, so a failed prefix excludes
// every gap at this origin without changing candidate order or random draws.
fn matches_prefix(row:u32,start:u32)->bool{
  let rp=row_ptr(row);
  let step=direction(game[rule_ptr()]);
  var p=vec2(i32(start/game[G_HEIGHT]),i32(start%game[G_HEIGHT]));
  for(var i=0u;i<game[rp+1u];i++){
    let c=cell_ptr(game[rp]+i);
    if(game[c+17u]!=0u){ return true; }
    if(any(p<vec2(0i)) || p.x>=i32(game[G_WIDTH]) || p.y>=i32(game[G_HEIGHT])){ return false; }
    if(!matches_cell(c,u32(p.x)*game[G_HEIGHT]+u32(p.y))){ return false; }
    p+=step;
  }
  return true;
}
const FLAT_ROW_MATCHING:bool=false;
fn matches_flat_row(rp:u32,d:u32,start:u32)->bool{
  let length=game[rp+1u];
  if(length==0u){return true;}
  if(start>=cells()){return false;}
  let vertical=d==1u || d==2u;let backward=d==1u || d==4u;
  let position=select(start/game[G_HEIGHT],start%game[G_HEIGHT],vertical);
  let span=select(game[G_WIDTH],game[G_HEIGHT],vertical);
  if(backward){if(length>position+1u){return false;}}
  else{if(length>span-position){return false;}}
  let stride=select(i32(game[G_HEIGHT]),1i,vertical);
  let delta=select(stride,-stride,backward);
  var index=i32(start);
  for(var i=0u;i<length;i++){
    if(!matches_cell(cell_ptr(game[rp]+i),u32(index))){return false;}
    index+=delta;
  }
  return true;
}
fn matches(row:u32,start:u32,gaps:vec2<u32>)->bool{
  let rp=row_ptr(row);
  let d=game[rule_ptr()];
  if(FLAT_ROW_MATCHING && game[rp+2u]==0u && (d==1u || d==2u || d==4u || d==8u)){
    return matches_flat_row(rp,d,start);
  }
  let step=direction(d);
  var p=vec2(i32(start/game[G_HEIGHT]),i32(start%game[G_HEIGHT]));
  var ellipse=0u;
  for(var i=0u;i<game[rp+1u];i++) {
    let c=cell_ptr(game[rp]+i);
    if(game[c+17u]!=0u){
      p+=step*i32(gaps[ellipse]);
      ellipse++;
      continue;
    }
    if(any(p<vec2(0i)) || p.x>=i32(game[G_WIDTH]) || p.y>=i32(game[G_HEIGHT])){
      return false;
    }
    let idx=u32(p.x)*game[G_HEIGHT]+u32(p.y);
    if(!matches_cell(c,idx)){ return false; }
    p+=step;
  }
  return true;
}
fn next_byte()->u32{
  let i=(rd(RNG_I)+1u)&255u;
  let j=(rd(RNG_J)+rd(RNG_DATA+i))&255u;
  let a=rd(RNG_DATA+i);
  put(RNG_DATA+i,rd(RNG_DATA+j));
  put(RNG_DATA+j,a);
  put(RNG_I,i);
  put(RNG_J,j);
  return rd(RNG_DATA+((rd(RNG_DATA+i)+rd(RNG_DATA+j))&255u));
}
// Exact integer emulation of JS's 56u-bit draw and double multiplication.
// base-65536u limbs avoid f32 choice-boundary errors; round each operation to 53u bits.
struct Limbs {
  v: array<u32,5u>,
}
fn round53(input:Limbs)->Limbs{
  var a=input;
  var bits=0u;
  for(var i=0u;i<5u;i++){
    if(a.v[i]!=0u){
      bits=i*16u+32u-countLeadingZeros(a.v[i]);
    }
  }
  if(bits<=53u){
    return a;
  }
  let shift=bits-53u;
  let limb=shift/16u;
  let offset=shift%16u;
  var lower=false;
  for(var i=0u;i<limb;i++){
    lower=lower || a.v[i]!=0u;
  }
  let half=1u<<((shift-1u)%16u);
  let hi=(shift-1u)/16u;
  var below=lower;
  if(offset==0u){
    below=false;
    for(var i=0u;i<hi;i++){
      below=below||a.v[i]!=0u;
    }
  }
  below=below || (a.v[hi]&(half-1u))!=0u;
  let up=(a.v[hi]&half)!=0u && (below || ((a.v[limb]>>offset)&1u)!=0u);
  for(var i=0u;i<limb;i++){
    a.v[i]=0u;
  }
  a.v[limb]&=~((1u<<offset)-1u);
  if(up){
    a.v[limb]+=1u<<offset;
    for(var i=limb;i<4u;i++){
      a.v[i+1u]+=a.v[i]>>16u;
      a.v[i]&=65535u;
    }
  }
  return a;
}
fn choose(n:u32)->u32{
  var a:Limbs;
  for(var b=0u;b<7u;b++){
    var carry=next_byte();
    for(var i=0u;i<5u;i++){
      let v=a.v[i]*256u+carry;
      a.v[i]=v&65535u;
      carry=v>>16u;
    }
  }
  a=round53(a);
  var carry=0u;
  for(var i=0u;i<5u;i++){
    let v=a.v[i]*n+carry;
    a.v[i]=v&65535u;
    carry=v>>16u;
  }
  a=round53(a);
  return (a.v[3u]>>8u)|(a.v[4u]<<8u);
}
fn sparse_replace(c:u32,idx:u32)->bool{
  let h=sparse_metadata.x+(c-game[G_CELL_BASE])/18u*8u;
  var changed=false;
  for(var i=0u;i<game[h+5u];i++){
    let p=game[h+4u]+i*3u;let encoded=game[p];let w=encoded&0x7fffffffu;
    if((encoded&0x80000000u)==0u){
      let old=rd(BOARD+idx*OBJ_WORDS+w);let after=(old&~game[p+1u])|game[p+2u];
      put(BOARD+idx*OBJ_WORDS+w,after);cache_object(idx,w,after&~old);
      add_global_objects(w,after);
      put(CREATED_BITS+w,rd(CREATED_BITS+w)|(after&~old));
      put(DESTROYED_BITS+w,rd(DESTROYED_BITS+w)|(old&~after));
      changed=changed || old!=after;
    }else{
      let old=rd(MOVEMENTS+idx*MOV_WORDS+w);let after=(old&~game[p+1u])|game[p+2u];
      put(MOVEMENTS+idx*MOV_WORDS+w,after);cache_movement(w,after);changed=changed || old!=after;
    }
  }
  return changed;
}
fn replace(row:u32,start:u32,gaps:vec2<u32>)->bool{
  let rp=row_ptr(row);
  let step=direction(game[rule_ptr()]);
  var p=vec2(i32(start/game[G_HEIGHT]),i32(start%game[G_HEIGHT]));
  var ellipse=0u;
  var changed=false;
  for(var i=0u;i<game[rp+1u];i++){
    let c=cell_ptr(game[rp]+i);
    if(game[c+17u]!=0u){
      p+=step*i32(gaps[ellipse]);
      ellipse++;
      continue;
    }
    let idx=u32(p.x)*game[G_HEIGHT]+u32(p.y);
    if(game[c+9u]!=0u){
      let sparse_header=sparse_metadata.x+(c-game[G_CELL_BASE])/18u*8u;
      if(SPARSE_RULES && game[sparse_header+6u]==0u && game[rule_ptr()+4u]==0u){
        changed=sparse_replace(c,idx)||changed;
      }else{
      var oc:array<u32,OBJ_WORDS>;
      var os:array<u32,OBJ_WORDS>;
      var mc:array<u32,MOV_WORDS>;
      var ms:array<u32,MOV_WORDS>;
      var n=0u;
      for(var w=0u;w<OBJ_WORDS;w++){
        oc[w]=game[game[c+10u]+w]; os[w]=game[game[c+11u]+w];
        n+=countOneBits(game[game[c+15u]+w]);
      }
      for(var w=0u;w<MOV_WORDS;w++){
        mc[w]=game[game[c+12u]+w]|game[game[c+14u]+w]; ms[w]=game[game[c+13u]+w];
      }
      if(n!=0u){
        var wanted=choose(n);
        if(wanted>=n){
          fail(6u);
          return false;
        }
        for(var o=0u;o<game[G_OBJECTS];o++){
          let word=o/32u;
          let mask=1u<<(o%32u);
          if((game[game[c+15u]+word]&mask)==0u){
            continue;
          }
          if(wanted>0u){
            wanted--;
            continue;
          }
          os[word]|=mask;
          for(var l=0u;l<game[G_LAYERS];l++){
            if((game[game[G_LAYER_BASE]+l*OBJ_WORDS+word]&mask)!=0u){
              for(var w=0u;w<OBJ_WORDS;w++){ oc[w]|=game[game[G_LAYER_BASE]+l*OBJ_WORDS+w]; }
              for(var w=0u;w<MOV_WORDS;w++){ mc[w]|=shifted5(l,w,31u); }
            }
          }
          break;
        }
      }
      for(var l=0u;l<game[G_LAYERS];l++){
        let bit=l*5u;
        if((game[game[c+16u]+bit/32u]&(1u<<(bit%32u)))!=0u){
          let movement=1u<<choose(4u);
          for(var w=0u;w<MOV_WORDS;w++){ ms[w]|=shifted5(l,w,movement); }
        }
      }
      for(var w=0u;w<OBJ_WORDS;w++){
        let old=rd(BOARD+idx*OBJ_WORDS+w);
        let after=(old&~oc[w])|os[w];
        put(BOARD+idx*OBJ_WORDS+w,after);
        cache_object(idx,w,after&~old);
        add_global_objects(w,after);
        put(CREATED_BITS+w,rd(CREATED_BITS+w)|(after&~old));
        put(DESTROYED_BITS+w,rd(DESTROYED_BITS+w)|(old&~after));
        changed=changed || old!=after;
      }
      for(var w=0u;w<MOV_WORDS;w++){
        let old=rd(MOVEMENTS+idx*MOV_WORDS+w);
        let after=(old&~mc[w])|ms[w];
        put(MOVEMENTS+idx*MOV_WORDS+w,after);
        cache_movement(w,after);
        changed=changed || old!=after;
      }
      let ord=game[rule_ptr()+4u];
      if(ord!=0u){
        var rigid:array<u32,MOV_WORDS>;
        var contains_owner=true;
        var contains_applied=true;
        for(var w=0u;w<MOV_WORDS;w++){
          var bits=0u;
          for(var l=0u;l<game[G_LAYERS];l++){ bits|=shifted5(l,w,ord); }
          rigid[w]=bits&game[game[c+14u]+w];
          contains_owner=contains_owner && (rd(RIGID_OWNERS+idx*MOV_WORDS+w)&rigid[w])==rigid[w];
          contains_applied=contains_applied && (rd(RIGID_APPLIED+idx*MOV_WORDS+w)&game[game[c+14u]+w])==game[game[c+14u]+w];
        }
        if(!contains_owner && !contains_applied){
          for(var w=0u;w<MOV_WORDS;w++){
            let at=idx*MOV_WORDS+w;
            put(RIGID_OWNERS+at,rd(RIGID_OWNERS+at)|rigid[w]);
            put(RIGID_APPLIED+at,rd(RIGID_APPLIED+at)|game[game[c+14u]+w]);
          }
          changed=true;
        }
      }
    }
      }
    p+=step;
  }
  return changed;
}
fn queue_commands(){
  let cmd=game[rule_ptr()+3u];
  let old=rd(COMMANDS);
  if(cmd==0u || (old&1u)!=0u || ((old&2u)!=0u && (cmd&1u)==0u)){
    return;
  }
  if((cmd&3u)!=0u){
    put(COMMANDS,0u);
    put(COMMAND_COUNT,0u);
    put(MESSAGE_TEXT,0u);
  }
  let p=game[rule_ptr()+7u];
  for(var i=0u;i<game[p];i++){
    let command=game[p+1u+i*2u];
    let bit=1u<<command;
    if((rd(COMMANDS)&bit)!=0u){ continue; }
    let count=rd(COMMAND_COUNT);
    if(count>=32u){ fail(13u); return; }
    put(COMMAND_LIST+count,command);
    put(COMMAND_COUNT,count+1u);
    put(COMMANDS,rd(COMMANDS)|bit);
    if(command==5u){ put(MESSAGE_TEXT,game[p+2u+i*2u]); }
  }
}
fn begin_rule(){
  if(MATCH_PRUNE && SPARSE_RULES){
    var possible=true;
    if(eligible_rule_cached(rd(RULE))){possible=(eligible_rule_bits&(1u<<(rd(RULE)-eligible_rule_start)))!=0u;}
    else{possible=sparse_possible_rule(rd(RULE));}
    if(!possible){put(PHASE,9u);return;}
  }
  put(SCAN_LINE,0xffffffffu);
  put(SCAN_ROW,0u);
  put(SCAN_CELL,0u);
  put(SCAN_GAP,0u);
  put(TUPLE,0u);
  for(var i=0u;i<game[rule_ptr()+2u];i++){
    put(MATCH_COUNTS+i,0u);
  }
  if(MATCH_PRUNE && !SPARSE_RULES){
    for(var row=0u;row<game[rule_ptr()+2u];row++){
      let mask=game[row_ptr(row)+3u];
      for(var w=0u;w<OBJ_WORDS;w++){
        if((rd(GLOBAL_OBJECTS+w)&game[mask+w])!=game[mask+w]){
          put(PHASE,9u);
          return;
        }
      }
    }
  }
  put(PHASE,2u);
}
fn begin_group(){
  put(RULE,game[group_ptr()]);
  put(GROUP_PASSES,0u);
  put(PASS_CHANGED,0u);
  put(RANDOM_PASS,0u);
  put(RANDOM_TOTAL,0u);
  put(RANDOM_CHOICE,0u);
  // Every rule requires this shared positive mask. If it is impossible even
  // in the conservative board union, all match totals are exactly zero. Finish
  // the ordinary pass/group once without walking its individual dead rules.
  if(SPARSE_RULES && !sparse_possible_group(rd(GROUP))){
    let gp=group_ptr();put(RULE,game[gp]+game[gp+1u]-1u);
    finish_rule(0u);end_group();return;
  }
  begin_rule();
}
fn begin_turn(input:u32){
  if(COOPERATIVE_MODE){eligible_rule_valid=0u;eligible_line_valid=0u;}
  cp(BEFORE,BOARD);
  put(COMMANDS,0u);
  put(COMMAND_COUNT,0u);
  put(CAN_COUNT,0u);
  put(CANT_COUNT,0u);
  put(AGAINING,0u);
  for(var w=0u;w<OBJ_WORDS;w++){ put(CREATED_BITS+w,0u); put(DESTROYED_BITS+w,0u); }
  for(var w=0u;w<OBJ_WORDS;w++){ put(GLOBAL_OBJECTS+w,0u); }
  for(var w=0u;w<BAN_WORDS;w++){ put(BANNED_GROUPS+w,0u); }
  put(RETRIES,0u);
  put(32u,0u);
  put(LOOP_COUNT,0u);
  put(INPUT_MASK,input);
  if(LINE_PRUNE){
    for(var i=0u;i<(game[G_WIDTH]+game[G_HEIGHT])*OBJ_WORDS;i++){ line_objects[line_base+i]=0u; }
  }
  if(MOVEMENT_GUARDS){for(var w=0u;w<MOV_WORDS;w++){line_objects[global_movement_base()+w]=0u;}}
  for(var i=0u;i<cells();i++){
    for(var w=0u;w<OBJ_WORDS;w++){ let value=rd(BOARD+i*OBJ_WORDS+w); put(GLOBAL_OBJECTS+w,rd(GLOBAL_OBJECTS+w)|value); cache_object(i,w,value); }
    let is_player=selected(i,game[G_PLAYER],game[G_AGGREGATE_PLAYER]!=0u);
    put(PLAYER_POSITIONS+i,select(0u,1u,is_player && input!=0u));
    if(is_player && input!=0u){
      for(var l=0u;l<game[G_LAYERS];l++){
        var in_layer=false;
        for(var w=0u;w<OBJ_WORDS;w++){
          in_layer=in_layer || (rd(BOARD+i*OBJ_WORDS+w)&game[game[G_PLAYER]+w]&game[game[G_LAYER_BASE]+l*OBJ_WORDS+w])!=0u;
        }
        if(in_layer){
          set5(MOVEMENTS,i,l,get5(MOVEMENTS,i,l)|input);
        }
      }
    }
  }
  // Include every pending movement word, not just newly marked players. Union
  // bits only grow until the next begin_turn, including across rigid retries.
  if(MOVEMENT_GUARDS){for(var i=0u;i<cells();i++){for(var w=0u;w<MOV_WORDS;w++){cache_movement(w,rd(MOVEMENTS+i*MOV_WORDS+w));}}}
  cp(RETRY_BOARD,BOARD);
  cp_mov(RETRY_MOVEMENTS,MOVEMENTS);
  put(GROUP,0u);
  put(LATE,0u);
  put(LOOP_CHANGED,0u);
  put(PHASE,1u);
}
fn finish_rule(total:u32){
  let gp=group_ptr();
  if(game[gp+2u]!=0u){
    if(rd(RANDOM_PASS)==0u){
      if(rd(RANDOM_TOTAL)+total>65535u){
        fail(5u);
        return;
      }
      put(RANDOM_TOTAL,rd(RANDOM_TOTAL)+total);
    }
    else if(rd(RANDOM_CHOICE)<total){
      put(TUPLE,rd(RANDOM_CHOICE));
      put(PHASE,3u);
      return;
    }
    else{
      put(RANDOM_CHOICE,rd(RANDOM_CHOICE)-total);
    }
  }
  else if(total>0u){
    put(TUPLE,0u);
    put(PHASE,3u);
    return;
  }
  next_rule();
}
fn next_rule(){
  let gp=group_ptr();
  put(RULE,rd(RULE)+1u);
  if(rd(RULE)<game[gp]+game[gp+1u]){
    begin_rule();
    return;
  }
  if(game[gp+2u]!=0u && rd(RANDOM_PASS)==0u && rd(RANDOM_TOTAL)>0u){
    put(RANDOM_CHOICE,choose(rd(RANDOM_TOTAL)));
    if(rd(RANDOM_CHOICE)>=rd(RANDOM_TOTAL)){
      fail(6u);
      return;
    }
    put(RANDOM_PASS,1u);
    put(RULE,game[gp]);
    begin_rule();
    return;
  }
  if(game[gp+2u]==0u){
    put(GROUP_PASSES,rd(GROUP_PASSES)+1u);
    if(rd(GROUP_PASSES)>=200u){
      put(DIAGNOSTICS,rd(DIAGNOSTICS)|1u);
    }
    else if(rd(PASS_CHANGED)!=0u){
      put(PASS_CHANGED,0u);
      put(RULE,game[gp]);
      begin_rule();
      return;
    }
  }
  put(PHASE,4u);
}
fn end_group(){
  let gp=group_ptr();
  var next=rd(GROUP)+1u;
  var destination=game[gp+3u];
  let end=select(game[G_EARLY_GROUPS],game[G_GROUPS],rd(LATE)!=0u);
  if(next==end && destination==0xffffffffu){
    destination=select(game[G_EARLY_END_LOOP],game[G_LATE_END_LOOP],rd(LATE)!=0u);
  }
  if(rd(LOOP_CHANGED)!=0u && destination!=0xffffffffu){
    next=destination;
    put(LOOP_CHANGED,0u);
    put(LOOP_COUNT,rd(LOOP_COUNT)+1u);
    if(rd(LOOP_COUNT)>200u){
      put(DIAGNOSTICS,rd(DIAGNOSTICS)|2u);
      next=end;
    }
  }
  put(GROUP,next);
  put(PHASE,1u);
}
fn finish_matching_row(row:u32){
  put(SCAN_LINE,0xffffffffu);
  if(rd(MATCH_COUNTS+row)==0u){ finish_rule(0u); return; }
  put(SCAN_ROW,row+1u); put(SCAN_CELL,0u); put(SCAN_GAP,0u);
  if(rd(SCAN_ROW)<game[rule_ptr()+2u]){ return; }
  var total=1u;
  for(var r=0u;r<game[rule_ptr()+2u];r++){
    if(total>65535u/rd(MATCH_COUNTS+r)){ fail(5u); return; }
    total*=rd(MATCH_COUNTS+r);
  }
  put(TUPLE_COUNT,total); finish_rule(total);
}
fn scan_origin(scan:u32,d:u32)->u32{
  return select((scan%game[G_WIDTH])*game[G_HEIGHT]+scan/game[G_WIDTH],scan,d==1u || d==2u);
}
fn match_tick(){
  let row=rd(SCAN_ROW);
  let rp=row_ptr(row);
  var scan=rd(SCAN_CELL);
  let gap=rd(SCAN_GAP);
  let d=game[rule_ptr()];
  let span=select(game[G_WIDTH],game[G_HEIGHT],d==1u || d==2u);
  if(LINE_PRUNE && gap==0u && !possible_line(row,scan,d)){
    let next=(scan/span+1u)*span;
    put(SCAN_CELL,next);
    if(next>=cells()){ finish_matching_row(row); }
    return;
  }
  if(gap==0u){
    let first=cell_ptr(game[rp]);
    var anchor_word=0u;
    var anchor_bits=0u;
    if(game[first+17u]==0u){
      for(var w=0u;w<OBJ_WORDS;w++){
        if(game[game[first]+w]!=0u){ anchor_word=w; anchor_bits=game[game[first]+w]; }
      }
    }
    if(anchor_bits!=0u){
      let end=min(min(cells(),scan+ANCHOR_SCAN),select(cells(),(scan/span+1u)*span,LINE_PRUNE));
      loop {
        if(scan>=end){
          put(SCAN_CELL,scan);
          if(scan>=cells()){ finish_matching_row(row); }
          return;
        }
        let origin=scan_origin(scan,d);
        if((rd(BOARD+origin*OBJ_WORDS+anchor_word)&anchor_bits)==anchor_bits){ break; }
        scan++;
      }
      put(SCAN_CELL,scan);
    }
  }
  let start=scan_origin(scan,d);
  let ellipses=game[rp+2u];
  let x=i32(start/game[G_HEIGHT]);
  let y=i32(start%game[G_HEIGHT]);
  let length=i32(game[rp+1u]-ellipses);
  var limit=1u;
  if(ellipses!=0u){
    switch d{
      case 1u:{ limit=u32(max(0i,y-length+2i)); }
      case 2u:{ limit=u32(max(0i,i32(game[G_HEIGHT])-y-length+1i)); }
      case 4u:{ limit=u32(max(0i,x-length+2i)); }
      case 8u:{ limit=u32(max(0i,i32(game[G_WIDTH])-x-length+1i)); }
      default:{ limit=0u; }
    }
  }
  let divisor=max(1u,limit);
  let gaps=select(vec2(gap,0u),vec2(gap/divisor,gap%divisor),ellipses==2u);
  let impossible_prefix=MATCH_PREFIX_PRUNE && ellipses!=0u && gap==0u && !matches_prefix(row,start);
  if(!impossible_prefix && limit>0u && matches(row,start,gaps)){
    let count=rd(MATCH_COUNTS+row);
    if(count>=MATCH_CAP){
      fail(3u);
      return;
    }
    let at=MATCHES+(row*MATCH_CAP+count)*3u;
    put(at,start);
    put(at+1u,gaps.x);
    put(at+2u,gaps.y);
    put(MATCH_COUNTS+row,count+1u);
  }
  let maxgap=select(divisor,divisor*divisor,ellipses==2u);
  var next=gap+1u;
  if(ellipses==2u && gaps.x+gaps.y+1u>=limit){ next=(gaps.x+1u)*divisor; }
  if(impossible_prefix){ next=maxgap; }
  put(SCAN_GAP,next);
  if(rd(SCAN_GAP)<maxgap){
    return;
  }
  put(SCAN_GAP,0u);
  put(SCAN_CELL,scan+1u);
  if(rd(SCAN_CELL)<cells()){
    return;
  }
  finish_matching_row(row);
}
fn apply_tick(){
  var tuple=rd(TUPLE);
  var starts:array<u32,ROW_CAP>;
  var gaps:array<vec2<u32>,ROW_CAP>;
  var valid=true;
  for(var r=0u;r<game[rule_ptr()+2u];r++){
    let count=rd(MATCH_COUNTS+r);
    let at=MATCHES+(r*MATCH_CAP+tuple%count)*3u;
    tuple/=count;
    starts[r]=rd(at);
    gaps[r]=vec2(rd(at+1u),rd(at+2u));
    valid=valid && matches(r,starts[r],gaps[r]);
  }
  if(valid && game[rule_ptr()+5u]!=0u){
    var changed=false;
    for(var r=0u;r<game[rule_ptr()+2u];r++){
      changed=replace(r,starts[r],gaps[r])||changed;
    }
    if(changed){
      put(PASS_CHANGED,1u);
      put(LOOP_CHANGED,1u);
    }
  }
  if(game[group_ptr()+2u]!=0u){
    queue_commands();
    put(PHASE,4u);
    return;
  }
  put(TUPLE,rd(TUPLE)+1u);
  if(rd(TUPLE)>=rd(TUPLE_COUNT)){
    queue_commands();
    next_rule();
  }
}
fn finish_movement_scan(next:u32){
  put(MOVE_CURSOR,next);
  if(next==cells()){
    put(MOVE_CURSOR,0u);
    if(rd(MOVED_THIS_PASS)!=0u){put(MOVED_THIS_PASS,0u);}
    else{put(PHASE,6u);put(RETRY_NEEDED,0u);}
  }
}
fn movement_tick(){
  var idx=rd(MOVE_CURSOR);
  if(SPARSE_RULES){
    // Empty cells cannot move or emit a movement sound. Skip a bounded run,
    // keeping the exact cell/layer order for every nonempty movement field.
    for(var empty=0u;empty<32u && idx<cells();empty++){
      var pending=0u;
      for(var w=0u;w<MOV_WORDS;w++){pending|=rd(MOVEMENTS+idx*MOV_WORDS+w);}
      if(pending!=0u){break;}
      idx++;
    }
    if(idx==cells()){finish_movement_scan(idx);return;}
  }
  let pos=vec2(i32(idx/game[G_HEIGHT]),i32(idx%game[G_HEIGHT]));
  for(var l=0u;l<game[G_LAYERS];l++){
    let d=get5(MOVEMENTS,idx,l);
    if(d==0u){
      continue;
    }
    if(d!=1u && d!=2u && d!=4u && d!=8u && d!=16u && d!=3u && d!=15u){
      fail(7u);
      return;
    }
    let destination=pos+direction(d);
    if(any(destination<vec2(0i)) || destination.x>=i32(game[G_WIDTH]) || destination.y>=i32(game[G_HEIGHT])){
      continue;
    }
    let dest=u32(destination.x)*game[G_HEIGHT]+u32(destination.y);
    var occupied=false;
    for(var w=0u;w<OBJ_WORDS;w++){
      occupied=occupied || (rd(BOARD+dest*OBJ_WORDS+w)&game[game[G_LAYER_BASE]+l*OBJ_WORDS+w])!=0u;
    }
    if(d!=16u && occupied){
      continue;
    }
    movement_sound(idx,l);
    for(var w=0u;w<OBJ_WORDS;w++){
      let mask=game[game[G_LAYER_BASE]+l*OBJ_WORDS+w];
      let moving=rd(BOARD+idx*OBJ_WORDS+w)&mask;
      put(BOARD+idx*OBJ_WORDS+w,rd(BOARD+idx*OBJ_WORDS+w)&~mask);
      put(BOARD+dest*OBJ_WORDS+w,rd(BOARD+dest*OBJ_WORDS+w)|moving);
      cache_object(dest,w,moving);
    }
    set5(MOVEMENTS,idx,l,0u);
    put(MOVED_THIS_PASS,1u);
  }
  finish_movement_scan(idx+1u);
}
fn rigid_cell(idx:u32,pending:u32){
  if(!SPARSE_RULES || pending!=0u){
  failed_movement_sounds(idx);
  for(var l=0u;l<game[G_LAYERS];l++){
    if((get5(MOVEMENTS,idx,l)&get5(RIGID_APPLIED,idx,l))==0u){
      continue;
    }
    let ord=get5(RIGID_OWNERS,idx,l);
    let group=game[game[G_RIGID_BASE]+ord];
    let mask=1u<<(group%32u);
    if(group!=0xffffffffu && (rd(BANNED_GROUPS+group/32u)&mask)==0u){
      put(BANNED_GROUPS+group/32u,rd(BANNED_GROUPS+group/32u)|mask);
      put(RETRY_NEEDED,1u);
    }
    break;
  }
  }
  for(var w=0u;w<MOV_WORDS;w++){
    put(MOVEMENTS+idx*MOV_WORDS+w,0u);
    put(RIGID_OWNERS+idx*MOV_WORDS+w,0u);
    put(RIGID_APPLIED+idx*MOV_WORDS+w,0u);
  }
}
fn rigid_tick(){
  // Only empty movement fields are batched. At most one cell with live
  // movements performs the full layer/retry scan in this bounded work unit.
  for(var empty=0u;empty<select(1u,32u,SPARSE_RULES) && rd(MOVE_CURSOR)<cells() && rd(STATUS)==0u;empty++){
    let idx=rd(MOVE_CURSOR);var pending=0u;
    if(SPARSE_RULES){for(var w=0u;w<MOV_WORDS;w++){pending|=rd(MOVEMENTS+idx*MOV_WORDS+w);}}
    rigid_cell(idx,pending);put(MOVE_CURSOR,idx+1u);
    if(!SPARSE_RULES || pending!=0u){break;}
  }
  if(rd(MOVE_CURSOR)<cells()){
    return;
  }
  put(MOVE_CURSOR,0u);
  if(rd(RETRY_NEEDED)!=0u){
    cp(BOARD,RETRY_BOARD);
    if(LINE_PRUNE){ for(var i=0u;i<cells();i++){ for(var w=0u;w<OBJ_WORDS;w++){ cache_object(i,w,rd(BOARD+i*OBJ_WORDS+w)); } } }
    cp_mov(MOVEMENTS,RETRY_MOVEMENTS);
    put(COMMANDS,0u);
    put(COMMAND_COUNT,0u);
    put(CAN_COUNT,0u);
    for(var w=0u;w<OBJ_WORDS;w++){ put(CREATED_BITS+w,0u); put(DESTROYED_BITS+w,0u); }
    put(RETRIES,rd(RETRIES)+1u);
    if(rd(RETRIES)>=50u){
      put(DIAGNOSTICS,rd(DIAGNOSTICS)|4u);
      put(PHASE,7u);
      return;
    }
    put(GROUP,0u);
    put(LOOP_CHANGED,0u);
    put(LOOP_COUNT,0u);
    put(PHASE,1u);
  }
  else{
    put(LATE,1u);
    put(GROUP,game[G_EARLY_GROUPS]);
    put(LOOP_CHANGED,0u);
    put(LOOP_COUNT,0u);
    put(PHASE,1u);
  }
}
fn has_won()->bool{
  if((rd(COMMANDS)&4u)!=0u){
    return true;
  }
  if(game[G_WINS]==0u){
    return false;
  }
  for(var w=0u;w<game[G_WINS];w++){
    let p=game[G_WIN_BASE]+w*5u;
    var some=false;
    var all_ok=true;
    for(var i=0u;i<cells();i++){
      let a=selected(i,game[p+1u],game[p+3u]!=0u);
      let b=selected(i,game[p+2u],game[p+4u]!=0u);
      some=some||(a&&b);
      all_ok=all_ok&&(!a||b);
    }
    if((game[p]==0u && some)||(game[p]==1u && !some)||(game[p]==2u && !all_ok)){
      return false;
    }
  }
  return true;
}
fn finish_turn(){
  let cmd=rd(COMMANDS);
  var modified=!same(BOARD,BEFORE);
  if((game[G_FLAGS]&4u)!=0u){
    var any_player=false;
    var moved=false;
    for(var i=0u;i<cells();i++){
      if(rd(PLAYER_POSITIONS+i)!=0u){
        any_player=true;
        moved=moved || !selected(i,game[G_PLAYER],false);
      }
    }
    if(any_player && !moved){
      restore(BEFORE);
      put(MODIFIED,0u);
      if(rd(PROBING)!=0u){
        put(MODIFIED,rd(OUTER_MODIFIED));
      }
      done();
      return;
    }
  }
  if((cmd&1u)!=0u){
    if(rd(PROBING)==0u){ output_commands(); }
    restore(BEFORE);
    simple_sound(9u);
    modified=countOneBits(cmd)>1u;
    put(MODIFIED,select(0u,1u,modified));
    if(rd(PROBING)!=0u){
      put(AGAINING,select(0u,1u,modified));
      put(MODIFIED,rd(OUTER_MODIFIED));
    }
    done();
    return;
  }
  if((cmd&2u)!=0u){
    if(rd(PROBING)==0u){ output_commands(); }
    history(BEFORE);
    if(rd(PROBING)==0u && rd(RESTARTING)==0u){
      cp(PARENT_BEFORE,BEFORE);
      put(PARENT_INPUT,rd(INPUT_MASK));
      put(PARENT_SUPPRESS_WIN,rd(SUPPRESS_WIN));
      restore(RESTART_BOARD);
      simple_sound(6u);
      if((game[G_FLAGS]&8u)!=0u){
        put(RESTARTING,1u);
        put(RESTART_FRAME,1u);
        put(SUPPRESS_WIN,1u);
        begin_turn(0u);
        return;
      }
    }
    modified=!same(BOARD,BEFORE);
  }
  if(rd(PROBING)!=0u){
    if(modified){
      restore(BEFORE);
    }
    else if((cmd&6u)==0u && rd(WINNING)==0u && (cmd&8u)!=0u){
      cp(RESTART_BOARD,BOARD);
      put(CHECKPOINT_USED,1u);
      put(EFFECTS,rd(EFFECTS)+1u);
    }
    put(AGAINING,select(0u,1u,modified || (cmd&6u)!=0u));
    put(MODIFIED,rd(OUTER_MODIFIED));
    put(COMMANDS,0u);
    done();
    return;
  }
  finish_result(modified);
}
fn finish_result(modified:bool){
  put(MODIFIED,select(0u,1u,modified));
  if(modified && rd(INPUT_MASK)!=0u){
    history(BEFORE);
  }
  play_sounds();
  output_commands();
  if(rd(TEXT_MODE)==0u && rd(SUPPRESS_WIN)==0u && has_won() && rd(WINNING)==0u){
    put(WINNING,1u);
    put(EFFECTS,rd(EFFECTS)+65536u);
    simple_sound(4u);
    put(AGAINING,0u);
  }
  if(rd(WINNING)==0u){
    if((rd(COMMANDS)&8u)!=0u){
      cp(RESTART_BOARD,BOARD);
      put(CHECKPOINT_USED,1u);
      put(EFFECTS,rd(EFFECTS)+1u);
    }
    if((rd(COMMANDS)&16u)!=0u && modified){
      put(OUTER_MODIFIED,rd(MODIFIED));
      put(PROBING,1u);
      put(SAVED_MESSAGE,rd(MESSAGE_TEXT));
      begin_turn(0u);
      return;
    }
  }
  put(COMMANDS,0u);
  put(COMMAND_COUNT,0u);
  done();
}
fn start_operation(){
  put(EPOCH,params.y);
  put(STATUS,0u);
  put(EFFECTS,0u);
  put(MODIFIED,0u);
  put(PROBING,0u);
  put(DIAGNOSTICS,0u);
  put(EVENT_COUNT,0u);
  put(SUPPRESS_WIN,0u);
  put(RESTARTING,0u);
  put(RESTART_FRAME,0u);
  if(opcode==8u){
    simple_sound(3u);
    put(SUPPRESS_WIN,1u);
    if((game[G_FLAGS]&8u)!=0u){ begin_turn(0u); }
    else{ done(); }
    return;
  }
  if(opcode==6u){
    if((game[G_FLAGS]&1u)==0u && rd(HISTORY_COUNT)>0u){
      put(HISTORY_COUNT,rd(HISTORY_COUNT)-1u);
      restore(HISTORY+rd(HISTORY_COUNT)*CELL_CAP*OBJ_WORDS);
      simple_sound(5u);
      put(MODIFIED,1u);
    }
    done();
    return;
  }
  if(opcode==7u){
    if((game[G_FLAGS]&2u)==0u){
      if(rd(AGAINING)!=0u && (game[G_FLAGS]&1u)==0u){
        loop{
          if(rd(HISTORY_COUNT)==0u){
            break;
          }
          let at=HISTORY+(rd(HISTORY_COUNT)-1u)*CELL_CAP*OBJ_WORDS;
          let eq=same(BOARD,at);
          put(HISTORY_COUNT,rd(HISTORY_COUNT)-1u);
          if(!eq){
            restore(at);
            break;
          }
        }
      }
      history(BOARD);
      restore(RESTART_BOARD);
      simple_sound(6u);
      put(MODIFIED,1u);
      if((game[G_FLAGS]&8u)!=0u){
        put(RESTARTING,1u);
        put(RESTART_FRAME,2u);
        put(SUPPRESS_WIN,1u);
        begin_turn(0u);
        return;
      }
    }
    done();
    return;
  }
  var input=0u;
  switch opcode{
    case 0u:{
      input=1u;
    }
    case 1u:{
      input=4u;
    }
    case 2u:{
      input=2u;
    }
    case 3u:{
      input=8u;
    }
    case 4u:{
      input=16u;
    }
    default:{
    }
  }
  begin_turn(input);
}
fn report_completion(board:u32){
  status[board]=rd(STATUS);
  if((params.w&0x80000000u)!=0u){
    status[params.z+board]=rd(AGAINING);
    status[params.z*2u+board]=rd(WINNING);
    status[params.z*3u+board]=rd(DIAGNOSTICS);
    // The host checks this shader-written epoch on EVERY bounded continuation.
    // A stale successful status cannot stand in for an omitted dispatch.
    status[params.z*4u+board]=rd(EPOCH);
  }
}
@compute @workgroup_size(32u)
fn main(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x>=params.z){
    return;
  }
  base=id.x*STATE_WORDS;
  load_execution_registers();
  line_base=id.x*cache_stride();
  opcode=inputs[params.x*params.z+id.x];
  if((params.w&0x80000000u)!=0u && opcode==0xffffffffu){
    put(EPOCH,params.y); put(STATUS,1u); save_execution_registers(); report_completion(id.x); return;
  }
  if((params.w&0x80000000u)!=0u && (opcode==6u || opcode==7u)){
    fail(14u); save_execution_registers(); report_completion(id.x); return;
  }
  if(rd(EPOCH)!=params.y){
    start_operation();
  }
  for(var fuel=0u;fuel<(params.w&0x7fffffffu) && rd(STATUS)==0u;fuel++){
    if(rd(PHASE)<8u){
      count_work(rd(PHASE));
    }
    switch rd(PHASE){
      case 1u:{
        let end=select(game[G_EARLY_GROUPS],game[G_GROUPS],rd(LATE)!=0u);
        if(rd(GROUP)>=end){
          if(rd(LATE)==0u){
            put(MOVE_CURSOR,0u);
            put(MOVED_THIS_PASS,0u);
            put(PHASE,5u);
          }
          else{
            put(PHASE,7u);
          }
        }
        else if(rd(LATE)==0u && (rd(BANNED_GROUPS+rd(GROUP)/32u)&(1u<<(rd(GROUP)%32u)))!=0u){
          put(PHASE,4u);
        }
        else{
          begin_group();
        }
      }
      case 2u:{
        // Bounded batching amortizes phase/dispatch overhead. It preserves
        // candidate order and stops before the sequential write phase.
        for(var m=0u;m<MATCH_CHUNK && rd(PHASE)==2u && rd(STATUS)==0u;m++){ match_tick(); }
      }
      case 3u:{
        apply_tick();
      }
      case 4u:{
        end_group();
      }
      case 5u:{
        movement_tick();
      }
      case 6u:{
        rigid_tick();
      }
      case 7u:{
        finish_turn();
      }
      case 8u:{
        finish_result(!same(BOARD,BEFORE));
      }
      case 9u:{
        // Impossible positive masks have no matches, commands or writes. Batch
        // their exact ordinary finish/advance operations, stopping at any other
        // phase (including group boundaries and sequential replacements).
        for(var skipped=0u;skipped<select(1u,32u,SPARSE_RULES) && rd(PHASE)==9u && rd(STATUS)==0u;skipped++){
          finish_rule(0u);
        }
      }
      default:{
        fail(8u);
      }
    }
  }
  save_execution_registers();
  report_completion(id.x);
}
