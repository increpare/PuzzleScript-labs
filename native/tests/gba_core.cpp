#include "puzzlescript/gba.h"

#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <vector>

namespace {

enum { Background, Target, Player, Wall, Crate };

constexpr uint32_t bit(int id) { return uint32_t{1} << id; }

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "gba_core: " << message << "\n";
        std::exit(1);
    }
}

ps_gba_kernel_result testKernel(uint32_t* board, uint32_t, uint16_t width, uint16_t height,
    uint16_t, ps_input input, ps_gba_rng_state*, bool, bool levelStart) {
    if (levelStart) {
        board[0] |= uint32_t{1} << 31U;
        return {true, true, true, true, true, false, false, false};
    }
    if (input != PS_INPUT_RIGHT) return {true, false, false, false, false, false, false, false};
    int playerCell = -1;
    for (int x = 0; x < width; ++x) for (int y = 0; y < height; ++y) {
        const int cell = x * height + y;
        if ((board[cell] & bit(Player)) != 0) playerCell = cell;
    }
    if (playerCell < 0) return {};
    const int x = playerCell / height;
    const int y = playerCell % height;
    if (x + 1 >= width) return {true, false, false, false, false, false, false, false};
    const int next = (x + 1) * height + y;
    if ((board[next] & bit(Wall)) != 0) return {true, false, false, false, false, false, false, false};
    if ((board[next] & bit(Crate)) != 0) {
        if (x + 2 >= width) return {true, false, false, false, false, false, false, false};
        const int beyond = (x + 2) * height + y;
        if ((board[beyond] & (bit(Wall) | bit(Crate))) != 0)
            return {true, false, false, false, false, false, false, false};
        board[next] &= ~bit(Crate);
        board[beyond] |= bit(Crate);
    }
    board[playerCell] &= ~bit(Player);
    board[next] |= bit(Player);
    bool won = true;
    for (int cell = 0; cell < width * height; ++cell) {
        if ((board[cell] & bit(Target)) != 0 && (board[cell] & bit(Crate)) == 0) won = false;
    }
    return {true, true, won, false, won, false, false, false};
}

ps_gba_kernel_result commandOnlyWinKernel(uint32_t*, uint32_t, uint16_t, uint16_t,
    uint16_t, ps_input input, ps_gba_rng_state*, bool, bool levelStart) {
    if (levelStart) return {true, false, false, false, false, false, false, false};
    if (input == PS_INPUT_ACTION) return {true, false, true, false, false, false, false, false};
    return {true, false, false, false, false, false, false, false};
}

} // namespace

int main() {
    static const uint16_t palette[] = {0, 0x7fff};
    static const uint8_t pixel[] = {1};
    static const uint32_t playerMask[] = {bit(Player)};
    static const ps_gba_object objects[] = {
        {"Background", 0, 1, 1, pixel, 0}, {"Target", 1, 1, 1, pixel, 0},
        {"Player", 2, 1, 1, pixel, 0}, {"Wall", 2, 1, 1, pixel, 0},
        {"Crate", 2, 1, 1, pixel, 0},
    };
    // Stored column-major: ####### / #P.*O.# / #######
    static const uint32_t levelWords[] = {
        bit(Wall), 0, bit(Wall), bit(Wall), bit(Player), bit(Wall), bit(Wall), 0, bit(Wall),
        bit(Wall), bit(Crate), bit(Wall), bit(Wall), bit(Target), bit(Wall), bit(Wall), 0, bit(Wall),
        bit(Wall), 0, bit(Wall),
    };
    static const ps_gba_level levels[] = {
        {PS_GBA_LEVEL_BOARD, 7, 3, levelWords, nullptr},
        {PS_GBA_LEVEL_MESSAGE, 0, 0, nullptr, "done"},
    };
    static const ps_gba_metadata metadata[] = {{"run_rules_on_level_start", "true"}};
    static const ps_gba_game_view game = {
        PS_GBA_GAME_ABI_VERSION, 1234, "test", "", 1, 0, 2, palette,
        5, 1, objects, 2, 21, 2, levels, 1, metadata, 0, nullptr,
        PS_GBA_RUNTIME_GENERATED_COMPACT, playerMask, testKernel, false, false, false,
    };

    ps_gba_game_view staleGame = game;
    staleGame.abi_version = PS_GBA_GAME_ABI_VERSION - 1;
    std::vector<uint8_t> staleArena(ps_gba_session_required_bytes(&staleGame));
    require(ps_gba_session_init(staleArena.data(), staleArena.size(), &staleGame) == nullptr,
        "session rejects generated data from an older ABI");

    std::vector<uint8_t> arena(ps_gba_session_required_bytes(&game));
    ps_gba_session* session = ps_gba_session_init(arena.data(), arena.size(), &game);
    require(session != nullptr, "session initializes in reported arena size");

    ps_gba_status status{};
    ps_gba_status_get(session, &status);
    require(status.mode == PS_FULL_STATE_MODE_TITLE, "session starts at title");
    require(ps_gba_step(session, PS_INPUT_ACTION).transitioned, "action starts the game");
    require((ps_gba_board_words(session)[0] & (uint32_t{1} << 31U)) != 0,
        "run_rules_on_level_start executes when a board is loaded");

    int32_t x = -1;
    int32_t y = -1;
    require(ps_gba_first_player_position(session, &x, &y) && x == 1 && y == 1, "player loads at expected position");
    const ps_step_result first = ps_gba_step(session, PS_INPUT_RIGHT);
    require(first.changed && !first.won, "ordinary movement changes board without winning");
    require(ps_gba_undo(session), "ordinary movement is undoable");
    require(ps_gba_first_player_position(session, &x, &y) && x == 1, "undo restores the player");

    require(ps_gba_step(session, PS_INPUT_RIGHT).changed, "movement can be replayed after undo");
    require(ps_gba_restart(session), "restart succeeds");
    require((ps_gba_board_words(session)[0] & (uint32_t{1} << 31U)) != 0,
        "restart reapplies run_rules_on_level_start");
    require(ps_gba_first_player_position(session, &x, &y) && x == 1, "restart restores initial level");
    require(ps_gba_undo(session), "restart itself is undoable");
    require(ps_gba_first_player_position(session, &x, &y) && x == 2, "undoing restart restores prior state");

    const ps_step_result push = ps_gba_step(session, PS_INPUT_RIGHT);
    require(push.changed && push.won && push.transitioned, "pushing crate onto target wins and transitions");
    ps_gba_status_get(session, &status);
    require(status.mode == PS_FULL_STATE_MODE_MESSAGE && status.message != nullptr, "win advances to message level");
    require(ps_gba_step(session, PS_INPUT_ACTION).transitioned, "message action finishes game");
    ps_gba_status_get(session, &status);
    require(status.mode == PS_FULL_STATE_MODE_TITLE && status.completed, "final message returns to completed title");

    static const ps_gba_level commandOnlyLevels[] = {
        {PS_GBA_LEVEL_BOARD, 1, 1, levelWords, nullptr},
    };
    ps_gba_game_view commandOnlyGame = game;
    commandOnlyGame.level_count = 1;
    commandOnlyGame.max_level_cells = 1;
    commandOnlyGame.levels = commandOnlyLevels;
    commandOnlyGame.turn_kernel = commandOnlyWinKernel;
    std::vector<uint8_t> commandOnlyArena(ps_gba_session_required_bytes(&commandOnlyGame));
    ps_gba_session* commandOnlySession = ps_gba_session_init(
        commandOnlyArena.data(), commandOnlyArena.size(), &commandOnlyGame);
    require(commandOnlySession != nullptr && ps_gba_load_level(commandOnlySession, 0),
        "command-only win session loads");
    const ps_step_result commandOnlyWin = ps_gba_step(commandOnlySession, PS_INPUT_ACTION);
    require(commandOnlyWin.changed && commandOnlyWin.won && commandOnlyWin.transitioned,
        "command-only win is reported as a visible change");
    return 0;
}
