#pragma once

#include "runtime/core.hpp"

#include "puzzlescript/puzzlescript.h"

#include <cstdint>
#include <chrono>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace puzzlescript::search {

struct DifficultyBreakdown {
    int64_t expandedPortfolio = -1;
    int64_t expandedGreedy = -1;
    int64_t expandedWeightedAStar = -1;
    int64_t expandedBfs = -1;
    int64_t difficulty = -1;
    std::string difficultyAlgorithm;
};

struct DifficultyOptions {
    int64_t timeoutMs = 250;
    bool runSupplemental = false;
    std::function<bool(int64_t primaryExpanded)> supplementalGate;
    int64_t supplementalCap = -1;
    int64_t supplementalTimeoutMs = 60000;
    // Shared across all lanes; individual lane timeouts are additionally capped
    // by this deadline. Cancellation is cooperative between runtime turns.
    std::optional<std::chrono::steady_clock::time_point> deadline;
    std::function<bool()> shouldCancel;
    // Gameplay randomness is part of candidate identity, separately from the
    // generator's sampling seed. Empty preserves the native solver default.
    std::string randomSeed;
};

enum class DifficultyStage {
    PrimaryComplete,
    GreedyComplete,
    WeightedAStarComplete,
    BfsComplete,
    Complete
};

struct DifficultyResult {
    bool solved = false;
    ps_solve_status primaryStatus = PS_SOLVE_STATUS_ERROR;
    std::string primaryError;
    bool supplementalRan = false;
    bool interrupted = false;
    std::vector<ps_input> solution;
    DifficultyBreakdown breakdown;
    int64_t primaryExpanded = 0;
    int64_t primaryElapsedMs = 0;
    std::string primaryStrategy;
};

using DifficultyProgressCallback = std::function<void(DifficultyStage stage, const DifficultyResult& partial)>;

struct DifficultyCacheStats {
    uint64_t hits = 0, searches = 0, waits = 0;
    size_t entries = 0, retainedBytes = 0;
};

// A cache owns one immutable compiled game and its initial session state.
// Share this evaluator between candidate workers; create a new one on recompile.
// Bounds cover retained lane results, not memory used by active solver calls.
class DifficultyEvaluator {
public:
    explicit DifficultyEvaluator(LoadedGame game, size_t maxEntries = 4096,
                                 size_t maxBytes = 32 * 1024 * 1024);
    ~DifficultyEvaluator();
    DifficultyResult assess(const LevelTemplate& level, const DifficultyOptions& options,
                            DifficultyProgressCallback onProgress = {});
    DifficultyCacheStats stats() const;
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

std::vector<int32_t> levelTemplateToLayerCellObjectIds(const Game& game, const LevelTemplate& level);

LevelTemplate levelTemplateFromLayerCellObjectIds(
    const Game& game,
    int32_t width,
    int32_t height,
    const std::vector<int32_t>& layerGrid);

DifficultyResult assessGeneratedLevelDifficulty(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const DifficultyOptions& options,
    DifficultyProgressCallback onProgress = {});

} // namespace puzzlescript::search
