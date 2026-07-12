#include "probe_log.hpp"

#include <cinttypes>

#include "esp_chip_info.h"
#include "esp_err.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "probe_config.hpp"

namespace pocket_card {
namespace {

constexpr const char* kTag = "ps_probe";

void emit_heap(Phase phase, const char* region, uint32_t caps) {
    multi_heap_info_t info{};
    heap_caps_get_info(&info, caps);
    ESP_LOGI(
        kTag,
        "{\"event\":\"heap\",\"phase\":\"%s\",\"region\":\"%s\",\"free\":%zu,\"allocated\":%zu,\"largest_free_block\":%zu,\"minimum_free\":%zu}",
        phase_name(phase),
        region,
        info.total_free_bytes,
        info.total_allocated_bytes,
        info.largest_free_block,
        info.minimum_free_bytes);
}

void allocation_failed(size_t requested, uint32_t caps, const char* function_name) {
    ESP_EARLY_LOGE(
        kTag,
        "{\"event\":\"alloc_failed\",\"requested\":%zu,\"caps\":%" PRIu32 ",\"function\":\"%s\"}",
        requested,
        caps,
        function_name != nullptr ? function_name : "?");
}

} // namespace

int64_t now_ms() {
    return esp_timer_get_time() / 1000;
}

const char* phase_name(Phase phase) {
    switch (phase) {
    case Phase::Boot:
        return "BOOT";
    case Phase::LoadIr:
        return "LOAD_IR";
    case Phase::CreateRuntime:
        return "CREATE_RUNTIME";
    case Phase::LoadLevel:
        return "LOAD_LEVEL";
    case Phase::InputTrace:
        return "INPUT_TRACE";
    case Phase::Unload:
        return "UNLOAD";
    }
    return "UNKNOWN";
}

void probe_log_init() {
    const esp_err_t status = heap_caps_register_failed_alloc_callback(allocation_failed);
    if (status != ESP_OK) {
        ESP_LOGE(
            kTag,
            "{\"event\":\"probe_init\",\"status\":\"error\",\"detail\":\"failed_alloc_callback\",\"error\":\"%s\"}",
            esp_err_to_name(status));
    }
}

void emit_boot_summary() {
    esp_chip_info_t chip_info{};
    esp_chip_info(&chip_info);

    uint32_t flash_bytes = 0;
    const esp_err_t flash_status = esp_flash_get_size(nullptr, &flash_bytes);
    ESP_LOGI(
        kTag,
        "{\"event\":\"boot\",\"target\":\"esp32s3\",\"board\":\"%s\",\"cores\":%u,\"revision\":%u,\"flash_bytes\":%" PRIu32 ",\"flash_status\":\"%s\",\"idf\":\"%s\",\"reset_reason\":%d}",
        kBoardName,
        static_cast<unsigned>(chip_info.cores),
        static_cast<unsigned>(chip_info.revision),
        flash_bytes,
        flash_status == ESP_OK ? "ok" : esp_err_to_name(flash_status),
        esp_get_idf_version(),
        static_cast<int>(esp_reset_reason()));
}

void emit_phase(Phase phase, const char* status, const char* detail, int64_t elapsed_ms) {
    ESP_LOGI(
        kTag,
        "{\"event\":\"phase\",\"phase\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\",\"elapsed_ms\":%" PRId64 ",\"fb_mode\":\"none\",\"fb_width\":0,\"fb_height\":0,\"fb_count\":0,\"fb_bpp\":2}",
        phase_name(phase),
        status,
        detail,
        elapsed_ms);
    emit_heap(phase, "internal", MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    emit_heap(phase, "spiram", MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
}

} // namespace pocket_card
