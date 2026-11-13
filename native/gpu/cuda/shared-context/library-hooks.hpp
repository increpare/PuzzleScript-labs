#pragma once
#include "service-api.h"
#include <cuda.h>
#include <cstring>

// This header is private to each DLL; nothing here is exported. CUDA's primary
// context is process-wide even though the two search implementations stay apart.
namespace ps_shared {
inline PsServiceHostV1 host{};
inline std::atomic<uint64_t> owner_context{0}, affinity{0}, owner_thread{0};
inline std::string role;
inline void driver_check(CUresult result) {
    if(result != CUDA_SUCCESS) {
        const char* text=nullptr;cuGetErrorString(result,&text);
        throw std::runtime_error(std::string("Shared CUDA context: ")+(text?text:"driver failure"));
    }
}
inline uint64_t context_id() {
    CUcontext context=nullptr;driver_check(cuCtxGetCurrent(&context));
    require(context!=nullptr,"Shared CUDA context is not current");
    unsigned long long id=0;driver_check(cuCtxGetId(context,&id));
    require(id==host.primary_context_id,"GPU service selected a different CUDA context");
    return id;
}
inline void set_affinity(const J& request) {
    const auto* value=request.find("affinity_mask");
    require(value!=nullptr,"Shared service requires an explicit role affinity");
    const auto text=value->asString();
    require(!text.empty()&&text.size()<=16&&text.find_first_not_of("0123456789abcdefABCDEF")==std::string::npos,"Hex role affinity required");
    const auto bits=std::stoull(text,nullptr,16);
    require(bits&&SetThreadAffinityMask(GetCurrentThread(),DWORD_PTR(bits)),"Cannot set shared input-thread affinity");
    affinity=bits;
}
inline void bind_owner() {
    require(affinity.load()&&SetThreadAffinityMask(GetCurrentThread(),DWORD_PTR(affinity.load())),"Cannot set shared GPU-owner affinity");
    owner_context=context_id();owner_thread=GetCurrentThreadId();
}
inline void validate_configuration(const J& request) {
    require(str(request,"mode","cuda")=="cuda","Shared experiment requires CUDA execution; no CPU fallback");
    require(num(request,"adapter",-1)==host.adapter,"Both shared roles must name the host adapter");
    set_affinity(request);
}
inline void decorate(J::Object& frame) {
    auto at=frame.find("report");
    if(at==frame.end()||!at->second.isObject())return;
    auto report=at->second.asObject();
    report["shared_cuda"]=J(J::Object{{"pid",ji(GetCurrentProcessId())},{"role",J(role)},
        {"primary_context_id",J(std::to_string(host.primary_context_id))},
        {"owner_context_id",J(std::to_string(owner_context.load()))},
        {"owner_thread_id",ji(owner_thread.load())},
        {"affinity_mask_decimal",J(std::to_string(affinity.load()))}});
    at->second=J(std::move(report));
}
inline void emit(J::Object row) {
    decorate(row);std::ostringstream frame;frame<<std::setprecision(12);json(frame,J(std::move(row)));
    auto text=frame.str();require(text.size()<=16*1024*1024,"Shared service reply exceeds 16 MiB");
    host.emit(host.user,text.data(),text.size());
}
inline void install(const PsServiceHostV1* supplied,const char* name) {
    require(supplied&&supplied->abi_version==1&&supplied->emit&&supplied->adapter>=0&&supplied->primary_context_id,"Invalid shared-service host ABI");
    require(!host.emit,"Only one instance of each shared service is supported");
    host=*supplied;role=name;ck(cudaSetDevice(host.adapter));context_id();
}
inline void copy_error(char* target,size_t capacity,const char* message) noexcept {
    if(target&&capacity){size_t count=std::min(capacity-1,strlen(message));memcpy(target,message,count);target[count]=0;}
}
}
