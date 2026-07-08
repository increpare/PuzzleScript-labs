#pragma once

#include "ps_touch_gestures.hpp"

#include "esp_err.h"

namespace ps_probe {

// Breadboard wiring for Waveshare ESP32-P4-WIFI6-Touch-LCD-7B (active-low to GND).
class ButtonInput {
public:
    esp_err_t init();
    void set_repeat_interval_ms(int interval_ms);
    void poll();
    std::vector<TouchGestureEvent> drain_events();

private:
    bool repeatable_action(PlayerAction action) const;
    void emit_edge(PlayerAction action);
    void maybe_emit_repeat();

    int repeat_interval_ms_ = 150;
    int64_t last_repeat_ms_ = 0;
    PlayerAction held_action_ = PlayerAction::Action;
    bool holding_repeatable_ = false;
    uint32_t stable_mask_ = 0;
    uint32_t last_raw_mask_ = 0;
    int debounce_count_ = 0;
    std::vector<TouchGestureEvent> pending_;
};

} // namespace ps_probe
