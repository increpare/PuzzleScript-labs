#include "probe_log.hpp"

extern "C" void app_main(void) {
    pocket_card::probe_log_init();
    const int64_t started = pocket_card::now_ms();
    pocket_card::emit_boot_summary();
    pocket_card::emit_phase(pocket_card::Phase::Boot, "pass", "boot_summary", pocket_card::now_ms() - started);
}
