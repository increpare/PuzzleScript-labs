#include "controls_input.hpp"

#include "mcp23017.hpp"

#include <algorithm>

#include "esp_log.h"
#include "esp_timer.h"

namespace pocket_card {
namespace {

constexpr const char* kTag = "controls_input";
constexpr int kDebounceSamples = 3;
constexpr int kRestartHoldMs = 650;

struct ButtonDef {
    uint8_t port_mask;
    bool port_b;
    ps_probe::PlayerAction action;
    const char* label;
};

constexpr ButtonDef kButtons[] = {
    {0x01, false, ps_probe::PlayerAction::MoveUp, "up"},
    {0x02, false, ps_probe::PlayerAction::MoveDown, "down"},
    {0x04, false, ps_probe::PlayerAction::MoveLeft, "left"},
    {0x08, false, ps_probe::PlayerAction::MoveRight, "right"},
    {0x10, false, ps_probe::PlayerAction::Action, "action"},
    {0x20, false, ps_probe::PlayerAction::Undo, "undo"},
    {0x40, false, ps_probe::PlayerAction::OpenMenu, "menu"},
    {0x80, false, ps_probe::PlayerAction::Restart, "restart"},
};

constexpr std::size_t kButtonCount = sizeof(kButtons) / sizeof(kButtons[0]);

int64_t now_ms() {
    return esp_timer_get_time() / 1000;
}

ps_probe::PlayerAction action_from_mask(uint32_t mask) {
    for (std::size_t i = 0; i < kButtonCount; ++i) {
        if ((mask & (1U << i)) != 0) {
            return kButtons[i].action;
        }
    }
    return ps_probe::PlayerAction::Action;
}

} // namespace

esp_err_t ControlsInput::init() {
    const esp_err_t err = mcp23017_init();
    if (err != ESP_OK) {
        return err;
    }
    stable_mask_ = read_raw_mask();
    last_raw_mask_ = stable_mask_;
    debounce_count_ = 0;
    holding_repeatable_ = false;
    holding_restart_ = false;
    restart_fired_ = false;
    ESP_LOGI(kTag, "MCP23017 controls ready (poll mode)");
    return ESP_OK;
}

void ControlsInput::set_repeat_interval_ms(int interval_ms) {
    repeat_interval_ms_ = std::max(50, interval_ms);
}

bool ControlsInput::repeatable_action(ps_probe::PlayerAction action) const {
    return action == ps_probe::PlayerAction::MoveUp ||
           action == ps_probe::PlayerAction::MoveDown ||
           action == ps_probe::PlayerAction::MoveLeft ||
           action == ps_probe::PlayerAction::MoveRight;
}

void ControlsInput::emit_edge(ps_probe::PlayerAction action) {
    pending_.push_back(ps_probe::TouchGestureEvent{action, 0, 0, 0});
}

void ControlsInput::maybe_emit_repeat() {
    if (!holding_repeatable_) {
        return;
    }
    const int64_t now = now_ms();
    if (now - last_repeat_ms_ < repeat_interval_ms_) {
        return;
    }
    pending_.push_back(ps_probe::TouchGestureEvent{held_action_, 0, 0, 0});
    last_repeat_ms_ = now;
}

void ControlsInput::begin_restart_hold() {
    holding_restart_ = true;
    restart_fired_ = false;
    restart_press_ms_ = now_ms();
    held_action_ = ps_probe::PlayerAction::Restart;
    holding_repeatable_ = false;
}

void ControlsInput::cancel_restart_hold() {
    holding_restart_ = false;
    restart_fired_ = false;
}

void ControlsInput::maybe_emit_restart_hold() {
    if (!holding_restart_ || restart_fired_) {
        return;
    }
    if (now_ms() - restart_press_ms_ < kRestartHoldMs) {
        return;
    }
    emit_edge(ps_probe::PlayerAction::Restart);
    restart_fired_ = true;
}

uint32_t ControlsInput::read_raw_mask() {
    Mcp23017GpioSnapshot snapshot{};
    if (mcp23017_read_gpio(&snapshot) != ESP_OK) {
        return stable_mask_;
    }

    uint32_t mask = 0;
    for (std::size_t i = 0; i < kButtonCount; ++i) {
        const uint8_t port_value = kButtons[i].port_b ? snapshot.gpio_b : snapshot.gpio_a;
        if ((port_value & kButtons[i].port_mask) == 0) {
            mask |= (1U << i);
        }
    }
    return mask;
}

void ControlsInput::poll() {
    const uint32_t raw = read_raw_mask();
    if (raw == last_raw_mask_) {
        if (debounce_count_ < kDebounceSamples) {
            ++debounce_count_;
        }
    } else {
        last_raw_mask_ = raw;
        debounce_count_ = 0;
    }

    if (debounce_count_ < kDebounceSamples) {
        maybe_emit_repeat();
        return;
    }

    const uint32_t previous = stable_mask_;
    stable_mask_ = raw;

    if (stable_mask_ == previous) {
        maybe_emit_repeat();
        maybe_emit_restart_hold();
        return;
    }

    const bool was_pressed = previous != 0;
    const bool is_pressed = stable_mask_ != 0;

    if (!was_pressed && is_pressed) {
        const ps_probe::PlayerAction action = action_from_mask(stable_mask_);
        if (action == ps_probe::PlayerAction::Restart) {
            begin_restart_hold();
        } else {
            cancel_restart_hold();
            emit_edge(action);
            if (repeatable_action(action)) {
                holding_repeatable_ = true;
                held_action_ = action;
                last_repeat_ms_ = now_ms();
            } else {
                holding_repeatable_ = false;
            }
        }
        return;
    }

    if (was_pressed && !is_pressed) {
        holding_repeatable_ = false;
        cancel_restart_hold();
        return;
    }

    if (was_pressed && is_pressed && stable_mask_ != previous) {
        held_action_ = action_from_mask(stable_mask_);
        if (held_action_ == ps_probe::PlayerAction::Restart) {
            begin_restart_hold();
        } else {
            cancel_restart_hold();
            emit_edge(held_action_);
            holding_repeatable_ = repeatable_action(held_action_);
            last_repeat_ms_ = now_ms();
        }
    }

    maybe_emit_repeat();
    maybe_emit_restart_hold();
}

std::vector<ps_probe::TouchGestureEvent> ControlsInput::drain_events() {
    std::vector<ps_probe::TouchGestureEvent> events;
    events.swap(pending_);
    return events;
}

} // namespace pocket_card
