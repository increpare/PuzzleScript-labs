#include <cinttypes>

#include "esp_chip_info.h"
#include "esp_err.h"
#include "esp_flash.h"
#include "esp_log.h"
#include "esp_system.h"
#include "probe_config.hpp"

namespace {
constexpr const char* kTag = "ps_probe";

void log_boot_probe() {
    esp_chip_info_t chip{};
    esp_chip_info(&chip);
    uint32_t flash_size = 0;
    const esp_err_t flash_probe = esp_flash_get_size(nullptr, &flash_size);
    ESP_LOGI(kTag,
             "{\"event\":\"boot\",\"cores\":%d,\"revision\":%d,\"flash_bytes\":%" PRIu32 ",\"flash_status\":\"%s\",\"target_width\":%d,\"target_height\":%d}",
             chip.cores,
             chip.revision,
             flash_size,
             flash_probe == ESP_OK ? "ok" : esp_err_to_name(flash_probe),
             ps_probe::kTargetWidth,
             ps_probe::kTargetHeight);
}
} // namespace

extern "C" void app_main(void) {
    log_boot_probe();
    ESP_LOGI(kTag, "{\"event\":\"probe_stub\",\"status\":\"ok\"}");
}
