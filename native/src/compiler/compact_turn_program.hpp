#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "runtime/core.hpp"

namespace puzzlescript::compiler {

enum class CompactTurnProgramOp {
    BeginTurn,
    SeedInputMovement,
    RunEarlyGroup,
    RunLateGroup,
    JumpIfChanged,
    ResolveMovements,
    HandleCommands,
    EvaluateWin,
    DrainAgain,
    ReturnOutcome,
};

struct CompactTurnProgramInstruction {
    CompactTurnProgramOp op = CompactTurnProgramOp::BeginTurn;
    int32_t groupIndex = -1;
    int32_t jumpTarget = -1;
    bool late = false;
};

struct CompactTurnProgram {
    std::vector<CompactTurnProgramInstruction> instructions;
    bool hasEarlyRules = false;
    bool hasLateRules = false;
    bool hasAgain = false;
    bool hasCancel = false;
    bool hasRestart = false;
    bool hasCheckpoint = false;
    bool hasOutputOnlyCommands = false;
    bool hasRuleLoops = false;
    bool runRulesOnLevelStart = false;
};

CompactTurnProgram buildCompactTurnProgram(const Game& game);
const char* compactTurnProgramOpName(CompactTurnProgramOp op);

} // namespace puzzlescript::compiler
