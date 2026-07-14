#include "generated_game.hpp"
#include "puzzlescript/gba.h"

#include <cstdint>
#include <cstring>
#include <iostream>
#include <vector>

namespace {

int32_t objectId(const char* name) {
    for (int32_t id = 0; id < ps_gba_generated_game.object_count; ++id) {
        const char* candidate = ps_gba_generated_game.objects[id].name;
        if (candidate != nullptr && std::strcmp(candidate, name) == 0) return id;
    }
    return -1;
}

bool hasTrail(ps_gba_session* session, int32_t x, int32_t y, int32_t trail1, int32_t trail2) {
    return ps_gba_cell_has_object(session, x, y, trail1)
        || ps_gba_cell_has_object(session, x, y, trail2);
}

} // namespace

int main() {
    const int32_t trail1 = objectId("jettrail1");
    const int32_t trail2 = objectId("jettrail2");
    if (trail1 < 0 || trail2 < 0) {
        std::cerr << "Collapse export is missing its jet-trail objects\n";
        return 1;
    }

    uint16_t boardLevel = ps_gba_generated_game.level_count;
    for (uint16_t index = 0; index < ps_gba_generated_game.level_count; ++index) {
        if (ps_gba_generated_game.levels[index].kind == PS_GBA_LEVEL_BOARD) {
            boardLevel = index;
            break;
        }
    }
    std::vector<uint8_t> arena(ps_gba_session_required_bytes(&ps_gba_generated_game));
    ps_gba_session* session = ps_gba_session_init(arena.data(), arena.size(), &ps_gba_generated_game);
    if (session == nullptr || boardLevel == ps_gba_generated_game.level_count
        || !ps_gba_load_level(session, boardLevel)) {
        std::cerr << "Collapse GBA board could not be loaded\n";
        return 1;
    }

    (void)ps_gba_step(session, PS_INPUT_UP);
    const ps_step_result launch = ps_gba_step(session, PS_INPUT_RIGHT);
    ps_gba_status status{};
    ps_gba_status_get(session, &status);
    if (!launch.changed || !status.pending_again) {
        std::cerr << "Collapse launch did not schedule its again chain\n";
        return 1;
    }

    int32_t originalTrailX = -1;
    int32_t originalTrailY = -1;
    for (int32_t x = 0; x < status.width && originalTrailX < 0; ++x) {
        for (int32_t y = 0; y < status.height; ++y) {
            if (hasTrail(session, x, y, trail1, trail2)) {
                originalTrailX = x;
                originalTrailY = y;
                break;
            }
        }
    }
    if (originalTrailX < 0) {
        std::cerr << "Collapse launch created no jet trail\n";
        return 1;
    }

    (void)ps_gba_step(session, PS_INPUT_TICK);
    if (!ps_gba_cell_has_object(session, originalTrailX, originalTrailY, trail2)) {
        std::cerr << "Collapse first again tick did not age jettrail1 to jettrail2\n";
        return 1;
    }
    (void)ps_gba_step(session, PS_INPUT_TICK);
    if (hasTrail(session, originalTrailX, originalTrailY, trail1, trail2)) {
        std::cerr << "Collapse second again tick did not remove the original cloud\n";
        return 1;
    }

    int ticks = 2;
    for (; ticks < 100; ++ticks) {
        ps_gba_status_get(session, &status);
        if (!status.pending_again) break;
        (void)ps_gba_step(session, PS_INPUT_TICK);
    }
    ps_gba_status_get(session, &status);
    if (status.pending_again || ticks < 3) {
        std::cerr << "Collapse again chain did not drain normally; ticks=" << ticks << '\n';
        return 1;
    }
    return 0;
}
