#pragma once

#include <cstdint>
#include "esp_err.h"

namespace ps_probe::board {

esp_err_t init_display();
esp_err_t show_hardware_pattern();
esp_err_t clear_hardware_pattern();
esp_err_t draw_rgb565(const uint16_t* pixels, int x0, int y0, int width, int height);

} // namespace ps_probe::board
