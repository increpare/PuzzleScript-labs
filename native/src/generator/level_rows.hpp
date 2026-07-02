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

struct SupplementalGlyph {
    std::string glyph;
    std::string legendLine;
};

std::vector<std::string> levelTemplateToRows(const Game& game, const LevelTemplate& level);

// True when every tile's object mask matches a legend glyph exactly (no dropped objects).
bool canLosslesslySerializeLevel(const Game& game, const LevelTemplate& level);

// Adds legend glyphs for cell masks in `level` that are not yet exactly representable.
// Mutates `game` glyph tables and returns the new legend lines to append to source.
std::vector<SupplementalGlyph> ensureSupplementalGlyphs(Game& game, const LevelTemplate& level);

std::string formatGroupedSolution(const std::vector<ps_input>& solution, bool includeAction);

} // namespace puzzlescript::generator
