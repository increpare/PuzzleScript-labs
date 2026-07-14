#include "pocket_player.hpp"

#include <cstdlib>
#include <memory>
#include <string>

#include "ambient_led.hpp"
#include "board_display.hpp"
#include "controls_input.hpp"
#include "probe_config.hpp"
#include "ps_dot_font.hpp"
#include "ps_framebuffer.hpp"
#include "ps_renderer.hpp"
#include "ps_text_screen.hpp"
#include "ps_touch_gestures.hpp"
#include "ps_ui_draw.hpp"

#include "puzzlescript/puzzlescript.h"

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

extern const uint8_t embedded_ir_start[] asm("_binary_sokoban_basic_ir_json_start");
extern const uint8_t embedded_ir_end[] asm("_binary_sokoban_basic_ir_json_end");

namespace pocket_card {
namespace {

constexpr const char* kTag = "pocket_player";
constexpr uint16_t kUiText = 0xFFFF;
constexpr uint16_t kUiMuted = 0xC618;

struct GameDeleter {
    void operator()(ps_game* game) const { ps_free_game(game); }
};
struct StateDeleter {
    void operator()(ps_full_state* state) const { ps_full_state_destroy(state); }
};
using GamePtr = std::unique_ptr<ps_game, GameDeleter>;
using StatePtr = std::unique_ptr<ps_full_state, StateDeleter>;

int64_t now_ms() {
    return esp_timer_get_time() / 1000;
}

int parse_interval_ms(const char* metadata_value, int default_ms) {
    if (metadata_value == nullptr || metadata_value[0] == '\0') {
        return default_ms;
    }
    const double seconds = std::atof(metadata_value);
    if (seconds <= 0.0) {
        return default_ms;
    }
    return std::max(1, static_cast<int>(seconds * 1000.0));
}

uint16_t game_background_rgb565(const ps_game* game) {
    const char* color = ps_game_background_color(game);
    if (color == nullptr || color[0] != '#') {
        return 0x0000;
    }
    const auto hex = [](char ch) -> int {
        if (ch >= '0' && ch <= '9') {
            return ch - '0';
        }
        if (ch >= 'a' && ch <= 'f') {
            return 10 + ch - 'a';
        }
        if (ch >= 'A' && ch <= 'F') {
            return 10 + ch - 'A';
        }
        return 0;
    };
    if (color[1] == '\0') {
        return 0x0000;
    }
    if (color[4] != '\0' && color[7] == '\0') {
        const int r = (hex(color[1]) << 4) | hex(color[2]);
        const int g = (hex(color[3]) << 4) | hex(color[4]);
        const int b = (hex(color[5]) << 4) | hex(color[6]);
        return ps_probe::rgb565(static_cast<uint8_t>(r), static_cast<uint8_t>(g), static_cast<uint8_t>(b));
    }
    return 0x0000;
}

bool load_embedded_game(GamePtr& game, StatePtr& state, std::string& error_message) {
    const std::uintptr_t start_address = reinterpret_cast<std::uintptr_t>(embedded_ir_start);
    const std::uintptr_t end_address = reinterpret_cast<std::uintptr_t>(embedded_ir_end);
    if (!(end_address > start_address)) {
        error_message = "missing embedded game";
        return false;
    }

    ps_game* raw_game = nullptr;
    ps_error* error = nullptr;
    const std::size_t ir_size = static_cast<std::size_t>(end_address - start_address);
    if (!ps_load_ir_json(reinterpret_cast<const char*>(embedded_ir_start), ir_size, &raw_game, &error)) {
        error_message = "load_ir_failed";
        ps_free_error(error);
        ps_free_game(raw_game);
        return false;
    }
    game.reset(raw_game);

    ps_full_state* raw_state = nullptr;
    if (!ps_full_state_create(game.get(), &raw_state, &error)) {
        error_message = "create_runtime_failed";
        ps_free_error(error);
        return false;
    }
    state.reset(raw_state);

    if (!ps_full_state_load_level(state.get(), 0, &error)) {
        error_message = "load_level_failed";
        ps_free_error(error);
        return false;
    }
    return true;
}

void draw_message_screen(uint16_t* framebuffer, const ps_game* game, const ps_full_state* state) {
    const uint16_t bg = game_background_rgb565(game);
    const uint16_t fg = bg == 0x0000 ? kUiText : static_cast<uint16_t>(~bg);
    const auto rows = ps_probe::generate_message_rows(state);
    ps_probe::draw_text_rows(framebuffer, ps_probe::kNativeWidth, ps_probe::kNativeHeight, rows, fg, bg);
}

void draw_menu_overlay(uint16_t* framebuffer, uint16_t bg, uint16_t fg) {
    ps_probe::ui_dim_rect(
        framebuffer,
        ps_probe::kNativeWidth,
        ps_probe::kNativeHeight,
        0,
        0,
        ps_probe::kNativeWidth,
        ps_probe::kNativeHeight,
        bg,
        2);
    ps_probe::ui_draw_centered_text(
        framebuffer,
        ps_probe::kNativeWidth,
        ps_probe::kNativeHeight,
        ps_probe::kNativeHeight - 72,
        "UNDO  RESTART",
        fg,
        2);
    ps_probe::ui_draw_centered_text(
        framebuffer,
        ps_probe::kNativeWidth,
        ps_probe::kNativeHeight,
        ps_probe::kNativeHeight - 36,
        "MENU closes",
        kUiMuted,
        1);
}

void draw_error_screen(uint16_t* framebuffer, const char* message) {
    ps_probe::ui_fill_rect(
        framebuffer,
        ps_probe::kNativeWidth,
        ps_probe::kNativeHeight,
        0,
        0,
        ps_probe::kNativeWidth,
        ps_probe::kNativeHeight,
        0xF800);
    ps_probe::ui_draw_centered_text(
        framebuffer,
        ps_probe::kNativeWidth,
        ps_probe::kNativeHeight,
        100,
        "Error",
        kUiText,
        2);
    ps_probe::ui_draw_centered_text(
        framebuffer,
        ps_probe::kNativeWidth,
        ps_probe::kNativeHeight,
        140,
        message,
        kUiText,
        1);
}

bool handle_input(
    const ps_probe::TouchGestureEvent& event,
    GamePtr& game,
    StatePtr& state,
    bool& menu_open) {
    if (event.action == ps_probe::PlayerAction::OpenMenu) {
        menu_open = !menu_open;
        return true;
    }
    if (event.action == ps_probe::PlayerAction::CloseMenu) {
        menu_open = false;
        return true;
    }
    if (event.action == ps_probe::PlayerAction::Undo) {
        return ps_full_state_undo(state.get());
    }
    if (event.action == ps_probe::PlayerAction::Restart) {
        return ps_full_state_restart(state.get());
    }

    ps_full_state_status_info status{};
    ps_full_state_status(state.get(), &status);
    if (status.mode == PS_FULL_STATE_MODE_MESSAGE) {
        if (event.action == ps_probe::PlayerAction::Action) {
            (void)ps_full_state_turn(state.get(), PS_INPUT_ACTION);
        }
        return true;
    }

    if (event.action == ps_probe::PlayerAction::MoveUp ||
        event.action == ps_probe::PlayerAction::MoveDown ||
        event.action == ps_probe::PlayerAction::MoveLeft ||
        event.action == ps_probe::PlayerAction::MoveRight ||
        event.action == ps_probe::PlayerAction::Action) {
        if (event.action == ps_probe::PlayerAction::Action && ps_game_has_metadata(game.get(), "noaction")) {
            return true;
        }
        (void)ps_full_state_turn(state.get(), ps_probe::player_action_to_ps_input(event.action));
        return true;
    }
    return false;
}

void render_frame(
    uint16_t* framebuffer,
    const GamePtr& game,
    const StatePtr& state,
    bool menu_open) {
    const uint16_t game_bg = game_background_rgb565(game.get());
    const uint16_t game_fg = game_bg == 0x0000 ? kUiText : static_cast<uint16_t>(~game_bg);

    ps_full_state_status_info status{};
    ps_full_state_status(state.get(), &status);
    if (status.mode == PS_FULL_STATE_MODE_MESSAGE) {
        draw_message_screen(framebuffer, game.get(), state.get());
    } else {
        const ps_probe::RenderResult rendered = ps_probe::render_level_to_native_framebuffer(
            game.get(),
            state.get(),
            framebuffer,
            ps_probe::kNativeWidth,
            ps_probe::kNativeHeight);
        if (!rendered.ok) {
            draw_error_screen(framebuffer, "render failed");
            return;
        }
    }

    if (menu_open) {
        draw_menu_overlay(framebuffer, game_bg, game_fg);
    }

    (void)ambient_led_apply_background(ps_game_background_color(game.get()));
}

} // namespace

void run_pocket_player() {
    ESP_LOGI(kTag, "starting pocket player");

    if (board::init_display() != ESP_OK) {
        ESP_LOGE(kTag, "display init failed");
        return;
    }

    ControlsInput controls;
    if (controls.init() != ESP_OK) {
        ESP_LOGE(kTag, "controls init failed");
        return;
    }

    if (!ps_probe::dot_font_init()) {
        ESP_LOGW(kTag, "dot font init failed; text screens may be blank");
    }
    (void)ambient_led_init();

    auto* framebuffer = static_cast<uint16_t*>(
        heap_caps_malloc(ps_probe::kNativeFramebufferBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (framebuffer == nullptr) {
        framebuffer = static_cast<uint16_t*>(heap_caps_malloc(ps_probe::kNativeFramebufferBytes, MALLOC_CAP_8BIT));
    }
    if (framebuffer == nullptr) {
        ESP_LOGE(kTag, "framebuffer alloc failed");
        return;
    }

    GamePtr game;
    StatePtr state;
    std::string error_message;
    if (!load_embedded_game(game, state, error_message)) {
        draw_error_screen(framebuffer, error_message.c_str());
        (void)board::draw_rgb565(framebuffer, 0, 0, ps_probe::kNativeWidth, ps_probe::kNativeHeight);
        heap_caps_free(framebuffer);
        return;
    }

    controls.set_repeat_interval_ms(
        parse_interval_ms(ps_game_metadata_value(game.get(), "key_repeat_interval"), 150));

    bool menu_open = false;
    while (true) {
        controls.poll();
        for (const ps_probe::TouchGestureEvent& event : controls.drain_events()) {
            (void)handle_input(event, game, state, menu_open);
        }

        render_frame(framebuffer, game, state, menu_open);
        (void)board::draw_rgb565(framebuffer, 0, 0, ps_probe::kNativeWidth, ps_probe::kNativeHeight);
        vTaskDelay(pdMS_TO_TICKS(16));
    }
}

} // namespace pocket_card
