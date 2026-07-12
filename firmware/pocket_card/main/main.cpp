#include "esp_log.h"
#include "probe_config.hpp"

extern "C" void app_main(void) {
    ESP_LOGI(
        "ps_probe",
        "{\"event\":\"probe_stub\",\"target\":\"esp32s3\",\"board\":\"%s\",\"status\":\"ok\"}",
        pocket_card::kBoardName);
}
