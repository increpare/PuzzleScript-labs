#pragma once

#include "driver/gpio.h"

namespace pocket_card {

inline constexpr gpio_num_t kI2cSda = GPIO_NUM_16;
inline constexpr gpio_num_t kI2cScl = GPIO_NUM_15;
inline constexpr gpio_num_t kControlsInterrupt = GPIO_NUM_2;

inline constexpr gpio_num_t kLcdCs = GPIO_NUM_10;
inline constexpr gpio_num_t kLcdDc = GPIO_NUM_46;
inline constexpr gpio_num_t kLcdSck = GPIO_NUM_12;
inline constexpr gpio_num_t kLcdMosi = GPIO_NUM_11;
inline constexpr gpio_num_t kLcdMiso = GPIO_NUM_13;
inline constexpr gpio_num_t kLcdBacklight = GPIO_NUM_45;

inline constexpr uint8_t kMcp23017AddrDefault = 0x20;
inline constexpr uint8_t kMcp23017AddrMin = 0x20;
inline constexpr uint8_t kMcp23017AddrMax = 0x27;

} // namespace pocket_card
