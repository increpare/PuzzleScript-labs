#pragma once

#include <string>

#include "compiler/types/semantic_program.hpp"
#include "runtime/core.hpp"

namespace puzzlescript::compiler {

// Projects a resolved SemanticProgram out of an already-lowered runtime Game.
// A later slice can replace this producer while keeping the contract unchanged.
SemanticProgram buildSemanticProgram(
    const puzzlescript::Game& game,
    const std::vector<SemanticRule>& authoredRules = {}
);

std::string serializeSemanticProgramJson(const SemanticProgram& program);

} // namespace puzzlescript::compiler
