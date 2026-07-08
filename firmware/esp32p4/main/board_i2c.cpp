#include "board_i2c.hpp"

#include "driver/gpio.h"
#include "esp_log.h"

namespace ps_probe::board {
namespace {

constexpr const char* kTag = "board_i2c";
constexpr gpio_num_t kI2cSda = GPIO_NUM_7;
constexpr gpio_num_t kI2cScl = GPIO_NUM_8;

i2c_master_bus_handle_t g_i2c_bus = nullptr;

} // namespace

esp_err_t init_i2c() {
    if (g_i2c_bus != nullptr) {
        return ESP_OK;
    }

    i2c_master_bus_config_t bus_config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = kI2cSda,
        .scl_io_num = kI2cScl,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .intr_priority = 0,
        .trans_queue_depth = 0,
        .flags = {
            .enable_internal_pullup = 1,
        },
    };

    const esp_err_t err = i2c_new_master_bus(&bus_config, &g_i2c_bus);
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "i2c_new_master_bus failed: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(kTag, "I2C bus ready (SDA=%d SCL=%d)", static_cast<int>(kI2cSda), static_cast<int>(kI2cScl));
    return ESP_OK;
}

i2c_master_bus_handle_t i2c_bus() {
    return g_i2c_bus;
}

} // namespace ps_probe::board
