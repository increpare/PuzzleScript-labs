#include "ps_instrumentation.hpp"

#include <cinttypes>

#include "esp_chip_info.h"
#include "esp_err.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "probe_config.hpp"

namespace ps_probe {
namespace {

constexpr const char* kTag = "ps_probe";
Phase g_active_phase = Phase::Boot;
FramebufferPolicy g_framebuffer_policy{"none", 0, 0, 0, 2};

void append_heap(const char* name, uint32_t caps) {
    multi_heap_info_t info{};
    heap_caps_get_info(&info, caps);
    ESP_LOGI(kTag,
             "{\"event\":\"heap\",\"phase\":\"%s\",\"region\":\"%s\",\"free\":%zu,\"allocated\":%zu,\"largest_free_block\":%zu,\"minimum_free\":%zu,\"allocated_blocks\":%zu,\"free_blocks\":%zu,\"total_blocks\":%zu}",
             phase_name(g_active_phase),
             name,
             info.total_free_bytes,
             info.total_allocated_bytes,
             info.largest_free_block,
             info.minimum_free_bytes,
             info.allocated_blocks,
             info.free_blocks,
             info.total_blocks);
}

void alloc_failed_hook(size_t requested_size, uint32_t caps, const char* function_name) {
    ESP_EARLY_LOGE(kTag,
                   "{\"event\":\"alloc_failed\",\"phase\":\"%s\",\"requested\":%zu,\"caps\":%" PRIu32 ",\"function\":\"%s\"}",
                   phase_name(g_active_phase),
                   requested_size,
                   caps,
                   function_name == nullptr ? "" : function_name);
}

} // namespace

PhaseTimer::PhaseTimer(Phase phase) : phase_(phase), start_us_(esp_timer_get_time()) {
    set_active_phase(phase_);
}

int64_t PhaseTimer::elapsed_ms() const {
    return (esp_timer_get_time() - start_us_) / 1000;
}

const char* phase_name(Phase phase) {
    switch (phase) {
        case Phase::Boot: return "BOOT";
        case Phase::DisplayInit: return "DISPLAY_INIT";
        case Phase::StorageInit: return "STORAGE_INIT";
        case Phase::LoadSourceFlash: return "LOAD_SOURCE_FLASH";
        case Phase::CompileSource: return "COMPILE_SOURCE";
        case Phase::CreateRuntime: return "CREATE_RUNTIME";
        case Phase::LoadLevel: return "LOAD_LEVEL";
        case Phase::RenderFrame: return "RENDER_FRAME";
        case Phase::RunInputTrace: return "RUN_INPUT_TRACE";
        case Phase::UnloadGame: return "UNLOAD_GAME";
        case Phase::LoadSourceSd: return "LOAD_SOURCE_SD";
    }
    return "UNKNOWN";
}

void instrumentation_init() {
    heap_caps_register_failed_alloc_callback(alloc_failed_hook);
}

void set_active_phase(Phase phase) {
    g_active_phase = phase;
}

void set_framebuffer_policy(const FramebufferPolicy& policy) {
    g_framebuffer_policy = policy;
}

void emit_phase_result(Phase phase, const char* status, const char* detail, int64_t elapsed_ms) {
    set_active_phase(phase);
    ESP_LOGI(kTag,
             "{\"event\":\"phase\",\"phase\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\",\"elapsed_ms\":%" PRId64 ",\"fb_mode\":\"%s\",\"fb_width\":%d,\"fb_height\":%d,\"fb_count\":%d,\"fb_bpp\":%d}",
             phase_name(phase),
             status == nullptr ? "" : status,
             detail == nullptr ? "" : detail,
             elapsed_ms,
             g_framebuffer_policy.mode == nullptr ? "" : g_framebuffer_policy.mode,
             g_framebuffer_policy.width,
             g_framebuffer_policy.height,
             g_framebuffer_policy.buffer_count,
             g_framebuffer_policy.bytes_per_pixel);
    append_heap("internal", MALLOC_CAP_INTERNAL);
    append_heap("spiram", MALLOC_CAP_SPIRAM);
    append_heap("8bit", MALLOC_CAP_8BIT);
}

void emit_boot_summary() {
    esp_chip_info_t chip{};
    esp_chip_info(&chip);
    uint32_t flash_size = 0;
    const esp_err_t flash_probe = esp_flash_get_size(nullptr, &flash_size);
    ESP_LOGI(kTag,
             "{\"event\":\"boot\",\"cores\":%d,\"revision\":%d,\"flash_bytes\":%" PRIu32 ",\"flash_status\":\"%s\",\"target_width\":%d,\"target_height\":%d,\"idf\":\"%s\",\"reset_reason\":%d}",
             chip.cores,
             chip.revision,
             flash_size,
             flash_probe == ESP_OK ? "ok" : esp_err_to_name(flash_probe),
             kTargetWidth,
             kTargetHeight,
             esp_get_idf_version(),
             static_cast<int>(esp_reset_reason()));
}

} // namespace ps_probe
