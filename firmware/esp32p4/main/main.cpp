#include "ps_instrumentation.hpp"

using ps_probe::Phase;
using ps_probe::PhaseTimer;

extern "C" void app_main(void) {
    ps_probe::instrumentation_init();
    PhaseTimer boot(Phase::Boot);
    ps_probe::emit_boot_summary();
    ps_probe::emit_phase_result(Phase::Boot, "pass", "boot_summary", boot.elapsed_ms());
}
