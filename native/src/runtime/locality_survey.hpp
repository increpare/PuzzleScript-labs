#pragma once

#include <atomic>
#include <cstdint>

namespace puzzlescript {

struct LocalitySurveySnapshot {
    uint64_t maskArenaAccesses = 0;
    uint64_t maskArenaUniqueCacheLines = 0;
};

void setLocalitySurveyEnabled(bool enabled);
bool localitySurveyEnabled();
void resetLocalitySurvey();
// Called on every mask-arena access in the runtime's hot paths, so the
// disabled case is an inline flag check rather than a call.
extern std::atomic<bool> gLocalitySurveyEnabled;
void recordMaskArenaAccessSlow(const void* ptr);
inline void recordMaskArenaAccess(const void* ptr) {
    if (ptr != nullptr && gLocalitySurveyEnabled.load(std::memory_order_relaxed)) recordMaskArenaAccessSlow(ptr);
}
LocalitySurveySnapshot snapshotLocalitySurvey();

} // namespace puzzlescript
