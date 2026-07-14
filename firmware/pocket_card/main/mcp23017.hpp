#pragma once

#include <cstdint>

#include "esp_err.h"

namespace pocket_card {

struct Mcp23017GpioSnapshot {
    uint8_t gpio_a = 0xFF;
    uint8_t gpio_b = 0xFF;
};

esp_err_t mcp23017_init();
uint8_t mcp23017_address();
esp_err_t mcp23017_read_gpio(Mcp23017GpioSnapshot* snapshot);

} // namespace pocket_card
