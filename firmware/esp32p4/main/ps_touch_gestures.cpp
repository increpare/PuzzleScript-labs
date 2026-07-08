#include "ps_touch_gestures.hpp"

#include <algorithm>
#include <cstdlib>

#include "esp_timer.h"

namespace ps_probe {
namespace {

constexpr int kSwipeThresholdPx = 8;
constexpr int kSwipeDistancePx = 40;
constexpr int kSwipeCancelPerpPx = 32;
constexpr int64_t kSwipeTimeoutMs = 1000;
constexpr int64_t kLongPressMs = 700;

int64_t now_ms() {
    return esp_timer_get_time() / 1000;
}

int dominant_direction(int dx, int dy) {
    if (std::abs(dx) >= std::abs(dy)) {
        return dx > 0 ? 1 : (dx < 0 ? 3 : -1);
    }
    return dy > 0 ? 2 : (dy < 0 ? 0 : -1);
}

int cardinal_distance(int x0, int y0, int x1, int y1) {
    return std::max(std::abs(x1 - x0), std::abs(y1 - y0));
}

int axis_progress(int direction, int x0, int y0, int x1, int y1) {
    switch (direction) {
        case 0: return y0 - y1;
        case 1: return x1 - x0;
        case 2: return y1 - y0;
        case 3: return x0 - x1;
        default: return 0;
    }
}

int perpendicular_slop(int direction, int x0, int y0, int x1, int y1) {
    switch (direction) {
        case 0:
        case 2:
            return std::abs(x1 - x0);
        case 1:
        case 3:
            return std::abs(y1 - y0);
        default:
            return 0;
    }
}

PlayerAction direction_to_action(int direction) {
    switch (direction) {
        case 0: return PlayerAction::MoveUp;
        case 1: return PlayerAction::MoveRight;
        case 2: return PlayerAction::MoveDown;
        case 3: return PlayerAction::MoveLeft;
        default: return PlayerAction::Action;
    }
}

} // namespace

void TouchGestureInput::set_repeat_interval_ms(int interval_ms) {
    repeat_interval_ms_ = std::max(50, interval_ms);
}

void TouchGestureInput::begin_repeat(PlayerAction action, int x, int y) {
    repeating_ = true;
    repeat_action_ = action;
    repeat_origin_x_ = x;
    repeat_origin_y_ = y;
    last_repeat_ms_ = now_ms();
}

void TouchGestureInput::maybe_emit_repeat(int x, int y) {
    if (!repeating_) {
        return;
    }
    if (cardinal_distance(repeat_origin_x_, repeat_origin_y_, x, y) >= kSwipeDistancePx) {
        repeat_origin_x_ = x;
        repeat_origin_y_ = y;
        const int direction = dominant_direction(x - start_x_, y - start_y_);
        if (direction >= 0) {
            repeat_action_ = direction_to_action(direction);
        }
    }
    const int64_t now = now_ms();
    if (now - last_repeat_ms_ < repeat_interval_ms_) {
        return;
    }
    pending_.push_back(TouchGestureEvent{repeat_action_, 0, x, y});
    last_repeat_ms_ = now;
}

bool TouchGestureInput::try_emit_swipe(int x, int y) {
    if (!may_swipe_) {
        return false;
    }

    int direction = swipe_direction_;
    int progress = 0;
    if (direction >= 0) {
        progress = axis_progress(direction, start_x_, start_y_, x, y);
    }

    if (direction < 0 || progress < kSwipeDistancePx) {
        const int total = cardinal_distance(start_x_, start_y_, x, y);
        if (total < kSwipeDistancePx) {
            return false;
        }
        direction = dominant_direction(x - start_x_, y - start_y_);
        if (direction < 0) {
            return false;
        }
        progress = axis_progress(direction, start_x_, start_y_, x, y);
        if (progress < kSwipeDistancePx) {
            return false;
        }
    }

    if (touch_count_ == 1) {
        const PlayerAction action = direction_to_action(direction);
        pending_.push_back(TouchGestureEvent{action, 0, x, y});
        begin_repeat(action, x, y);
    } else if (touch_count_ >= 2) {
        pending_.push_back(TouchGestureEvent{PlayerAction::OpenMenu, 0, x, y});
    }
    return true;
}

void TouchGestureInput::reset() {
    touching_ = false;
    may_swipe_ = false;
    gestured_ = false;
    repeating_ = false;
    swipe_direction_ = -1;
    swipe_distance_ = 0;
    pending_.clear();
}

void TouchGestureInput::on_touch_frame(int x, int y, int touch_count, bool touching) {
    if (!touching) {
        if (touching_ && !gestured_) {
            if (touch_count_ >= 2) {
                pending_.push_back(TouchGestureEvent{PlayerAction::OpenMenu, 0, last_x_, last_y_});
            } else if (!try_emit_swipe(last_x_, last_y_)) {
                const int64_t held_ms = now_ms() - start_time_ms_;
                if (held_ms >= kLongPressMs) {
                    pending_.push_back(TouchGestureEvent{PlayerAction::OpenMenu, 0, last_x_, last_y_});
                } else {
                    pending_.push_back(TouchGestureEvent{PlayerAction::Action, 0, last_x_, last_y_});
                }
            }
        }
        touching_ = false;
        may_swipe_ = false;
        gestured_ = false;
        repeating_ = false;
        swipe_direction_ = -1;
        swipe_distance_ = 0;
        return;
    }

    if (!touching_) {
        touching_ = true;
        may_swipe_ = true;
        gestured_ = false;
        swipe_direction_ = -1;
        swipe_distance_ = 0;
        start_x_ = x;
        start_y_ = y;
        last_x_ = x;
        last_y_ = y;
        touch_count_ = touch_count;
        start_time_ms_ = now_ms();
        if (touch_count >= 2) {
            pending_.push_back(TouchGestureEvent{PlayerAction::OpenMenu, 0, x, y});
            gestured_ = true;
            may_swipe_ = false;
        }
        return;
    }

    last_x_ = x;
    last_y_ = y;
    if (gestured_) {
        maybe_emit_repeat(x, y);
        return;
    }
    if (!may_swipe_) {
        return;
    }

    if (touch_count < touch_count_) {
        may_swipe_ = false;
        return;
    }
    if (now_ms() - start_time_ms_ > kSwipeTimeoutMs) {
        may_swipe_ = false;
        return;
    }

    const int distance = cardinal_distance(start_x_, start_y_, x, y);
    swipe_distance_ = distance;
    if (swipe_direction_ < 0) {
        if (distance > kSwipeThresholdPx) {
            swipe_direction_ = dominant_direction(x - start_x_, y - start_y_);
            touch_count_ = touch_count;
        }
        return;
    }

    if (perpendicular_slop(swipe_direction_, start_x_, start_y_, x, y) > kSwipeCancelPerpPx) {
        may_swipe_ = false;
        return;
    }

    const int progress = axis_progress(swipe_direction_, start_x_, start_y_, x, y);
    swipe_distance_ = progress;
    if (progress < kSwipeDistancePx) {
        return;
    }

    if (try_emit_swipe(x, y)) {
        gestured_ = true;
        may_swipe_ = false;
    }
}

std::vector<TouchGestureEvent> TouchGestureInput::drain_events() {
    std::vector<TouchGestureEvent> events;
    events.swap(pending_);
    return events;
}

ps_input player_action_to_ps_input(PlayerAction action) {
    switch (action) {
        case PlayerAction::MoveUp: return PS_INPUT_UP;
        case PlayerAction::MoveDown: return PS_INPUT_DOWN;
        case PlayerAction::MoveLeft: return PS_INPUT_LEFT;
        case PlayerAction::MoveRight: return PS_INPUT_RIGHT;
        case PlayerAction::Action: return PS_INPUT_ACTION;
        default: return PS_INPUT_TICK;
    }
}

} // namespace ps_probe
