#include "generator/level_rows.hpp"

#include "search/search_common.hpp"

#include <algorithm>
#include <sstream>
#include <stdexcept>

namespace puzzlescript::generator {
namespace {

using puzzlescript::search::bitsSet;
using puzzlescript::search::maskPtr;

const MaskWord* cellPtr(const LevelTemplate& level, const Game& game, int32_t tileIndex) {
    return level.objects.data() + static_cast<size_t>(tileIndex * game.strideObject);
}

const MaskWord* glyphMaskForName(const Game& game, const std::string& glyphName) {
    for (const auto& entry : game.glyphMaskTable) {
        if (entry.name == glyphName) {
            return maskPtr(game, entry.offset);
        }
    }
    return nullptr;
}

bool maskHasObjectId(const MaskWord* mask, uint32_t wordCount, int32_t objectId) {
    if (mask == nullptr || objectId < 0) {
        return false;
    }
    const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
    if (word >= wordCount) {
        return false;
    }
    return (mask[word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) != 0;
}

bool anyCellBit(const MaskWord* mask, uint32_t wordCount, const MaskWord* cell, uint32_t cellCount) {
    const uint32_t count = std::min(wordCount, cellCount);
    for (uint32_t index = 0; index < count; ++index) {
        if ((mask[index] & cell[index]) != 0) {
            return true;
        }
    }
    return false;
}

bool isBackgroundGlyph(const Game& game, const MaskWord* glyphMask) {
    return game.backgroundId >= 0 && maskHasObjectId(glyphMask, game.wordCount, game.backgroundId);
}

int countMaskBits(const MaskWord* mask, uint32_t wordCount) {
    int count = 0;
    for (uint32_t index = 0; index < wordCount; ++index) {
        MaskWord word = mask[index];
        while (word != 0) {
            count += static_cast<int>(word & 1u);
            word >>= 1;
        }
    }
    return count;
}

char glyphForCell(const Game& game, const LevelTemplate& level, int32_t tileIndex) {
    const MaskWord* cell = cellPtr(level, game, tileIndex);
    char bestGlyph = '.';
    int bestBits = -1;

    auto considerGlyph = [&](const std::string& glyph, const MaskWord* glyphMask, bool skipBackground) {
        if (glyph.empty() || glyphMask == nullptr) {
            return;
        }
        if (skipBackground && isBackgroundGlyph(game, glyphMask)) {
            return;
        }
        if (!bitsSet(glyphMask, game.wordCount, cell, game.wordCount)) {
            return;
        }
        const int bits = countMaskBits(glyphMask, game.wordCount);
        if (bits > bestBits) {
            bestBits = bits;
            bestGlyph = glyph.front();
        }
    };

    for (const std::string& glyph : game.glyphOrder) {
        considerGlyph(glyph, glyphMaskForName(game, glyph), true);
    }
    if (bestBits < 0) {
        for (const std::string& glyph : game.glyphOrder) {
            considerGlyph(glyph, glyphMaskForName(game, glyph), false);
        }
    }
    return bestBits < 0 ? '.' : bestGlyph;
}

char inputToCompactChar(ps_input input) {
    switch (input) {
        case PS_INPUT_UP: return 'U';
        case PS_INPUT_DOWN: return 'D';
        case PS_INPUT_LEFT: return 'L';
        case PS_INPUT_RIGHT: return 'R';
        case PS_INPUT_ACTION: return 'A';
        default: return '?';
    }
}

} // namespace

std::vector<std::string> levelTemplateToRows(const Game& game, const LevelTemplate& level) {
    if (level.width <= 0 || level.height <= 0) {
        throw std::runtime_error("levelTemplateToRows requires positive dimensions");
    }

    std::vector<std::string> rows;
    rows.reserve(static_cast<size_t>(level.height));
    for (int32_t y = 0; y < level.height; ++y) {
        std::string row;
        row.reserve(static_cast<size_t>(level.width));
        for (int32_t x = 0; x < level.width; ++x) {
            const int32_t tile = tileIndexColumnMajor(x, y, level.height);
            row.push_back(glyphForCell(game, level, tile));
        }
        rows.push_back(std::move(row));
    }
    return rows;
}

std::string formatGroupedSolution(const std::vector<ps_input>& solution, bool includeAction) {
    std::string compact;
    compact.reserve(solution.size());
    for (const ps_input input : solution) {
        if (input == PS_INPUT_ACTION && !includeAction) {
            continue;
        }
        compact.push_back(inputToCompactChar(input));
    }

    std::ostringstream out;
    for (size_t index = 0; index < compact.size(); ++index) {
        if (index > 0) {
            if (index % 4 == 0) {
                out << ' ';
            }
        }
        out << compact[index];
    }
    return out.str();
}

} // namespace puzzlescript::generator
