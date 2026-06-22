#pragma once

#include "runtime/core.hpp"

#include "puzzlescript/puzzlescript.h"

#include <string>
#include <vector>

namespace puzzlescript::generator {

// Column-major tile index: tile = x * height + y (width x height grid).
inline int32_t tileIndexColumnMajor(int32_t x, int32_t y, int32_t height) {
    return x * height + y;
}

std::vector<std::string> levelTemplateToRows(const Game& game, const LevelTemplate& level);

std::string formatGroupedSolution(const std::vector<ps_input>& solution, bool includeAction);

} // namespace puzzlescript::generator
