#include "sdkconfig.h"

#if CONFIG_POCKET_CARD_MCP23017_BENCH
#include "mcp23017_bench.hpp"
#elif CONFIG_POCKET_CARD_PLAYER_APP
#include "pocket_player.hpp"
#else
#include "probe_log.hpp"
#include "runtime_probe.hpp"
#endif

extern "C" void app_main(void) {
#if CONFIG_POCKET_CARD_MCP23017_BENCH
    pocket_card::run_mcp23017_bench();
#elif CONFIG_POCKET_CARD_PLAYER_APP
    pocket_card::run_pocket_player();
#else
    pocket_card::probe_log_init();
    const int64_t started = pocket_card::now_ms();
    pocket_card::emit_boot_summary();
    pocket_card::emit_phase(pocket_card::Phase::Boot, "pass", "boot_summary", pocket_card::now_ms() - started);
    pocket_card::run_runtime_probe();
#endif
}
