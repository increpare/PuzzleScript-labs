#pragma once

#include "compiler/diagnostic.hpp"
#include "compiler/types/parser_state.hpp"

namespace puzzlescript::compiler {
struct ParsedRuleGroup {
    int32_t lineNumber;
    int32_t groupNumber;
};
// Structurally accepted rules, with source groups shared across early/late phases.
std::vector<ParsedRuleGroup> parseRuleGroups(const ParserState& state);
// Returns false when malformed row shapes prevent later compiler stages.
bool runRuleDiagnostics(const ParserState& state, DiagnosticSink& diagnostics);
}
