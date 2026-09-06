#pragma once

#include "runtime/core.hpp"
#include <atomic>
#include <deque>
#include <mutex>
#include <unordered_map>

namespace puzzlescript {

// Ordered indices, not a work queue: existing rule order, fixed-point passes,
// input masks and wake/sleep checks still determine execution.
struct FutureRuleSelection {
    MaskVector possibleObjects;
    std::vector<std::vector<uint32_t>> early;
    std::vector<std::vector<uint32_t>> late;
    size_t excludedRules = 0;
};

class FutureRuleCache {
public:
    explicit FutureRuleCache(const Game& game, size_t capacity = 256);
    std::shared_ptr<const FutureRuleSelection> lookup(const MaskVector& presence);
    bool supported() const { return supported_; }
    uint64_t queries() const { return queries_.load(); }
    uint64_t misses() const { return misses_.load(); }
private:
    struct RulePlan {
        MaskVector required;
        std::vector<MaskVector> alternatives;
        MaskVector writes;
        bool possible(const MaskVector& universe) const;
    };
    struct MaskHash { size_t operator()(const MaskVector& words) const; };
    std::vector<std::vector<RulePlan>> early_, late_;
    std::vector<bool> randomEarly_, randomLate_;
    uint32_t words_ = 0;
    size_t capacity_;
    bool supported_ = true;
    std::mutex mutex_;
    std::unordered_map<MaskVector, std::shared_ptr<const FutureRuleSelection>, MaskHash> cache_;
    std::deque<MaskVector> insertionOrder_;
    std::atomic<uint64_t> queries_{0}, misses_{0};
};

// Build only at compilation/loading when explicitly enabled. Cloned worker
// sessions share this ruleset-owned, bounded, synchronized cache.
void configureFutureRulePruning(Game& game);

} // namespace puzzlescript
