#include "ps_framebuffer.hpp"

#include "probe_config.hpp"

namespace ps_probe {

uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
    return static_cast<uint16_t>(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

void fill_native_diagnostic(uint16_t* pixels, std::size_t pixel_count) {
    if (pixels == nullptr || pixel_count < static_cast<std::size_t>(kNativeWidth) * kNativeHeight) {
        return;
    }
    for (int y = 0; y < kNativeHeight; ++y) {
        for (int x = 0; x < kNativeWidth; ++x) {
            const bool left = x < kNativeWidth / 3;
            const bool middle = x >= kNativeWidth / 3 && x < (2 * kNativeWidth) / 3;
            pixels[y * kNativeWidth + x] = left
                ? rgb565(220, 32, 48)
                : (middle ? rgb565(32, 180, 96) : rgb565(40, 96, 220));
        }
    }
}

void fill_target_800x480_diagnostic(uint16_t* pixels, std::size_t pixel_count) {
    if (pixels == nullptr || pixel_count < static_cast<std::size_t>(kNativeWidth) * kNativeHeight) {
        return;
    }

    const uint16_t border = rgb565(16, 18, 20);
    const uint16_t background = rgb565(36, 40, 48);
    for (std::size_t i = 0; i < pixel_count; ++i) {
        pixels[i] = border;
    }

    const int x0 = (kNativeWidth - kTargetWidth) / 2;
    const int y0 = (kNativeHeight - kTargetHeight) / 2;
    for (int y = 0; y < kTargetHeight; ++y) {
        for (int x = 0; x < kTargetWidth; ++x) {
            const bool axis = (x % 100) == 0 || (y % 80) == 0;
            const bool frame = x == 0 || y == 0 || x == kTargetWidth - 1 || y == kTargetHeight - 1;
            pixels[(y0 + y) * kNativeWidth + (x0 + x)] =
                frame ? rgb565(255, 255, 255) : (axis ? rgb565(96, 128, 180) : background);
        }
    }
}

} // namespace ps_probe
