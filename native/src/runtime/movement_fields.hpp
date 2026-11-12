#pragma once

#include "runtime/core.hpp"

namespace puzzlescript::interpreter {

// Five-bit movement fields can straddle a mask-word boundary. A missing high
// word contributes zero, just as it does in the vector-based bit operations.
inline int32_t readMovementField5(const MaskWord* words, uint32_t wordCount, int32_t layerIndex) {
    if (words == nullptr || layerIndex < 0) return 0;
    const uint64_t shift = uint64_t{5} * static_cast<uint32_t>(layerIndex);
    const uint64_t word = shift / kMaskWordBits;
    const uint32_t bit = static_cast<uint32_t>(shift & kMaskWordBitMask);
    if (word >= wordCount) return 0;
    MaskWordUnsigned result = static_cast<MaskWordUnsigned>(words[word]) >> bit;
    if (bit > kMaskWordBits - 5U && word + 1 < wordCount) {
        result |= static_cast<MaskWordUnsigned>(words[word + 1]) << (kMaskWordBits - bit);
    }
    return static_cast<int32_t>(result & 0x1F);
}

} // namespace puzzlescript::interpreter
