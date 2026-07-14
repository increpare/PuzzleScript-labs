#include "ambient_led.hpp"

#include "led_strip.h"

namespace pocket_card {
namespace {

constexpr int kAmbientLedGpio = 42;
constexpr uint32_t kAmbientLedCount = 1;
constexpr uint32_t kRmtResolutionHz = 10 * 1000 * 1000;

led_strip_handle_t s_strip = nullptr;
bool s_enabled = true;

} // namespace

esp_err_t ambient_led_init() {
    if (s_strip != nullptr) {
        return ESP_OK;
    }

    led_strip_config_t strip_config = {};
    strip_config.strip_gpio_num = kAmbientLedGpio;
    strip_config.max_leds = kAmbientLedCount;
    strip_config.led_model = LED_MODEL_WS2812;
    strip_config.color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB;

    led_strip_rmt_config_t rmt_config = {};
    rmt_config.resolution_hz = kRmtResolutionHz;

    const esp_err_t status = led_strip_new_rmt_device(&strip_config, &rmt_config, &s_strip);
    if (status != ESP_OK) {
        s_strip = nullptr;
        return status;
    }
    return led_strip_clear(s_strip);
}

void ambient_led_set_enabled(const bool enabled) {
    s_enabled = enabled;
    if (!enabled) {
        (void)ambient_led_off();
    }
}

bool ambient_led_is_enabled() {
    return s_enabled;
}

esp_err_t ambient_led_apply(const AmbientColor& color) {
    if (s_strip == nullptr) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!s_enabled || color.is_off()) {
        return led_strip_clear(s_strip);
    }
    const esp_err_t status = led_strip_set_pixel(s_strip, 0, color.red, color.green, color.blue);
    if (status != ESP_OK) {
        return status;
    }
    return led_strip_refresh(s_strip);
}

esp_err_t ambient_led_apply_background(const char* background_color) {
    return ambient_led_apply(ambient_color_for_background(background_color));
}

esp_err_t ambient_led_off() {
    if (s_strip == nullptr) {
        return ESP_OK;
    }
    return led_strip_clear(s_strip);
}

} // namespace pocket_card
