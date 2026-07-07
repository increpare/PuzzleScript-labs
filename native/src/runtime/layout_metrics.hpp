#pragma once

#include "runtime/core.hpp"

namespace puzzlescript {

struct GameLayoutMetrics {
    int32_t objectCount = 0;
    int32_t layerCount = 0;
    uint32_t wordCount = 0;
    int32_t strideObject = 0;
    int32_t strideMovement = 0;
    uint64_t maskArenaWords = 0;
    uint64_t maskArenaBytes = 0;
    uint64_t ruleCount = 0;
    uint64_t lateRuleCount = 0;
    uint64_t maskSlotCount = 0;
    uint64_t uniqueMaskCount = 0;
    double maskArenaUtilization = 0.0;
    uint64_t maskReferenceSpanWords = 0;
    double maskReferenceSpanRatio = 0.0;
    int32_t firstBoardLevelIndex = -1;
    int32_t firstBoardWidth = 0;
    int32_t firstBoardHeight = 0;
    uint64_t boardObjectsBytes = 0;
};

GameLayoutMetrics computeGameLayoutMetrics(const Game& game);
std::string gameLayoutMetricsJson(const GameLayoutMetrics& metrics, const std::string& sourceName, bool compileOk);

} // namespace puzzlescript
