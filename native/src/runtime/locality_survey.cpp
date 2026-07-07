#include "runtime/locality_survey.hpp"

#include <atomic>
#include <cstdint>
#include <mutex>
#include <unordered_set>

namespace puzzlescript {
namespace {

std::atomic<bool> gLocalitySurveyEnabled{false};
std::atomic<uint64_t> gMaskArenaAccesses{0};
std::mutex gUniqueCacheLineMutex;
std::unordered_set<uintptr_t> gUniqueCacheLines;

uintptr_t cacheLineKey(const void* ptr) {
    return reinterpret_cast<uintptr_t>(ptr) >> 6;
}

} // namespace

void setLocalitySurveyEnabled(bool enabled) {
    gLocalitySurveyEnabled.store(enabled, std::memory_order_relaxed);
}

bool localitySurveyEnabled() {
    return gLocalitySurveyEnabled.load(std::memory_order_relaxed);
}

void resetLocalitySurvey() {
    gMaskArenaAccesses.store(0, std::memory_order_relaxed);
    std::lock_guard<std::mutex> lock(gUniqueCacheLineMutex);
    gUniqueCacheLines.clear();
}

void recordMaskArenaAccess(const void* ptr) {
    if (ptr == nullptr || !localitySurveyEnabled()) {
        return;
    }
    gMaskArenaAccesses.fetch_add(1, std::memory_order_relaxed);
    const uintptr_t line = cacheLineKey(ptr);
    std::lock_guard<std::mutex> lock(gUniqueCacheLineMutex);
    gUniqueCacheLines.insert(line);
}

LocalitySurveySnapshot snapshotLocalitySurvey() {
    LocalitySurveySnapshot snapshot{};
    snapshot.maskArenaAccesses = gMaskArenaAccesses.load(std::memory_order_relaxed);
    std::lock_guard<std::mutex> lock(gUniqueCacheLineMutex);
    snapshot.maskArenaUniqueCacheLines = gUniqueCacheLines.size();
    return snapshot;
}

} // namespace puzzlescript
