#pragma once

#include "esp_err.h"

namespace ps_probe::board {

esp_err_t init_touch();
bool poll_touch(int& out_x, int& out_y, int& out_touch_count);

} // namespace ps_probe::board
