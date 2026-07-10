#include "board_touch.hpp"

#include "board_i2c.hpp"
#include "esp_lcd_touch.h"
#include "esp_lcd_touch_gt911.h"
#include "esp_log.h"
#include "driver/gpio.h"

namespace ps_probe::board {
namespace {

constexpr const char* kTag = "board_touch";
constexpr int kTouchWidth = 1024;
constexpr int kTouchHeight = 600;

esp_lcd_touch_handle_t g_touch = nullptr;
bool g_touch_initialized = false;

} // namespace

esp_err_t init_touch() {
    if (g_touch_initialized) {
        return ESP_OK;
    }

    esp_err_t err = init_i2c();
    if (err != ESP_OK) {
        return err;
    }

    esp_lcd_panel_io_handle_t io_handle = nullptr;
    esp_lcd_panel_io_i2c_config_t io_config = {
        .dev_addr = ESP_LCD_TOUCH_IO_I2C_GT911_ADDRESS,
        .scl_speed_hz = 100000,
        .control_phase_bytes = 1,
        .dc_bit_offset = 0,
        .lcd_cmd_bits = 16,
        .flags = {
            .disable_control_phase = 1,
        },
    };
    err = esp_lcd_new_panel_io_i2c(i2c_bus(), &io_config, &io_handle);
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "esp_lcd_new_panel_io_i2c failed: %s", esp_err_to_name(err));
        return err;
    }

    esp_lcd_touch_io_gt911_config_t gt911_config = {
        .dev_addr = static_cast<uint8_t>(io_config.dev_addr),
    };
    esp_lcd_touch_config_t touch_config = {
        .x_max = kTouchWidth,
        .y_max = kTouchHeight,
        .rst_gpio_num = GPIO_NUM_NC,
        .int_gpio_num = GPIO_NUM_NC,
        .levels = {
            .reset = 0,
            .interrupt = 0,
        },
        .flags = {
            .swap_xy = 0,
            .mirror_x = 0,
            .mirror_y = 0,
        },
        .process_coordinates = nullptr,
        .interrupt_callback = nullptr,
        .user_data = nullptr,
        .driver_data = &gt911_config,
    };

    err = esp_lcd_touch_new_i2c_gt911(io_handle, &touch_config, &g_touch);
    if (err != ESP_OK) {
        ESP_LOGE(kTag, "esp_lcd_touch_new_i2c_gt911 failed: %s", esp_err_to_name(err));
        return err;
    }

    g_touch_initialized = true;
    ESP_LOGI(kTag, "GT911 touch ready (%dx%d)", kTouchWidth, kTouchHeight);
    return ESP_OK;
}

bool poll_touch(int& out_x, int& out_y, int& out_touch_count) {
    out_x = 0;
    out_y = 0;
    out_touch_count = 0;
    if (!g_touch_initialized || g_touch == nullptr) {
        return false;
    }
    if (esp_lcd_touch_read_data(g_touch) != ESP_OK) {
        return false;
    }

    esp_lcd_touch_point_data_t points[2] = {};
    uint8_t touch_count = 0;
    if (esp_lcd_touch_get_data(g_touch, points, &touch_count, 2) != ESP_OK) {
        return false;
    }
    if (touch_count == 0) {
        return true;
    }

    out_touch_count = static_cast<int>(touch_count);
    out_x = (kTouchWidth - 1) - static_cast<int>(points[0].x);
    out_y = (kTouchHeight - 1) - static_cast<int>(points[0].y);
    return true;
}

} // namespace ps_probe::board
