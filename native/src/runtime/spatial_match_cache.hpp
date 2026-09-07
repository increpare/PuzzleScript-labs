#pragma once
#include <cstdint>

namespace puzzlescript {
// Experimental instrumentation, available only in PS_SPATIAL_MATCH_CACHE builds.
// No cache is stored in FullState or copied into search nodes.
struct SpatialMatchStats {
    uint64_t collections = 0;
    uint64_t fullCollections = 0;
    uint64_t cachedCollections = 0;
    uint64_t repairedPositions = 0;
    uint64_t dirtyEvents = 0;
};
SpatialMatchStats spatialMatchStats();
void resetSpatialMatchStats();
void setSpatialMatchCacheEnabled(bool enabled);
}
