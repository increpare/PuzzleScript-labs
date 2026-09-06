#include "search/difficulty.hpp"

#include "runtime/c_api_internal.hpp"

#include <algorithm>
#include <memory>
#include <utility>

namespace puzzlescript::search {
namespace {

constexpr const char* kMisGreedyHeuristic = "mis-cost-estimate";

void updateDifficultyMin(DifficultyBreakdown& breakdown, int64_t expanded, const std::string& algorithm) {
    if (expanded < 0) {
        return;
    }
    if (breakdown.difficulty < 0 || expanded < breakdown.difficulty) {
        breakdown.difficulty = expanded;
        breakdown.difficultyAlgorithm = algorithm;
    }
}

std::vector<ps_input> copySolution(const ps_solve_result* result) {
    if (result == nullptr || result->solution == nullptr || result->solution_count == 0) {
        return {};
    }
    return std::vector<ps_input>(result->solution, result->solution + result->solution_count);
}

std::string copyStrategy(const ps_solve_result* result) {
    return result != nullptr && result->strategy != nullptr ? std::string(result->strategy) : std::string{};
}

struct SolveAttempt {
    bool solved = false;
    ps_solve_status status = PS_SOLVE_STATUS_ERROR;
    std::string error;
    int64_t expanded = -1;
    int64_t elapsedMs = 0;
    std::string strategy;
    std::vector<ps_input> solution;
};

bool assessmentStopped(const DifficultyOptions& options) {
    return (options.shouldCancel && options.shouldCancel())
        || (options.deadline && std::chrono::steady_clock::now() >= *options.deadline);
}

SolveAttempt runStrategy(
    const ps_game* game,
    int32_t width,
    int32_t height,
    const std::vector<int32_t>& layerGrid,
    const DifficultyOptions& options,
    ps_solve_strategy strategy,
    uint64_t maxExpanded,
    const char* solverHeuristic = nullptr) {
    SolveAttempt attempt;
    if (assessmentStopped(options)) {
        attempt.status = PS_SOLVE_STATUS_TIMEOUT;
        return attempt;
    }
    ps_solve_options solveOptions = ps_solve_default_options();
    solveOptions.timeout_ms = std::max<int64_t>(1, options.timeoutMs);
    if (options.deadline) {
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
            *options.deadline - std::chrono::steady_clock::now()).count();
        solveOptions.timeout_ms = std::min(solveOptions.timeout_ms, std::max<int64_t>(1, remaining));
    }
    if (options.deadline || options.shouldCancel) {
        solveOptions.should_cancel = [](void* context) {
            return assessmentStopped(*static_cast<const DifficultyOptions*>(context));
        };
        solveOptions.cancel_context = const_cast<DifficultyOptions*>(&options);
    }
    solveOptions.strategy = strategy;
    solveOptions.portfolio_jobs = 1;
    solveOptions.max_expanded = maxExpanded;
    solveOptions.solver_heuristic = solverHeuristic;

    ps_solve_result* rawResult = nullptr;
    ps_error* rawError = nullptr;
    if (!ps_solve_level_layer_cell_object_ids(
            game,
            width,
            height,
            layerGrid.data(),
            layerGrid.size(),
            &solveOptions,
            &rawResult,
            &rawError)) {
        const char* message = rawError ? ps_error_message(rawError) : nullptr;
        attempt.error = message ? message : "Candidate solver failed without an error message";
        ps_free_error(rawError);
        return attempt;
    }

    std::unique_ptr<ps_solve_result, decltype(&ps_solve_result_free)> result(rawResult, ps_solve_result_free);
    if (!result) {
        attempt.error = "Candidate solver returned no result";
        return attempt;
    }
    attempt.status = result->status;
    attempt.error = result->error ? result->error : "";
    attempt.expanded = static_cast<int64_t>(result->expanded);
    attempt.elapsedMs = result->elapsed_ms;
    attempt.strategy = copyStrategy(result.get());
    if (result->status == PS_SOLVE_STATUS_SOLVED) {
        attempt.solved = true;
        attempt.solution = copySolution(result.get());
    }
    return attempt;
}

} // namespace

std::vector<int32_t> levelTemplateToLayerCellObjectIds(const Game& game, const LevelTemplate& level) {
    const int32_t width = level.width;
    const int32_t height = level.height;
    const int32_t layerCount = game.layerCount;
    if (width <= 0 || height <= 0 || layerCount <= 0) {
        return {};
    }

    const size_t required = static_cast<size_t>(layerCount) * static_cast<size_t>(width) * static_cast<size_t>(height);
    std::vector<int32_t> layerGrid(required, -1);
    const int32_t tileCount = width * height;
    const size_t expectedWords = static_cast<size_t>(tileCount * game.strideObject);
    if (level.objects.size() != expectedWords) {
        return {};
    }

    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {
        const int32_t x = tileIndex / height;
        const int32_t y = tileIndex % height;
        const size_t tileBase = static_cast<size_t>(tileIndex * game.strideObject);
        for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
            const auto& object = game.objectsById[static_cast<size_t>(objectId)];
            if (object.layer < 0 || object.layer >= layerCount) {
                continue;
            }
            const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
            if (word >= game.wordCount) {
                continue;
            }
            if ((level.objects[tileBase + word] & maskBit(static_cast<uint32_t>(objectId))) == 0) {
                continue;
            }
            const size_t outOffset = static_cast<size_t>(object.layer * width * height + y * width + x);
            layerGrid[outOffset] = objectId;
        }
    }
    return layerGrid;
}

LevelTemplate levelTemplateFromLayerCellObjectIds(
    const Game& game,
    int32_t width,
    int32_t height,
    const std::vector<int32_t>& layerGrid) {
    LevelTemplate level;
    if (width <= 0 || height <= 0 || game.layerCount <= 0) {
        return level;
    }

    const size_t required = static_cast<size_t>(game.layerCount) * static_cast<size_t>(width) * static_cast<size_t>(height);
    if (layerGrid.size() != required) {
        return level;
    }

    const int32_t tileCount = width * height;
    level.width = width;
    level.height = height;
    level.objects.assign(static_cast<size_t>(tileCount * game.strideObject), 0);

    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        for (int32_t y = 0; y < height; ++y) {
            for (int32_t x = 0; x < width; ++x) {
                const size_t inputOffset = static_cast<size_t>(layer * width * height + y * width + x);
                const int32_t objectId = layerGrid[inputOffset];
                if (objectId < 0) {
                    continue;
                }
                if (objectId >= game.objectCount) {
                    continue;
                }
                const int32_t tileIndex = x * height + y;
                const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
                const size_t objectOffset = static_cast<size_t>(tileIndex * game.strideObject + static_cast<int32_t>(word));
                if (objectOffset < level.objects.size()) {
                    level.objects[objectOffset] |= maskBit(static_cast<uint32_t>(objectId));
                }
            }
        }
    }
    return level;
}

DifficultyResult assessGeneratedLevelDifficulty(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const DifficultyOptions& options,
    DifficultyProgressCallback onProgress) {
    DifficultyResult result;
    if (!loadedGame.information) {
        result.primaryError = "Cannot assess a level without a compiled game";
        if (onProgress) {
            onProgress(DifficultyStage::Complete, result);
        }
        return result;
    }

    const std::vector<int32_t> layerGrid = levelTemplateToLayerCellObjectIds(*loadedGame.information, level);
    if (layerGrid.empty()) {
        result.primaryError = "Candidate level dimensions or object storage are invalid";
        if (onProgress) {
            onProgress(DifficultyStage::Complete, result);
        }
        return result;
    }

    ps_game gameWrapper;
    gameWrapper.impl = loadedGame;
    const ps_game* game = &gameWrapper;

    const SolveAttempt primary = runStrategy(
        game,
        level.width,
        level.height,
        layerGrid,
        options,
        PS_SOLVE_STRATEGY_PORTFOLIO,
        0);
    result.primaryExpanded = std::max<int64_t>(0, primary.expanded);
    result.primaryElapsedMs = std::max<int64_t>(0, primary.elapsedMs);
    result.primaryStrategy = primary.strategy;
    // Preserve unknown (timeout) separately from exhausted and engine errors:
    // generation uses this distinction to retry with a larger solve budget.
    result.primaryStatus = primary.status;
    result.primaryError = primary.error;
    result.interrupted = assessmentStopped(options);

    if (!primary.solved) {
        if (onProgress) {
            onProgress(DifficultyStage::Complete, result);
        }
        return result;
    }

    result.solved = true;
    result.solution = primary.solution;
    result.breakdown.expandedPortfolio = result.primaryExpanded;
    updateDifficultyMin(result.breakdown, result.primaryExpanded, "Portfolio");

    if (onProgress) {
        onProgress(DifficultyStage::PrimaryComplete, result);
    }

    auto finishIfStopped = [&]() {
        if (!assessmentStopped(options)) return false;
        result.interrupted = true;
        if (onProgress) onProgress(DifficultyStage::Complete, result);
        return true;
    };
    if (finishIfStopped()) return result;

    const bool runSupplemental = options.supplementalGate
        ? options.supplementalGate(result.primaryExpanded)
        : options.runSupplemental;
    if (!runSupplemental) {
        if (onProgress) {
            onProgress(DifficultyStage::Complete, result);
        }
        return result;
    }
    if (finishIfStopped()) return result;

    DifficultyOptions supplementalOptions = options;
    if (supplementalOptions.supplementalCap < 0) {
        supplementalOptions.supplementalCap = result.primaryExpanded + 6;
    }
    supplementalOptions.supplementalCap = std::max<int64_t>(1, supplementalOptions.supplementalCap);
    supplementalOptions.timeoutMs = std::max<int64_t>(1, supplementalOptions.supplementalTimeoutMs);

    result.supplementalRan = true;
    // Keep the validated primary score while lanes run. If interrupted, the
    // caller can show a partial result but must not rank it as fully assessed.

    const uint64_t cap = static_cast<uint64_t>(supplementalOptions.supplementalCap);
    const SolveAttempt greedy = runStrategy(
        game,
        level.width,
        level.height,
        layerGrid,
        supplementalOptions,
        PS_SOLVE_STRATEGY_GREEDY,
        cap,
        kMisGreedyHeuristic);
    if (greedy.solved) {
        result.breakdown.expandedGreedy = greedy.expanded;
        updateDifficultyMin(result.breakdown, greedy.expanded, "Greedy");
    }
    if (onProgress) {
        onProgress(DifficultyStage::GreedyComplete, result);
    }
    if (finishIfStopped()) return result;

    const SolveAttempt weighted = runStrategy(
        game,
        level.width,
        level.height,
        layerGrid,
        supplementalOptions,
        PS_SOLVE_STRATEGY_WEIGHTED_ASTAR,
        cap);
    if (weighted.solved) {
        result.breakdown.expandedWeightedAStar = weighted.expanded;
        updateDifficultyMin(result.breakdown, weighted.expanded, "WeightedAStar");
    }
    if (onProgress) {
        onProgress(DifficultyStage::WeightedAStarComplete, result);
    }
    if (finishIfStopped()) return result;

    const SolveAttempt bfs = runStrategy(
        game,
        level.width,
        level.height,
        layerGrid,
        supplementalOptions,
        PS_SOLVE_STRATEGY_BFS,
        cap);
    if (bfs.solved) {
        result.breakdown.expandedBfs = bfs.expanded;
        updateDifficultyMin(result.breakdown, bfs.expanded, "BFS");
    }
    if (onProgress) {
        onProgress(DifficultyStage::BfsComplete, result);
    }
    if (finishIfStopped()) return result;

    updateDifficultyMin(result.breakdown, result.breakdown.expandedPortfolio, "Portfolio");

    if (onProgress) {
        onProgress(DifficultyStage::Complete, result);
    }
    return result;
}

} // namespace puzzlescript::search
