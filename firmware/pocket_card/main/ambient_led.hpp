#pragma once

#include "esp_err.h"

#include "ambient_light_policy.hpp"

namespace pocket_card {

// ES3C28P onboard single-wire RGB LED (WS2812-style, internal IC) on GPIO 42.
// See hardware/pocket_card/es3c28p_pin_contract.json (reserved.rgb).

esp_err_t ambient_led_init();

// Release firmware may disable ambient light in persistent settings.
void ambient_led_set_enabled(bool enabled);
bool ambient_led_is_enabled();

// Applies an already-computed ambient color; {0,0,0} turns the LED off.
esp_err_t ambient_led_apply(const AmbientColor& color);

// Convenience: policy + apply from a game background color string.
esp_err_t ambient_led_apply_background(const char* background_color);

esp_err_t ambient_led_off();

} // namespace pocket_card
