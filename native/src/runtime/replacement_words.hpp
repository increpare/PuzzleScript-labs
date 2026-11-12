#pragma once

#include "runtime/core.hpp"

namespace puzzlescript::interpreter {

// Small bitsets avoid per-pattern allocations; dense, dynamic and very wide
// replacements keep the ordinary full-width path.
inline void prepareReplacementWordPlan(const Game& game, Replacement& replacement) {
    replacement.hasStaticWordPlan = false;
    replacement.staticObjectWords = 0;
    replacement.staticMovementWords = 0;
    if (replacement.dynamic || replacement.hasRandomEntityMask || replacement.hasRandomDirMask
        || game.wordCount > 8 || game.movementWordCount > 16
        || game.wordCount + game.movementWordCount < 4) return;
    const auto activeWords = [&game](std::initializer_list<MaskOffset> offsets, uint32_t width, uint32_t& bits) {
        for (MaskOffset offset : offsets) {
            if (offset == kNullMaskOffset) continue;
            if (uint64_t{offset} + width > game.maskArena.size()) return false;
            for (uint32_t word = 0; word < width; ++word) {
                if (game.maskArena[offset + word] != 0) bits |= uint32_t{1} << word;
            }
        }
        return true;
    };
    uint32_t objectWords = 0, movementWords = 0;
    if (!activeWords({replacement.objectsClear, replacement.objectsSet}, game.wordCount, objectWords)
        || !activeWords({replacement.movementsClear, replacement.movementsSet,
                         replacement.hasMovementsLayerMask ? replacement.movementsLayerMask : kNullMaskOffset},
                        game.movementWordCount, movementWords)) return;
    if (2 * (maskWordPopcount(objectWords) + maskWordPopcount(movementWords))
        > game.wordCount + game.movementWordCount) return;
    replacement.staticObjectWords = static_cast<uint8_t>(objectWords);
    replacement.staticMovementWords = static_cast<uint16_t>(movementWords);
    replacement.hasStaticWordPlan = true;
}

} // namespace puzzlescript::interpreter
