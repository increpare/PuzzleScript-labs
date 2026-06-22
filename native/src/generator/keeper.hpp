#pragma once

#include "runtime/core.hpp"

#include "puzzlescript/puzzlescript.h"

#include <cstdint>
#include <string>
#include <vector>

namespace puzzlescript::generator {

struct Keeper {
    uint64_t levelHash = 0;
    int64_t difficulty = 0;
    int64_t expandedPortfolio = 0;
    uint64_t sampleSeed = 0;
    size_t blockIndex = 0;
    std::string blockName;
    std::string dimensionsLabel;
    std::vector<ps_input> solution;
    LevelTemplate level;
};

inline std::string dimensionsLabel(int32_t width, int32_t height) {
    return std::to_string(width) + "x" + std::to_string(height);
}

} // namespace puzzlescript::generator
