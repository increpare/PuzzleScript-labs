#include "compiler/compact_turn_program.hpp"

#include <algorithm>

namespace puzzlescript::compiler {

namespace {

bool hasLoopPoint(const LoopPointTable& table) {
    return std::any_of(table.entries.begin(), table.entries.end(), [](const std::optional<int32_t>& value) {
        return value.has_value();
    });
}

void appendRuleGroups(
    CompactTurnProgram& program,
    const std::vector<std::vector<Rule>>& groups,
    const LoopPointTable& loopPoints,
    bool late
) {
    for (size_t index = 0; index < groups.size(); ++index) {
        CompactTurnProgramInstruction run;
        run.op = late ? CompactTurnProgramOp::RunLateGroup : CompactTurnProgramOp::RunEarlyGroup;
        run.groupIndex = static_cast<int32_t>(index);
        run.late = late;
        program.instructions.push_back(run);

        if (index < loopPoints.entries.size() && loopPoints.entries[index].has_value()) {
            CompactTurnProgramInstruction jump;
            jump.op = CompactTurnProgramOp::JumpIfChanged;
            jump.groupIndex = static_cast<int32_t>(index);
            jump.jumpTarget = *loopPoints.entries[index];
            jump.late = late;
            program.instructions.push_back(jump);
        }
    }
}

void scanCommands(CompactTurnProgram& program, const std::vector<std::vector<Rule>>& groups) {
    for (const std::vector<Rule>& group : groups) {
        for (const Rule& rule : group) {
            for (const RuleCommand& command : rule.commands) {
                if (command.name == "again") program.hasAgain = true;
                else if (command.name == "cancel") program.hasCancel = true;
                else if (command.name == "restart") program.hasRestart = true;
                else if (command.name == "checkpoint") program.hasCheckpoint = true;
                else if (command.name == "message" || command.name.rfind("sfx", 0) == 0) program.hasOutputOnlyCommands = true;
            }
        }
    }
}

} // namespace

CompactTurnProgram buildCompactTurnProgram(const Game& game) {
    CompactTurnProgram program;
    program.hasEarlyRules = std::any_of(game.rules.begin(), game.rules.end(), [](const std::vector<Rule>& group) {
        return !group.empty();
    });
    program.hasLateRules = std::any_of(game.lateRules.begin(), game.lateRules.end(), [](const std::vector<Rule>& group) {
        return !group.empty();
    });
    program.hasRuleLoops = hasLoopPoint(game.loopPoint) || hasLoopPoint(game.lateLoopPoint);
    program.runRulesOnLevelStart = game.metadata.values.find("run_rules_on_level_start") != game.metadata.values.end();
    scanCommands(program, game.rules);
    scanCommands(program, game.lateRules);

    program.instructions.push_back({CompactTurnProgramOp::BeginTurn});
    program.instructions.push_back({CompactTurnProgramOp::SeedInputMovement});
    appendRuleGroups(program, game.rules, game.loopPoint, false);
    program.instructions.push_back({CompactTurnProgramOp::ResolveMovements});
    appendRuleGroups(program, game.lateRules, game.lateLoopPoint, true);
    program.instructions.push_back({CompactTurnProgramOp::HandleCommands});
    program.instructions.push_back({CompactTurnProgramOp::EvaluateWin});
    if (program.hasAgain) {
        program.instructions.push_back({CompactTurnProgramOp::DrainAgain});
    }
    program.instructions.push_back({CompactTurnProgramOp::ReturnOutcome});
    return program;
}

const char* compactTurnProgramOpName(CompactTurnProgramOp op) {
    switch (op) {
    case CompactTurnProgramOp::BeginTurn: return "BeginTurn";
    case CompactTurnProgramOp::SeedInputMovement: return "SeedInputMovement";
    case CompactTurnProgramOp::RunEarlyGroup: return "RunEarlyGroup";
    case CompactTurnProgramOp::RunLateGroup: return "RunLateGroup";
    case CompactTurnProgramOp::JumpIfChanged: return "JumpIfChanged";
    case CompactTurnProgramOp::ResolveMovements: return "ResolveMovements";
    case CompactTurnProgramOp::HandleCommands: return "HandleCommands";
    case CompactTurnProgramOp::EvaluateWin: return "EvaluateWin";
    case CompactTurnProgramOp::DrainAgain: return "DrainAgain";
    case CompactTurnProgramOp::ReturnOutcome: return "ReturnOutcome";
    }
    return "Unknown";
}

} // namespace puzzlescript::compiler
