#pragma once
#include <cstdint>
#include <memory>
#include <string>
// Host search ordering only. This bridge never executes gameplay or prunes states.
struct NativePolicyGame;
struct NativePolicyContext;
std::shared_ptr<NativePolicyGame> native_policy_load(const std::string&,int,int,int,int,int);
std::shared_ptr<NativePolicyContext> native_policy_context(std::shared_ptr<NativePolicyGame>,const uint32_t*);
int32_t native_policy_score(NativePolicyContext&,const uint32_t*);
