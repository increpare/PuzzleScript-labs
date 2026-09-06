#undef NDEBUG
#include "generation_random.h"

#include <cassert>
#include <cstdlib>

int main() {
    std::srand(17);
    for (int i = 0; i < 10000; ++i) {
        assert(!generationOptionApplies(0.0));
        assert(generationOptionApplies(1.0));
    }
    int accepted = 0;
    for (int i = 0; i < 100000; ++i) {
        accepted += generationOptionApplies(0.25) ? 1 : 0;
    }
    // Wide enough for different C-library RNG streams; integer division
    // accepts almost all draws and fails by a very large margin.
    assert(accepted > 23000 && accepted < 27000);
}
