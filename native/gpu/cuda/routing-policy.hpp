#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace continuous {
// Compare latency for the same query chunk. Throughput across other queries or
// streams must not make an individual handoff look artificially cheap.
struct LatencyRouting {
    static constexpr double margin=1.25;
    static constexpr double cpu_quantum_ms=2.0;
    static double parent_cost(double recent,double spent_ms,uint64_t parents){
        // A preempted short quantum must not turn a demonstrably fast CPU
        // search into an apparently slow one. Root/control time in spent_ms
        // makes the sustained estimate conservative about CPU cost.
        if(parents&&spent_ms>0&&std::isfinite(spent_ms))return std::min(recent,spent_ms/parents);
        return recent;
    }
    static bool promotion(double cpu_chunk,double gpu_chunk,double remaining,
                          unsigned cpu_samples,unsigned gpu_samples){
        return cpu_samples>=2&&gpu_samples>=4&&std::isfinite(gpu_chunk)&&
            gpu_chunk*margin<cpu_chunk&&gpu_chunk*2<remaining;
    }
    static bool fallback(double residence,double cpu_chunk,double allowance){
        const double reserve=std::min(allowance*.25,std::max(cpu_quantum_ms,cpu_chunk*margin));
        return residence>reserve&&residence>cpu_chunk*margin;
    }
};
}
