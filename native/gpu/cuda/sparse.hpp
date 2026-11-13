#pragma once
// Host compilation of validated masks into sparse instructions. No board is
// read here. Same conservative certificates as ../src/sparse.rs.
Params prepare_sparse(std::vector<u32>&game){
 const auto input=game;const u32 ow=input[23],mw=input[24];
 auto check=[&]{require(game.size()<=32*1024*1024,"Sparse game exceeds 128 MiB");};
 auto append=[&](std::initializer_list<u32> row){game.insert(game.end(),row);check();};
 u32 base=u32(game.size());game.resize(game.size()+size_t(input[10])*8);check();
 for(u32 cell=0;cell<input[10];cell++){
  u32 c=input[16]+cell*18,h=base+cell*8;if(input[c+17]){game[h+6]=1;continue;}
  for(u32 slot:{0u,2u}){u32 width=slot==0?ow:mw;game[h+slot]=u32(game.size());u32 n=0;for(u32 w=0;w<width;w++){u32 required=input[input[c+slot]+w],missing=input[input[c+slot+1]+w];if(required|missing){append({w,required,missing});n++;}}game[h+slot+1]=n;}
  bool random=false;for(u32 w=0;w<ow;w++)random=random||input[input[c+15]+w]!=0;for(u32 w=0;w<mw;w++)random=random||input[input[c+16]+w]!=0;game[h+6]=u32(random);game[h+4]=u32(game.size());u32 n=0;
  for(u32 w=0;w<ow;w++){u32 clear=input[input[c+10]+w],set=input[input[c+11]+w];if(clear|set){append({w,clear,set});n++;}}
  for(u32 w=0;w<mw;w++){u32 clear=input[input[c+12]+w]|input[input[c+14]+w],set=input[input[c+13]+w];if(clear|set){append({0x80000000u|w,clear,set});n++;}}game[h+5]=n;
 }
 u32 rules=u32(game.size());game.resize(game.size()+size_t(input[9])*2);check();
 for(u32 r=0;r<input[9];r++){
  u32 p=input[14]+r*8;std::vector<u32>required(ow+mw,0);
  for(u32 row=0;row<input[p+2];row++){u32 rp=input[15]+(input[p+1]+row)*4;for(u32 w=0;w<ow;w++)required[w]|=input[input[rp+3]+w];for(u32 i=0;i<input[rp+1];i++){u32 c=input[16]+(input[rp]+i)*18;if(input[c+17])continue;for(u32 w=0;w<mw;w++)required[ow+w]|=input[input[c+2]+w];}}
  u32 h=rules+r*2;game[h]=u32(game.size());u32 n=0;for(u32 w=0;w<required.size();w++)if(required[w]){append({w<ow?w:(0x80000000u|(w-ow)),required[w]});n++;}game[h+1]=n;
 }
 u32 groups=u32(game.size());game.resize(game.size()+size_t(input[7])*2);check();
 for(u32 group=0;group<input[7];group++){
  u32 gp=input[13]+group*4;std::vector<u32>common(ow+mw,0xffffffffu);
  for(u32 r=input[gp];r<input[gp]+input[gp+1];r++){u32 h=rules+r*2;std::vector<u32>required(ow+mw,0);for(u32 i=0;i<game[h+1];i++){u32 p=game[h]+i*2,word=game[p],index=(word&0x80000000u)?ow+(word&0x7fffffffu):word;required[index]=game[p+1];}for(u32 w=0;w<common.size();w++)common[w]&=required[w];}
  u32 h=groups+group*2;game[h]=u32(game.size());u32 n=0;for(u32 w=0;w<common.size();w++)if(common[w]){append({w<ow?w:(0x80000000u|(w-ow)),common[w]});n++;}game[h+1]=n;
 }
 return {base,rules,groups,0};
}
