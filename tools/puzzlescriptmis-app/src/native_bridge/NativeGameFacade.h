#pragma once

#include <string>
#include <vector>

#include "macros.h"

struct Game;
class Logger;

namespace nativebridge {

bool compileSourceLines(const std::vector<std::string>& sourceLines, Game& displayGame, Logger& logger);
bool loadLevel(int levelIndex, Game& displayGame, Logger& logger);
bool step(short moveDir, Game& displayGame, bool& won, Logger& logger);
bool undo(Game& displayGame);
bool restart(Game& displayGame);
bool canUndo(const Game& displayGame);
bool isAtRestartState(const Game& displayGame);
std::string lastMessageText();

} // namespace nativebridge
