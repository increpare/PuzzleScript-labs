#include "runtime_probe.hpp"

#include <cstddef>
#include <cstdint>
#include <cstring>

#include "ambient_led.hpp"
#include "probe_log.hpp"
#include "puzzlescript/puzzlescript.h"

extern const uint8_t embedded_ir_start[] asm("_binary_sokoban_basic_ir_json_start");
extern const uint8_t embedded_ir_end[] asm("_binary_sokoban_basic_ir_json_end");

namespace pocket_card {
namespace {

void emit_failure(Phase phase, const char* controlled_detail, int64_t started, ps_error* error = nullptr) {
    emit_phase(phase, "fail", controlled_detail, now_ms() - started);
    if (error != nullptr) {
        ps_free_error(error);
    }
}

bool player_is_at(const ps_full_state* state, int32_t expected_x, int32_t expected_y) {
    int32_t x = 0;
    int32_t y = 0;
    return ps_full_state_first_player_position(state, &x, &y) && x == expected_x && y == expected_y;
}

void free_runtime(ps_full_state*& state, ps_game*& game) {
    if (state != nullptr) {
        ps_full_state_destroy(state);
        state = nullptr;
    }
    if (game != nullptr) {
        ps_free_game(game);
        game = nullptr;
    }
}

} // namespace

void run_runtime_probe() {
    ps_game* game = nullptr;
    ps_full_state* state = nullptr;
    ps_error* error = nullptr;

    int64_t started = now_ms();
    const std::uintptr_t start_address = reinterpret_cast<std::uintptr_t>(embedded_ir_start);
    const std::uintptr_t end_address = reinterpret_cast<std::uintptr_t>(embedded_ir_end);
    if (!(end_address > start_address)) {
        emit_failure(Phase::LoadIr, "load_ir_failed", started);
        return;
    }
    const std::size_t ir_size = static_cast<std::size_t>(end_address - start_address);
    try {
        if (!ps_load_ir_json(reinterpret_cast<const char*>(embedded_ir_start), ir_size, &game, &error)) {
            emit_failure(Phase::LoadIr, "load_ir_failed", started, error);
            ps_free_game(game);
            return;
        }
    } catch (...) {
        emit_failure(Phase::LoadIr, "load_ir_failed", started, error);
        ps_free_game(game);
        return;
    }
    emit_phase(Phase::LoadIr, "pass", "sokoban_basic.ir.json", now_ms() - started);

    started = now_ms();
    try {
        if (!ps_full_state_create(game, &state, &error)) {
            emit_failure(Phase::CreateRuntime, "create_runtime_failed", started, error);
            free_runtime(state, game);
            return;
        }
    } catch (...) {
        emit_failure(Phase::CreateRuntime, "create_runtime_failed", started, error);
        free_runtime(state, game);
        return;
    }
    emit_phase(Phase::CreateRuntime, "pass", "runtime_created", now_ms() - started);

    started = now_ms();
    try {
        if (!ps_full_state_load_level(state, 0, &error)) {
            emit_failure(Phase::LoadLevel, "load_level_failed", started, error);
            free_runtime(state, game);
            return;
        }
    } catch (...) {
        emit_failure(Phase::LoadLevel, "load_level_failed", started, error);
        free_runtime(state, game);
        return;
    }
    emit_phase(Phase::LoadLevel, "pass", "level_0", now_ms() - started);

    // Ambient light per the pocket-card spec: the RGB LED mirrors the game's
    // background color at half brightness, off for black.
    started = now_ms();
    const char* background_color = ps_game_background_color(game);
    const AmbientColor ambient = ambient_color_for_background(background_color);
    const char* ambient_failure = nullptr;
    if (ambient_led_init() != ESP_OK) {
        ambient_failure = "ambient_init_failed";
    } else if (std::strcmp(background_color, "#000000") == 0 && !ambient.is_off()) {
        ambient_failure = "black_background_not_off";
    } else if (ambient_led_apply_background(background_color) != ESP_OK) {
        ambient_failure = "ambient_apply_failed";
    }

    if (ambient_failure != nullptr) {
        emit_phase(Phase::AmbientLed, "fail", ambient_failure, now_ms() - started);
    } else {
        emit_phase(
            Phase::AmbientLed,
            "pass",
            ambient.is_off() ? "ambient_off" : "ambient_on",
            now_ms() - started);
    }

    started = now_ms();
    const char* input_failure = nullptr;
    try {
        if (!player_is_at(state, 2, 3)) {
            input_failure = "initial_player_position_failed";
        } else {
            (void)ps_full_state_turn(state, PS_INPUT_RIGHT);
            (void)ps_full_state_turn(state, PS_INPUT_DOWN);
            if (!player_is_at(state, 3, 3)) {
                input_failure = "right_down_position_failed";
            } else if (!ps_full_state_undo(state) || !player_is_at(state, 2, 3)) {
                input_failure = "undo_failed";
            } else {
                (void)ps_full_state_turn(state, PS_INPUT_RIGHT);
                if (!player_is_at(state, 3, 3)) {
                    input_failure = "pre_restart_position_failed";
                } else if (!ps_full_state_restart(state) || !player_is_at(state, 2, 3)) {
                    input_failure = "restart_failed";
                }
            }
        }
    } catch (...) {
        input_failure = "input_trace_exception";
    }

    if (input_failure != nullptr) {
        emit_failure(Phase::InputTrace, input_failure, started);
    } else {
        emit_phase(Phase::InputTrace, "pass", "right_down_undo_restart", now_ms() - started);
    }

    started = now_ms();
    (void)ambient_led_off();
    free_runtime(state, game);
    emit_phase(Phase::Unload, "pass", "runtime_freed", now_ms() - started);
}

} // namespace pocket_card
