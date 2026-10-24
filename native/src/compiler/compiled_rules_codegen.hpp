#pragma once

#include <cstddef>
#include <iosfwd>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "runtime/core.hpp"

namespace puzzlescript::compiler {

struct CompiledRulesOptions {
    size_t maxRows = 1;
    bool solverProfile = false;
};

struct SpecializedFullTurnSupport {
    // These are the generated top-level early/late rule loops: they sequence
    // rulegroups and preserve BEGIN LOOP / END LOOP loop-point jumps.
    bool earlyRuleLoopsGenerated = false;
    bool lateRuleLoopsGenerated = false;
    std::string commandStatus = "unknown_interpreter";
    bool wholeTurnSupported = false;
    std::string wholeTurnFallbackReason = "interpreter_delegation";
};

bool isCompilableReplacement(const Replacement& replacement);
std::string cppStringLiteral(std::string_view value);
std::string safeCppIdentifier(std::string_view value);
std::string compiledMaskWordLiteral(MaskWord word);
std::vector<MaskWord> compiledMaskWords(const Game& game, MaskOffset offset, uint32_t wordCount);
std::string compiledRuleMissReason(const Rule& rule, const CompiledRulesOptions& options, bool allowRandomRule = false);
bool isCompilableRule(const Rule& rule, const CompiledRulesOptions& options);
std::string compiledGroupMissReason(const std::vector<Rule>& group, const CompiledRulesOptions& options);
bool isCompilableGroup(const std::vector<Rule>& group, const CompiledRulesOptions& options);
bool areAllGroupsCompilable(const std::vector<std::vector<Rule>>& groups, const CompiledRulesOptions& options);

// Conservative match-interaction certificates for the concrete runtime masks.
// Dynamic bindings, random writes and rigid rules keep their original schedule.
struct CompiledRuleScheduling {
    bool fixedReplacements = false;
    bool simpleRow = false;
    bool unconditional = false;
    bool mayInvalidateOtherMatches = true;
    bool mayEnableOtherMatches = true;
    bool singlePass = false;
    std::vector<MaskWordUnsigned> readObjects;
    std::vector<MaskWordUnsigned> readMovements;
    std::vector<MaskWordUnsigned> writeObjects;
    std::vector<MaskWordUnsigned> writeMovements;
};

CompiledRuleScheduling analyzeCompiledRuleScheduling(const Game& game, const Rule& rule);
bool canEmitStraightLineCompiledPhase(const Game& game, const LoopPointTable& loopPoints);
void emitCompiledGroupFunctions(std::ostream& out, const Game& game, size_t sourceIndex, const CompiledRulesOptions& options);
void emitCompiledGroupDispatch(std::ostream& out, const Game& game, size_t sourceIndex, bool late, const CompiledRulesOptions& options);
void emitStraightLineCompiledPhase(std::ostream& out, const Game& game, size_t sourceIndex, bool late);

bool isKnownSpecializedFullTurnCommandName(std::string_view name);
std::string specializedFullTurnCommandStatusForGroups(const std::vector<std::vector<Rule>>& groups);
std::string specializedFullTurnCommandStatus(const Game& game);
std::optional<std::string_view> compiledRuleCommandKindExpression(std::string_view commandName);
bool canGenerateCompiledRuleCommandQueue(const Rule& rule);

SpecializedFullTurnSupport specializedFullTurnSupportForGame(const Game& game, const CompiledRulesOptions& options);
SpecializedFullTurnSupport specializedFullTurnSupportForMissingGame();

} // namespace puzzlescript::compiler
