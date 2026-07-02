#include "generator/level_rows.hpp"

#include "search/search_common.hpp"

#include <algorithm>
#include <sstream>
#include <stdexcept>
#include <unordered_set>

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

bool masksEqual(const MaskWord* lhs, const MaskWord* rhs, uint32_t wordCount) {
    for (uint32_t index = 0; index < wordCount; ++index) {
        if (lhs[index] != rhs[index]) {
            return false;
        }
    }
    return true;
}

bool isAllZeroMask(const MaskWord* cell, uint32_t wordCount) {
    for (uint32_t index = 0; index < wordCount; ++index) {
        if (cell[index] != 0) {
            return false;
        }
    }
    return true;
}

bool cellHasExactGlyph(const Game& game, const MaskWord* cell) {
    if (isAllZeroMask(cell, game.wordCount)) {
        return true;
    }
    for (const std::string& glyph : game.glyphOrder) {
        const MaskWord* glyphMask = glyphMaskForName(game, glyph);
        if (glyphMask == nullptr) {
            continue;
        }
        if (masksEqual(glyphMask, cell, game.wordCount)) {
            return true;
        }
    }
    return false;
}

MaskVector maskVectorFromCell(const MaskWord* cell, uint32_t wordCount) {
    MaskVector mask(static_cast<size_t>(wordCount));
    for (uint32_t index = 0; index < wordCount; ++index) {
        mask[index] = cell[index];
    }
    return mask;
}

bool maskIsEmpty(const MaskVector& mask) {
    return std::all_of(mask.begin(), mask.end(), [](MaskWord word) {
        return word == 0;
    });
}

std::vector<int32_t> objectIdsInMask(const Game& game, const MaskVector& mask) {
    std::vector<int32_t> objectIds;
    for (int32_t objectId = 0; objectId < game.objectCount; ++objectId) {
        const uint32_t word = puzzlescript::maskWordIndex(static_cast<uint32_t>(objectId));
        if (word >= mask.size()) {
            continue;
        }
        if ((mask[word] & puzzlescript::maskBit(static_cast<uint32_t>(objectId))) != 0) {
            objectIds.push_back(objectId);
        }
    }
    std::sort(objectIds.begin(), objectIds.end(), [&](int32_t lhs, int32_t rhs) {
        return game.objectsById[static_cast<size_t>(lhs)].name
            < game.objectsById[static_cast<size_t>(rhs)].name;
    });
    return objectIds;
}

std::string formatAggregateLegendRhs(const Game& game, const std::vector<int32_t>& objectIds) {
    std::ostringstream rhs;
    for (size_t index = 0; index < objectIds.size(); ++index) {
        if (index > 0) {
            rhs << " and ";
        }
        rhs << game.objectsById[static_cast<size_t>(objectIds[index])].name;
    }
    return rhs.str();
}

std::string pickUnusedGlyph(const Game& game) {
    static constexpr const char* kGlyphPool =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?@%^*-_+=:;\"',.";
    std::unordered_set<std::string> used(game.glyphOrder.begin(), game.glyphOrder.end());
    for (const char* cursor = kGlyphPool; *cursor != '\0'; ++cursor) {
        const std::string glyph(1, *cursor);
        if (used.find(glyph) == used.end()) {
            return glyph;
        }
    }
    for (int32_t index = 0; index < 10000; ++index) {
        const std::string glyph = "+g" + std::to_string(index);
        if (used.find(glyph) == used.end()) {
            return glyph;
        }
    }
    throw std::runtime_error("No unused legend glyph characters remain");
}

MaskOffset storeMaskWords(Game& game, const MaskVector& words) {
    const auto offset = static_cast<MaskOffset>(game.maskArena.size());
    game.maskArena.insert(game.maskArena.end(), words.begin(), words.end());
    return offset;
}

bool maskVectorsEqual(const MaskVector& lhs, const MaskVector& rhs) {
    if (lhs.size() != rhs.size()) {
        return false;
    }
    return std::equal(lhs.begin(), lhs.end(), rhs.begin());
}

bool maskAlreadyRepresented(const Game& game, const MaskVector& mask) {
    for (const std::string& glyph : game.glyphOrder) {
        const MaskWord* glyphMask = glyphMaskForName(game, glyph);
        if (glyphMask == nullptr) {
            continue;
        }
        MaskVector existing = maskVectorFromCell(glyphMask, game.wordCount);
        if (maskVectorsEqual(existing, mask)) {
            return true;
        }
    }
    return false;
}

} // namespace

bool canLosslesslySerializeLevel(const Game& game, const LevelTemplate& level) {
    if (level.width <= 0 || level.height <= 0) {
        return false;
    }
    const int32_t tileCount = level.width * level.height;
    const size_t expectedWords = static_cast<size_t>(tileCount * game.strideObject);
    if (level.objects.size() != expectedWords) {
        return false;
    }
    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {
        if (!cellHasExactGlyph(game, cellPtr(level, game, tileIndex))) {
            return false;
        }
    }
    return true;
}

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

std::vector<SupplementalGlyph> ensureSupplementalGlyphs(Game& game, const LevelTemplate& level) {
    if (level.width <= 0 || level.height <= 0) {
        return {};
    }

    const int32_t tileCount = level.width * level.height;
    const size_t expectedWords = static_cast<size_t>(tileCount * game.strideObject);
    if (level.objects.size() != expectedWords) {
        return {};
    }

    std::vector<MaskVector> missingMasks;
    for (int32_t tileIndex = 0; tileIndex < tileCount; ++tileIndex) {
        const MaskWord* cell = cellPtr(level, game, tileIndex);
        if (cellHasExactGlyph(game, cell)) {
            continue;
        }
        MaskVector mask = maskVectorFromCell(cell, game.wordCount);
        if (maskIsEmpty(mask)) {
            continue;
        }
        if (maskAlreadyRepresented(game, mask)) {
            continue;
        }
        if (std::any_of(missingMasks.begin(), missingMasks.end(), [&](const MaskVector& existing) {
                return maskVectorsEqual(existing, mask);
            })) {
            continue;
        }
        missingMasks.push_back(std::move(mask));
    }

    std::vector<SupplementalGlyph> added;
    added.reserve(missingMasks.size());
    for (const MaskVector& mask : missingMasks) {
        const std::vector<int32_t> objectIds = objectIdsInMask(game, mask);
        if (objectIds.empty()) {
            continue;
        }
        SupplementalGlyph entry;
        entry.glyph = pickUnusedGlyph(game);
        entry.legendLine = entry.glyph + " = " + formatAggregateLegendRhs(game, objectIds);
        const MaskOffset offset = storeMaskWords(game, mask);
        game.glyphOrder.push_back(entry.glyph);
        game.glyphMaskTable.push_back({entry.glyph, offset});
        added.push_back(std::move(entry));
    }
    return added;
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
