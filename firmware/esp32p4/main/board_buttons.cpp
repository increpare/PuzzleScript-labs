#include "board_buttons.hpp"

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "sdkconfig.h"

#if CONFIG_PS_BOARD_CARD
#include "board_card_pins.hpp"
#endif

#include <algorithm>

namespace ps_probe {
namespace {

constexpr const char* kTag = "board_buttons";
constexpr int kDebounceSamples = 3;

struct ButtonDef {
    gpio_num_t gpio;
    PlayerAction action;
    const char* label;
};

// PH2.0 GPIO header — see breadboard wiring notes in Track 1 devkit design.
#if CONFIG_PS_BOARD_CARD
constexpr ButtonDef kButtons[] = {
    {static_cast<gpio_num_t>(board::card_pins::kSwDpadUp), PlayerAction::MoveUp, "up"},
    {static_cast<gpio_num_t>(board::card_pins::kSwDpadDown), PlayerAction::MoveDown, "down"},
    {static_cast<gpio_num_t>(board::card_pins::kSwDpadLeft), PlayerAction::MoveLeft, "left"},
    {static_cast<gpio_num_t>(board::card_pins::kSwDpadRight), PlayerAction::MoveRight, "right"},
    {static_cast<gpio_num_t>(board::card_pins::kSwAction), PlayerAction::Action, "action"},
    {static_cast<gpio_num_t>(board::card_pins::kSwUndo), PlayerAction::Undo, "undo"},
    {static_cast<gpio_num_t>(board::card_pins::kSwRestart), PlayerAction::Restart, "restart"},
    {static_cast<gpio_num_t>(board::card_pins::kSwMenu), PlayerAction::OpenMenu, "menu"},
};
#else
constexpr ButtonDef kButtons[] = {
    {GPIO_NUM_28, PlayerAction::MoveUp, "up"},
    {GPIO_NUM_29, PlayerAction::MoveDown, "down"},
    {GPIO_NUM_30, PlayerAction::MoveLeft, "left"},
    {GPIO_NUM_31, PlayerAction::MoveRight, "right"},
    {GPIO_NUM_32, PlayerAction::Action, "action"},
    {GPIO_NUM_34, PlayerAction::Undo, "undo"},
    {GPIO_NUM_35, PlayerAction::Restart, "restart"},
    {GPIO_NUM_49, PlayerAction::OpenMenu, "menu"},
};
#endif

constexpr std::size_t kButtonCount = sizeof(kButtons) / sizeof(kButtons[0]);

int64_t now_ms() {
    return esp_timer_get_time() / 1000;
}

uint32_t read_raw_mask() {
    uint32_t mask = 0;
    for (std::size_t i = 0; i < kButtonCount; ++i) {
        if (gpio_get_level(kButtons[i].gpio) == 0) {
            mask |= (1U << i);
        }
    }
    return mask;
}

PlayerAction action_from_mask(uint32_t mask) {
    for (std::size_t i = 0; i < kButtonCount; ++i) {
        if ((mask & (1U << i)) != 0) {
            return kButtons[i].action;
        }
    }
    return PlayerAction::Action;
}

const char* label_from_action(PlayerAction action) {
    for (const ButtonDef& button : kButtons) {
        if (button.action == action) {
            return button.label;
        }
    }
    return "?";
}

} // namespace

esp_err_t ButtonInput::init() {
    uint64_t pin_mask = 0;
    for (const ButtonDef& button : kButtons) {
        pin_mask |= (1ULL << button.gpio);
    }

    gpio_config_t config = {
        .pin_bit_mask = pin_mask,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    const esp_err_t err = gpio_config(&config);
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "gpio_config failed: %s", esp_err_to_name(err));
        return err;
    }

    stable_mask_ = read_raw_mask();
    last_raw_mask_ = stable_mask_;
    debounce_count_ = 0;
    holding_repeatable_ = false;
#if CONFIG_PS_BOARD_CARD
    ESP_LOGI(kTag, "card buttons ready (GPIO 28-34,37 active-low)");
#else
    ESP_LOGI(kTag, "breadboard buttons ready (GPIO 28-32,34,35,49 active-low)");
#endif
    return ESP_OK;
}

void ButtonInput::set_repeat_interval_ms(int interval_ms) {
    repeat_interval_ms_ = std::max(50, interval_ms);
}

bool ButtonInput::repeatable_action(PlayerAction action) const {
    return action == PlayerAction::MoveUp ||
           action == PlayerAction::MoveDown ||
           action == PlayerAction::MoveLeft ||
           action == PlayerAction::MoveRight;
}

void ButtonInput::emit_edge(PlayerAction action) {
    pending_.push_back(TouchGestureEvent{action, 0, 0, 0});
    ESP_LOGD(kTag, "press %s", label_from_action(action));
}

void ButtonInput::maybe_emit_repeat() {
    if (!holding_repeatable_) {
        return;
    }
    const int64_t now = now_ms();
    if (now - last_repeat_ms_ < repeat_interval_ms_) {
        return;
    }
    pending_.push_back(TouchGestureEvent{held_action_, 0, 0, 0});
    last_repeat_ms_ = now;
}

void ButtonInput::poll() {
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
        return;
    }

    const bool was_pressed = previous != 0;
    const bool is_pressed = stable_mask_ != 0;

    if (!was_pressed && is_pressed) {
        const PlayerAction action = action_from_mask(stable_mask_);
        emit_edge(action);
        if (repeatable_action(action)) {
            holding_repeatable_ = true;
            held_action_ = action;
            last_repeat_ms_ = now_ms();
        } else {
            holding_repeatable_ = false;
        }
        return;
    }

    if (was_pressed && !is_pressed) {
        holding_repeatable_ = false;
        return;
    }

    if (was_pressed && is_pressed && stable_mask_ != previous) {
        const PlayerAction action = action_from_mask(stable_mask_);
        emit_edge(action);
        holding_repeatable_ = repeatable_action(action);
        held_action_ = action;
        last_repeat_ms_ = now_ms();
    }

    maybe_emit_repeat();
}

std::vector<TouchGestureEvent> ButtonInput::drain_events() {
    std::vector<TouchGestureEvent> events;
    events.swap(pending_);
    return events;
}

} // namespace ps_probe
