#pragma once

#include <cstdint>
#include <optional>
#include <string_view>
#include <vector>

#include "runtime/core.hpp"
#include "search/search_common.hpp"

namespace puzzlescript::solver {

enum class HeuristicKind {
    Winconditions,
    Auto,
};

inline const char* heuristicName(HeuristicKind kind) {
    switch (kind) {
        case HeuristicKind::Winconditions: return "winconditions";
        case HeuristicKind::Auto: return "auto";
    }
    return "winconditions";
}

inline std::optional<HeuristicKind> parseHeuristicName(std::string_view name) {
    if (name == "winconditions") {
        return HeuristicKind::Winconditions;
    }
    if (name == "auto") {
        return HeuristicKind::Auto;
    }
    return std::nullopt;
}

// Per-level cache and scratch for the `auto` heuristic extras: the A3
// static-dead-cell cache (corner/edge penalties), the D2 region-isolation
// penalty, and the single-all-on clear-path penalty. Ported from
// src/tests/run_solver_tests_js.js (`inferStaticBlockerMask`,
// `getStaticDeadCells`, `deadPositionPenalty`, `regionIsolationPenalty`,
// `clearPathPenalty`, `autoHeuristic`).
//
// `autoExtras` is the JS `autoHeuristic` minus its base score; the caller adds
// it to the existing winconditions score only when that base is non-zero (JS
// returns the base unchanged when it is <= 0).
//
// Boards are cell-major object masks, identical between FullState
// (`session.levelState.board.objects`) and PersistentLevelState
// (`state.board.objects`), so one context serves both node-storage modes.
// Static geometry is built once from the initial board, matching the JS
// per-level caches that populate on the first heuristic call. Per-call
// scratch lives in the context, so it is not thread-safe; each search owns
// its own context.
class HeuristicContext {
public:
    HeuristicContext(
        const Game& game,
        int32_t width,
        int32_t height,
        HeuristicKind kind,
        const MaskWord* initialBoard)
        : game_(game), width_(width), height_(height), kind_(kind) {
        if (kind_ != HeuristicKind::Auto || game_.winConditions.empty()) {
            return;
        }
        playerMask_ = search::maskPtr(game_, game_.playerMask);
        buildAllObjectsMask();
        buildNonBackgroundMask();

        const size_t conditionCount = game_.winConditions.size();
        plain_.resize(conditionCount, false);
        statics_.resize(conditionCount);
        for (size_t index = 0; index < conditionCount; ++index) {
            plain_[index] = isPlainFilter(search::maskPtr(game_, game_.winConditions[index].filter2));
        }
        if (conditionCount == 1 && game_.winConditions[0].quantifier == 1 && !plain_[0]) {
            singleAllOnIndex_ = 0;
        }
        for (size_t index = 0; index < conditionCount; ++index) {
            if (game_.winConditions[index].quantifier == 1 && !plain_[index]) {
                buildConditionStatics(static_cast<int32_t>(index), initialBoard);
            }
        }
        targetRowPresence_.assign(static_cast<size_t>(height_), 0);
        targetColPresence_.assign(static_cast<size_t>(width_), 0);
    }

    HeuristicKind kind() const { return kind_; }

    int32_t autoExtras(const MaskWord* board) {
        if (kind_ != HeuristicKind::Auto || game_.winConditions.empty()) {
            return 0;
        }
        int32_t extra = 0;
        if (singleAllOnIndex_ >= 0) {
            const WinCondition& condition = game_.winConditions[static_cast<size_t>(singleAllOnIndex_)];
            collectUnsatisfiedAllOnTiles(condition, board, unsatisfied_);
            collectMatchingTiles(
                search::maskPtr(game_, condition.filter2), condition.aggr2, board, targets_);
            extra += clearPathPenalty(unsatisfied_, targets_, singleAllOnIndex_, board);
        }
        for (size_t index = 0; index < game_.winConditions.size(); ++index) {
            const WinCondition& condition = game_.winConditions[index];
            if (condition.quantifier != 1 || plain_[index]) {
                continue;
            }
            collectUnsatisfiedAllOnTiles(condition, board, unsatisfied_);
            if (unsatisfied_.empty()) {
                continue;
            }
            extra += deadPositionPenalty(unsatisfied_, static_cast<int32_t>(index), board);
            extra += regionIsolationPenalty(unsatisfied_, static_cast<int32_t>(index), board);
        }
        return extra;
    }

private:
    struct ConditionStatics {
        bool built = false;
        std::vector<uint8_t> corner;
        std::vector<uint8_t> edge;
        std::vector<int32_t> componentId;
        int32_t componentCount = 0;
        MaskVector allowed; // filter1 | filter2 | player
    };

    int32_t tileCount() const { return width_ * height_; }
    int32_t tileX(int32_t tile) const { return tile / height_; }
    int32_t tileY(int32_t tile) const { return tile % height_; }

    const MaskWord* cellAt(const MaskWord* board, int32_t tile) const {
        return board + static_cast<size_t>(tile) * static_cast<size_t>(game_.strideObject);
    }

    static bool hasBits(const MaskWord* mask, uint32_t wordCount) {
        if (mask == nullptr) {
            return false;
        }
        for (uint32_t word = 0; word < wordCount; ++word) {
            if (mask[word] != 0) {
                return true;
            }
        }
        return false;
    }

    static bool vectorHasBits(const MaskVector& mask) {
        for (const MaskWord word : mask) {
            if (word != 0) {
                return true;
            }
        }
        return false;
    }

    void orMask(MaskVector& target, const MaskWord* mask) const {
        if (mask == nullptr) {
            return;
        }
        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            target[word] |= mask[word];
        }
    }

    void clearMask(MaskVector& target, const MaskWord* mask) const {
        if (mask == nullptr) {
            return;
        }
        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            target[word] &= ~mask[word];
        }
    }

    bool masksIntersect(const MaskVector& left, const MaskVector& right) const {
        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            if ((left[word] & right[word]) != 0) {
                return true;
            }
        }
        return false;
    }

    bool maskIntersectsPtr(const MaskWord* left, const MaskWord* right) const {
        if (left == nullptr || right == nullptr) {
            return false;
        }
        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            if ((left[word] & right[word]) != 0) {
                return true;
            }
        }
        return false;
    }

    // JS matchesMask: null mask never matches; aggregate masks require every
    // bit (vacuously true when the mask is empty), plain masks any overlap.
    bool matchesMask(const MaskWord* mask, bool aggregate, const MaskWord* cell) const {
        if (mask == nullptr) {
            return false;
        }
        if (aggregate) {
            for (uint32_t word = 0; word < game_.wordCount; ++word) {
                if ((cell[word] & mask[word]) != mask[word]) {
                    return false;
                }
            }
            return true;
        }
        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            if ((cell[word] & mask[word]) != 0) {
                return true;
            }
        }
        return false;
    }

    void buildAllObjectsMask() {
        allObjects_.assign(game_.wordCount, 0);
        constexpr uint32_t bitsPerWord = sizeof(MaskWord) * 8;
        for (int32_t id = 0; id < game_.objectCount; ++id) {
            allObjects_[static_cast<size_t>(id) / bitsPerWord] |=
                static_cast<MaskWord>(MaskWordUnsigned{1} << (static_cast<uint32_t>(id) % bitsPerWord));
        }
    }

    void buildNonBackgroundMask() {
        nonBackground_.assign(game_.wordCount, static_cast<MaskWord>(~MaskWordUnsigned{0}));
        if (game_.backgroundLayer >= 0
            && static_cast<size_t>(game_.backgroundLayer) < game_.layerMaskOffsets.size()) {
            const MaskWord* background =
                search::maskPtr(game_, game_.layerMaskOffsets[static_cast<size_t>(game_.backgroundLayer)]);
            if (background != nullptr) {
                for (uint32_t word = 0; word < game_.wordCount; ++word) {
                    nonBackground_[word] = static_cast<MaskWord>(~background[word]);
                }
            }
        }
    }

    // A condition is "plain" when the source had no ON clause; the native
    // compiler lowers that to a filter2 covering bits [0, objectCount). A
    // game-defined property that happens to span every object would compare
    // equal too (JS distinguishes those via padding bits in its "all" mask);
    // that only shifts which heuristic extras apply, never correctness.
    bool isPlainFilter(const MaskWord* filter) const {
        if (filter == nullptr) {
            return false;
        }
        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            if (filter[word] != allObjects_[word]) {
                return false;
            }
        }
        return true;
    }

    void patternPresenceMask(const Pattern& pattern, MaskVector& out) const {
        out.assign(game_.wordCount, 0);
        orMask(out, search::maskPtr(game_, pattern.objectsPresent));
        for (uint32_t entry = 0; entry < pattern.anyObjectsCount; ++entry) {
            orMask(out, search::maskPtr(game_, game_.anyObjectOffsets[pattern.anyObjectsFirst + entry]));
        }
    }

    bool patternMatchesMovement(const Pattern& pattern) const {
        if (hasBits(search::maskPtr(game_, pattern.movementsPresent), game_.movementWordCount)) {
            return true;
        }
        for (uint32_t entry = 0; entry < pattern.anyMovementsCount; ++entry) {
            if (hasBits(
                    search::maskPtr(game_, game_.anyMovementOffsets[pattern.anyMovementsFirst + entry]),
                    game_.movementWordCount)) {
                return true;
            }
        }
        return false;
    }

    bool patternChangesObjects(const Pattern& pattern) const {
        if (!pattern.replacement.has_value()) {
            return false;
        }
        return hasBits(search::maskPtr(game_, pattern.replacement->objectsSet), game_.wordCount)
            || hasBits(search::maskPtr(game_, pattern.replacement->objectsClear), game_.wordCount);
    }

    static bool isCancelRule(const Rule& rule) {
        for (const RuleCommand& command : rule.commands) {
            if (command.name == "cancel") {
                return true;
            }
        }
        return false;
    }

    // JS inferStaticBlockerMask: objects that rules treat as immovable
    // obstacles next to a moving/changing condition actor. A zero result
    // means "no blockers inferred" (JS null).
    MaskVector inferStaticBlockerMask(const WinCondition& condition) const {
        MaskVector blockers(game_.wordCount, 0);
        MaskVector consumed(game_.wordCount, 0);

        const MaskWord* filter1 = search::maskPtr(game_, condition.filter1);
        const MaskWord* filter2 = search::maskPtr(game_, condition.filter2);
        MaskVector actorMask(game_.wordCount, 0);
        orMask(actorMask, filter1);
        if (playerMask_ != nullptr && maskIntersectsPtr(filter1, playerMask_)) {
            orMask(actorMask, playerMask_);
        }

        MaskVector cellPresent(game_.wordCount, 0);
        MaskVector neighborPresent(game_.wordCount, 0);
        MaskVector rowSet(game_.wordCount, 0);

        auto scanGroups = [&](const std::vector<std::vector<Rule>>& groups) {
            for (const auto& group : groups) {
                for (const Rule& rule : group) {
                    const bool cancelRule = isCancelRule(rule);
                    for (const auto& row : rule.patterns) {
                        rowSet.assign(game_.wordCount, 0);
                        for (const Pattern& cell : row) {
                            if (cell.kind == Pattern::Kind::Ellipsis || !cell.replacement.has_value()) {
                                continue;
                            }
                            orMask(rowSet, search::maskPtr(game_, cell.replacement->objectsSet));
                        }
                        for (size_t cellIndex = 0; cellIndex < row.size(); ++cellIndex) {
                            const Pattern& cell = row[cellIndex];
                            if (cell.kind == Pattern::Kind::Ellipsis) {
                                continue;
                            }
                            patternPresenceMask(cell, cellPresent);
                            if (!masksIntersect(cellPresent, actorMask)) {
                                continue;
                            }
                            const bool actorMoves = patternMatchesMovement(cell);
                            const bool actorChanges = patternChangesObjects(cell);
                            if (!actorMoves && !actorChanges && !cancelRule) {
                                continue;
                            }

                            for (const int32_t delta : {-1, 1}) {
                                const int64_t neighborIndex = static_cast<int64_t>(cellIndex) + delta;
                                if (neighborIndex < 0 || neighborIndex >= static_cast<int64_t>(row.size())) {
                                    continue;
                                }
                                const Pattern& neighbor = row[static_cast<size_t>(neighborIndex)];
                                if (neighbor.kind == Pattern::Kind::Ellipsis) {
                                    continue;
                                }

                                const MaskWord* missing = search::maskPtr(game_, neighbor.objectsMissing);
                                if ((actorMoves || actorChanges) && hasBits(missing, game_.wordCount)) {
                                    orMask(blockers, missing);
                                }

                                patternPresenceMask(neighbor, neighborPresent);
                                if (neighbor.replacement.has_value() && vectorHasBits(neighborPresent)) {
                                    const MaskWord* objectsClear =
                                        search::maskPtr(game_, neighbor.replacement->objectsClear);
                                    if (objectsClear != nullptr) {
                                        for (uint32_t word = 0; word < game_.wordCount; ++word) {
                                            consumed[word] |=
                                                neighborPresent[word] & objectsClear[word] & ~rowSet[word];
                                        }
                                    }
                                }

                                if (!vectorHasBits(neighborPresent)) {
                                    continue;
                                }
                                if (cancelRule) {
                                    for (uint32_t word = 0; word < game_.wordCount; ++word) {
                                        blockers[word] |= neighborPresent[word];
                                    }
                                } else if (actorChanges && !patternChangesObjects(neighbor)) {
                                    for (uint32_t word = 0; word < game_.wordCount; ++word) {
                                        blockers[word] |= neighborPresent[word];
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };
        scanGroups(game_.rules);
        scanGroups(game_.lateRules);

        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            blockers[word] &= ~consumed[word];
        }
        clearMask(blockers, filter1);
        clearMask(blockers, filter2);
        clearMask(blockers, playerMask_);
        return blockers;
    }

    bool cellHasStaticBlockingObject(
        int32_t tile,
        const MaskVector& blockers,
        const MaskVector& allowed,
        const MaskWord* board) const {
        const MaskWord* cell = cellAt(board, tile);
        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            if ((cell[word] & blockers[word] & ~allowed[word]) != 0) {
                return true;
            }
        }
        return false;
    }

    // JS getStaticDeadCells: blocked map from inferred static blockers, then
    // corner/edge classification (map boundaries count as blocked) and
    // 4-neighbour connected components of the non-blocked cells.
    void buildConditionStatics(int32_t index, const MaskWord* board) {
        ConditionStatics& statics = statics_[static_cast<size_t>(index)];
        const WinCondition& condition = game_.winConditions[static_cast<size_t>(index)];

        statics.allowed.assign(game_.wordCount, 0);
        orMask(statics.allowed, search::maskPtr(game_, condition.filter1));
        orMask(statics.allowed, search::maskPtr(game_, condition.filter2));
        orMask(statics.allowed, playerMask_);

        const int32_t n = tileCount();
        const MaskVector blockers = inferStaticBlockerMask(condition);
        std::vector<uint8_t> blocked(static_cast<size_t>(n), 0);
        if (vectorHasBits(blockers)) {
            for (int32_t tile = 0; tile < n; ++tile) {
                if (cellHasStaticBlockingObject(tile, blockers, statics.allowed, board)) {
                    blocked[static_cast<size_t>(tile)] = 1;
                }
            }
        }

        statics.corner.assign(static_cast<size_t>(n), 0);
        statics.edge.assign(static_cast<size_t>(n), 0);
        for (int32_t x = 0; x < width_; ++x) {
            for (int32_t y = 0; y < height_; ++y) {
                const int32_t tile = x * height_ + y;
                const bool left = x == 0 || blocked[static_cast<size_t>((x - 1) * height_ + y)] != 0;
                const bool right = x == width_ - 1 || blocked[static_cast<size_t>((x + 1) * height_ + y)] != 0;
                const bool up = y == 0 || blocked[static_cast<size_t>(x * height_ + (y - 1))] != 0;
                const bool down = y == height_ - 1 || blocked[static_cast<size_t>(x * height_ + (y + 1))] != 0;
                const bool horizontal = left || right;
                const bool vertical = up || down;
                if (horizontal && vertical) {
                    statics.corner[static_cast<size_t>(tile)] = 1;
                } else if (horizontal || vertical) {
                    statics.edge[static_cast<size_t>(tile)] = 1;
                }
            }
        }

        statics.componentId.assign(static_cast<size_t>(n), -1);
        std::vector<int32_t> queue(static_cast<size_t>(n), 0);
        int32_t componentCount = 0;
        for (int32_t start = 0; start < n; ++start) {
            if (blocked[static_cast<size_t>(start)] != 0 || statics.componentId[static_cast<size_t>(start)] != -1) {
                continue;
            }
            const int32_t id = componentCount++;
            statics.componentId[static_cast<size_t>(start)] = id;
            size_t head = 0;
            size_t tail = 0;
            queue[tail++] = start;
            while (head < tail) {
                const int32_t current = queue[head++];
                const int32_t cx = current / height_;
                const int32_t cy = current - cx * height_;
                const auto visit = [&](int32_t neighbor) {
                    if (blocked[static_cast<size_t>(neighbor)] == 0
                        && statics.componentId[static_cast<size_t>(neighbor)] == -1) {
                        statics.componentId[static_cast<size_t>(neighbor)] = id;
                        queue[tail++] = neighbor;
                    }
                };
                if (cx > 0) visit((cx - 1) * height_ + cy);
                if (cx < width_ - 1) visit((cx + 1) * height_ + cy);
                if (cy > 0) visit(cx * height_ + (cy - 1));
                if (cy < height_ - 1) visit(cx * height_ + (cy + 1));
            }
        }
        statics.componentCount = componentCount;
        statics.built = true;
    }

    void collectMatchingTiles(
        const MaskWord* mask,
        bool aggregate,
        const MaskWord* board,
        std::vector<int32_t>& out) const {
        out.clear();
        const int32_t n = tileCount();
        for (int32_t tile = 0; tile < n; ++tile) {
            if (matchesMask(mask, aggregate, cellAt(board, tile))) {
                out.push_back(tile);
            }
        }
    }

    void collectUnsatisfiedAllOnTiles(
        const WinCondition& condition,
        const MaskWord* board,
        std::vector<int32_t>& out) const {
        out.clear();
        const MaskWord* filter1 = search::maskPtr(game_, condition.filter1);
        const MaskWord* filter2 = search::maskPtr(game_, condition.filter2);
        const int32_t n = tileCount();
        for (int32_t tile = 0; tile < n; ++tile) {
            const MaskWord* cell = cellAt(board, tile);
            if (matchesMask(filter1, condition.aggr1, cell)
                && !matchesMask(filter2, condition.aggr2, cell)) {
                out.push_back(tile);
            }
        }
    }

    int32_t buildTargetLinePresence(const WinCondition& condition, const MaskWord* board) {
        std::fill(targetRowPresence_.begin(), targetRowPresence_.end(), 0);
        std::fill(targetColPresence_.begin(), targetColPresence_.end(), 0);
        const MaskWord* filter2 = search::maskPtr(game_, condition.filter2);
        int32_t targetCount = 0;
        const int32_t n = tileCount();
        for (int32_t tile = 0; tile < n; ++tile) {
            if (!matchesMask(filter2, condition.aggr2, cellAt(board, tile))) {
                continue;
            }
            targetRowPresence_[static_cast<size_t>(tileY(tile))] = 1;
            targetColPresence_[static_cast<size_t>(tileX(tile))] = 1;
            ++targetCount;
        }
        return targetCount;
    }

    bool cellHasBlockingObject(int32_t tile, const MaskVector& allowed, const MaskWord* board) const {
        const MaskWord* cell = cellAt(board, tile);
        for (uint32_t word = 0; word < game_.wordCount; ++word) {
            if ((cell[word] & nonBackground_[word] & ~allowed[word]) != 0) {
                return true;
            }
        }
        return false;
    }

    bool clearPathBetween(
        int32_t left,
        int32_t right,
        const MaskVector& allowed,
        const MaskWord* board) const {
        const int32_t leftX = tileX(left);
        const int32_t leftY = tileY(left);
        const int32_t rightX = tileX(right);
        const int32_t rightY = tileY(right);
        const int32_t dx = rightX > leftX ? 1 : (rightX < leftX ? -1 : 0);
        const int32_t dy = rightY > leftY ? 1 : (rightY < leftY ? -1 : 0);
        int32_t x = leftX + dx;
        int32_t y = leftY + dy;
        while (x != rightX || y != rightY) {
            if (cellHasBlockingObject(x * height_ + y, allowed, board)) {
                return false;
            }
            x += dx;
            y += dy;
        }
        return true;
    }

    bool hasClearAlignedTarget(
        int32_t tile,
        const std::vector<int32_t>& targets,
        const MaskVector& allowed,
        const MaskWord* board) const {
        const int32_t x = tileX(tile);
        const int32_t y = tileY(tile);
        for (const int32_t target : targets) {
            if ((tileX(target) == x || tileY(target) == y)
                && clearPathBetween(tile, target, allowed, board)) {
                return true;
            }
        }
        return false;
    }

    int32_t clearPathPenalty(
        const std::vector<int32_t>& unsatisfied,
        const std::vector<int32_t>& targets,
        int32_t conditionIndex,
        const MaskWord* board) {
        if (targets.empty()) {
            return static_cast<int32_t>(unsatisfied.size()) * 16;
        }
        const WinCondition& condition = game_.winConditions[static_cast<size_t>(conditionIndex)];
        const ConditionStatics& statics = statics_[static_cast<size_t>(conditionIndex)];
        int32_t penalty = 0;
        buildTargetLinePresence(condition, board);
        for (const int32_t tile : unsatisfied) {
            const bool aligned = targetRowPresence_[static_cast<size_t>(tileY(tile))] != 0
                || targetColPresence_[static_cast<size_t>(tileX(tile))] != 0;
            if (!aligned) {
                penalty += 4;
            } else if (!hasClearAlignedTarget(tile, targets, statics.allowed, board)) {
                penalty += 2;
            }
        }
        return penalty;
    }

    int32_t deadPositionPenalty(
        const std::vector<int32_t>& unsatisfied,
        int32_t conditionIndex,
        const MaskWord* board) {
        const WinCondition& condition = game_.winConditions[static_cast<size_t>(conditionIndex)];
        const ConditionStatics& statics = statics_[static_cast<size_t>(conditionIndex)];
        if (!statics.built) {
            return 0;
        }
        int32_t penalty = 0;
        buildTargetLinePresence(condition, board);
        for (const int32_t tile : unsatisfied) {
            if (statics.corner[static_cast<size_t>(tile)] != 0) {
                penalty += 32;
            } else if (statics.edge[static_cast<size_t>(tile)] != 0
                && targetRowPresence_[static_cast<size_t>(tileY(tile))] == 0
                && targetColPresence_[static_cast<size_t>(tileX(tile))] == 0) {
                penalty += 8;
            }
        }
        return penalty;
    }

    int32_t regionIsolationPenalty(
        const std::vector<int32_t>& unsatisfied,
        int32_t conditionIndex,
        const MaskWord* board) {
        const WinCondition& condition = game_.winConditions[static_cast<size_t>(conditionIndex)];
        const ConditionStatics& statics = statics_[static_cast<size_t>(conditionIndex)];
        if (!statics.built || statics.componentCount <= 1) {
            return 0;
        }
        collectMatchingTiles(
            search::maskPtr(game_, condition.filter2), condition.aggr2, board, isolationTargets_);
        if (isolationTargets_.empty()) {
            return 0;
        }
        liveComponent_.assign(static_cast<size_t>(statics.componentCount), 0);
        for (const int32_t target : isolationTargets_) {
            const int32_t component = statics.componentId[static_cast<size_t>(target)];
            if (component >= 0) {
                liveComponent_[static_cast<size_t>(component)] = 1;
            }
        }
        int32_t isolated = 0;
        for (const int32_t tile : unsatisfied) {
            const int32_t component = statics.componentId[static_cast<size_t>(tile)];
            if (component >= 0 && liveComponent_[static_cast<size_t>(component)] == 0) {
                ++isolated;
            }
        }
        return isolated * 256;
    }

    const Game& game_;
    int32_t width_ = 0;
    int32_t height_ = 0;
    HeuristicKind kind_ = HeuristicKind::Winconditions;
    const MaskWord* playerMask_ = nullptr;
    int32_t singleAllOnIndex_ = -1;
    MaskVector allObjects_;
    MaskVector nonBackground_;
    std::vector<bool> plain_;
    std::vector<ConditionStatics> statics_;

    // per-call scratch
    std::vector<uint8_t> targetRowPresence_;
    std::vector<uint8_t> targetColPresence_;
    std::vector<int32_t> unsatisfied_;
    std::vector<int32_t> targets_;
    std::vector<int32_t> isolationTargets_;
    std::vector<uint8_t> liveComponent_;
};

} // namespace puzzlescript::solver
