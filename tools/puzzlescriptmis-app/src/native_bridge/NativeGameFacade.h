#pragma once

#include <memory>
#include <string>
#include <vector>

#include "macros.h"

struct Game;
class Logger;

namespace nativebridge {

class CandidateSolverContext;

enum class CandidateSolveStatus {
    Solved,
    Unsolvable,
    Timeout,
    Error
};

struct CandidateSolveResult {
    CandidateSolveStatus status = CandidateSolveStatus::Error;
    long long expanded = 0;
    long long generated = 0;
    long long elapsedMs = 0;
    std::vector<short> solution;
    std::string error;
};

bool compileSourceLines(const std::vector<std::string>& sourceLines, Game& displayGame, Logger& logger);
bool loadLevel(int levelIndex, Game& displayGame, Logger& logger);
bool step(short moveDir, Game& displayGame, bool& won, Logger& logger);
std::shared_ptr<CandidateSolverContext> createCandidateSolverContext();
CandidateSolveResult solveGeneratedState(
    CandidateSolverContext& context,
    const std::vector<std::vector<std::vector<short> > >& state,
    long long timeoutMs);
CandidateSolveResult solveGeneratedState(const std::vector<std::vector<std::vector<short> > >& state, long long timeoutMs);
bool undo(Game& displayGame);
bool restart(Game& displayGame);
bool canUndo(const Game& displayGame);
bool isAtRestartState(const Game& displayGame);
std::string lastMessageText();

} // namespace nativebridge
