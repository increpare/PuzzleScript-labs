#pragma once
#include <bit>
#include <cstring>
#include <span>
#include <string_view>
#include <type_traits>
using KeyView=std::span<const u32>;
// Full keys are always compared. This word-at-a-time hash only selects a bucket;
// hash_bits can deliberately force collisions for regression testing.
struct WordHash {
 using is_transparent=void;
 unsigned bits=64;
 size_t operator()(std::string_view bytes)const noexcept{
  uint64_t h=0;const char*p=bytes.data();size_t n=bytes.size();
  auto add=[&](uint64_t word){h=(std::rotl(h,5)^word)*0x517cc1b727220a95ull;};
  while(n>=8){uint64_t word;std::memcpy(&word,p,8);add(word);p+=8;n-=8;}
  if(n>=4){u32 word;std::memcpy(&word,p,4);add(word);p+=4;n-=4;}
  while(n--){add(static_cast<unsigned char>(*p++));}
  return size_t(bits==64?h:h&((uint64_t(1)<<bits)-1));
 }
};
