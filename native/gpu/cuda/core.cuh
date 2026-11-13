#pragma once
#include <cstdint>
#ifdef __CUDACC__
#ifdef PS_CUDA_FORCE_INLINE
#define PS_HD __host__ __device__ __forceinline__
#else
#define PS_HD __host__ __device__
#endif
#else
#define PS_HD
#endif
namespace ps_cuda {
using u32=uint32_t; using i32=int32_t;
template<class T,int N> struct Array { T v[N]; PS_HD T& operator[](u32 n){return v[n];} PS_HD const T& operator[](u32 n)const{return v[n];} };
template<class T> struct Vec2 {
  T x,y;
  PS_HD T& operator[](u32 n){return n?y:x;}
  PS_HD T operator[](u32 n)const{return n?y:x;}
  PS_HD Vec2 operator*(T k)const{return {x*k,y*k};}
  PS_HD Vec2& operator+=(Vec2 b){x+=b.x;y+=b.y;return *this;}
  PS_HD Vec2 operator+(Vec2 b)const{return {x+b.x,y+b.y};}
  PS_HD bool operator<(Vec2 b)const{return x<b.x||y<b.y;}
};
template<class T> PS_HD Vec2<T> v2(T x,T y){return {x,y};}
template<class T> PS_HD Vec2<T> v2(T x){return {x,x};}
template<class T>struct Vec4 {T x,y,z,w;PS_HD Vec2<T> yz()const{return {y,z};}};
template<class T>PS_HD Vec4<T> v4(T x,T y,T z,T w){return {x,y,z,w};}
template<class T>PS_HD Vec4<T> v4(T x,Vec2<T> yz,T w){return {x,yz.x,yz.y,w};}
PS_HD inline bool any(bool b){return b;}
template<class T> PS_HD T select(T a,T b,bool c){return c?b:a;}
template<class T> PS_HD T min(T a,T b){return a<b?a:b;}
template<class T> PS_HD T max(T a,T b){return a>b?a:b;}
PS_HD inline u32 countOneBits(u32 x){
#ifdef __CUDA_ARCH__
 return __popc(x);
#else
 u32 n=0;while(x){x&=x-1;n++;}return n;
#endif
}
PS_HD inline u32 countLeadingZeros(u32 x){
#ifdef __CUDA_ARCH__
 return __clz(x);
#else
 if(!x)return 32;u32 n=0;for(u32 b=0x80000000u;!(x&b);b>>=1)n++;return n;
#endif
}
PS_HD inline u32 firstTrailingBit(u32 x){if(!x)return 0xffffffffu;u32 i=0;while(!(x&1u)){x>>=1;i++;}return i;}
// Rank is at most31. Used only by the experimental compact-line path.
PS_HD inline u32 nthSetBit(u32 bits,u32 rank){for(u32 i=0;i<rank;i++)bits&=bits-1;
#ifdef __CUDA_ARCH__
 return bits?u32(__ffs(int(bits))-1):0xffffffffu;
#else
 return firstTrailingBit(bits);
#endif
}
struct Params {u32 x,y,z,w;};
// Logical V2 word offsets are shared by both executors. No STL, allocation,
// host callbacks, or recursion occurs in the gameplay interpreter.
struct Layout {
 u32 OBJ_WORDS,MOV_WORDS,CELL_CAP,HISTORY_CAP,MATCH_CAP,ROW_CAP,STATE_WORDS;
 u32 RNG_DATA,BOARD,MOVEMENTS,BEFORE,PARENT_BEFORE,RETRY_BOARD,RESTART_BOARD;
 u32 RETRY_MOVEMENTS,RIGID_OWNERS,RIGID_APPLIED,PLAYER_POSITIONS,BANNED_GROUPS,BAN_WORDS;
 u32 CREATED_BITS,DESTROYED_BITS,GLOBAL_OBJECTS,HISTORY,MATCHES,COMMAND_LIST;
 u32 SOUND_CAN,SOUND_CANT,EVENTS,SOUND_CAP,EFFECT_CAP;
};
struct CooperativeShared {
 u32 eligible_rule_start,eligible_rule_bits,eligible_rule_valid,eligible_line_valid,eligible_line_row,eligible_line_bits;
 Array<Vec4<u32>,32> cooperative_candidates,cooperative_ranges;
 Array<u32,32> cooperative_matches;
 u32 cooperative_count,cooperative_row,cooperative_rp,cooperative_rule,cooperative_row_end;
 u32 cooperative_mode,cooperative_rule_start,cooperative_direct,cooperative_direct_start,cooperative_finished,cooperative_range_count;
 u32 prefix_valid,prefix_row,prefix_start,prefix_end,prefix_bits;
 u32 finish_commands,finish_modified,finish_won;
};
template<int FixedOW=0,int FixedMW=0,bool Cooperative=false>struct Engine:Layout {
 const u32* game; u32* states; u32* line_objects;
 Params params{},sparse_metadata{};
 CooperativeShared* shared=nullptr;
 bool compact_lines=false;
 bool parallel_ellipses=false;
 // Valid only during one cooperative finish_result call, before any board write.
 bool finish_win_valid=false,finish_win_value=false;
 static constexpr bool SPARSE_RULES=true,MOVEMENT_GUARDS=true;
 PS_HD u32 object_words()const{return FixedOW?FixedOW:Layout::OBJ_WORDS;}
 PS_HD u32 movement_words()const{return FixedMW?FixedMW:Layout::MOV_WORDS;}
 #include "generated-core.inc"
 // A cached row's bitmask already certifies all eligible lines. A contiguous
 // rank interval replaces serial range construction. Workers select their own
 // line, preserving exactly the same scan order. Only leader cursors change.
 PS_HD void prepare_compact_lines(u32 span){
  const u32 scan=cursor_SCAN_CELL;if(scan>=cells()){shared->cooperative_row_end=1;return;}
  const u32 line=scan/span,mask=shared->eligible_line_bits&(~0u<<line);
  if(!mask){cursor_put_SCAN_CELL(cells());shared->cooperative_row_end=1;return;}
  const u32 first=nthSetBit(mask,0),offset=first==line?scan%span:0,lines=countOneBits(mask);
  const u32 available=lines*span-offset,take=min(32u,available);
  shared->cooperative_count=take;shared->cooperative_direct=2;
  shared->cooperative_ranges[0]=v4(mask,offset,span,0u);
  const u32 next=offset+take,rank=next/span;
  if(rank>=lines){cursor_put_SCAN_CELL(cells());shared->cooperative_row_end=1;}
  else cursor_put_SCAN_CELL(nthSetBit(mask,rank)*span+next%span);
 }
 // Matching is pure until the complete rule's tuple list is applied. Cache
 // prefix witnesses only in this warp, invalidate at every begin_rule, and
 // rebuild after a bounded launch/ownership transfer. No witness is a state key.
 PS_HD void prepare_parallel_ellipses(u32 span,bool cached_lines){
  const u32 rp=shared->cooperative_rp,d=game[shared->cooperative_rule],ellipses=game[rp+2];
  for(u32 work=0;work<32;work++){
   u32 scan=cooperative_line_jump(cursor_SCAN_CELL,span);
   if(scan!=cursor_SCAN_CELL){cursor_put_SCAN_CELL(scan);cursor_put_SCAN_GAP(0);}
   u32 gap=cursor_SCAN_GAP;
   if(scan>=cells()){shared->cooperative_row_end=1;break;}
   if(LINE_PRUNE&&!cached_lines&&!gap&&!possible_line(shared->cooperative_row,scan,d)){cursor_put_SCAN_CELL((scan/span+1)*span);continue;}
   if(!gap){
    if(!shared->prefix_valid||shared->prefix_row!=rp||scan<shared->prefix_start||scan>=shared->prefix_end){
     if(shared->cooperative_count)break; // Commit an already ordered batch first.
     shared->prefix_row=rp;shared->prefix_start=scan;shared->prefix_end=min(cells(),scan+32u);shared->prefix_valid=0;
     shared->cooperative_mode=5;return;
    }
    const u32 bits=shared->prefix_bits&(~0u<<(scan-shared->prefix_start));
    if(!bits){cursor_put_SCAN_CELL(shared->prefix_end);continue;}
    scan=shared->prefix_start+nthSetBit(bits,0);cursor_put_SCAN_CELL(scan);
   }
   const u32 start=scan_origin(scan,d);const i32 x=i32(start/game[G_HEIGHT]),y=i32(start%game[G_HEIGHT]),length=i32(game[rp+1]-ellipses);
   u32 limit=0;switch(d){case 1:limit=u32(max(0,y-length+2));break;case 2:limit=u32(max(0,i32(game[G_HEIGHT])-y-length+1));break;case 4:limit=u32(max(0,x-length+2));break;case 8:limit=u32(max(0,i32(game[G_WIDTH])-x-length+1));break;}
   const u32 divisor=max(1u,limit),maximum=ellipses==2?divisor*divisor:divisor;
   // A single-origin range needs no serial candidate descriptors. Invalid
   // two-ellipse sums are rejected by workers without changing accepted order.
   if(limit&&shared->cooperative_count==0&&maximum-gap>=8){
    const u32 take=min(32u,maximum-gap),next=gap+take;shared->cooperative_count=take;shared->cooperative_direct=ellipses==2?4:3;
    shared->cooperative_ranges[0]=v4(start,gap,divisor,limit);
    if(next<maximum)cursor_put_SCAN_GAP(next);else{cursor_put_SCAN_GAP(0);cursor_put_SCAN_CELL(scan+1);}
    if(cursor_SCAN_CELL>=cells())shared->cooperative_row_end=1;return;
   }
   const auto gaps=ellipses==2?v2(gap/divisor,gap%divisor):v2(gap,0u);
   if(limit){shared->cooperative_candidates[shared->cooperative_count]=v4(start,gaps,0u);shared->cooperative_count++;}
   u32 next=gap+1;if(ellipses==2&&gaps.x+gaps.y+1>=limit)next=(gaps.x+1)*divisor;
   if(next<maximum)cursor_put_SCAN_GAP(next);else{cursor_put_SCAN_GAP(0);cursor_put_SCAN_CELL(scan+1);}
  }
  if(cursor_SCAN_CELL>=cells())shared->cooperative_row_end=1;
 }
 PS_HD bool prefix_candidate_matches(u32 rp,u32 start,u32 d){
  // Worker execution cursors are not the leader's cursors. Use its absolute
  // compiled row pointer, not row_ptr(), which depends on cursor_RULE.
  const auto step=direction(d);auto p=v2(i32(start/game[G_HEIGHT]),i32(start%game[G_HEIGHT]));
  for(u32 i=0;i<game[rp+1];i++){const u32 c=cell_ptr(game[rp]+i);if(game[c+17])return true;
   if(p.x<0||p.y<0||p.x>=i32(game[G_WIDTH])||p.y>=i32(game[G_HEIGHT]))return false;
   if(!matches_cell(c,u32(p.x)*game[G_HEIGHT]+u32(p.y)))return false;p+=step;
  }return true;
 }
 #include "generated-cooperative.inc"
};
using Runtime=Engine<>;
PS_HD inline u32 key_words(Layout l){return 72+l.CELL_CAP*(2*l.OBJ_WORDS+l.MOV_WORDS);}
// PSCK1: eight metadata words, 256 RC4 bytes packed little-endian, then
// object, movement and restart words. The permutation occupies 256, not 1024 B.
PS_HD inline void capture_key(Layout l,const u32*s,u32*k){
 k[0]=s[4];k[1]=s[5];k[2]=s[8];k[3]=s[71];k[4]=s[70];k[5]=s[6];k[6]=s[7];k[7]=0;
 for(u32 i=0;i<64;i++)k[8+i]=s[128+i*4]|(s[129+i*4]<<8)|(s[130+i*4]<<16)|(s[131+i*4]<<24);
 u32 os=l.CELL_CAP*l.OBJ_WORDS,ms=l.CELL_CAP*l.MOV_WORDS;
 for(u32 i=0;i<os;i++)k[72+i]=s[l.BOARD+i];
 for(u32 i=0;i<ms;i++)k[72+os+i]=s[l.MOVEMENTS+i];
 for(u32 i=0;i<os;i++)k[72+os+ms+i]=s[l.RESTART_BOARD+i];
}
PS_HD inline void restore_key(Layout l,u32*s,const u32*k){
 for(u32 i=0;i<128;i++)s[i]=0;
 s[4]=k[0];s[5]=k[1];s[8]=k[2];s[71]=k[3];s[70]=k[4];s[6]=k[5];s[7]=k[6];
 for(u32 i=0;i<256;i++)s[128+i]=(k[8+i/4]>>((i%4)*8))&255u;
 u32 os=l.CELL_CAP*l.OBJ_WORDS,ms=l.CELL_CAP*l.MOV_WORDS;
 for(u32 i=0;i<os;i++)s[l.BOARD+i]=k[72+i];
 for(u32 i=0;i<ms;i++)s[l.MOVEMENTS+i]=k[72+os+i];
 for(u32 i=0;i<os;i++)s[l.RESTART_BOARD+i]=k[72+os+ms+i];
}
}
