#include "generated_game.hpp"
#include "puzzlescript/gba.h"

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <vector>

int main() {
    uint16_t boardLevel = ps_gba_generated_game.level_count;
    for (uint16_t index = 0; index < ps_gba_generated_game.level_count; ++index) {
        if (ps_gba_generated_game.levels[index].kind == PS_GBA_LEVEL_BOARD) {
            boardLevel = index;
            break;
        }
    }
    if (boardLevel == ps_gba_generated_game.level_count) {
        std::cerr << "Atlas export contains no board level\n";
        return 1;
    }
    std::vector<uint8_t> arena(ps_gba_session_required_bytes(&ps_gba_generated_game));
    ps_gba_session* session = ps_gba_session_init(arena.data(), arena.size(), &ps_gba_generated_game);
    if (session == nullptr || !ps_gba_load_level(session, boardLevel)) {
        std::cerr << "Atlas GBA board could not be loaded\n";
        return 1;
    }
    ps_gba_status status{};
    ps_gba_status_get(session, &status);
    const size_t wordCount = static_cast<size_t>(status.width) * status.height
        * ps_gba_generated_game.object_word_count;
    const uint32_t* transformed = ps_gba_board_words(session);
    const uint32_t* raw = ps_gba_generated_game.levels[boardLevel].object_words;
    if (transformed == nullptr || raw == nullptr
        || std::equal(transformed, transformed + wordCount, raw)) {
        std::cerr << "Atlas run_rules_on_level_start did not wallify the raw board\n";
        return 1;
    }
    std::vector<uint32_t> expected(transformed, transformed + wordCount);
    if (!ps_gba_restart(session)
        || !std::equal(expected.begin(), expected.end(), ps_gba_board_words(session))) {
        std::cerr << "Atlas restart did not reapply its level-start wallification\n";
        return 1;
    }
    return 0;
}
