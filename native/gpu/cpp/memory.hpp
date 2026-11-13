#pragma once
#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <psapi.h>
#pragma comment(lib, "psapi.lib")
#endif
namespace gpu_memory {
inline size_t peak_rss_bytes(){
#if defined(_WIN32)
 PROCESS_MEMORY_COUNTERS value{};value.cb=sizeof(value);
 return GetProcessMemoryInfo(GetCurrentProcess(),&value,sizeof(value))?size_t(value.PeakWorkingSetSize):0;
#else
 return 0;
#endif
}
}
