#include "board_card.hpp"
#include "board_card_pins.hpp"

#include "esp_log.h"

namespace ps_probe::board {
namespace {

constexpr const char* kTag = "board_card";

} // namespace

esp_err_t init_display() {
    ESP_LOGW(
        kTag,
        "Card DSI display bring-up not implemented yet (target %dx%d, %d DSI lanes)",
        card_pins::kTargetWidth,
        card_pins::kTargetHeight,
        card_pins::kMipiDsiLaneCount);
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t show_hardware_pattern() {
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t clear_hardware_pattern() {
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t draw_rgb565(const uint16_t* pixels, int x0, int y0, int width, int height) {
    (void)pixels;
    (void)x0;
    (void)y0;
    (void)width;
    (void)height;
    return ESP_ERR_NOT_SUPPORTED;
}

} // namespace ps_probe::board
