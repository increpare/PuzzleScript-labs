#include <cstdint>

namespace puzzlescript {

enum class RuntimeCounterId;

bool runtimeCountersEnabled() {
    return false;
}

uint64_t runtimeCounterNowNs() {
    return 0;
}

void addRuntimeCounter(RuntimeCounterId, uint64_t) {}

bool inputSpecializationEnabled() {
    return true;
}

uint8_t inputSpecializationMaskForDirectionMask(int32_t directionMask) {
    switch (directionMask) {
        case 1: return 1U << 0;
        case 4: return 1U << 1;
        case 2: return 1U << 2;
        case 8: return 1U << 3;
        case 16: return 1U << 4;
        default: return 1U << 5;
    }
}

} // namespace puzzlescript
