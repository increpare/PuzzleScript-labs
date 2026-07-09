#if CONFIG_PS_BOARD_CARD
#include "board_card.hpp"
#else
#include "board_waveshare_7b.hpp"
#endif
#include "probe_config.hpp"
#include "ps_framebuffer.hpp"
#include "ps_instrumentation.hpp"
#include "ps_player.hpp"
#include "ps_probe_runtime.hpp"
#include "ps_simulation_corpus.hpp"
#include "ps_storage.hpp"

#include "esp_err.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

using ps_probe::Phase;
using ps_probe::PhaseTimer;

extern "C" void app_main(void) {
    ps_probe::instrumentation_init();

    {
        PhaseTimer boot(Phase::Boot);
        ps_probe::emit_boot_summary();
        ps_probe::emit_phase_result(Phase::Boot, "pass", "boot_summary", boot.elapsed_ms());
    }

#if CONFIG_PS_PLAYER_APP
    ps_probe::run_player_app();
    return;
#endif

#if CONFIG_PS_SIMULATION_CORPUS_BOOT
    if (ps_probe::simulation_corpus_bundle_available()) {
        ps_probe::run_simulation_corpus_if_available();
        return;
    }
#endif

    {
        PhaseTimer display(Phase::DisplayInit);
        const esp_err_t init = ps_probe::board::init_display();
        if (init == ESP_OK) {
            ps_probe::set_framebuffer_policy({"native_1024x600", ps_probe::kNativeWidth, ps_probe::kNativeHeight, 1, ps_probe::kRgb565BytesPerPixel});
            auto* fb = static_cast<uint16_t*>(heap_caps_malloc(ps_probe::kNativeFramebufferBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
            if (fb == nullptr) {
                ps_probe::emit_phase_result(Phase::DisplayInit, "fail", "framebuffer_alloc", display.elapsed_ms());
                return;
            }

            ps_probe::fill_native_diagnostic(fb, ps_probe::kNativeWidth * ps_probe::kNativeHeight);
            const esp_err_t native_draw = ps_probe::board::draw_rgb565(fb, 0, 0, ps_probe::kNativeWidth, ps_probe::kNativeHeight);
            if (native_draw != ESP_OK) {
                heap_caps_free(fb);
                ps_probe::emit_phase_result(Phase::DisplayInit, "fail", esp_err_to_name(native_draw), display.elapsed_ms());
                return;
            }
            ps_probe::emit_phase_result(Phase::DisplayInit, "pass", "native_1024x600_diagnostic", display.elapsed_ms());

            vTaskDelay(pdMS_TO_TICKS(1200));
            ps_probe::set_framebuffer_policy({"target_800x480", ps_probe::kNativeWidth, ps_probe::kNativeHeight, 1, ps_probe::kRgb565BytesPerPixel});
            ps_probe::fill_target_800x480_diagnostic(fb, ps_probe::kNativeWidth * ps_probe::kNativeHeight);
            const esp_err_t target_draw = ps_probe::board::draw_rgb565(fb, 0, 0, ps_probe::kNativeWidth, ps_probe::kNativeHeight);
            if (target_draw != ESP_OK) {
                heap_caps_free(fb);
                ps_probe::emit_phase_result(Phase::DisplayInit, "fail", esp_err_to_name(target_draw), display.elapsed_ms());
                return;
            }

            heap_caps_free(fb);
            ps_probe::emit_phase_result(Phase::DisplayInit, "pass", "target_800x480_diagnostic", display.elapsed_ms());
        } else {
            ps_probe::emit_phase_result(Phase::DisplayInit, "fail", esp_err_to_name(init), display.elapsed_ms());
        }
    }

    {
        PhaseTimer storage(Phase::StorageInit);
        const esp_err_t mount = ps_probe::mount_sd_card();
        if (mount == ESP_OK) {
            const auto games = ps_probe::list_sd_games();
            ps_probe::emit_phase_result(
                Phase::StorageInit,
                "pass",
                games.empty() ? "mounted_no_games" : "mounted_games",
                storage.elapsed_ms());
        } else {
            ps_probe::emit_phase_result(Phase::StorageInit, "pass", esp_err_to_name(mount), storage.elapsed_ms());
        }
    }

    auto* probe_fb = static_cast<uint16_t*>(heap_caps_malloc(
        ps_probe::kNativeFramebufferBytes,
        MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (probe_fb == nullptr) {
        ps_probe::emit_phase_result(Phase::RenderFrame, "fail", "probe_framebuffer_alloc", 0);
        return;
    }

    ps_probe::set_framebuffer_policy({"target_800x480", ps_probe::kNativeWidth, ps_probe::kNativeHeight, 1, ps_probe::kRgb565BytesPerPixel});
    ps_probe::run_embedded_sokoban_probe(probe_fb);
    ps_probe::run_embedded_broken_probe();
    ps_probe::run_sd_probe_if_available(probe_fb);
    ps_probe::run_named_sd_probe_if_available("at-the-hedges-of-time.txt", probe_fb);
    ps_probe::run_simulation_corpus_if_available();
    heap_caps_free(probe_fb);
}
