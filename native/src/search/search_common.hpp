#pragma once

#include <algorithm>
#include <cstdint>
#include <cstddef>
#include <limits>
#include <optional>
#include <vector>

#include "runtime/core.hpp"

namespace puzzlescript::search {

enum class SearchMode {
    Bfs,
    WeightedAStar,
    WeightedAStarDeep,
    Greedy,
};

struct StateKey {
    uint64_t lo = 0;
    uint64_t hi = 0;

    bool operator==(const StateKey& other) const {
        return lo == other.lo && hi == other.hi;
    }
};

struct StateKeyHash {
    size_t operator()(const StateKey& key) const {
        const uint64_t mixed = key.lo ^ (key.hi + 0x9e3779b97f4a7c15ULL + (key.lo << 6) + (key.lo >> 2));
        return static_cast<size_t>(mixed ^ (mixed >> 32));
    }
};

inline uint64_t mix64(uint64_t value) {
    value ^= value >> 30;
    value *= 0xbf58476d1ce4e5b9ULL;
    value ^= value >> 27;
    value *= 0x94d049bb133111ebULL;
    value ^= value >> 31;
    return value;
}

inline uint64_t rotateLeft64(uint64_t value, uint32_t shift) {
    return (value << shift) | (value >> (64U - shift));
}

inline void appendStateKeyValue(StateKey& key, uint64_t value) {
    key.lo ^= value;
    key.lo *= 0x100000001b3ULL;
    key.hi ^= rotateLeft64(value + 0x9e3779b97f4a7c15ULL + key.lo, 27);
    key.hi *= 0x9e3779b185ebca87ULL;
}

inline void appendStateKeyBytes(StateKey& key, const uint8_t* bytes, size_t size) {
    uint64_t packed = 0;
    uint32_t shift = 0;
    for (size_t index = 0; index < size; ++index) {
        packed |= static_cast<uint64_t>(bytes[index]) << shift;
        shift += 8;
        if (shift == 64) {
            appendStateKeyValue(key, packed);
            packed = 0;
            shift = 0;
        }
    }
    if (shift != 0) {
        appendStateKeyValue(key, packed);
    }
}

template <typename ProjectWord>
inline StateKey fullStateKey(const FullState& session, bool includeRandomState, ProjectWord projectWord) {
    StateKey key{1469598103934665603ull, 7809847782465536322ull};
    appendStateKeyValue(key, static_cast<uint64_t>(static_cast<uint32_t>(session.meta.currentLevelIndex)));
    appendStateKeyValue(key, session.meta.titleScreen ? 1 : 0);
    appendStateKeyValue(key, session.meta.textMode ? 1 : 0);
    appendStateKeyValue(key, session.meta.winning ? 1 : 0);
    appendStateKeyValue(key, session.meta.pendingAgain ? 1 : 0);

    if (includeRandomState) {
        appendStateKeyValue(key, static_cast<uint64_t>(session.levelState.rng.s.size()));
        appendStateKeyValue(key, static_cast<uint64_t>(static_cast<uint32_t>(session.levelState.rng.i)));
        appendStateKeyValue(key, static_cast<uint64_t>(static_cast<uint32_t>(session.levelState.rng.j)));
        appendStateKeyValue(key, session.levelState.rng.valid ? 1 : 0);
        appendStateKeyBytes(key, session.levelState.rng.s.data(), session.levelState.rng.s.size());
    }

    const auto& objects = session.levelState.board.objects;
    appendStateKeyValue(key, static_cast<uint64_t>(objects.size()));
    for (size_t index = 0; index < objects.size(); ++index) {
        appendStateKeyValue(key, static_cast<uint64_t>(static_cast<MaskWordUnsigned>(projectWord(index, objects[index]))));
    }
    return key;
}

inline StateKey fullStateKey(const FullState& session, bool includeRandomState) {
    return fullStateKey(session, includeRandomState, [](size_t, MaskWord word) { return word; });
}

template <typename ProjectWord>
inline StateKey sessionStateKey(const FullState& state, bool includeRandomState, ProjectWord projectWord) {
    return fullStateKey(state, includeRandomState, projectWord);
}

inline StateKey sessionStateKey(const FullState& state, bool includeRandomState) {
    return fullStateKey(state, includeRandomState);
}

inline int32_t priorityFor(SearchMode mode, uint32_t depth, int32_t heuristic, int32_t weightedAStarWeight) {
    switch (mode) {
        case SearchMode::Bfs: return static_cast<int32_t>(depth);
        case SearchMode::WeightedAStar: return static_cast<int32_t>(depth) + heuristic * weightedAStarWeight;
        case SearchMode::WeightedAStarDeep: return static_cast<int32_t>(depth) + heuristic * weightedAStarWeight;
        case SearchMode::Greedy: return heuristic;
    }
    return static_cast<int32_t>(depth);
}

inline int32_t priorityFor(SearchMode mode, uint32_t depth, int32_t heuristic) {
    return priorityFor(mode, depth, heuristic, 2);
}

inline const MaskWord* maskPtr(const Game& game, MaskOffset offset) {
    if (offset == kNullMaskOffset || offset >= game.maskArena.size()) {
        return nullptr;
    }
    return game.maskArena.data() + offset;
}

inline const MaskWord* cellObjects(const FullState& session, int32_t tileIndex) {
    return session.levelState.board.objects.data() + static_cast<size_t>(tileIndex * session.game->strideObject);
}

inline bool anyBits(const MaskWord* lhs, uint32_t lhsCount, const MaskWord* rhs, uint32_t rhsCount) {
    const uint32_t count = std::min(lhsCount, rhsCount);
    for (uint32_t index = 0; index < count; ++index) {
        if ((lhs[index] & rhs[index]) != 0) {
            return true;
        }
    }
    return false;
}

inline bool bitsSet(const MaskWord* required, uint32_t requiredCount, const MaskWord* actual, uint32_t actualCount) {
    for (uint32_t index = 0; index < requiredCount; ++index) {
        const MaskWord actualWord = index < actualCount ? actual[index] : 0;
        if ((required[index] & actualWord) != required[index]) {
            return false;
        }
    }
    return true;
}

inline bool matchesFilter(const MaskWord* filter, uint32_t wordCount, bool aggregate, const MaskWord* cell) {
    if (filter == nullptr) {
        return false;
    }
    return aggregate ? bitsSet(filter, wordCount, cell, wordCount) : anyBits(filter, wordCount, cell, wordCount);
}

inline constexpr int32_t kNoMatchingDistance = 64;

inline int32_t distanceOrFallback(int32_t distance) {
    return distance == std::numeric_limits<int32_t>::max() ? kNoMatchingDistance : distance;
}

struct StaticDeadCells {
    bool initialized = false;
    std::vector<uint8_t> corner;
    std::vector<uint8_t> edge;
    std::vector<int32_t> componentId;
    int32_t componentCount = 0;
};

struct HeuristicScratch {
    std::vector<int32_t> distanceField;
    std::vector<std::vector<int32_t>> conditionDistances;
    std::vector<uint8_t> targetRowPresence;
    std::vector<uint8_t> targetColumnPresence;
    std::vector<int32_t> matchingTiles;
    std::vector<int32_t> unsatisfiedTiles;
    std::vector<int32_t> componentQueue;
    std::vector<StaticDeadCells> staticDeadCells;
    MaskVector maskScratchA;
    MaskVector maskScratchB;
    MaskVector maskScratchC;
};

inline void matchingDistanceField(
    const FullState& session,
    const MaskWord* filter,
    bool aggregate,
    std::vector<int32_t>& distances
) {
    const int32_t width = currentLevelWidth(session);
    const int32_t height = currentLevelHeight(session);
    const int32_t tileCount = width * height;
    distances.assign(static_cast<size_t>(tileCount), std::numeric_limits<int32_t>::max());
    if (filter == nullptr) {
        return;
    }

    for (int32_t tile = 0; tile < tileCount; ++tile) {
        if (matchesFilter(filter, session.game->wordCount, aggregate, cellObjects(session, tile))) {
            distances[static_cast<size_t>(tile)] = 0;
        }
    }

    auto relax = [&](int32_t tile, int32_t neighbor) {
        int32_t& distance = distances[static_cast<size_t>(tile)];
        const int32_t neighborDistance = distances[static_cast<size_t>(neighbor)];
        if (neighborDistance != std::numeric_limits<int32_t>::max()) {
            distance = std::min(distance, neighborDistance + 1);
        }
    };

    for (int32_t x = 0; x < width; ++x) {
        for (int32_t y = 0; y < height; ++y) {
            const int32_t tile = x * height + y;
            if (x > 0) relax(tile, (x - 1) * height + y);
            if (y > 0) relax(tile, x * height + (y - 1));
        }
    }
    for (int32_t x = width - 1; x >= 0; --x) {
        for (int32_t y = height - 1; y >= 0; --y) {
            const int32_t tile = x * height + y;
            if (x + 1 < width) relax(tile, (x + 1) * height + y);
            if (y + 1 < height) relax(tile, x * height + (y + 1));
        }
    }
}

inline std::vector<int32_t> matchingDistanceField(const FullState& session, const MaskWord* filter, bool aggregate) {
    std::vector<int32_t> distances;
    matchingDistanceField(session, filter, aggregate, distances);
    return distances;
}

struct HeuristicOptions {
    bool includeNoQuantifierPenalty = false;
    bool includePlayerDistance = false;
};

inline int32_t winConditionHeuristicScore(const FullState& session, HeuristicOptions options, HeuristicScratch& scratch) {
    const Game& game = *session.game;
    if (game.winConditions.empty()) {
        return 0;
    }

    int32_t score = 0;
    const int32_t tileCount = currentLevelWidth(session) * currentLevelHeight(session);
    for (const auto& condition : game.winConditions) {
        const MaskWord* filter1 = maskPtr(game, condition.filter1);
        const MaskWord* filter2 = maskPtr(game, condition.filter2);
        if (filter1 == nullptr || filter2 == nullptr) {
            continue;
        }
        matchingDistanceField(session, filter2, condition.aggr2, scratch.distanceField);
        if (condition.quantifier == 1) {
            for (int32_t tile = 0; tile < tileCount; ++tile) {
                const MaskWord* cell = cellObjects(session, tile);
                if (!matchesFilter(filter1, game.wordCount, condition.aggr1, cell)) {
                    continue;
                }
                if (matchesFilter(filter2, game.wordCount, condition.aggr2, cell)) {
                    continue;
                }
                score += 10 + distanceOrFallback(scratch.distanceField[static_cast<size_t>(tile)]);
            }
        } else if (condition.quantifier == 0) {
            bool passed = false;
            int32_t best = kNoMatchingDistance;
            for (int32_t tile = 0; tile < tileCount; ++tile) {
                const MaskWord* cell = cellObjects(session, tile);
                if (!matchesFilter(filter1, game.wordCount, condition.aggr1, cell)) {
                    continue;
                }
                if (matchesFilter(filter2, game.wordCount, condition.aggr2, cell)) {
                    passed = true;
                    break;
                }
                best = std::min(best, distanceOrFallback(scratch.distanceField[static_cast<size_t>(tile)]));
            }
            score += passed ? 0 : best;
        } else if (options.includeNoQuantifierPenalty && condition.quantifier == -1) {
            for (int32_t tile = 0; tile < tileCount; ++tile) {
                const MaskWord* cell = cellObjects(session, tile);
                if (matchesFilter(filter1, game.wordCount, condition.aggr1, cell)
                    && matchesFilter(filter2, game.wordCount, condition.aggr2, cell)) {
                    score += 10;
                }
            }
        }
    }

    if (options.includePlayerDistance && game.playerMask != kNullMaskOffset && score > 0) {
        const MaskWord* playerMask = maskPtr(game, game.playerMask);
        bool hasPlayer = false;
        int32_t best = kNoMatchingDistance;
        scratch.conditionDistances.resize(game.winConditions.size());
        for (size_t index = 0; index < game.winConditions.size(); ++index) {
            const auto& condition = game.winConditions[index];
            matchingDistanceField(session, maskPtr(game, condition.filter1), condition.aggr1, scratch.conditionDistances[index]);
        }
        for (int32_t player = 0; player < tileCount; ++player) {
            if (!matchesFilter(playerMask, game.wordCount, game.playerMaskAggregate, cellObjects(session, player))) {
                continue;
            }
            hasPlayer = true;
            for (const auto& distances : scratch.conditionDistances) {
                best = std::min(best, distanceOrFallback(distances[static_cast<size_t>(player)]));
            }
        }
        if (hasPlayer) {
            score += std::min(best, 16);
        }
    }

    return score;
}

inline bool maskHasBits(const MaskWord* mask, uint32_t wordCount) {
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

inline bool maskHasBits(const MaskVector& mask) {
    return std::any_of(mask.begin(), mask.end(), [](MaskWord word) { return word != 0; });
}

inline bool masksEqual(const MaskWord* left, const MaskWord* right, uint32_t wordCount) {
    if (left == nullptr || right == nullptr) {
        return left == right;
    }
    for (uint32_t word = 0; word < wordCount; ++word) {
        if (left[word] != right[word]) {
            return false;
        }
    }
    return true;
}

inline bool masksIntersect(const MaskVector& left, const MaskVector& right) {
    const size_t count = std::min(left.size(), right.size());
    for (size_t word = 0; word < count; ++word) {
        if ((left[word] & right[word]) != 0) {
            return true;
        }
    }
    return false;
}

inline void orMaskInto(MaskVector& target, const MaskWord* source, uint32_t wordCount) {
    if (source == nullptr) {
        return;
    }
    if (target.size() < wordCount) {
        target.resize(wordCount, 0);
    }
    for (uint32_t word = 0; word < wordCount; ++word) {
        target[word] |= source[word];
    }
}

inline void clearMaskBits(MaskVector& target, const MaskWord* source, uint32_t wordCount) {
    if (source == nullptr) {
        return;
    }
    const uint32_t count = std::min<uint32_t>(wordCount, static_cast<uint32_t>(target.size()));
    for (uint32_t word = 0; word < count; ++word) {
        target[word] &= ~source[word];
    }
}

inline int32_t tileX(const FullState& session, int32_t tile) {
    return tile / currentLevelHeight(session);
}

inline int32_t tileY(const FullState& session, int32_t tile) {
    return tile % currentLevelHeight(session);
}

inline int32_t tileIndexAt(const FullState& session, int32_t x, int32_t y) {
    return x * currentLevelHeight(session) + y;
}

inline void allObjectsMask(const Game& game, MaskVector& mask) {
    mask.assign(game.wordCount, 0);
    for (int32_t id = 0; id < game.objectCount; ++id) {
        const uint32_t objectId = static_cast<uint32_t>(id);
        const uint32_t word = maskWordIndex(objectId);
        if (word < mask.size()) {
            mask[word] |= maskBit(objectId);
        }
    }
}

inline bool isPlainCondition(const Game& game, const WinCondition& condition, HeuristicScratch& scratch) {
    const MaskWord* filter2 = maskPtr(game, condition.filter2);
    if (filter2 == nullptr) {
        return false;
    }
    allObjectsMask(game, scratch.maskScratchA);
    return masksEqual(filter2, scratch.maskScratchA.data(), game.wordCount);
}

inline bool isAllOnNonPlainCondition(const Game& game, const WinCondition& condition, HeuristicScratch& scratch) {
    return condition.quantifier == 1 && !isPlainCondition(game, condition, scratch);
}

inline void collectMatchingTiles(
    const FullState& session,
    const MaskWord* mask,
    bool aggregate,
    std::vector<int32_t>& tiles
) {
    tiles.clear();
    if (mask == nullptr) {
        return;
    }
    const int32_t tileCount = currentLevelWidth(session) * currentLevelHeight(session);
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        if (matchesFilter(mask, session.game->wordCount, aggregate, cellObjects(session, tile))) {
            tiles.push_back(tile);
        }
    }
}

inline void collectUnsatisfiedAllOnTiles(
    const FullState& session,
    const WinCondition& condition,
    std::vector<int32_t>& tiles
) {
    tiles.clear();
    const Game& game = *session.game;
    const MaskWord* filter1 = maskPtr(game, condition.filter1);
    const MaskWord* filter2 = maskPtr(game, condition.filter2);
    if (filter1 == nullptr || filter2 == nullptr) {
        return;
    }
    const int32_t tileCount = currentLevelWidth(session) * currentLevelHeight(session);
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        const MaskWord* cell = cellObjects(session, tile);
        if (matchesFilter(filter1, game.wordCount, condition.aggr1, cell)
            && !matchesFilter(filter2, game.wordCount, condition.aggr2, cell)) {
            tiles.push_back(tile);
        }
    }
}

inline int32_t buildTargetLinePresence(
    const FullState& session,
    const WinCondition& condition,
    HeuristicScratch& scratch
) {
    const int32_t width = currentLevelWidth(session);
    const int32_t height = currentLevelHeight(session);
    scratch.targetRowPresence.assign(static_cast<size_t>(height), 0);
    scratch.targetColumnPresence.assign(static_cast<size_t>(width), 0);
    const Game& game = *session.game;
    const MaskWord* filter2 = maskPtr(game, condition.filter2);
    if (filter2 == nullptr) {
        return 0;
    }
    int32_t targetCount = 0;
    const int32_t tileCount = width * height;
    for (int32_t tile = 0; tile < tileCount; ++tile) {
        if (!matchesFilter(filter2, game.wordCount, condition.aggr2, cellObjects(session, tile))) {
            continue;
        }
        scratch.targetRowPresence[static_cast<size_t>(tileY(session, tile))] = 1;
        scratch.targetColumnPresence[static_cast<size_t>(tileX(session, tile))] = 1;
        ++targetCount;
    }
    return targetCount;
}

inline bool cellHasBlockingObject(const FullState& session, int32_t tile, const WinCondition& condition) {
    const Game& game = *session.game;
    const MaskWord* filter1 = maskPtr(game, condition.filter1);
    const MaskWord* filter2 = maskPtr(game, condition.filter2);
    const MaskWord* playerMask = maskPtr(game, game.playerMask);
    const MaskWord* backgroundMask = game.backgroundLayer >= 0
        && static_cast<size_t>(game.backgroundLayer) < game.layerMaskOffsets.size()
            ? maskPtr(game, game.layerMaskOffsets[static_cast<size_t>(game.backgroundLayer)])
            : nullptr;
    const MaskWord* cell = cellObjects(session, tile);
    for (uint32_t word = 0; word < game.wordCount; ++word) {
        const MaskWord allowed = (filter1 != nullptr ? filter1[word] : 0)
            | (filter2 != nullptr ? filter2[word] : 0)
            | (playerMask != nullptr ? playerMask[word] : 0);
        const MaskWord nonBackground = backgroundMask != nullptr
            ? static_cast<MaskWord>(~static_cast<MaskWordUnsigned>(backgroundMask[word]))
            : static_cast<MaskWord>(~MaskWordUnsigned{0});
        if ((cell[word] & nonBackground & ~allowed) != 0) {
            return true;
        }
    }
    return false;
}

inline bool cellHasStaticBlockingObject(
    const FullState& session,
    int32_t tile,
    const WinCondition& condition,
    const MaskVector& blockerMask
) {
    const Game& game = *session.game;
    const MaskWord* filter1 = maskPtr(game, condition.filter1);
    const MaskWord* filter2 = maskPtr(game, condition.filter2);
    const MaskWord* playerMask = maskPtr(game, game.playerMask);
    const MaskWord* cell = cellObjects(session, tile);
    for (uint32_t word = 0; word < game.wordCount; ++word) {
        const MaskWord allowed = (filter1 != nullptr ? filter1[word] : 0)
            | (filter2 != nullptr ? filter2[word] : 0)
            | (playerMask != nullptr ? playerMask[word] : 0);
        const MaskWord blocker = word < blockerMask.size() ? blockerMask[word] : 0;
        if ((cell[word] & blocker & ~allowed) != 0) {
            return true;
        }
    }
    return false;
}

inline bool clearPathBetween(const FullState& session, int32_t left, int32_t right, const WinCondition& condition) {
    const int32_t leftX = tileX(session, left);
    const int32_t leftY = tileY(session, left);
    const int32_t rightX = tileX(session, right);
    const int32_t rightY = tileY(session, right);
    const int32_t dx = (rightX > leftX) - (rightX < leftX);
    const int32_t dy = (rightY > leftY) - (rightY < leftY);
    int32_t x = leftX + dx;
    int32_t y = leftY + dy;
    while (x != rightX || y != rightY) {
        if (cellHasBlockingObject(session, tileIndexAt(session, x, y), condition)) {
            return false;
        }
        x += dx;
        y += dy;
    }
    return true;
}

inline bool hasClearAlignedTarget(
    const FullState& session,
    int32_t tile,
    const std::vector<int32_t>& targets,
    const WinCondition& condition
) {
    const int32_t x = tileX(session, tile);
    const int32_t y = tileY(session, tile);
    for (const int32_t target : targets) {
        if ((tileX(session, target) == x || tileY(session, target) == y)
            && clearPathBetween(session, tile, target, condition)) {
            return true;
        }
    }
    return false;
}

inline int32_t clearPathPenalty(
    const FullState& session,
    const std::vector<int32_t>& unsatisfied,
    const std::vector<int32_t>& targets,
    const WinCondition& condition,
    HeuristicScratch& scratch
) {
    if (targets.empty()) {
        return static_cast<int32_t>(unsatisfied.size()) * 16;
    }
    int32_t penalty = 0;
    buildTargetLinePresence(session, condition, scratch);
    for (const int32_t tile : unsatisfied) {
        const bool aligned =
            scratch.targetRowPresence[static_cast<size_t>(tileY(session, tile))] != 0
            || scratch.targetColumnPresence[static_cast<size_t>(tileX(session, tile))] != 0;
        if (!aligned) {
            penalty += 4;
        } else if (!hasClearAlignedTarget(session, tile, targets, condition)) {
            penalty += 2;
        }
    }
    return penalty;
}

inline void objectPresenceMask(const Game& game, const Pattern& pattern, MaskVector& mask) {
    mask.assign(game.wordCount, 0);
    orMaskInto(mask, maskPtr(game, pattern.objectsPresent), game.wordCount);
    for (uint32_t index = 0; index < pattern.anyObjectsCount; ++index) {
        const size_t offsetIndex = static_cast<size_t>(pattern.anyObjectsFirst + index);
        if (offsetIndex < game.anyObjectOffsets.size()) {
            orMaskInto(mask, maskPtr(game, game.anyObjectOffsets[offsetIndex]), game.wordCount);
        }
    }
}

inline bool cellMatchesMovement(const Pattern& pattern) {
    return pattern.hasMovementsPresent
        || pattern.anyMovementsCount > 0
        || !pattern.layerCoupledMovementMasks.empty();
}

inline bool cellChangesObjects(const Game& game, const Pattern& pattern) {
    if (!pattern.replacement.has_value()) {
        return false;
    }
    const Replacement& replacement = *pattern.replacement;
    return maskHasBits(maskPtr(game, replacement.objectsSet), game.wordCount)
        || maskHasBits(maskPtr(game, replacement.objectsClear), game.wordCount);
}

inline bool isCancelRule(const Rule& rule) {
    return std::any_of(rule.commands.begin(), rule.commands.end(), [](const RuleCommand& command) {
        return command.name == "cancel";
    });
}

inline void rowObjectsSetMask(const Game& game, const std::vector<Pattern>& row, MaskVector& mask) {
    mask.assign(game.wordCount, 0);
    for (const Pattern& pattern : row) {
        if (pattern.kind != Pattern::Kind::CellPattern || !pattern.replacement.has_value()) {
            continue;
        }
        orMaskInto(mask, maskPtr(game, pattern.replacement->objectsSet), game.wordCount);
    }
}

inline void actorMaskForCondition(const Game& game, const WinCondition& condition, MaskVector& actorMask) {
    actorMask.assign(game.wordCount, 0);
    const MaskWord* conditionMask = maskPtr(game, condition.filter1);
    orMaskInto(actorMask, conditionMask, game.wordCount);
    const MaskWord* playerMask = maskPtr(game, game.playerMask);
    if (conditionMask != nullptr
        && playerMask != nullptr
        && anyBits(conditionMask, game.wordCount, playerMask, game.wordCount)) {
        orMaskInto(actorMask, playerMask, game.wordCount);
    }
}

inline std::optional<MaskVector> inferStaticBlockerMask(
    const FullState& session,
    const WinCondition& condition,
    HeuristicScratch& scratch
) {
    const Game& game = *session.game;
    MaskVector blockers(game.wordCount, 0);
    MaskVector consumed(game.wordCount, 0);
    actorMaskForCondition(game, condition, scratch.maskScratchA);
    const MaskVector actorMask = scratch.maskScratchA;

    auto visitRuleGroups = [&](const std::vector<std::vector<Rule>>& groups) {
        for (const std::vector<Rule>& group : groups) {
            for (const Rule& rule : group) {
                const bool cancelRule = isCancelRule(rule);
                for (const std::vector<Pattern>& row : rule.patterns) {
                    rowObjectsSetMask(game, row, scratch.maskScratchB);
                    const MaskVector rowSet = scratch.maskScratchB;
                    for (size_t cellIndex = 0; cellIndex < row.size(); ++cellIndex) {
                        const Pattern& cell = row[cellIndex];
                        if (cell.kind != Pattern::Kind::CellPattern) {
                            continue;
                        }
                        objectPresenceMask(game, cell, scratch.maskScratchC);
                        const MaskVector cellPresent = scratch.maskScratchC;
                        if (!masksIntersect(cellPresent, actorMask)) {
                            continue;
                        }
                        const bool actorMoves = cellMatchesMovement(cell);
                        const bool actorChanges = cellChangesObjects(game, cell);
                        if (!actorMoves && !actorChanges && !cancelRule) {
                            continue;
                        }

                        for (const int neighborDelta : {-1, 1}) {
                            const int neighborIndex = static_cast<int>(cellIndex) + neighborDelta;
                            if (neighborIndex < 0 || neighborIndex >= static_cast<int>(row.size())) {
                                continue;
                            }
                            const Pattern& neighbor = row[static_cast<size_t>(neighborIndex)];
                            if (neighbor.kind != Pattern::Kind::CellPattern) {
                                continue;
                            }

                            if ((actorMoves || actorChanges)
                                && maskHasBits(maskPtr(game, neighbor.objectsMissing), game.wordCount)) {
                                orMaskInto(blockers, maskPtr(game, neighbor.objectsMissing), game.wordCount);
                            }

                            objectPresenceMask(game, neighbor, scratch.maskScratchC);
                            const MaskVector neighborPresent = scratch.maskScratchC;
                            if (neighbor.replacement.has_value() && maskHasBits(neighborPresent)) {
                                MaskVector cleared(game.wordCount, 0);
                                const MaskWord* objectsClear = maskPtr(game, neighbor.replacement->objectsClear);
                                for (uint32_t word = 0; word < game.wordCount; ++word) {
                                    const MaskWord clearWord = objectsClear != nullptr ? objectsClear[word] : 0;
                                    const MaskWord rowSetWord = word < rowSet.size() ? rowSet[word] : 0;
                                    cleared[word] = (neighborPresent[word] & clearWord) & ~rowSetWord;
                                }
                                if (maskHasBits(cleared)) {
                                    for (uint32_t word = 0; word < game.wordCount; ++word) {
                                        consumed[word] |= cleared[word];
                                    }
                                }
                            }

                            if (!maskHasBits(neighborPresent)) {
                                continue;
                            }
                            if (cancelRule) {
                                for (uint32_t word = 0; word < game.wordCount; ++word) {
                                    blockers[word] |= neighborPresent[word];
                                }
                            } else if (actorChanges && !cellChangesObjects(game, neighbor)) {
                                for (uint32_t word = 0; word < game.wordCount; ++word) {
                                    blockers[word] |= neighborPresent[word];
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    visitRuleGroups(game.rules);
    visitRuleGroups(game.lateRules);

    for (uint32_t word = 0; word < game.wordCount; ++word) {
        blockers[word] &= ~consumed[word];
    }
    clearMaskBits(blockers, maskPtr(game, condition.filter1), game.wordCount);
    clearMaskBits(blockers, maskPtr(game, condition.filter2), game.wordCount);
    clearMaskBits(blockers, maskPtr(game, game.playerMask), game.wordCount);
    if (!maskHasBits(blockers)) {
        return std::nullopt;
    }
    return blockers;
}

inline const StaticDeadCells& getStaticDeadCells(
    const FullState& session,
    size_t conditionIndex,
    HeuristicScratch& scratch
) {
    const Game& game = *session.game;
    if (scratch.staticDeadCells.size() < game.winConditions.size()) {
        scratch.staticDeadCells.resize(game.winConditions.size());
    }
    StaticDeadCells& entry = scratch.staticDeadCells[conditionIndex];
    if (entry.initialized) {
        return entry;
    }

    const WinCondition& condition = game.winConditions[conditionIndex];
    const int32_t width = currentLevelWidth(session);
    const int32_t height = currentLevelHeight(session);
    const int32_t tileCount = width * height;
    std::vector<uint8_t> blocked(static_cast<size_t>(tileCount), 0);
    const std::optional<MaskVector> blockerMask = inferStaticBlockerMask(session, condition, scratch);
    if (blockerMask.has_value()) {
        for (int32_t tile = 0; tile < tileCount; ++tile) {
            if (cellHasStaticBlockingObject(session, tile, condition, *blockerMask)) {
                blocked[static_cast<size_t>(tile)] = 1;
            }
        }
    }

    entry.corner.assign(static_cast<size_t>(tileCount), 0);
    entry.edge.assign(static_cast<size_t>(tileCount), 0);
    for (int32_t x = 0; x < width; ++x) {
        for (int32_t y = 0; y < height; ++y) {
            const int32_t tile = tileIndexAt(session, x, y);
            const bool left = x == 0 || blocked[static_cast<size_t>(tileIndexAt(session, x - 1, y))] != 0;
            const bool right = x == width - 1 || blocked[static_cast<size_t>(tileIndexAt(session, x + 1, y))] != 0;
            const bool up = y == 0 || blocked[static_cast<size_t>(tileIndexAt(session, x, y - 1))] != 0;
            const bool down = y == height - 1 || blocked[static_cast<size_t>(tileIndexAt(session, x, y + 1))] != 0;
            const bool horiz = left || right;
            const bool vert = up || down;
            if (horiz && vert) {
                entry.corner[static_cast<size_t>(tile)] = 1;
            } else if (horiz || vert) {
                entry.edge[static_cast<size_t>(tile)] = 1;
            }
        }
    }

    entry.componentId.assign(static_cast<size_t>(tileCount), -1);
    scratch.componentQueue.assign(static_cast<size_t>(tileCount), 0);
    int32_t componentCount = 0;
    for (int32_t start = 0; start < tileCount; ++start) {
        if (blocked[static_cast<size_t>(start)] != 0 || entry.componentId[static_cast<size_t>(start)] != -1) {
            continue;
        }
        const int32_t id = componentCount++;
        entry.componentId[static_cast<size_t>(start)] = id;
        size_t head = 0;
        size_t tail = 0;
        scratch.componentQueue[tail++] = start;
        while (head < tail) {
            const int32_t current = scratch.componentQueue[head++];
            const int32_t cx = tileX(session, current);
            const int32_t cy = tileY(session, current);
            auto addNeighbor = [&](int32_t nx, int32_t ny) {
                const int32_t neighbor = tileIndexAt(session, nx, ny);
                if (blocked[static_cast<size_t>(neighbor)] == 0
                    && entry.componentId[static_cast<size_t>(neighbor)] == -1) {
                    entry.componentId[static_cast<size_t>(neighbor)] = id;
                    scratch.componentQueue[tail++] = neighbor;
                }
            };
            if (cx > 0) addNeighbor(cx - 1, cy);
            if (cx + 1 < width) addNeighbor(cx + 1, cy);
            if (cy > 0) addNeighbor(cx, cy - 1);
            if (cy + 1 < height) addNeighbor(cx, cy + 1);
        }
    }
    entry.componentCount = componentCount;
    entry.initialized = true;
    return entry;
}

inline int32_t deadPositionPenalty(
    const FullState& session,
    size_t conditionIndex,
    const std::vector<int32_t>& unsatisfied,
    HeuristicScratch& scratch
) {
    const WinCondition& condition = session.game->winConditions[conditionIndex];
    buildTargetLinePresence(session, condition, scratch);
    const StaticDeadCells& dead = getStaticDeadCells(session, conditionIndex, scratch);
    int32_t penalty = 0;
    for (const int32_t tile : unsatisfied) {
        if (dead.corner[static_cast<size_t>(tile)] != 0) {
            penalty += 32;
        } else if (dead.edge[static_cast<size_t>(tile)] != 0
            && scratch.targetRowPresence[static_cast<size_t>(tileY(session, tile))] == 0
            && scratch.targetColumnPresence[static_cast<size_t>(tileX(session, tile))] == 0) {
            penalty += 8;
        }
    }
    return penalty;
}

inline int32_t regionIsolationPenalty(
    const FullState& session,
    size_t conditionIndex,
    const std::vector<int32_t>& unsatisfied,
    HeuristicScratch& scratch
) {
    const StaticDeadCells& dead = getStaticDeadCells(session, conditionIndex, scratch);
    if (dead.componentCount <= 1) {
        return 0;
    }
    const WinCondition& condition = session.game->winConditions[conditionIndex];
    collectMatchingTiles(
        session,
        maskPtr(*session.game, condition.filter2),
        condition.aggr2,
        scratch.matchingTiles);
    if (scratch.matchingTiles.empty()) {
        return 0;
    }
    std::vector<uint8_t> liveComponent(static_cast<size_t>(dead.componentCount), 0);
    for (const int32_t target : scratch.matchingTiles) {
        const int32_t component = dead.componentId[static_cast<size_t>(target)];
        if (component >= 0) {
            liveComponent[static_cast<size_t>(component)] = 1;
        }
    }
    int32_t isolated = 0;
    for (const int32_t tile : unsatisfied) {
        const int32_t component = dead.componentId[static_cast<size_t>(tile)];
        if (component >= 0 && liveComponent[static_cast<size_t>(component)] == 0) {
            ++isolated;
        }
    }
    return isolated * 256;
}

inline int32_t allOnClearPathHeuristicScore(const FullState& session, HeuristicScratch& scratch) {
    HeuristicOptions options;
    options.includeNoQuantifierPenalty = true;
    options.includePlayerDistance = true;
    const int32_t base = winConditionHeuristicScore(session, options, scratch);
    const Game& game = *session.game;
    if (base <= 0 || game.winConditions.size() != 1) {
        return base;
    }
    const WinCondition& condition = game.winConditions.front();
    if (!isAllOnNonPlainCondition(game, condition, scratch)) {
        return base;
    }
    collectUnsatisfiedAllOnTiles(session, condition, scratch.unsatisfiedTiles);
    collectMatchingTiles(session, maskPtr(game, condition.filter2), condition.aggr2, scratch.matchingTiles);
    return base + clearPathPenalty(session, scratch.unsatisfiedTiles, scratch.matchingTiles, condition, scratch);
}

inline int32_t autoWinConditionHeuristicScore(const FullState& session, HeuristicScratch& scratch) {
    const Game& game = *session.game;
    if (game.winConditions.empty()) {
        return 0;
    }
    const int32_t base = allOnClearPathHeuristicScore(session, scratch);
    if (base <= 0) {
        return base;
    }
    int32_t extra = 0;
    for (size_t index = 0; index < game.winConditions.size(); ++index) {
        const WinCondition& condition = game.winConditions[index];
        if (!isAllOnNonPlainCondition(game, condition, scratch)) {
            continue;
        }
        collectUnsatisfiedAllOnTiles(session, condition, scratch.unsatisfiedTiles);
        if (scratch.unsatisfiedTiles.empty()) {
            continue;
        }
        extra += deadPositionPenalty(session, index, scratch.unsatisfiedTiles, scratch);
        extra += regionIsolationPenalty(session, index, scratch.unsatisfiedTiles, scratch);
    }
    return base + extra;
}

inline int32_t winConditionHeuristicScore(const FullState& session, HeuristicOptions options = {}) {
    HeuristicScratch scratch;
    return winConditionHeuristicScore(session, options, scratch);
}

} // namespace puzzlescript::search
