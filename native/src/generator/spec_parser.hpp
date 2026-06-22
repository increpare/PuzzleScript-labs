#pragma once

#include "runtime/core.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace puzzlescript::generator {

struct LegacySpec {
    std::vector<std::string> initRows;
    std::vector<std::string> ruleLines;
};

struct BlockHeader {
    int32_t width = 0;
    int32_t height = 0;
    size_t take = 1;
    std::string name;
    std::optional<uint64_t> seed;
};

struct BlockSpec {
    BlockHeader header;
    LevelTemplate initLevel;
    std::vector<std::string> ruleLines;
};

LevelTemplate synthesizeBackgroundGrid(const Game& game, int32_t width, int32_t height);

LegacySpec parseLegacySpec(const std::string& text);
std::vector<BlockSpec> parseLevelSetSpec(const std::string& text, const Game& game);

} // namespace puzzlescript::generator
