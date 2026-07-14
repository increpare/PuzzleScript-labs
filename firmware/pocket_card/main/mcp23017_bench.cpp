#include "mcp23017_bench.hpp"

#include <cstdint>

#include "driver/i2c_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace pocket_card {
namespace {

constexpr const char* kTag = "mcp_bench";

constexpr gpio_num_t kI2cSda = GPIO_NUM_16;
constexpr gpio_num_t kI2cScl = GPIO_NUM_15;
constexpr uint8_t kMcp23017AddrDefault = 0x20;
constexpr uint8_t kMcp23017AddrMin = 0x20;
constexpr uint8_t kMcp23017AddrMax = 0x27;

uint8_t g_mcp_addr = kMcp23017AddrDefault;

constexpr uint8_t kRegGpioA = 0x12;
constexpr uint8_t kRegGpioB = 0x13;

struct ButtonMap {
    const char* name;
    uint8_t port_mask;
    bool port_b;
};

constexpr ButtonMap kButtons[] = {
    {"Up", 0x01, false},
    {"Down", 0x02, false},
    {"Left", 0x04, false},
    {"Right", 0x08, false},
    {"Action", 0x10, false},
    {"Undo", 0x20, false},
    {"Menu", 0x40, false},
    {"Restart", 0x80, false},
    {"VolUp", 0x01, true},
    {"VolDown", 0x02, true},
};

i2c_master_bus_handle_t g_bus = nullptr;
i2c_master_dev_handle_t g_mcp = nullptr;

esp_err_t mcp_write(uint8_t reg, uint8_t value) {
    const uint8_t payload[2] = {reg, value};
    return i2c_master_transmit(g_mcp, payload, sizeof(payload), 1000);
}

esp_err_t mcp_read(uint8_t reg, uint8_t* value) {
    return i2c_master_transmit_receive(g_mcp, &reg, 1, value, 1, 1000);
}

bool probe_address(uint8_t addr) {
    esp_err_t err = i2c_master_probe(g_bus, addr, 200);
    return err == ESP_OK;
}

void scan_i2c_bus() {
    ESP_LOGI(kTag, "I2C scan on SDA=%d SCL=%d:", static_cast<int>(kI2cSda), static_cast<int>(kI2cScl));
    int found = 0;
    for (uint8_t addr = 0x08; addr < 0x78; ++addr) {
        if (!probe_address(addr)) {
            continue;
        }
        ++found;
        const char* label = "?";
        if (addr == 0x18) {
            label = "audio codec";
        } else if (addr == 0x20) {
            label = "MCP23017 controls (A0/A1/A2=GND)";
        } else if (addr >= 0x20 && addr <= 0x27) {
            label = "MCP23017? (check A0/A1/A2 straps)";
        } else if (addr == 0x38) {
            label = "touch";
        }
        ESP_LOGI(kTag, "  found 0x%02X (%s)", addr, label);
    }
    if (found == 0) {
        ESP_LOGE(kTag, "No I2C devices found. Check 3.3V, GND, SDA, SCL.");
    }
}

esp_err_t init_i2c_bus() {
    if (g_bus != nullptr) {
        return ESP_OK;
    }

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

    const esp_err_t err = i2c_new_master_bus(&bus_config, &g_bus);
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "i2c_new_master_bus failed: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t attach_mcp_device() {
    if (g_mcp != nullptr) {
        (void)i2c_master_bus_rm_device(g_mcp);
        g_mcp = nullptr;
    }

    const i2c_device_config_t dev_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = g_mcp_addr,
        .scl_speed_hz = 400000,
    };
    const esp_err_t err = i2c_master_bus_add_device(g_bus, &dev_config, &g_mcp);
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "i2c_master_bus_add_device failed: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t init_mcp23017() {
    esp_err_t err = mcp_write(0x00, 0xFF);
    if (err != ESP_OK) {
        return err;
    }
    err = mcp_write(0x01, 0xFF);
    if (err != ESP_OK) {
        return err;
    }
    err = mcp_write(0x0C, 0xFF);
    if (err != ESP_OK) {
        return err;
    }
    return mcp_write(0x0D, 0xFF);
}

void log_button_changes(uint8_t gpio_a, uint8_t gpio_b, uint8_t& last_a, uint8_t& last_b) {
    if (gpio_a == last_a && gpio_b == last_b) {
        return;
    }

    ESP_LOGI(kTag, "GPIOA=0x%02X GPIOB=0x%02X", gpio_a, gpio_b);
    for (const ButtonMap& button : kButtons) {
        const uint8_t port_value = button.port_b ? gpio_b : gpio_a;
        const bool pressed = (port_value & button.port_mask) == 0;
        const uint8_t last_value = button.port_b ? last_b : last_a;
        const bool was_pressed = (last_value & button.port_mask) == 0;
        if (pressed != was_pressed) {
            ESP_LOGI(kTag, "  %s %s", button.name, pressed ? "PRESSED" : "released");
        }
    }

    last_a = gpio_a;
    last_b = gpio_b;
}

bool find_mcp23017_address() {
    for (uint8_t addr = kMcp23017AddrMin; addr <= kMcp23017AddrMax; ++addr) {
        if (!probe_address(addr)) {
            continue;
        }
        g_mcp_addr = addr;
        if (addr != kMcp23017AddrDefault) {
            ESP_LOGW(
                kTag,
                "MCP23017 responded at 0x%02X (expected 0x20). Tie A0/A1/A2 to GND on the final board.",
                addr);
        }
        return true;
    }
    return false;
}

} // namespace

void run_mcp23017_bench() {
    ESP_LOGI(kTag, "MCP23017 breadboard bench starting (poll mode, no INT GPIO needed)");

    if (init_i2c_bus() != ESP_OK) {
        return;
    }

    scan_i2c_bus();

    if (!find_mcp23017_address()) {
        ESP_LOGE(
            kTag,
            "No MCP23017 found in 0x20-0x27. Check 3.3V/GND/SDA/SCL and address pin wiring.");
        return;
    }

    if (attach_mcp_device() != ESP_OK) {
        return;
    }

    if (init_mcp23017() != ESP_OK) {
        ESP_LOGE(kTag, "Failed to configure MCP23017 registers at 0x%02X", g_mcp_addr);
        return;
    }

    ESP_LOGI(kTag, "MCP23017 ready at 0x%02X. Press buttons; changes print below.", g_mcp_addr);

    uint8_t last_a = 0xFF;
    uint8_t last_b = 0xFF;
    while (true) {
        uint8_t gpio_a = 0xFF;
        uint8_t gpio_b = 0xFF;
        const esp_err_t err_a = mcp_read(kRegGpioA, &gpio_a);
        const esp_err_t err_b = mcp_read(kRegGpioB, &gpio_b);
        if (err_a != ESP_OK || err_b != ESP_OK) {
            ESP_LOGE(
                kTag,
                "Read failed: A=%s B=%s",
                esp_err_to_name(err_a),
                esp_err_to_name(err_b));
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }

        log_button_changes(gpio_a, gpio_b, last_a, last_b);
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

} // namespace pocket_card
