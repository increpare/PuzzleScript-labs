#pragma once

#include <cstdint>

namespace ps_probe {

bool dot_font_init();
bool dot_font_ready();
void dot_font_draw_glyph(
    uint16_t* pixels,
    int width,
    int height,
    int x,
    int y,
    char ch,
    uint16_t color,
    int scale_x,
    int scale_y);

} // namespace ps_probe
