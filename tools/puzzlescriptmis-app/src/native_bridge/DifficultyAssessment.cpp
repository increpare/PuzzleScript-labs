#include "native_bridge/DifficultyAssessment.h"

#include "puzzlescript/puzzlescript.h"

namespace nativebridge {
namespace {

constexpr const char* kMisGreedyHeuristic = "mis-cost-estimate";

void updateDifficultyMin(DifficultyBreakdown& breakdown, long long expanded, const std::string& algorithm) {
    if (expanded < 0) {
        return;
    }
    if (breakdown.difficulty < 0 || expanded < breakdown.difficulty) {
        breakdown.difficulty = expanded;
        breakdown.difficultyAlgorithm = algorithm;
    }
}

CandidateSolveResult solveWithStrategy(
    CandidateSolverContext& context,
    const vvvs& state,
    long long timeoutMs,
    ps_solve_strategy strategy,
    uint64_t maxExpanded,
    const char* solverHeuristic = nullptr) {
    return solveGeneratedState(context, state, timeoutMs, strategy, maxExpanded, solverHeuristic);
}

void runSupplementalLane(
    CandidateSolverContext& context,
    const vvvs& state,
    const DifficultyAssessmentOptions& options,
    ps_solve_strategy strategy,
    long long& laneExpanded,
    DifficultyBreakdown& breakdown,
    const std::string& algorithmLabel,
    const char* solverHeuristic = nullptr) {
    const uint64_t cap = static_cast<uint64_t>(MAX(0LL, options.supplementalCap));
    const CandidateSolveResult lane = solveWithStrategy(
        context,
        state,
        options.supplementalTimeoutMs,
        strategy,
        cap,
        solverHeuristic);
    if (lane.status == CandidateSolveStatus::Solved && lane.expanded >= 0) {
        laneExpanded = lane.expanded;
        updateDifficultyMin(breakdown, laneExpanded, algorithmLabel);
    }
}

bool shouldRunSupplemental(
    const DifficultyAssessmentOptions& options,
    long long primaryExpanded) {
    if (options.supplementalGate) {
        return options.supplementalGate(primaryExpanded);
    }
    return options.runSupplemental;
}

} // namespace

DifficultyAssessmentResult assessDifficulty(
    CandidateSolverContext& context,
    const vvvs& state,
    const DifficultyAssessmentOptions& options,
    DifficultyAssessmentProgressCallback onProgress) {
    DifficultyAssessmentResult result;

    const CandidateSolveResult primary = solveWithStrategy(
        context,
        state,
        options.primaryTimeoutMs,
        PS_SOLVE_STRATEGY_PORTFOLIO,
        0);
    result.primaryStatus = primary.status;
    result.primaryExpanded = MAX(0LL, primary.expanded);
    result.primaryElapsedMs = MAX(0LL, primary.elapsedMs);
    result.primaryStrategy = primary.strategy;
    result.primaryError = primary.error;
    result.solution = primary.solution;

    if (primary.status != CandidateSolveStatus::Solved) {
        if (onProgress) {
            onProgress(DifficultyAssessmentStage::Complete, result);
        }
        return result;
    }

    result.breakdown.expandedPortfolio = result.primaryExpanded;
    updateDifficultyMin(result.breakdown, result.primaryExpanded, "Portfolio");

    if (onProgress) {
        onProgress(DifficultyAssessmentStage::PrimaryComplete, result);
    }

    const bool runSupplemental = shouldRunSupplemental(options, result.primaryExpanded);
    if (!runSupplemental) {
        if (onProgress) {
            onProgress(DifficultyAssessmentStage::Complete, result);
        }
        return result;
    }

    DifficultyAssessmentOptions supplementalOptions = options;
    if (supplementalOptions.supplementalCap < 0) {
        supplementalOptions.supplementalCap = result.primaryExpanded + 6;
    }
    supplementalOptions.supplementalCap = MAX(1LL, supplementalOptions.supplementalCap);

    result.supplementalRan = true;
    result.breakdown.difficulty = -1;
    result.breakdown.difficultyAlgorithm.clear();

    runSupplementalLane(
        context,
        state,
        supplementalOptions,
        PS_SOLVE_STRATEGY_GREEDY,
        result.breakdown.expandedGreedy,
        result.breakdown,
        "Greedy",
        kMisGreedyHeuristic);
    if (onProgress) {
        onProgress(DifficultyAssessmentStage::GreedyComplete, result);
    }

    runSupplementalLane(
        context,
        state,
        supplementalOptions,
        PS_SOLVE_STRATEGY_WEIGHTED_ASTAR,
        result.breakdown.expandedWeightedAStar,
        result.breakdown,
        "WeightedAStar");
    if (onProgress) {
        onProgress(DifficultyAssessmentStage::WeightedAStarComplete, result);
    }

    runSupplementalLane(
        context,
        state,
        supplementalOptions,
        PS_SOLVE_STRATEGY_BFS,
        result.breakdown.expandedBfs,
        result.breakdown,
        "BFS");
    if (onProgress) {
        onProgress(DifficultyAssessmentStage::BfsComplete, result);
    }

    updateDifficultyMin(result.breakdown, result.breakdown.expandedPortfolio, "Portfolio");

    if (onProgress) {
        onProgress(DifficultyAssessmentStage::Complete, result);
    }
    return result;
}

} // namespace nativebridge
