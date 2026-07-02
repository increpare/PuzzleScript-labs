#include "search/simplify.hpp"

#include "runtime/c_api_internal.hpp"
#include "search/difficulty.hpp"
#include "search/search_common.hpp"

#include <algorithm>
#include <cmath>
#include <memory>
#include <unordered_set>
#include <utility>
#include <vector>

namespace puzzlescript::search {
namespace {

constexpr RuntimeStepOptions kSimplifyStepOptions{
    .playableUndo = false,
    .emitAudio = false,
    .solverMode = true,
    .againPolicy = AgainPolicy::Drain,
};

struct BfsSolveAttempt {
    bool solved = false;
    int32_t length = -1;
    int64_t expanded = -1;
};

struct CellKey {
    int32_t layer = 0;
    int32_t x = 0;
    int32_t y = 0;

    bool operator==(const CellKey& other) const {
        return layer == other.layer && x == other.x && y == other.y;
    }
};

struct CellKeyHash {
    size_t operator()(const CellKey& key) const {
        return static_cast<size_t>(key.layer * 73856093 ^ key.x * 19349663 ^ key.y * 83492791);
    }
};

struct DeletionCandidate {
    int32_t layer = 0;
    int32_t x = 0;
    int32_t y = 0;
    int32_t objectId = -1;
    int32_t sortTier = 3;
};

struct SolutionTrace {
    std::unordered_set<CellKey, CellKeyHash> envelope;
    std::unordered_set<int32_t> changedLayers;
};

struct ClassifiedCandidates {
    std::vector<DeletionCandidate> outsideEnvelope;
    std::vector<DeletionCandidate> insideEnvelope;
};

size_t layerCellOffset(int32_t layer, int32_t x, int32_t y, int32_t width, int32_t height) {
    return static_cast<size_t>(layer * width * height + y * width + x);
}

void decodeLayerGridIndex(
    size_t index,
    int32_t width,
    int32_t height,
    int32_t& layer,
    int32_t& x,
    int32_t& y) {
    const size_t plane = static_cast<size_t>(width * height);
    layer = static_cast<int32_t>(index / plane);
    const size_t within = index % plane;
    y = static_cast<int32_t>(within / static_cast<size_t>(width));
    x = static_cast<int32_t>(within % static_cast<size_t>(width));
}

constexpr uint64_t kMinTrialExpanded = 64;

std::vector<int32_t> playerObjectIds(const Game& game) {
    std::vector<int32_t> ids;
    if (game.playerMask == kNullMaskOffset) {
        return ids;
    }
    const MaskWord* playerMaskWords = maskPtr(game, game.playerMask);
    if (playerMaskWords == nullptr) {
        return ids;
    }
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
        if (word >= game.wordCount) {
            continue;
        }
        if ((playerMaskWords[word] & maskBit(static_cast<uint32_t>(objectId))) != 0) {
            ids.push_back(objectId);
        }
    }
    return ids;
}

bool isPlayerObjectId(const std::vector<int32_t>& playerIds, int32_t objectId) {
    return std::find(playerIds.begin(), playerIds.end(), objectId) != playerIds.end();
}

bool levelStillHasPlayer(
    const Game& game,
    const std::vector<int32_t>& layerGrid,
    int32_t width,
    int32_t height) {
    const std::vector<int32_t> players = playerObjectIds(game);
    if (players.empty()) {
        return false;
    }
    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        for (int32_t y = 0; y < height; ++y) {
            for (int32_t x = 0; x < width; ++x) {
                const size_t offset = layerCellOffset(layer, x, y, width, height);
                const int32_t objectId = layerGrid[offset];
                if (objectId < 0) {
                    continue;
                }
                if (std::find(players.begin(), players.end(), objectId) != players.end()) {
                    return true;
                }
            }
        }
    }
    return false;
}

std::vector<CellKey> playerCellsInGrid(
    const Game& game,
    const std::vector<int32_t>& players,
    const std::vector<int32_t>& layerGrid,
    int32_t width,
    int32_t height) {
    std::vector<CellKey> cells;
    for (int32_t layer = 0; layer < game.layerCount; ++layer) {
        for (int32_t y = 0; y < height; ++y) {
            for (int32_t x = 0; x < width; ++x) {
                const size_t offset = layerCellOffset(layer, x, y, width, height);
                const int32_t objectId = layerGrid[offset];
                if (isPlayerObjectId(players, objectId)) {
                    cells.push_back(CellKey{layer, x, y});
                }
            }
        }
    }
    return cells;
}

void addPlayerEnvelopeCells(
    const std::vector<CellKey>& playerCells,
    std::unordered_set<CellKey, CellKeyHash>& envelope) {
    for (const CellKey& cell : playerCells) {
        envelope.insert(cell);
    }
}

std::vector<int32_t> layerGridFromBoard(
    const Game& game,
    int32_t width,
    int32_t height,
    const MaskVector& objects) {
    const int32_t layerCount = game.layerCount;
    const int32_t tileCount = width * height;
    const size_t required = static_cast<size_t>(layerCount) * static_cast<size_t>(width) * static_cast<size_t>(height);
    std::vector<int32_t> layerGrid(required, -1);
    if (objects.size() != static_cast<size_t>(tileCount * game.strideObject)) {
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
            if ((objects[tileBase + word] & maskBit(static_cast<uint32_t>(objectId))) == 0) {
                continue;
            }
            const size_t outOffset = layerCellOffset(object.layer, x, y, width, height);
            layerGrid[outOffset] = objectId;
        }
    }
    return layerGrid;
}

BfsSolveAttempt bfsSolve(
    const ps_game* game,
    int32_t width,
    int32_t height,
    const std::vector<int32_t>& layerGrid,
    int64_t timeoutMs,
    uint64_t maxExpanded) {
    BfsSolveAttempt attempt;
    ps_solve_options solveOptions = ps_solve_default_options();
    solveOptions.timeout_ms = std::max<int64_t>(1, timeoutMs);
    solveOptions.strategy = PS_SOLVE_STRATEGY_BFS;
    solveOptions.portfolio_jobs = 1;
    solveOptions.max_expanded = maxExpanded;

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
        ps_free_error(rawError);
        return attempt;
    }

    std::unique_ptr<ps_solve_result, decltype(&ps_solve_result_free)> result(rawResult, ps_solve_result_free);
    attempt.expanded = static_cast<int64_t>(result->expanded);
    if (result->status == PS_SOLVE_STATUS_SOLVED) {
        attempt.solved = true;
        attempt.length = static_cast<int32_t>(result->solution_count);
    }
    return attempt;
}

bool rulesUseRandomness(const std::vector<std::vector<Rule>>& groups) {
    for (const auto& group : groups) {
        for (const auto& rule : group) {
            if (rule.isRandom) {
                return true;
            }
            for (const auto& row : rule.patterns) {
                for (const auto& pattern : row) {
                    if (!pattern.replacement) {
                        continue;
                    }
                    if (pattern.replacement->hasRandomEntityMask || pattern.replacement->hasRandomDirMask) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

bool gameUsesRandom(const Game& game) {
    return rulesUseRandomness(game.rules) || rulesUseRandomness(game.lateRules);
}

SolutionTrace buildSolutionTrace(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& inputs) {
    SolutionTrace trace;
    if (!loadedGame.information || inputs.empty()) {
        return trace;
    }
    const Game& game = *loadedGame.information;
    auto session = createFullStateWithLoadedLevelSeed(loadedGame, "simplify-trace");
    session->meta.suppressRuleMessages = true;
    if (auto error = loadLevelTemplate(*session, level, 0, kSimplifyStepOptions)) {
        return trace;
    }

    const int32_t width = level.width;
    const int32_t height = level.height;
    std::vector<int32_t> before = layerGridFromBoard(game, width, height, session->levelState.board.objects);
    if (before.empty()) {
        return trace;
    }

    const std::vector<int32_t> players = playerObjectIds(game);
    addPlayerEnvelopeCells(
        playerCellsInGrid(game, players, before, width, height),
        trace.envelope);

    for (const ps_input input : inputs) {
        (void)turn(*session, input, kSimplifyStepOptions);
        const std::vector<int32_t> after =
            layerGridFromBoard(game, width, height, session->levelState.board.objects);
        if (after.empty()) {
            break;
        }
        addPlayerEnvelopeCells(
            playerCellsInGrid(game, players, after, width, height),
            trace.envelope);
        if (after.size() != before.size()) {
            before = after;
            continue;
        }
        for (size_t index = 0; index < before.size(); ++index) {
            if (before[index] == after[index]) {
                continue;
            }
            int32_t layer = 0;
            int32_t x = 0;
            int32_t y = 0;
            decodeLayerGridIndex(index, width, height, layer, x, y);
            trace.envelope.insert(CellKey{layer, x, y});
            trace.changedLayers.insert(layer);
        }
        before = after;
    }
    return trace;
}

int32_t backgroundNeighborCount(
    const std::vector<int32_t>& layerGrid,
    int32_t width,
    int32_t height,
    const DeletionCandidate& candidate) {
    static constexpr int32_t kDx[] = {0, 0, -1, 1};
    static constexpr int32_t kDy[] = {-1, 1, 0, 0};
    int32_t count = 0;
    for (size_t dir = 0; dir < 4; ++dir) {
        const int32_t nx = candidate.x + kDx[dir];
        const int32_t ny = candidate.y + kDy[dir];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            ++count;
            continue;
        }
        const size_t offset = layerCellOffset(candidate.layer, nx, ny, width, height);
        if (layerGrid[offset] < 0) {
            ++count;
        }
    }
    return count;
}

ClassifiedCandidates classifyCandidates(
    const Game& game,
    int32_t width,
    int32_t height,
    const std::vector<int32_t>& layerGrid,
    const std::vector<int32_t>& playerIds,
    const SolutionTrace& trace,
    bool useTraceBatch) {
    ClassifiedCandidates classified;
    const int32_t layerCount = game.layerCount;
    const bool hasEnvelope = useTraceBatch && !trace.envelope.empty();

    for (int32_t layer = 0; layer < layerCount; ++layer) {
        for (int32_t y = 0; y < height; ++y) {
            for (int32_t x = 0; x < width; ++x) {
                const size_t offset = layerCellOffset(layer, x, y, width, height);
                const int32_t objectId = layerGrid[offset];
                if (objectId < 0 || isPlayerObjectId(playerIds, objectId)) {
                    continue;
                }
                const CellKey key{layer, x, y};
                DeletionCandidate candidate{layer, x, y, objectId, 3};
                if (hasEnvelope && trace.envelope.find(key) == trace.envelope.end()) {
                    classified.outsideEnvelope.push_back(candidate);
                    continue;
                }
                if (trace.changedLayers.find(layer) == trace.changedLayers.end()) {
                    candidate.sortTier = 1;
                } else if (backgroundNeighborCount(layerGrid, width, height, candidate) >= 3) {
                    candidate.sortTier = 2;
                }
                classified.insideEnvelope.push_back(candidate);
            }
        }
    }

    std::sort(
        classified.insideEnvelope.begin(),
        classified.insideEnvelope.end(),
        [](const DeletionCandidate& a, const DeletionCandidate& b) {
            if (a.sortTier != b.sortTier) {
                return a.sortTier < b.sortTier;
            }
            if (a.layer != b.layer) {
                return a.layer < b.layer;
            }
            if (a.y != b.y) {
                return a.y < b.y;
            }
            return a.x < b.x;
        });
    return classified;
}

struct SimplifyContext {
    const LoadedGame& loadedGame;
    const Game& game;
    ps_game gameWrapper;
    const SimplifyOptions& options;
    SimplifyResult& result;
    int32_t optimalLength = -1;
    uint64_t trialMaxExpanded = 0;
    const std::vector<ps_input>& referenceSolution;
};

bool tryRemoveSet(
    SimplifyContext& ctx,
    std::vector<int32_t>& workingGrid,
    const std::vector<DeletionCandidate>& cells) {
    if (cells.empty()) {
        return false;
    }
    std::vector<int32_t> trialGrid = workingGrid;
    for (const DeletionCandidate& cell : cells) {
        trialGrid[layerCellOffset(cell.layer, cell.x, cell.y, ctx.result.level.width, ctx.result.level.height)] = -1;
    }
    const LevelTemplate trialLevel = levelTemplateFromLayerCellObjectIds(
        ctx.game,
        ctx.result.level.width,
        ctx.result.level.height,
        trialGrid);
    if (!ctx.referenceSolution.empty()
        && !replaySolutionWins(ctx.loadedGame, trialLevel, ctx.referenceSolution)) {
        ++ctx.result.replayRejections;
        return false;
    }
    const BfsSolveAttempt bfs = bfsSolve(
        &ctx.gameWrapper,
        ctx.result.level.width,
        ctx.result.level.height,
        trialGrid,
        ctx.options.bfsTimeoutMs,
        ctx.trialMaxExpanded);
    ++ctx.result.bfsCalls;
    if (!bfs.solved || bfs.length != ctx.optimalLength) {
        ++ctx.result.bfsRejections;
        return false;
    }
    if (!levelStillHasPlayer(ctx.game, trialGrid, ctx.result.level.width, ctx.result.level.height)) {
        ++ctx.result.bfsRejections;
        return false;
    }
    workingGrid = std::move(trialGrid);
    ctx.result.level = trialLevel;
    ctx.result.objectsRemoved += static_cast<int32_t>(cells.size());
    return true;
}

void bisectRemove(
    SimplifyContext& ctx,
    std::vector<int32_t>& workingGrid,
    std::vector<DeletionCandidate> cells) {
    if (cells.empty()) {
        return;
    }
    if (tryRemoveSet(ctx, workingGrid, cells)) {
        return;
    }
    if (cells.size() == 1) {
        return;
    }
    const size_t mid = cells.size() / 2;
    std::vector<DeletionCandidate> first(cells.begin(), cells.begin() + static_cast<std::ptrdiff_t>(mid));
    std::vector<DeletionCandidate> second(cells.begin() + static_cast<std::ptrdiff_t>(mid), cells.end());
    bisectRemove(ctx, workingGrid, std::move(first));
    bisectRemove(ctx, workingGrid, std::move(second));
}

} // namespace

bool gameUsesRandomRules(const Game& game) {
    return gameUsesRandom(game);
}

bool replaySolutionWins(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& inputs) {
    if (!loadedGame.information || inputs.empty()) {
        return false;
    }
    auto session = createFullStateWithLoadedLevelSeed(loadedGame, "simplify-replay");
    session->meta.suppressRuleMessages = true;
    if (auto error = loadLevelTemplate(*session, level, 0, kSimplifyStepOptions)) {
        return false;
    }
    for (const ps_input input : inputs) {
        const ps_step_result step = turn(*session, input, kSimplifyStepOptions);
        if (step.won || session->meta.currentLevelIndex != 0) {
            return true;
        }
    }
    return session->meta.winning;
}

SimplifyResult simplifyLevel(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& referenceSolution,
    const SimplifyOptions& options) {
    SimplifyResult result;
    result.level = level;
    if (!loadedGame.information) {
        return result;
    }
    const Game& game = *loadedGame.information;
    if (gameUsesRandom(game)) {
        return result;
    }

    std::vector<int32_t> workingGrid = levelTemplateToLayerCellObjectIds(game, level);
    if (workingGrid.empty()) {
        return result;
    }

    ps_game gameWrapper;
    gameWrapper.impl = loadedGame;
    const BfsSolveAttempt baseline = bfsSolve(
        &gameWrapper,
        level.width,
        level.height,
        workingGrid,
        options.bfsTimeoutMs,
        options.bfsMaxExpanded);
    ++result.bfsCalls;
    if (!baseline.solved) {
        return result;
    }

    result.complete = true;
    result.optimalLength = baseline.length;
    result.baselineExpanded = baseline.expanded;
    const uint64_t trialMaxExpanded = options.bfsMaxExpanded != 0
        ? options.bfsMaxExpanded
        : static_cast<uint64_t>(std::max<int64_t>(
              kMinTrialExpanded,
              static_cast<int64_t>(std::ceil(
                  static_cast<double>(baseline.expanded) * options.bfsExpandedFactor))));

    const std::vector<int32_t> playerIds = playerObjectIds(game);
    const SolutionTrace trace = referenceSolution.empty()
        ? SolutionTrace{}
        : buildSolutionTrace(loadedGame, level, referenceSolution);
    const ClassifiedCandidates classified = classifyCandidates(
        game,
        level.width,
        level.height,
        workingGrid,
        playerIds,
        trace,
        options.useTraceBatch);

    SimplifyContext ctx{
        loadedGame,
        game,
        gameWrapper,
        options,
        result,
        baseline.length,
        trialMaxExpanded,
        referenceSolution,
    };

    if (!classified.outsideEnvelope.empty()) {
        result.candidatesTried += static_cast<int32_t>(classified.outsideEnvelope.size());
        bisectRemove(ctx, workingGrid, classified.outsideEnvelope);
    }

    for (const DeletionCandidate& candidate : classified.insideEnvelope) {
        ++result.candidatesTried;
        tryRemoveSet(ctx, workingGrid, {candidate});
    }

    return result;
}

} // namespace puzzlescript::search
