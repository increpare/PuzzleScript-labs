#pragma once

#include "runtime/core.hpp"

#include <memory>

struct ps_game {
    puzzlescript::LoadedGame impl;
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
