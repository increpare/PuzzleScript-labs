#include "compiler/parser_glyphs.hpp"

#include <algorithm>
#include <set>
#include <vector>

namespace puzzlescript::compiler {
namespace {

bool maskHasAnyBit(const MaskVector& mask) {
    return std::any_of(mask.begin(), mask.end(), [](MaskWord word) {
        return word != 0;
    });
}

void setMaskBit(MaskVector& mask, int32_t objectId) {
    if (objectId < 0) {
        return;
    }
    const uint32_t word = maskWordIndex(static_cast<uint32_t>(objectId));
    if (word >= mask.size()) {
        return;
    }
    mask[static_cast<size_t>(word)] |= maskBit(static_cast<uint32_t>(objectId));
}

void orMaskInto(MaskVector& target, const MaskVector& source) {
    const size_t count = std::min(target.size(), source.size());
    for (size_t index = 0; index < count; ++index) {
        target[index] |= source[index];
    }
}

MaskOffset storeMaskWords(Game& game, const MaskVector& words) {
    const auto offset = static_cast<MaskOffset>(game.maskArena.size());
    game.maskArena.insert(game.maskArena.end(), words.begin(), words.end());
    return offset;
}

MaskVector resolveParserGlyphMask(
    const Game& game,
    const ParserState& parserState,
    const std::string& name,
    std::set<std::string>& visiting) {
    MaskVector mask(static_cast<size_t>(game.wordCount), 0);
    if (!visiting.insert(name).second) {
        return mask;
    }

    if (parserState.objects.find(name) != parserState.objects.end()) {
        for (const auto& object : game.objectsById) {
            if (object.name == name) {
                setMaskBit(mask, object.id);
                break;
            }
        }
        visiting.erase(name);
        return mask;
    }

    for (const auto& entry : parserState.legendSynonyms) {
        if (entry.name == name && !entry.items.empty()) {
            mask = resolveParserGlyphMask(game, parserState, entry.items.front(), visiting);
            visiting.erase(name);
            return mask;
        }
    }

    for (const auto& entry : parserState.legendAggregates) {
        if (entry.name != name) {
            continue;
        }
        for (const auto& item : entry.items) {
            orMaskInto(mask, resolveParserGlyphMask(game, parserState, item, visiting));
        }
        visiting.erase(name);
        return mask;
    }

    visiting.erase(name);
    return mask;
}

} // namespace

void publishParserGlyphs(Game& game, const ParserState& parserState) {
    game.glyphOrder.clear();
    game.glyphMaskTable.clear();
    game.glyphOrder.reserve(parserState.abbrevNames.size());
    game.glyphMaskTable.reserve(parserState.abbrevNames.size());

    for (const std::string& name : parserState.abbrevNames) {
        std::set<std::string> visiting;
        MaskVector mask = resolveParserGlyphMask(game, parserState, name, visiting);
        if (!maskHasAnyBit(mask)) {
            continue;
        }
        game.glyphOrder.push_back(name);
        game.glyphMaskTable.push_back({name, storeMaskWords(game, mask)});
    }
}

} // namespace puzzlescript::compiler
