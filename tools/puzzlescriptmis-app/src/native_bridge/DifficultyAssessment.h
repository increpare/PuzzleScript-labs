#pragma once

#include <functional>
#include <string>
#include <vector>

#include "macros.h"
#include "native_bridge/NativeGameFacade.h"

namespace nativebridge {

struct DifficultyBreakdown {
    long long expandedPortfolio = -1;
    long long expandedWeightedAStar = -1;
    long long expandedGreedy = -1;
    long long expandedBfs = -1;
    long long difficulty = -1;
    std::string difficultyAlgorithm;
};

struct DifficultyAssessmentOptions {
    long long primaryTimeoutMs = 500;
    bool runSupplemental = false;
    std::function<bool(long long primaryExpanded)> supplementalGate;
    long long supplementalCap = -1;
    long long supplementalTimeoutMs = 60000;
    std::function<bool()> shouldCancel;
    std::string randomSeed;
};

struct DifficultyAssessmentResult {
    CandidateSolveStatus primaryStatus = CandidateSolveStatus::Error;
    long long primaryExpanded = 0;
    long long primaryElapsedMs = 0;
    std::string primaryStrategy;
    std::string primaryError;
    std::vector<short> solution;
    DifficultyBreakdown breakdown;
    bool supplementalRan = false;
    bool interrupted = false;
};

enum class DifficultyAssessmentStage {
    PrimaryComplete,
    GreedyComplete,
    WeightedAStarComplete,
    BfsComplete,
    Complete
};

using DifficultyAssessmentProgressCallback =
    std::function<void(DifficultyAssessmentStage stage, const DifficultyAssessmentResult& partial)>;

DifficultyAssessmentResult assessDifficulty(
    CandidateSolverContext& context,
    const vvvs& state,
    const DifficultyAssessmentOptions& options,
    DifficultyAssessmentProgressCallback onProgress = {});

} // namespace nativebridge
