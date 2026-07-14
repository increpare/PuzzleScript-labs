#pragma once

#include <cstdint>

#include "esp_err.h"

namespace pocket_card::board {

esp_err_t init_display();
esp_err_t draw_rgb565(const uint16_t* pixels, int x, int y, int width, int height);
void set_backlight(bool enabled);

} // namespace pocket_card::board
