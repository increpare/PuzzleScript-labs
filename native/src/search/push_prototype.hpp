#pragma once
#include "puzzlescript/puzzlescript.h"
#include <cstdint>
#include <string>
#include <vector>

namespace puzzlescript::search {
struct PushPrototypeResult {
    bool supported = false;
    ps_solve_status status = PS_SOLVE_STATUS_ERROR;
    std::string reason;
    uint64_t expanded = 0, pushes = 0;
    std::vector<ps_input> solution;
};
// Experimental, deliberately separate from production portfolios and scoring.
// Unsupported games use the generic solver; supported games minimize pushes,
// not keypresses. Every returned solution is replayed by the normal runtime.
PushPrototypeResult solvePushPrototype(const std::string& source, size_t levelIndex,
    int64_t timeoutMs = 5000, size_t maxNodes = 200000);
}
