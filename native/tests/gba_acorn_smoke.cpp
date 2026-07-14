#include "generated_game.hpp"
#include "puzzlescript/gba.h"

#include <cstdint>
#include <iostream>
#include <vector>

int main() {
    std::vector<uint8_t> arena(ps_gba_session_required_bytes(&ps_gba_generated_game));
    ps_gba_session* session = ps_gba_session_init(arena.data(), arena.size(), &ps_gba_generated_game);
    if (session == nullptr) {
        std::cerr << "Acorn GBA session initialization failed\n";
        return 1;
    }
    ps_step_result result = ps_gba_step(session, PS_INPUT_ACTION);
    ps_gba_status status{};
    ps_gba_status_get(session, &status);
    if (!result.transitioned || status.mode != PS_FULL_STATE_MODE_MESSAGE || status.current_level != 0) {
        std::cerr << "Acorn title did not enter its first message\n";
        return 1;
    }
    result = ps_gba_step(session, PS_INPUT_ACTION);
    ps_gba_status_get(session, &status);
    if (!result.transitioned || status.mode != PS_FULL_STATE_MODE_LEVEL || status.current_level != 1
        || status.width != 6 || status.height != 6) {
        std::cerr << "Acorn message did not enter its first board\n";
        return 1;
    }
    int32_t x = -1;
    int32_t y = -1;
    if (!ps_gba_first_player_position(session, &x, &y) || x != 2 || y != 3) {
        std::cerr << "Acorn player starts at " << x << ',' << y << " instead of 2,3\n";
        return 1;
    }
    result = ps_gba_step(session, PS_INPUT_RIGHT);
    if (!result.changed || !ps_gba_first_player_position(session, &x, &y) || x != 3 || y != 3) {
        std::cerr << "Acorn input failed: handled board did not move right; changed="
                  << result.changed << " player=" << x << ',' << y << '\n';
        return 1;
    }
    return 0;
}
