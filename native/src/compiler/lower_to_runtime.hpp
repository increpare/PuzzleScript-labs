#pragma once

#include <memory>
#include <vector>

#include "compiler/types/parser_state.hpp"
#include "compiler/types/semantic_program.hpp"
#include "runtime/core.hpp"

namespace puzzlescript::compiler {

struct LowerToRuntimeOptions {
    // Generated compact kernels currently operate on concrete object masks.
    // Host runtimes may coalesce property aliases and resolve them dynamically.
    bool coalesceProperties = true;
};

// Lower a parsed PuzzleScript program into a runnable native runtime Game.
//
// This is the missing “native compiler” stage: ParserState -> runtime::Game.
// It must preserve JS semantics (including RNG behavior and rule ordering) so
// the existing JS test corpus can be used as a correctness gate.
std::unique_ptr<puzzlescript::Error> lowerToRuntimeGame(
    const ParserState& state,
    puzzlescript::LoadedGame& outGame,
    std::vector<SemanticRule>* outAuthoredRules = nullptr,
    LowerToRuntimeOptions options = {}
);

} // namespace puzzlescript::compiler
