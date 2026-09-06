#include "native_bridge/DifficultyAssessment.h"

#include "macros.h"
#include "native_bridge/CandidateSolverContext.h"
#include "search/difficulty.hpp"

namespace nativebridge {
namespace {

CandidateSolveStatus toCandidateStatus(ps_solve_status status) {
    switch (status) {
        case PS_SOLVE_STATUS_SOLVED: return CandidateSolveStatus::Solved;
        case PS_SOLVE_STATUS_EXHAUSTED: return CandidateSolveStatus::Unsolvable;
        case PS_SOLVE_STATUS_TIMEOUT: return CandidateSolveStatus::Timeout;
        case PS_SOLVE_STATUS_ERROR: return CandidateSolveStatus::Error;
    }
    return CandidateSolveStatus::Error;
}

DifficultyBreakdown toBridgeBreakdown(const puzzlescript::search::DifficultyBreakdown& breakdown) {
    DifficultyBreakdown mapped;
    mapped.expandedPortfolio = breakdown.expandedPortfolio;
    mapped.expandedWeightedAStar = breakdown.expandedWeightedAStar;
    mapped.expandedGreedy = breakdown.expandedGreedy;
    mapped.expandedBfs = breakdown.expandedBfs;
    mapped.difficulty = breakdown.difficulty;
    mapped.difficultyAlgorithm = breakdown.difficultyAlgorithm;
    return mapped;
}

DifficultyAssessmentStage toBridgeStage(puzzlescript::search::DifficultyStage stage) {
    switch (stage) {
        case puzzlescript::search::DifficultyStage::PrimaryComplete:
            return DifficultyAssessmentStage::PrimaryComplete;
        case puzzlescript::search::DifficultyStage::GreedyComplete:
            return DifficultyAssessmentStage::GreedyComplete;
        case puzzlescript::search::DifficultyStage::WeightedAStarComplete:
            return DifficultyAssessmentStage::WeightedAStarComplete;
        case puzzlescript::search::DifficultyStage::BfsComplete:
            return DifficultyAssessmentStage::BfsComplete;
        case puzzlescript::search::DifficultyStage::Complete:
            return DifficultyAssessmentStage::Complete;
    }
    return DifficultyAssessmentStage::Complete;
}

std::vector<short> toEditorSolution(const std::vector<ps_input>& solution) {
    std::vector<short> mapped;
    mapped.reserve(solution.size());
    for (const ps_input input : solution) {
        switch (input) {
            case PS_INPUT_UP:
                mapped.push_back(UP_MOVE);
                break;
            case PS_INPUT_DOWN:
                mapped.push_back(DOWN_MOVE);
                break;
            case PS_INPUT_LEFT:
                mapped.push_back(LEFT_MOVE);
                break;
            case PS_INPUT_RIGHT:
                mapped.push_back(RIGHT_MOVE);
                break;
            case PS_INPUT_ACTION:
                mapped.push_back(ACTION_MOVE);
                break;
            default:
                break;
        }
    }
    return mapped;
}

DifficultyAssessmentResult toBridgeResult(const puzzlescript::search::DifficultyResult& assessed) {
    DifficultyAssessmentResult result;
    result.primaryStatus = toCandidateStatus(assessed.primaryStatus);
    result.primaryError = assessed.primaryError;
    result.primaryExpanded = assessed.primaryExpanded;
    result.primaryElapsedMs = assessed.primaryElapsedMs;
    result.primaryStrategy = assessed.primaryStrategy;
    result.solution = toEditorSolution(assessed.solution);
    result.breakdown = toBridgeBreakdown(assessed.breakdown);
    result.supplementalRan = assessed.supplementalRan;
    result.interrupted = assessed.interrupted;
    return result;
}

} // namespace

DifficultyAssessmentResult assessDifficulty(
    CandidateSolverContext& context,
    const vvvs& state,
    const DifficultyAssessmentOptions& options,
    DifficultyAssessmentProgressCallback onProgress) {
    const puzzlescript::LevelTemplate level = context.levelTemplateFromState(state);

    puzzlescript::search::DifficultyOptions sharedOptions;
    sharedOptions.timeoutMs = options.primaryTimeoutMs;
    sharedOptions.runSupplemental = options.runSupplemental;
    if (options.supplementalGate) {
        sharedOptions.supplementalGate = [&](int64_t primaryExpanded) {
            return options.supplementalGate(primaryExpanded);
        };
    }
    sharedOptions.supplementalCap = options.supplementalCap;
    sharedOptions.supplementalTimeoutMs = options.supplementalTimeoutMs;
    sharedOptions.shouldCancel = options.shouldCancel;
    sharedOptions.randomSeed = options.randomSeed;

    DifficultyAssessmentResult result;
    const auto assessed = context.bridge().difficultyEvaluator().assess(
        level,
        sharedOptions,
        onProgress
            ? [&](puzzlescript::search::DifficultyStage stage, const puzzlescript::search::DifficultyResult& partial) {
                  result = toBridgeResult(partial);
                  onProgress(toBridgeStage(stage), result);
              }
            : puzzlescript::search::DifficultyProgressCallback{});
    result = toBridgeResult(assessed);
    return result;
}

} // namespace nativebridge
