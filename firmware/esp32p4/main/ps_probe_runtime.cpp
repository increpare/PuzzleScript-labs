#include "ps_probe_runtime.hpp"

#include "sdkconfig.h"
#if CONFIG_PS_BOARD_CARD
#include "board_card.hpp"
#elif CONFIG_PS_BOARD_P4_NANO
#include "board_p4_nano.hpp"
#else
#include "board_waveshare_7b.hpp"
#endif
#include "probe_config.hpp"
#include "ps_instrumentation.hpp"
#include "ps_renderer.hpp"
#include "ps_storage.hpp"

#include "puzzlescript/compiler.h"
#include "puzzlescript/puzzlescript.h"

#include "esp_err.h"
#include "esp_log.h"

#include <cinttypes>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <new>
#include <string>

extern const uint8_t _binary_sokoban_basic_txt_start[] asm("_binary_sokoban_basic_txt_start");
extern const uint8_t _binary_sokoban_basic_txt_end[] asm("_binary_sokoban_basic_txt_end");
extern const uint8_t _binary_broken_smoke_txt_start[] asm("_binary_broken_smoke_txt_start");
extern const uint8_t _binary_broken_smoke_txt_end[] asm("_binary_broken_smoke_txt_end");

namespace ps_probe {
namespace {

constexpr const char* kTag = "ps_probe";
constexpr std::size_t kJsonStringBufferBytes = 384;

struct CompileResultDeleter {
    void operator()(ps_compile_result* result) const {
        ps_free_compile_result(result);
    }
};

struct CompilerResultDeleter {
    void operator()(ps_compiler_result* result) const {
        ps_compiler_result_free(result);
    }
};

struct GameDeleter {
    void operator()(const ps_game* game) const {
        ps_free_game(const_cast<ps_game*>(game));
    }
};

struct FullStateDeleter {
    void operator()(ps_full_state* state) const {
        ps_full_state_destroy(state);
    }
};

struct ErrorDeleter {
    void operator()(const ps_error* error) const {
        ps_free_error(const_cast<ps_error*>(error));
    }
};

using CompileResultPtr = std::unique_ptr<ps_compile_result, CompileResultDeleter>;
using CompilerResultPtr = std::unique_ptr<ps_compiler_result, CompilerResultDeleter>;
using GamePtr = std::unique_ptr<const ps_game, GameDeleter>;
using FullStatePtr = std::unique_ptr<ps_full_state, FullStateDeleter>;
using ErrorPtr = std::unique_ptr<const ps_error, ErrorDeleter>;

class ActiveSourceScope {
public:
    explicit ActiveSourceScope(const char* source) {
        set_active_source(source);
    }

    ~ActiveSourceScope() {
        set_active_source(nullptr);
    }
};

class EscapedJsonString {
public:
    explicit EscapedJsonString(const char* value) {
        append(value == nullptr ? "" : value);
    }

    const char* c_str() const {
        return buffer_;
    }

private:
    void append(const char* value) {
        static constexpr char kHex[] = "0123456789ABCDEF";
        std::size_t out = 0;
        for (const unsigned char* cursor = reinterpret_cast<const unsigned char*>(value); *cursor != '\0'; ++cursor) {
            const unsigned char ch = *cursor;
            const char* replacement = nullptr;
            std::size_t replacement_len = 0;
            char control_escape[6]{'\\', 'u', '0', '0', kHex[ch >> 4], kHex[ch & 0x0f]};

            switch (ch) {
                case '"': replacement = "\\\""; replacement_len = 2; break;
                case '\\': replacement = "\\\\"; replacement_len = 2; break;
                case '\n': replacement = "\\n"; replacement_len = 2; break;
                case '\r': replacement = "\\r"; replacement_len = 2; break;
                case '\t': replacement = "\\t"; replacement_len = 2; break;
                default:
                    if (ch < 0x20) {
                        replacement = control_escape;
                        replacement_len = sizeof(control_escape);
                    }
                    break;
            }

            if (replacement != nullptr) {
                if (out + replacement_len >= sizeof(buffer_)) {
                    break;
                }
                for (std::size_t i = 0; i < replacement_len; ++i) {
                    buffer_[out++] = replacement[i];
                }
            } else {
                if (out + 1 >= sizeof(buffer_)) {
                    break;
                }
                buffer_[out++] = static_cast<char>(ch);
            }
        }
        buffer_[out] = '\0';
    }

    char buffer_[kJsonStringBufferBytes]{};
};

const char* severity_name(ps_diagnostic_severity severity) {
    switch (severity) {
        case PS_DIAG_ERROR: return "error";
        case PS_DIAG_WARNING: return "warning";
        case PS_DIAG_INFO: return "info";
        case PS_DIAG_LOG: return "log";
    }
    return "unknown";
}

void emit_source_event(const char* event, const char* source_name, const char* status, const char* detail) {
    const EscapedJsonString escaped_event(event);
    const EscapedJsonString escaped_source(source_name);
    const EscapedJsonString escaped_status(status);
    const EscapedJsonString escaped_detail(detail);
    ESP_LOGI(kTag,
             "{\"event\":\"%s\",\"source\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\"}",
             escaped_event.c_str(),
             escaped_source.c_str(),
             escaped_status.c_str(),
             escaped_detail.c_str());
}

void emit_compiler_diagnostic(const char* source_name, const ps_diagnostic& diagnostic) {
    try {
        const EscapedJsonString escaped_source(source_name);
        const EscapedJsonString escaped_severity(severity_name(diagnostic.severity));
        const EscapedJsonString escaped_message(diagnostic.message);
        ESP_LOGI(kTag,
                 R"({"event":"diagnostic","source":"%s","severity":"%s","code":%)" PRId32 R"(,"line":%)" PRId32 R"(,"message":"%s"})",
                 escaped_source.c_str(),
                 escaped_severity.c_str(),
                 diagnostic.code,
                 diagnostic.line,
                 escaped_message.c_str());
    } catch (const std::bad_alloc&) {
        emit_source_event("diagnostic", source_name, "fail", "diagnostic_alloc");
    }
}

void emit_compile_error_message(const char* source_name, const ps_compile_result* result) {
    ErrorPtr error;
    try {
        error.reset(ps_compile_result_error(result));
    } catch (const std::bad_alloc&) {
        emit_source_event("compile_error", source_name, "fail", "compile_error_alloc");
        return;
    }
    if (error) {
        const char* message = ps_error_message(error.get());
        emit_source_event("compile_error", source_name, "fail", message == nullptr ? "unknown_error" : message);
    }
}

void emit_compiler_diagnostics(const SourceProbeInput& input) {
    try {
        CompilerResultPtr diagnostics(ps_compiler_compile_source_diagnostics(input.text, input.size));
        if (!diagnostics) {
            emit_source_event("compiler_diagnostics", input.name, "fail", "diagnostics_unavailable");
            return;
        }

        const std::size_t count = ps_compiler_result_diagnostic_count(diagnostics.get());
        for (std::size_t index = 0; index < count; ++index) {
            const ps_diagnostic* diagnostic = ps_compiler_result_diagnostic(diagnostics.get(), index);
            if (diagnostic != nullptr) {
                emit_compiler_diagnostic(input.name, *diagnostic);
            }
        }
        if (count == 0) {
            emit_source_event("compiler_diagnostics", input.name, "pass", "no_diagnostics");
        }
    } catch (const std::bad_alloc&) {
        emit_source_event("compiler_diagnostics", input.name, "fail", "diagnostics_alloc");
    }
}

const char* error_detail(const ErrorPtr& error) {
    if (!error) {
        return "unknown_error";
    }
    const char* message = ps_error_message(error.get());
    return message == nullptr ? "unknown_error" : message;
}

void run_input_trace(ps_full_state* state, const char* source_name) {
    PhaseTimer input_timer(Phase::RunInputTrace);
    try {
        (void)ps_full_state_turn(state, PS_INPUT_RIGHT);
        (void)ps_full_state_turn(state, PS_INPUT_DOWN);
        if (!ps_full_state_undo(state)) {
            emit_phase_result(Phase::RunInputTrace, "fail", "undo_failed", input_timer.elapsed_ms());
            return;
        }
        if (!ps_full_state_restart(state)) {
            emit_phase_result(Phase::RunInputTrace, "fail", "restart_failed", input_timer.elapsed_ms());
            return;
        }
    } catch (const std::bad_alloc&) {
        emit_phase_result(Phase::RunInputTrace, "fail", "input_trace_alloc", input_timer.elapsed_ms());
        return;
    }
    emit_source_event("input_trace", source_name, "pass", "right_down_undo_restart");
    emit_phase_result(Phase::RunInputTrace, "pass", "right_down_undo_restart", input_timer.elapsed_ms());
}

void run_source_probe(const SourceProbeInput& input, uint16_t* framebuffer) {
    ActiveSourceScope source_scope(input.name);
    ps_compile_result* raw_compile_result = nullptr;
    {
        PhaseTimer compile_timer(Phase::CompileSource);
        bool compiled = false;
        try {
            compiled = ps_compile_source(input.text, input.size, &raw_compile_result);
        } catch (const std::bad_alloc&) {
            emit_phase_result(Phase::CompileSource, "fail", "compile_alloc", compile_timer.elapsed_ms());
            return;
        }
        CompileResultPtr compile_result(raw_compile_result);
        raw_compile_result = nullptr;
        if (!compiled || !compile_result) {
            emit_compile_error_message(input.name, compile_result.get());
            emit_compiler_diagnostics(input);
            emit_phase_result(Phase::CompileSource, "fail", "compile_failed", compile_timer.elapsed_ms());
            return;
        }
        emit_phase_result(Phase::CompileSource, "pass", input.name, compile_timer.elapsed_ms());

        PhaseTimer create_timer(Phase::CreateRuntime);
        GamePtr game;
        try {
            game.reset(ps_compile_result_game(compile_result.get()));
        } catch (const std::bad_alloc&) {
            emit_phase_result(Phase::CreateRuntime, "fail", "game_alloc", create_timer.elapsed_ms());
            return;
        }
        if (!game) {
            emit_phase_result(Phase::CreateRuntime, "fail", "game_unavailable", create_timer.elapsed_ms());
            return;
        }

        ps_full_state* raw_state = nullptr;
        ps_error* raw_error = nullptr;
        {
            bool created = false;
            try {
                created = ps_full_state_create(game.get(), &raw_state, &raw_error);
            } catch (const std::bad_alloc&) {
                emit_phase_result(Phase::CreateRuntime, "fail", "runtime_alloc", create_timer.elapsed_ms());
                return;
            }
            ErrorPtr create_error(raw_error);
            raw_error = nullptr;
            if (!created || raw_state == nullptr) {
                emit_phase_result(Phase::CreateRuntime, "fail", error_detail(create_error), create_timer.elapsed_ms());
                return;
            }
            emit_phase_result(Phase::CreateRuntime, "pass", input.name, create_timer.elapsed_ms());
        }
        FullStatePtr state(raw_state);

        {
            PhaseTimer level_timer(Phase::LoadLevel);
            raw_error = nullptr;
            bool loaded = false;
            try {
                loaded = ps_full_state_load_level(state.get(), 0, &raw_error);
            } catch (const std::bad_alloc&) {
                emit_phase_result(Phase::LoadLevel, "fail", "level_alloc", level_timer.elapsed_ms());
                return;
            }
            ErrorPtr level_error(raw_error);
            raw_error = nullptr;
            if (!loaded) {
                emit_phase_result(Phase::LoadLevel, "fail", error_detail(level_error), level_timer.elapsed_ms());
                PhaseTimer unload_timer(Phase::UnloadGame);
                emit_phase_result(Phase::UnloadGame, "pass", input.name, unload_timer.elapsed_ms());
                return;
            }
            emit_phase_result(Phase::LoadLevel, "pass", input.name, level_timer.elapsed_ms());
        }

        if (input.render) {
            PhaseTimer render_timer(Phase::RenderFrame);
            if (framebuffer == nullptr) {
                emit_phase_result(Phase::RenderFrame, "fail", "probe_framebuffer_missing", render_timer.elapsed_ms());
            } else {
                const RenderResult render = render_level_to_native_framebuffer(
                    game.get(),
                    state.get(),
                    framebuffer,
                    kNativeWidth,
                    kNativeHeight);
                if (!render.ok) {
                    emit_phase_result(Phase::RenderFrame, "fail", "renderer_failed", render_timer.elapsed_ms());
                } else {
                    const esp_err_t draw = board::draw_rgb565(framebuffer, 0, 0, kNativeWidth, kNativeHeight);
                    if (draw != ESP_OK) {
                        emit_phase_result(Phase::RenderFrame, "fail", esp_err_to_name(draw), render_timer.elapsed_ms());
                    } else {
                        emit_phase_result(Phase::RenderFrame, "pass", input.name, render_timer.elapsed_ms());
                    }
                }
            }
        }

        if (input.run_input_trace) {
            run_input_trace(state.get(), input.name);
        } else {
            emit_source_event("input_trace", input.name, "pass", "skipped");
            emit_phase_result(Phase::RunInputTrace, "pass", "skipped", 0);
        }

        {
            PhaseTimer unload_timer(Phase::UnloadGame);
            emit_phase_result(Phase::UnloadGame, "pass", input.name, unload_timer.elapsed_ms());
        }
    }
}

void emit_flash_load_pass(const char* name, std::size_t size) {
    ActiveSourceScope source_scope(name);
    char detail[96]{};
    std::snprintf(detail, sizeof(detail), "%s:%zu", name == nullptr ? "" : name, size);
    PhaseTimer load_timer(Phase::LoadSourceFlash);
    emit_phase_result(Phase::LoadSourceFlash, "pass", detail, load_timer.elapsed_ms());
}

void run_loaded_sd_probe(const LoadedSource& source, uint16_t* framebuffer) {
    SourceProbeInput input{
        source.name.c_str(),
        source.text.data(),
        source.text.size(),
        true,
        true,
    };
    run_source_probe(input, framebuffer);
}

} // namespace

void run_embedded_sokoban_probe(uint16_t* framebuffer) {
    const auto* start = _binary_sokoban_basic_txt_start;
    const auto* end = _binary_sokoban_basic_txt_end;
    const std::size_t size = static_cast<std::size_t>(end - start);
    const SourceProbeInput input{
        "embedded:sokoban_basic.txt",
        reinterpret_cast<const char*>(start),
        size,
        true,
        true,
    };
    emit_flash_load_pass(input.name, input.size);
    run_source_probe(input, framebuffer);
}

void run_embedded_broken_probe() {
    const auto* start = _binary_broken_smoke_txt_start;
    const auto* end = _binary_broken_smoke_txt_end;
    const std::size_t size = static_cast<std::size_t>(end - start);
    const SourceProbeInput input{
        "embedded:broken_smoke.txt",
        reinterpret_cast<const char*>(start),
        size,
        false,
        false,
    };
    emit_flash_load_pass(input.name, input.size);
    run_source_probe(input, nullptr);
}

void run_sd_probe_if_available(uint16_t* framebuffer) {
    LoadedSource source;
    {
        PhaseTimer load_timer(Phase::LoadSourceSd);
        const esp_err_t load = load_first_sd_game(source);
        if (load != ESP_OK) {
            emit_phase_result(Phase::LoadSourceSd, "pass", esp_err_to_name(load), load_timer.elapsed_ms());
            return;
        }
        ActiveSourceScope source_scope(source.name.c_str());
        emit_phase_result(Phase::LoadSourceSd, "pass", source.name.c_str(), load_timer.elapsed_ms());
    }
    run_loaded_sd_probe(source, framebuffer);
}

void run_named_sd_probe_if_available(const char* basename, uint16_t* framebuffer) {
    ActiveSourceScope source_scope(basename);
    LoadedSource source;
    {
        PhaseTimer load_timer(Phase::LoadSourceSd);
        const esp_err_t load = load_named_sd_game(basename, source);
        if (load != ESP_OK) {
            emit_phase_result(Phase::LoadSourceSd, "pass", esp_err_to_name(load), load_timer.elapsed_ms());
            return;
        }
        set_active_source(source.name.c_str());
        emit_phase_result(Phase::LoadSourceSd, "pass", source.name.c_str(), load_timer.elapsed_ms());
    }
    run_loaded_sd_probe(source, framebuffer);
}

} // namespace ps_probe
