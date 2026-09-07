#pragma once
#include <chrono>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

namespace puzzlescript::solver {
// Only the diagnostic executable defines PS_PORTFOLIO_DIAGNOSTICS. Production
// builds contain neither these probes nor the experimental lock override.
struct PortfolioLaneDiagnosis {
    std::string name;
    uint64_t expanded = 0, generated = 0, unique = 0, noops = 0, duplicates = 0;
    uint64_t lower = 0, equal = 0, higher = 0, improvements = 0;
    int64_t stepNs = 0;
};
struct PortfolioEvent {
    std::string reason;
    size_t from = 0, to = 0;
    uint64_t expanded = 0, generated = 0;
    double elapsedMs = 0, stepUsPerGenerated = 0;
    int32_t bestHeuristic = 0;
};
struct PortfolioDiagnosis {
    bool disableLock = false, collect = true;
    uint64_t maxExpanded = 0;
    std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
    std::vector<PortfolioLaneDiagnosis> lanes;
    std::vector<PortfolioEvent> events;
    uint64_t droppedEvents = 0, lockExpanded = 0, lastImprovementExpanded = 0;
    uint64_t expansionDigest = 1469598103934665603ULL;
    int32_t initialHeuristic = 0, bestHeuristic = 0;
    void event(const char* reason, size_t from, size_t to, uint64_t expanded, uint64_t generated, int64_t stepNs) {
        if (!collect) return;
        if (events.size() == 1024) { ++droppedEvents; return; }
        events.push_back({reason, from, to, expanded, generated,
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count(),
            generated ? double(stepNs) / 1000.0 / generated : 0.0, bestHeuristic});
    }
    void expanded(size_t lane, uint64_t lo, uint64_t hi) {
        if (!collect) return;
        ++lanes[lane].expanded;
        expansionDigest = (expansionDigest ^ lo) * 1099511628211ULL;
        expansionDigest = (expansionDigest ^ hi) * 1099511628211ULL;
    }
    void child(size_t lane, int32_t parent, int32_t child, uint64_t expandedCount) {
        if (!collect) return;
        auto& stats = lanes[lane];
        ++stats.unique;
        if (child < parent) ++stats.lower;
        else if (child == parent) ++stats.equal;
        else ++stats.higher;
        if (child < bestHeuristic) {
            bestHeuristic = child;
            lastImprovementExpanded = expandedCount;
            ++stats.improvements;
        }
    }
};
inline thread_local PortfolioDiagnosis* activePortfolioDiagnosis = nullptr;
}
