#pragma once

#include <optional>
#include <vector>

#include "puzzlescript/puzzlescript.h"

namespace ps_probe {

enum class PlayerAction {
    MoveUp,
    MoveDown,
    MoveLeft,
    MoveRight,
    Action,
    Undo,
    Restart,
    OpenMenu,
    CloseMenu,
    ScrollLibrary,
    SelectLibraryItem,
};

struct TouchGestureEvent {
    PlayerAction action;
    int delta_y = 0;
    int tap_x = 0;
    int tap_y = 0;
};

class TouchGestureInput {
public:
    void reset();
    void on_touch_frame(int x, int y, int touch_count, bool touching);
    std::vector<TouchGestureEvent> drain_events();

private:
    bool try_emit_swipe(int x, int y);
    bool touching_ = false;
    bool may_swipe_ = false;
    bool gestured_ = false;
    int start_x_ = 0;
    int start_y_ = 0;
    int last_x_ = 0;
    int last_y_ = 0;
    int touch_count_ = 0;
    int swipe_direction_ = -1;
    int swipe_distance_ = 0;
    int64_t start_time_ms_ = 0;
    std::vector<TouchGestureEvent> pending_;
};

ps_input player_action_to_ps_input(PlayerAction action);

} // namespace ps_probe
