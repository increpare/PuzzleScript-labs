#include "generated_game.hpp"
#include "puzzlescript/gba.h"

#include <cstring>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <vector>

int main() {
    if (ps_gba_generated_game.runtime_profile != PS_GBA_RUNTIME_GENERATED_COMPACT
        || ps_gba_generated_game.level_count != 2
        || ps_gba_generated_game.palette_count == 0
        || ps_gba_generated_game.turn_kernel == nullptr
        || ps_gba_generated_game.player_mask == nullptr) {
        std::cerr << "generated GBA game contract is incomplete\n";
        return 1;
    }
    std::vector<uint8_t> arena(ps_gba_session_required_bytes(&ps_gba_generated_game));
    ps_gba_session* session = ps_gba_session_init(arena.data(), arena.size(), &ps_gba_generated_game);
    if (session == nullptr || !ps_gba_step(session, PS_INPUT_ACTION).transitioned) {
        std::cerr << "generated GBA game cannot start\n";
        return 1;
    }
    int32_t x = -1;
    int32_t y = -1;
    if (!ps_gba_first_player_position(session, &x, &y) || x != 2 || y != 3) {
        std::cerr << "generated GBA level orientation moved the player landmark\n";
        return 1;
    }
    ps_gba_status status{};
    ps_gba_status_get(session, &status);
    if (status.width != 6 || status.height != 7) {
        std::cerr << "generated GBA level dimensions are transposed\n";
        return 1;
    }
    int32_t wall = -1;
    int32_t target = -1;
    int32_t crate = -1;
    for (uint16_t object = 0; object < ps_gba_generated_game.object_count; ++object) {
        if (std::strcmp(ps_gba_generated_game.objects[object].name, "wall") == 0) wall = object;
        if (std::strcmp(ps_gba_generated_game.objects[object].name, "target") == 0) target = object;
        if (std::strcmp(ps_gba_generated_game.objects[object].name, "crate") == 0) crate = object;
    }
    if (wall < 0 || target < 0 || crate < 0
        || !ps_gba_cell_has_object(session, 0, 0, wall)
        || ps_gba_cell_has_object(session, 4, 0, wall)
        || !ps_gba_cell_has_object(session, 2, 1, target)
        || !ps_gba_cell_has_object(session, 1, 3, crate)
        || !ps_gba_cell_has_object(session, 1, 3, target)
        || !ps_gba_cell_has_object(session, 3, 4, crate)) {
        std::cerr << "generated GBA level landmarks do not match canonical coordinates\n";
        return 1;
    }
    std::vector<uint32_t> probeBoard(
        ps_gba_board_words(session),
        ps_gba_board_words(session) + static_cast<size_t>(status.width) * status.height
            * ps_gba_generated_game.object_word_count);
    ps_gba_rng_state probeRng{};
    for (int index = 0; index < 256; ++index) probeRng.s[index] = static_cast<uint8_t>(index);
    const ps_gba_kernel_result probe = ps_gba_generated_game.turn_kernel(
        probeBoard.data(), static_cast<uint32_t>(probeBoard.size()), status.width, status.height,
        status.current_level, PS_INPUT_RIGHT, &probeRng, true, false);
    if (!probe.handled || !probe.changed || probe.won
        || (probeBoard[static_cast<size_t>(2) * status.height + 1] & (uint32_t{1} << target)) == 0) {
        std::cerr << "generated compact kernel direct result is wrong"
                  << " handled=" << probe.handled << " changed=" << probe.changed << " won=" << probe.won
                  << " target_cell=0x" << std::hex
                  << probeBoard[static_cast<size_t>(2) * status.height + 1] << std::dec << "\n";
        return 1;
    }
    const ps_step_result move = ps_gba_step(session, PS_INPUT_RIGHT);
    if (!move.changed || !ps_gba_first_player_position(session, &x, &y) || x != 3 || y != 3) {
        std::cerr << "generated compact kernel did not execute the game's movement rules"
                  << " changed=" << move.changed << " won=" << move.won
                  << " transitioned=" << move.transitioned << " player=" << x << "," << y << "\n";
        return 1;
    }
    return 0;
}
