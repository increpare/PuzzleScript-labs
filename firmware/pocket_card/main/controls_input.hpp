#pragma once

#include "ps_touch_gestures.hpp"

#include "esp_err.h"

namespace pocket_card {

class ControlsInput {
public:
    esp_err_t init();
    void set_repeat_interval_ms(int interval_ms);
    void poll();
    std::vector<ps_probe::TouchGestureEvent> drain_events();

private:
    bool repeatable_action(ps_probe::PlayerAction action) const;
    void emit_edge(ps_probe::PlayerAction action);
    void maybe_emit_repeat();
    void begin_restart_hold();
    void cancel_restart_hold();
    void maybe_emit_restart_hold();
    uint32_t read_raw_mask();

    int repeat_interval_ms_ = 150;
    int64_t last_repeat_ms_ = 0;
    int64_t restart_press_ms_ = 0;
    ps_probe::PlayerAction held_action_ = ps_probe::PlayerAction::Action;
    bool holding_repeatable_ = false;
    bool holding_restart_ = false;
    bool restart_fired_ = false;
    uint32_t stable_mask_ = 0;
    uint32_t last_raw_mask_ = 0;
    int debounce_count_ = 0;
    std::vector<ps_probe::TouchGestureEvent> pending_;
};

} // namespace pocket_card
