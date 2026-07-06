#pragma once

#include <cstddef>
#include <cstdint>

namespace ps_probe {

uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b);
void fill_native_diagnostic(uint16_t* pixels, std::size_t pixel_count);
void fill_target_800x480_diagnostic(uint16_t* pixels, std::size_t pixel_count);

} // namespace ps_probe
