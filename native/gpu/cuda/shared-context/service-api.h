#pragma once
#include <stddef.h>
#include <stdint.h>

// Only opaque handles and bounded byte strings cross DLL boundaries. Exact BFS
// and production search have deliberately different resident::Query layouts.
struct PsServiceHostV1 {
    uint32_t abi_version;
    int32_t adapter;
    uint64_t primary_context_id;
    void* user;
    void (__cdecl *emit)(void* user, const char* data, size_t size);
};
struct PsServiceApiV1 {
    uint32_t abi_version;
    void* (__cdecl *create)(const PsServiceHostV1*, char* error, size_t error_capacity);
    // 0: continue; 1: shutdown acknowledged; -1: fatal ABI/transport failure.
    int (__cdecl *request)(void*, const char* data, size_t size);
    void (__cdecl *destroy)(void*);
};
typedef const PsServiceApiV1* (__cdecl *PsGetServiceApiV1)();
