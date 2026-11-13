// Included inside resident. Ranking only: no heuristic value prunes a state.
// Sixteen disjoint heaps distribute insertion, while admission selects the best
// available roots. Each node belongs to heap(id %16), so ceil(capacity/16) slots
// per heap suffice even before any node is removed.
constexpr u32 priority_queues=16;
// Bounded approximate width-one novelty, conditioned on h modulo 64. Collisions
// and concurrent observations affect priority only; no state is discarded.
constexpr u32 novelty_buckets=64,novelty_penalty=0x80000000u;
PS_HD inline size_t novelty_words(u32 cells,u32 words){return size_t(novelty_buckets)*2*cells*words;}
PS_HD inline u32 novelty_mask(const u32* game,u32 word){
 const u32 bits=game[4]-word*32;return bits>=32?0xffffffffu:(1u<<bits)-1;
}
PS_HD inline u32 novelty_scalar(const u32* game,const u32* board,u32 words,u32 h,u32* seen){
 const u32 count=game[1]*game[2]*words;const size_t base=size_t(h%novelty_buckets)*2*count;
 bool fresh=false;for(u32 i=0;i<count;i++){
  const u32 mask=novelty_mask(game,i%words),present=board[i]&mask,absent=(~board[i])&mask;
  fresh|=bool((present&~seen[base+i])|(absent&~seen[base+count+i]));
  seen[base+i]|=present;seen[base+count+i]|=absent;
 }return h|(fresh?0:novelty_penalty);
}
PS_HD inline bool priority_less(u32 a,u32 b,const u32* priority){
 return priority[a]<priority[b]||(priority[a]==priority[b]&&a<b);
}
PS_HD inline void priority_push(u32* heap,u32& count,u32 id,const u32* priority){
 u32 pos=count++;
 while(pos){const u32 parent=(pos-1)/2;if(!priority_less(id,heap[parent],priority))break;heap[pos]=heap[parent];pos=parent;}
 heap[pos]=id;
}
PS_HD inline u32 priority_pop(u32* heap,u32& count,const u32* priority){
 const u32 result=heap[0],last=heap[--count];u32 pos=0;
 while(pos*2+1<count){u32 child=pos*2+1;if(child+1<count&&priority_less(heap[child+1],heap[child],priority))child++;
  if(!priority_less(heap[child],last,priority))break;heap[pos]=heap[child];pos=child;}
 if(count)heap[pos]=last;return result;
}
PS_HD inline bool ranking_match(const u32* game,const u32* board,u32 cell,u32 mask,u32 aggregate,u32 words){
 bool any=false;for(u32 w=0;w<words;w++){
  const u32 m=game[mask+w],v=board[size_t(cell)*words+w];
  if(aggregate&&(v&m)!=m)return false;any|=(v&m)!=0;
 }return aggregate||any;
}
PS_HD inline u32 ranking_distance(u32 a,u32 b,u32 height){
 const u32 ax=a/height,ay=a%height,bx=b/height,by=b%height;
 return (ax>bx?ax-bx:bx-ax)+(ay>by?ay-by:by-ay);
}
PS_HD inline u32 ranking_nearest(const u32* game,const u32* board,u32 cell,u32 mask,u32 aggregate,u32 words,u32 cells){
 u32 best=nil;for(u32 j=0;j<cells;j++)if(ranking_match(game,board,j,mask,aggregate,words))best=min(best,ranking_distance(cell,j,game[2]));
 return best==nil?64:best;
}
// Independent port of the native winconditions heuristic: Manhattan target
// distance, all/no penalties, and capped player-to-subject distance. No static
// deadlock pruning or Auto-specific assignment extras are implied.
PS_HD inline u32 ranking_scalar(const u32* game,const u32* board,u32 words){
 const u32 cells=game[1]*game[2];u32 score=0;
 for(u32 c=0;c<game[22];c++){
  const u32* win=game+game[21]+c*5;u32 best=64;
  for(u32 i=0;i<cells;i++)if(ranking_match(game,board,i,win[1],win[3],words)){
   const bool target=ranking_match(game,board,i,win[2],win[4],words);
   if(win[0]==2&&!target)score+=10+ranking_nearest(game,board,i,win[2],win[4],words,cells);
   else if(win[0]==1)best=min(best,target?0:ranking_nearest(game,board,i,win[2],win[4],words,cells));
   else if(win[0]==0&&target)score+=10;
  }
  if(win[0]==1)score+=best;
 }
 if(score){bool players=false;u32 best=64;
  for(u32 i=0;i<cells;i++)if(ranking_match(game,board,i,game[5],game[6],words)){
   players=true;for(u32 c=0;c<game[22];c++){const u32* win=game+game[21]+c*5;best=min(best,ranking_nearest(game,board,i,win[1],win[3],words,cells));}
  }if(players)score+=min(best,16u);
 }return score;
}
__device__ u32 ranking_warp(const u32* game,const u32* board,u32 words){
 const u32 cells=game[1]*game[2];u32 score=0;
 for(u32 c=0;c<game[22];c++){
  const u32* win=game+game[21]+c*5;u32 sum=0,best=64;
  for(u32 i=threadIdx.x;i<cells;i+=32)if(ranking_match(game,board,i,win[1],win[3],words)){
   const bool target=ranking_match(game,board,i,win[2],win[4],words);
   if(win[0]==2&&!target)sum+=10+ranking_nearest(game,board,i,win[2],win[4],words,cells);
   else if(win[0]==1)best=min(best,target?0:ranking_nearest(game,board,i,win[2],win[4],words,cells));
   else if(win[0]==0&&target)sum+=10;
  }
  score+=__reduce_add_sync(0xffffffffu,sum);
  if(win[0]==1)score+=__reduce_min_sync(0xffffffffu,best);
 }
 if(score){u32 players=0,best=64;
  for(u32 i=threadIdx.x;i<cells;i+=32)if(ranking_match(game,board,i,game[5],game[6],words)){
   players=1;for(u32 c=0;c<game[22];c++){const u32* win=game+game[21]+c*5;best=min(best,ranking_nearest(game,board,i,win[1],win[3],words,cells));}
  }
  best=__reduce_min_sync(0xffffffffu,best);if(__any_sync(0xffffffffu,players))score+=min(best,16u);
 }return score;
}
__device__ u32 novelty_warp(const u32* game,const u32* board,u32 words,u32 h,u32* seen){
 const u32 count=game[1]*game[2]*words;const size_t base=size_t(h%novelty_buckets)*2*count;
 bool fresh=false;for(u32 i=threadIdx.x;i<count;i+=32){
  const u32 mask=novelty_mask(game,i%words),present=board[i]&mask,absent=(~board[i])&mask;
  const u32 old_present=atomicOr(seen+base+i,present),old_absent=atomicOr(seen+base+count+i,absent);
  fresh|=bool((present&~old_present)|(absent&~old_absent));
 }return h|(__any_sync(0xffffffffu,fresh)?0:novelty_penalty);
}
__global__ void production_rank(const u32* game,Layout l,const Query* queries,const u32* keys,
 const Node* nodes,u32* heuristic,u32* priority,u32* novelty,u32 capacity,u32 kw,u32 slots){
 const u32 qi=blockIdx.x/slots,a=blockIdx.x%slots;const auto& q=queries[qi];
 if(!q.guided)return;const u32 id=q.queued_count+a;if(id>=q.count)return;
 const size_t index=size_t(qi)*capacity+id;
 const u32 h=ranking_warp(game,keys+index*kw+72,l.OBJ_WORDS);
 const u32 raw=q.guided>=3?novelty_warp(game,keys+index*kw+72,l.OBJ_WORDS,h,novelty+size_t(qi)*novelty_words(l.CELL_CAP,l.OBJ_WORDS)):
  q.guided==1?h:nodes[index].depth+q.heuristic_weight*h;
 const u32 rank=q.guided==4?2*h+(raw>>31):raw;
 if(threadIdx.x==0){heuristic[index]=h;priority[index]=rank;}
}
__global__ void production_enqueue(Query* queries,u32* heaps,const u32* priority,u32 capacity){
 const u32 qi=blockIdx.x,k=threadIdx.x,queue_capacity=(capacity+15)/16;auto& q=queries[qi];
 if(!q.guided)return;
 // A terminal startup root has already been consumed without an expansion.
 if(q.head==1&&q.count==1&&q.expanded==0){if(k==0)q.queued_count=1;return;}
 if(k<16){
  u32* heap=heaps+(size_t(qi)*16+k)*queue_capacity;const u32* scores=priority+size_t(qi)*capacity;
  const u32 first=q.queued_count+((k+16-q.queued_count%16)%16);
  for(u32 id=first;id<q.count;id+=16)priority_push(heap,q.heap_count[k],id,scores);
 }
 __syncwarp();if(k==0)q.queued_count=q.count;
}
