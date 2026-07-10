#pragma once

#include <cstdint>

namespace puzzlescript {

struct LocalitySurveySnapshot {
    uint64_t maskArenaAccesses = 0;
    uint64_t maskArenaUniqueCacheLines = 0;
};

void setLocalitySurveyEnabled(bool enabled);
bool localitySurveyEnabled();
void resetLocalitySurvey();
void recordMaskArenaAccess(const void* ptr);
LocalitySurveySnapshot snapshotLocalitySurvey();

} // namespace puzzlescript
