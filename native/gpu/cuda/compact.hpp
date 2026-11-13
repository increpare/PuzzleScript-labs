#pragma once
std::string read_limited(const std::string&path,size_t maximum){std::ifstream file(path,std::ios::binary|std::ios::ate);require(bool(file),"Cannot open "+path);auto length=file.tellg();require(length>=0&&uint64_t(length)<=maximum,"File capacity exceeded: "+path);std::string bytes(size_t(length),'\0');file.seekg(0);file.read(bytes.data(),std::streamsize(bytes.size()));require(bool(file)||bytes.empty(),"Incomplete file read: "+path);return bytes;}
// Existing PSGB v1 interchange: six LE u32 header words; each pristine board
// contains 256 RC4 permutation words followed by column-major object words.
void compact_boards(Game&game,const std::string&file){
 auto bytes=read_limited(file,64*1024*1024);require(bytes.size()>=24&&bytes.size()%4==0,"PSGB file length");
 auto word=[&](size_t index){size_t p=index*4;return u32(static_cast<unsigned char>(bytes[p]))|(u32(static_cast<unsigned char>(bytes[p+1]))<<8)|(u32(static_cast<unsigned char>(bytes[p+2]))<<16)|(u32(static_cast<unsigned char>(bytes[p+3]))<<24);};
 u32 count=word(2),objects=game.l.CELL_CAP*game.l.OBJ_WORDS;
 require(word(0)==0x42475350&&word(1)==1&&count&&count<=2048&&word(3)==game.g[1]&&word(4)==game.g[2]&&word(5)==game.l.OBJ_WORDS,"PSGB header/game shape");
 require(bytes.size()==(6+size_t(count)*(256+objects))*4,"PSGB file length");require(uint64_t(count)*game.l.STATE_WORDS*4<=512ull*1024*1024,"Pristine root cache exceeds 512 MiB");
 std::vector<std::vector<u32>>roots;roots.reserve(count);
 for(u32 board=0;board<count;board++){
  auto initial=game.initial;size_t start=6+size_t(board)*(256+objects);std::vector<u32>permutation;
  for(u32 i=0;i<256;i++){u32 value=word(start+i);initial[128+i]=value;permutation.push_back(value);}std::sort(permutation.begin(),permutation.end());for(u32 i=0;i<256;i++)require(permutation[i]==i,"PSGB RC4 permutation");
  for(u32 i=0;i<objects;i++){u32 value=word(start+256+i);if(game.g[4]%32&&i%game.l.OBJ_WORDS==game.l.OBJ_WORDS-1)require(!(value&~((1u<<(game.g[4]%32))-1)),"PSGB object mask");initial[game.l.BOARD+i]=initial[game.l.RESTART_BOARD+i]=value;}
  roots.push_back(std::move(initial));
 }game.roots=std::move(roots);
}
