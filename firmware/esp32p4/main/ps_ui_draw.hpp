#pragma once

#include <cstdint>

namespace ps_probe {

void ui_fill_rect(uint16_t* pixels, int width, int height, int x, int y, int w, int h, uint16_t color);
void ui_dim_rect(uint16_t* pixels, int width, int height, int x, int y, int w, int h, uint16_t tint, int strength);
void ui_draw_text(uint16_t* pixels, int width, int height, int x, int y, const char* text, uint16_t color, int scale);
void ui_draw_centered_text(
    uint16_t* pixels,
    int width,
    int height,
    int y,
    const char* text,
    uint16_t color,
    int scale);

} // namespace ps_probe
