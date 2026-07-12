#include "puzzlescript/puzzlescript.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

namespace {

int fail(
    const std::string& message,
    ps_game* game = nullptr,
    ps_full_state* state = nullptr,
    ps_error* error = nullptr) {
    std::cerr << "pocket_card_runtime_fixture: " << message;
    if (error != nullptr) {
        std::cerr << ": " << ps_error_message(error);
    }
    std::cerr << '\n';
    ps_free_error(error);
    ps_full_state_destroy(state);
    ps_free_game(game);
    return 1;
}

bool hasPlayerAt(const ps_full_state* state, int32_t expectedX, int32_t expectedY) {
    int32_t actualX = 0;
    int32_t actualY = 0;
    return ps_full_state_first_player_position(state, &actualX, &actualY)
        && actualX == expectedX
        && actualY == expectedY;
}

} // namespace

int main(int argc, char** argv) {
    if (argc != 2) {
        return fail("expected exactly one IR path argument");
    }

    std::ifstream input(argv[1], std::ios::binary);
    if (!input) {
        return fail(std::string("could not open IR file: ") + argv[1]);
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    if (input.bad()) {
        return fail(std::string("could not read IR file: ") + argv[1]);
    }
    const std::string irText = buffer.str();
    if (irText.empty()) {
        return fail("IR file is empty");
    }

    ps_game* game = nullptr;
    ps_error* error = nullptr;
    if (!ps_load_ir_json(irText.data(), irText.size(), &game, &error)) {
        return fail("could not load IR", game, nullptr, error);
    }

    ps_full_state* state = nullptr;
    if (!ps_full_state_create(game, &state, &error)) {
        return fail("could not create runtime state", game, state, error);
    }
    if (!ps_full_state_load_level(state, 0, &error)) {
        return fail("could not load level 0", game, state, error);
    }
    if (!hasPlayerAt(state, 2, 3)) {
        return fail("initial player position is not (2,3)", game, state);
    }

    (void)ps_full_state_turn(state, PS_INPUT_RIGHT);
    (void)ps_full_state_turn(state, PS_INPUT_DOWN);
    if (!hasPlayerAt(state, 3, 3)) {
        return fail("player position after RIGHT, DOWN is not (3,3)", game, state);
    }

    if (!ps_full_state_undo(state)) {
        return fail("undo failed", game, state);
    }
    if (!hasPlayerAt(state, 2, 3)) {
        return fail("player position after undo is not (2,3)", game, state);
    }

    (void)ps_full_state_turn(state, PS_INPUT_RIGHT);
    if (!hasPlayerAt(state, 3, 3)) {
        return fail("player position before restart is not (3,3)", game, state);
    }

    if (!ps_full_state_restart(state)) {
        return fail("restart failed", game, state);
    }
    if (!hasPlayerAt(state, 2, 3)) {
        return fail("player position after restart is not (2,3)", game, state);
    }

    ps_full_state_destroy(state);
    ps_free_game(game);
    std::cout << "pocket_card_runtime_fixture: ok\n";
    return 0;
}
