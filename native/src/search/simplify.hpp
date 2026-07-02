#pragma once

#include "runtime/core.hpp"

#include "puzzlescript/puzzlescript.h"

#include <cstdint>
#include <vector>

namespace puzzlescript::search {

struct SimplifyOptions {
    int64_t bfsTimeoutMs = 5000;
    uint64_t bfsMaxExpanded = 0;
    double bfsExpandedFactor = 2.0;
    bool useTraceBatch = true;
};

struct SimplifyResult {
    LevelTemplate level;
    int32_t optimalLength = -1;
    int64_t baselineExpanded = -1;
    int32_t objectsRemoved = 0;
    int32_t candidatesTried = 0;
    int32_t replayRejections = 0;
    int32_t bfsRejections = 0;
    int32_t bfsCalls = 0;
    bool complete = false;
};

bool gameUsesRandomRules(const Game& game);

bool replaySolutionWins(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& inputs);

SimplifyResult simplifyLevel(
    const LoadedGame& loadedGame,
    const LevelTemplate& level,
    const std::vector<ps_input>& referenceSolution,
    const SimplifyOptions& options);

} // namespace puzzlescript::search
