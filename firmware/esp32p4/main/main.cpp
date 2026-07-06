#include "board_waveshare_7b.hpp"
#include "ps_instrumentation.hpp"

#include "esp_err.h"

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
            const esp_err_t pattern = ps_probe::board::show_hardware_pattern();
            if (pattern == ESP_OK) {
                ps_probe::emit_phase_result(Phase::DisplayInit, "pass", "hardware_pattern", display.elapsed_ms());
            } else {
                ps_probe::emit_phase_result(Phase::DisplayInit, "fail", esp_err_to_name(pattern), display.elapsed_ms());
            }
        } else {
            ps_probe::emit_phase_result(Phase::DisplayInit, "fail", esp_err_to_name(init), display.elapsed_ms());
        }
    }
}
