#include "board_waveshare_7b.hpp"
#include "probe_config.hpp"
#include "ps_framebuffer.hpp"
#include "ps_instrumentation.hpp"

#include "esp_err.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

using ps_probe::Phase;
using ps_probe::PhaseTimer;

extern "C" void app_main(void) {
    ps_probe::instrumentation_init();

    {
        PhaseTimer boot(Phase::Boot);
        ps_probe::emit_boot_summary();
        ps_probe::emit_phase_result(Phase::Boot, "pass", "boot_summary", boot.elapsed_ms());
    }

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
}
