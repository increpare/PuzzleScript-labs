#include "mcp23017.hpp"

#include "board_pins.hpp"

#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"

namespace pocket_card {
namespace {

constexpr const char* kTag = "mcp23017";
constexpr uint8_t kRegGpioA = 0x12;
constexpr uint8_t kRegGpioB = 0x13;

i2c_master_bus_handle_t g_bus = nullptr;
i2c_master_dev_handle_t g_dev = nullptr;
uint8_t g_addr = kMcp23017AddrDefault;
bool g_ready = false;

bool probe_address(uint8_t addr) {
    return i2c_master_probe(g_bus, addr, 200) == ESP_OK;
}

esp_err_t write_reg(uint8_t reg, uint8_t value) {
    const uint8_t payload[2] = {reg, value};
    return i2c_master_transmit(g_dev, payload, sizeof(payload), 1000);
}

esp_err_t read_reg(uint8_t reg, uint8_t* value) {
    return i2c_master_transmit_receive(g_dev, &reg, 1, value, 1, 1000);
}

esp_err_t configure_device() {
    ESP_RETURN_ON_ERROR(write_reg(0x00, 0xFF), kTag, "IODIRA");
    ESP_RETURN_ON_ERROR(write_reg(0x01, 0xFF), kTag, "IODIRB");
    ESP_RETURN_ON_ERROR(write_reg(0x0C, 0xFF), kTag, "GPPUA");
    return write_reg(0x0D, 0xFF);
}

} // namespace

esp_err_t mcp23017_init() {
    if (g_ready) {
        return ESP_OK;
    }

    if (g_bus == nullptr) {
        const i2c_master_bus_config_t bus_config = {
            .i2c_port = I2C_NUM_0,
            .sda_io_num = kI2cSda,
            .scl_io_num = kI2cScl,
            .clk_source = I2C_CLK_SRC_DEFAULT,
            .glitch_ignore_cnt = 7,
            .intr_priority = 0,
            .trans_queue_depth = 0,
            .flags =
                {
                    .enable_internal_pullup = 1,
                },
        };
        ESP_RETURN_ON_ERROR(i2c_new_master_bus(&bus_config, &g_bus), kTag, "i2c bus");
    }

    for (uint8_t addr = kMcp23017AddrMin; addr <= kMcp23017AddrMax; ++addr) {
        if (!probe_address(addr)) {
            continue;
        }
        g_addr = addr;
        break;
    }
    if (g_addr < kMcp23017AddrMin || g_addr > kMcp23017AddrMax || !probe_address(g_addr)) {
        ESP_LOGE(kTag, "MCP23017 not found on I2C bus");
        return ESP_ERR_NOT_FOUND;
    }
    if (g_addr != kMcp23017AddrDefault) {
        ESP_LOGW(kTag, "MCP23017 at 0x%02X (expected 0x20)", g_addr);
    }

    if (g_dev != nullptr) {
        (void)i2c_master_bus_rm_device(g_dev);
        g_dev = nullptr;
    }

    const i2c_device_config_t dev_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = g_addr,
        .scl_speed_hz = 400000,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(g_bus, &dev_config, &g_dev), kTag, "add device");
    ESP_RETURN_ON_ERROR(configure_device(), kTag, "configure");
    g_ready = true;
    ESP_LOGI(kTag, "ready at 0x%02X", g_addr);
    return ESP_OK;
}

uint8_t mcp23017_address() {
    return g_addr;
}

esp_err_t mcp23017_read_gpio(Mcp23017GpioSnapshot* snapshot) {
    if (!g_ready || snapshot == nullptr) {
        return ESP_ERR_INVALID_STATE;
    }
    ESP_RETURN_ON_ERROR(read_reg(kRegGpioA, &snapshot->gpio_a), kTag, "read A");
    return read_reg(kRegGpioB, &snapshot->gpio_b);
}

} // namespace pocket_card
