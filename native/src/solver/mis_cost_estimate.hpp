#pragma once

#include <algorithm>
#include <cstdint>
#include <limits>
#include <vector>

#include "runtime/core.hpp"
#include "search/search_common.hpp"

namespace puzzlescript::solver {

// Port of PuzzleScript+MIS `costEstimateFromGoal`
// (tools/puzzlescriptmis-app/src/solver.cpp), with three deliberate deviations:
//   * Deterministic LHS order. The original shuffled `lindices` "to avoid skew";
//     a search heuristic must be reproducible, so we keep natural tile order.
//   * Empty-set guard on "some X on Y". The original added FLT_MAX into an int
//     estimate when either side was absent; we add 0.
//   * "all X on Y" LHS counts only unsatisfied cells (X && !Y) instead of every
//     X cell (already-satisfied cells would otherwise compete for near targets).
// These shift the absolute difficulty numbers slightly versus the pre-native
// metric but preserve its shape (a distance-to-goal lower bound).
//
// `plainByCondition[i]` (whether win condition `i` had no explicit ON clause) is
// precomputed once by the owning HeuristicContext and passed in, so this hot
// per-node call does not rebuild an all-objects mask every time it runs.
inline int32_t misCostEstimateScore(
    const Game& game,
    int32_t width,
    int32_t height,
    const MaskWord* board,
    const std::vector<bool>& plainByCondition) {
    if (board == nullptr || game.winConditions.empty()) {
        return 0;
    }

    const int32_t tileCount = width * height;
    const int32_t stride = game.strideObject;
    int32_t estimate = 0;

    auto cellAt = [&](int32_t tile) {
        return board + static_cast<size_t>(tile) * static_cast<size_t>(stride);
    };
    auto tileX = [&](int32_t tile) { return tile / height; };
    auto tileY = [&](int32_t tile) { return tile % height; };
    auto manhattanTiles = [&](int32_t left, int32_t right) {
        return std::abs(tileX(left) - tileX(right)) + std::abs(tileY(left) - tileY(right));
    };

    std::vector<int32_t> lhsTiles;
    std::vector<int32_t> rhsTiles;
    std::vector<int32_t> lhsOrder;

    for (size_t conditionIndex = 0; conditionIndex < game.winConditions.size(); ++conditionIndex) {
        const WinCondition& condition = game.winConditions[conditionIndex];
        const MaskWord* filter1 = search::maskPtr(game, condition.filter1);
        const MaskWord* filter2 = search::maskPtr(game, condition.filter2);
        if (filter1 == nullptr || filter2 == nullptr) {
            continue;
        }
        const bool plain2 = conditionIndex < plainByCondition.size()
            && plainByCondition[conditionIndex];

        if (condition.quantifier == -1 && plain2) {
            for (int32_t tile = 0; tile < tileCount; ++tile) {
                if (search::matchesFilter(filter1, game.wordCount, condition.aggr1, cellAt(tile))) {
                    ++estimate;
                }
            }
        } else if (condition.quantifier == -1) {
            for (int32_t tile = 0; tile < tileCount; ++tile) {
                const MaskWord* cell = cellAt(tile);
                if (search::matchesFilter(filter1, game.wordCount, condition.aggr1, cell)
                    && search::matchesFilter(filter2, game.wordCount, condition.aggr2, cell)) {
                    ++estimate;
                }
            }
        } else if (condition.quantifier == 0 && plain2) {
            bool found = false;
            for (int32_t tile = 0; tile < tileCount && !found; ++tile) {
                if (search::matchesFilter(filter1, game.wordCount, condition.aggr1, cellAt(tile))) {
                    found = true;
                }
            }
            if (!found) {
                ++estimate;
            }
        } else if (condition.quantifier == 0) {
            lhsTiles.clear();
            rhsTiles.clear();
            for (int32_t tile = 0; tile < tileCount; ++tile) {
                const MaskWord* cell = cellAt(tile);
                if (search::matchesFilter(filter1, game.wordCount, condition.aggr1, cell)) {
                    lhsTiles.push_back(tile);
                }
                if (search::matchesFilter(filter2, game.wordCount, condition.aggr2, cell)) {
                    rhsTiles.push_back(tile);
                }
            }
            int32_t minDist = std::numeric_limits<int32_t>::max();
            for (const int32_t lhs : lhsTiles) {
                for (const int32_t rhs : rhsTiles) {
                    minDist = std::min(minDist, manhattanTiles(lhs, rhs));
                }
            }
            if (!lhsTiles.empty() && !rhsTiles.empty() && minDist != std::numeric_limits<int32_t>::max()) {
                estimate += minDist;
            }
        } else if (condition.quantifier == 1 && !plain2) {
            lhsTiles.clear();
            rhsTiles.clear();
            for (int32_t tile = 0; tile < tileCount; ++tile) {
                const MaskWord* cell = cellAt(tile);
                if (search::matchesFilter(filter1, game.wordCount, condition.aggr1, cell)
                    && !search::matchesFilter(filter2, game.wordCount, condition.aggr2, cell)) {
                    lhsTiles.push_back(tile);
                }
                if (search::matchesFilter(filter2, game.wordCount, condition.aggr2, cell)) {
                    rhsTiles.push_back(tile);
                }
            }

            lhsOrder.resize(lhsTiles.size());
            for (size_t index = 0; index < lhsTiles.size(); ++index) {
                lhsOrder[index] = static_cast<int32_t>(index);
            }

            std::vector<uint8_t> taken(rhsTiles.size(), 0);
            for (const int32_t lhsIndex : lhsOrder) {
                int32_t minDist = 10000000;
                int prevTaken = -1;
                for (size_t rhsIndex = 0; rhsIndex < rhsTiles.size(); ++rhsIndex) {
                    if (taken[rhsIndex]) {
                        continue;
                    }
                    const int32_t dist = manhattanTiles(
                        lhsTiles[static_cast<size_t>(lhsIndex)],
                        rhsTiles[rhsIndex]);
                    if (dist < minDist) {
                        minDist = dist;
                        taken[rhsIndex] = 1;
                        if (prevTaken >= 0) {
                            taken[static_cast<size_t>(prevTaken)] = 0;
                        }
                        prevTaken = static_cast<int>(rhsIndex);
                    }
                }
                if (minDist < 10000000) {
                    estimate += minDist;
                }
            }
        }
    }

    return estimate;
}

} // namespace puzzlescript::solver
