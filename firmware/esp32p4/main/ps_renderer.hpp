#pragma once

#include <cstdint>
#include "puzzlescript/puzzlescript.h"

namespace ps_probe {

struct RenderResult {
    // True when the framebuffer was filled, either with a rendered level frame
    // or with a diagnostic fallback for text/invalid-board states.
    bool ok;
    int board_width;
    int board_height;
    int tile_pixels;
    int sprite_scale;
};

RenderResult render_level_to_native_framebuffer(
    const ps_game* game,
    const ps_full_state* state,
    uint16_t* native_pixels,
    int native_width,
    int native_height);

} // namespace ps_probe
