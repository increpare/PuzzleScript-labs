#pragma once

#include "runtime/core.hpp"

#include <memory>
#include <mutex>

namespace puzzlescript::solver { struct StaticAnalysisHints; }

struct ps_solver_hint_cache {
    std::once_flag once;
    std::shared_ptr<const puzzlescript::solver::StaticAnalysisHints> hints;
};

struct ps_game {
    puzzlescript::LoadedGame impl;
    // Public game handles are immutable after loading. Share their game-scoped
    // solver proofs across generated-board searches, including concurrent calls.
    std::shared_ptr<ps_solver_hint_cache> solverHintCache = std::make_shared<ps_solver_hint_cache>();
};

struct ps_full_state {
    std::unique_ptr<puzzlescript::FullState> impl;
    puzzlescript::TurnResult lastTurnResult;
};

struct ps_compile_result {
    std::unique_ptr<puzzlescript::CompileResult> impl;
};

struct ps_error {
    std::unique_ptr<puzzlescript::Error> impl;
};
