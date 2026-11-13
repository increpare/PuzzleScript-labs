#pragma once
#include <bcrypt.h>
#pragma comment(lib,"bcrypt.lib")
std::string sha_words(const u32*words,size_t count){
 struct Provider{BCRYPT_ALG_HANDLE value=nullptr;Provider(){require(BCryptOpenAlgorithmProvider(&value,BCRYPT_SHA256_ALGORITHM,nullptr,0)>=0,"SHA256 provider unavailable");}~Provider(){BCryptCloseAlgorithmProvider(value,0);}};
 static Provider provider;ULONG objectBytes=0,readBytes=0;require(BCryptGetProperty(provider.value,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&objectBytes),sizeof(objectBytes),&readBytes,0)>=0,"SHA256 object size");std::vector<unsigned char>object(objectBytes);BCRYPT_HASH_HANDLE hash=nullptr;
 require(BCryptCreateHash(provider.value,&hash,object.data(),objectBytes,nullptr,0,0)>=0,"SHA256 initialization");struct Cleanup{BCRYPT_HASH_HANDLE h;~Cleanup(){BCryptDestroyHash(h);}}cleanup{hash};
 require(count<=0xffffffffu/4,"Digest byte capacity");if(count)require(BCryptHashData(hash,reinterpret_cast<PUCHAR>(const_cast<u32*>(words)),ULONG(count*4),0)>=0,"SHA256 input");unsigned char digest[32];require(BCryptFinishHash(hash,digest,32,0)>=0,"SHA256 completion");const char*hex="0123456789abcdef";std::string result;for(auto b:digest){result+=hex[b>>4];result+=hex[b&15];}return result;
}
J digest_words(const u32*p,size_t count){return J(J::Object{{"words",ji(count)},{"sha256",J(sha_words(p,count))}});}
J observe_digest(const Game&g,const u32*s){const auto&l=g.l;u32 objects=l.CELL_CAP*l.OBJ_WORDS;J::Array events;for(u32 i=0;i<s[75];i++){u32 p=l.EVENTS+i*2;require(s[p+1]<g.symbols.size(),"Bad output symbol");events.emplace_back(J::Object{{"kind",J(std::string(s[p]?"message":"sound"))},{s[p]?"text":"seed",J(g.symbols[s[p+1]])}});}
 return J(J::Object{{"board",digest_words(s+l.BOARD,objects)},{"movements",digest_words(s+l.MOVEMENTS,l.CELL_CAP*l.MOV_WORDS)},{"restart",digest_words(s+l.RESTART_BOARD,objects)},{"history",J(J::Object{{"snapshots",ji(s[3])},{"words_per_snapshot",ji(objects)},{"sha256",J(sha_words(s+l.HISTORY,size_t(s[3])*objects))}})},{"rng",J(J::Object{{"i",ji(s[6])},{"j",ji(s[7])},{"s",digest_words(s+128,256)}})},{"againing",J(bool(s[4]))},{"winning",J(bool(s[5]))},{"checkpoint",J(bool(s[8]))},{"effects",ji(s[9])},{"modified",J(bool(s[10]))},{"commands",ji(s[11])},{"created",digest_words(s+l.CREATED_BITS,l.OBJ_WORDS)},{"destroyed",digest_words(s+l.DESTROYED_BITS,l.OBJ_WORDS)},{"diagnostics",ji(s[38])},{"message",J(g.symbols.at(s[70]))},{"textMode",J(bool(s[71]))},{"events",J(std::move(events))}});
}
