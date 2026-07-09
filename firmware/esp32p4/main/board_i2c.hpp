#pragma once

#include "driver/i2c_master.h"
#include "esp_err.h"

namespace ps_probe::board {

esp_err_t init_i2c();
i2c_master_bus_handle_t i2c_bus();

} // namespace ps_probe::board
