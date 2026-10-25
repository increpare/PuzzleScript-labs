#pragma once

#include "compiler/diagnostic.hpp"
#include "compiler/types/parser_state.hpp"

namespace puzzlescript::compiler {
// Returns false when malformed row shapes prevent later compiler stages.
bool runRuleDiagnostics(const ParserState& state, DiagnosticSink& diagnostics);
}
