#include "board_p4_nano.hpp"

#include "board_i2c.hpp"
#include "probe_config.hpp"

#include "driver/i2c_master.h"
#include "esp_lcd_dsi.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_ldo_regulator.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace ps_probe::board {
namespace {

constexpr const char* kTag = "board_p4_nano";
constexpr int kMipiDsiLaneCount = 2;
constexpr int kMipiPhyLdoChannel = 3;
constexpr int kMipiPhyLdoVoltageMv = 2500;
constexpr int kPanelBacklightI2cAddr = 0x45;
constexpr int kMipiLaneBitrateMbps = 500;

// Waveshare 4.3-DSI-TOUCH-A (ST7701S) — esp32_p4_platform BSP values.
constexpr int kHSize = 480;
constexpr int kVSize = 800;
constexpr float kDpiClockMhz = 30.0f;

static const dsi_lcd_init_cmd_t kPanelInitCmds[] = {
    {0xFF, (uint8_t[]){0x77, 0x01, 0x00, 0x00, 0x13}, 5, 0},
    {0xEF, (uint8_t[]){0x08}, 1, 0},
    {0xFF, (uint8_t[]){0x77, 0x01, 0x00, 0x00, 0x10}, 5, 0},
    {0xC0, (uint8_t[]){0x63, 0x00}, 2, 0},
    {0xC1, (uint8_t[]){0x0D, 0x02}, 2, 0},
    {0xC2, (uint8_t[]){0x17, 0x08}, 2, 0},
    {0xCC, (uint8_t[]){0x10}, 1, 0},
    {0xB0, (uint8_t[]){0x40, 0xC9, 0x94, 0x0E, 0x10, 0x05, 0x0B, 0x09, 0x08, 0x26, 0x04, 0x52, 0x10, 0x69, 0x6B, 0x69}, 16, 0},
    {0xB1, (uint8_t[]){0x40, 0xD2, 0x98, 0x0C, 0x92, 0x07, 0x09, 0x08, 0x07, 0x25, 0x02, 0x0E, 0x0C, 0x6E, 0x78, 0x55}, 16, 0},
    {0xFF, (uint8_t[]){0x77, 0x01, 0x00, 0x00, 0x11}, 5, 0},
    {0xB0, (uint8_t[]){0x5D}, 1, 0},
    {0xB1, (uint8_t[]){0x4E}, 1, 0},
    {0xB2, (uint8_t[]){0x87}, 1, 0},
    {0xB3, (uint8_t[]){0x80}, 1, 0},
    {0xB5, (uint8_t[]){0x4E}, 1, 0},
    {0xB7, (uint8_t[]){0x85}, 1, 0},
    {0xB8, (uint8_t[]){0x21}, 1, 0},
    {0xB9, (uint8_t[]){0x10, 0x1F}, 2, 0},
    {0xBB, (uint8_t[]){0x03}, 1, 0},
    {0xBC, (uint8_t[]){0x00}, 1, 0},
    {0xC1, (uint8_t[]){0x78}, 1, 0},
    {0xC2, (uint8_t[]){0x78}, 1, 0},
    {0xD0, (uint8_t[]){0x88}, 1, 0},
    {0xE0, (uint8_t[]){0x00, 0x3A, 0x02}, 3, 0},
    {0xE1, (uint8_t[]){0x04, 0xA0, 0x00, 0xA0, 0x05, 0xA0, 0x00, 0xA0, 0x00, 0x40, 0x40}, 11, 0},
    {0xE2, (uint8_t[]){0x30, 0x00, 0x40, 0x40, 0x32, 0xA0, 0x00, 0xA0, 0x00, 0xA0, 0x00, 0xA0, 0x00}, 13, 0},
    {0xE3, (uint8_t[]){0x00, 0x00, 0x33, 0x33}, 4, 0},
    {0xE4, (uint8_t[]){0x44, 0x44}, 2, 0},
    {0xE5, (uint8_t[]){0x09, 0x2E, 0xA0, 0xA0, 0x0B, 0x30, 0xA0, 0xA0, 0x05, 0x2A, 0xA0, 0xA0, 0x07, 0x2C, 0xA0, 0xA0}, 16, 0},
    {0xE6, (uint8_t[]){0x00, 0x00, 0x33, 0x33}, 4, 0},
    {0xE7, (uint8_t[]){0x44, 0x44}, 2, 0},
    {0xE8, (uint8_t[]){0x08, 0x2D, 0xA0, 0xA0, 0x0A, 0x2F, 0xA0, 0xA0, 0x04, 0x29, 0xA0, 0xA0, 0x06, 0x2B, 0xA0, 0xA0}, 16, 0},
    {0xEB, (uint8_t[]){0x00, 0x00, 0x4E, 0x4E, 0x00, 0x00, 0x00}, 7, 0},
    {0xEC, (uint8_t[]){0x08, 0x01}, 2, 0},
    {0xED, (uint8_t[]){0xB0, 0x2B, 0x98, 0xA4, 0x56, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xF7, 0x65, 0x4A, 0x89, 0xB2, 0x0B}, 16, 0},
    {0xEF, (uint8_t[]){0x08, 0x08, 0x08, 0x45, 0x3F, 0x54}, 6, 0},
    {0xFF, (uint8_t[]){0x77, 0x01, 0x00, 0x00, 0x00}, 5, 0},
    {0x11, (uint8_t[]){0x00}, 0, 120},
    {0x29, (uint8_t[]){0x00}, 0, 0},
};

esp_ldo_channel_handle_t g_mipi_ldo = nullptr;
esp_lcd_dsi_bus_handle_t g_dsi_bus = nullptr;
esp_lcd_panel_io_handle_t g_dbi_io = nullptr;
esp_lcd_panel_handle_t g_panel = nullptr;
bool g_display_initialized = false;

esp_err_t write_backlight_bytes(const uint8_t* payload, size_t len) {
    esp_err_t err = init_i2c();
    if (err != ESP_OK) {
        return err;
    }

    i2c_master_dev_handle_t dev = nullptr;
    i2c_device_config_t dev_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = kPanelBacklightI2cAddr,
        .scl_speed_hz = 100000,
    };
    err = i2c_master_bus_add_device(i2c_bus(), &dev_config, &dev);
    if (err != ESP_OK) {
        return err;
    }

    err = i2c_master_transmit(dev, payload, len, 1000);
    (void)i2c_master_bus_rm_device(dev);
    return err;
}

esp_err_t init_panel_backlight() {
    bool any_ok = false;

    static const uint8_t kWaveshareSequence[][2] = {
        {0x95, 0x11},
        {0x95, 0x17},
        {0x96, 0x00},
        {0x96, 0xFF},
    };
    for (const auto& step : kWaveshareSequence) {
        const esp_err_t err = write_backlight_bytes(step, sizeof(step));
        if (err == ESP_OK) {
            any_ok = true;
        } else {
            ESP_LOGW(kTag, "backlight Waveshare write 0x%02X=0x%02X failed: %s",
                     step[0], step[1], esp_err_to_name(err));
        }
    }

    static const uint8_t kRpiSequence[][2] = {
        {0xC0, 0x01},
        {0xC2, 0x01},
        {0xAC, 0x01},
        {0xAB, 0x00},
        {0xAA, 0x01},
        {0xAD, 0x02},
        {0xAB, 0x00},
        {0x96, 0xFF},
    };
    for (const auto& step : kRpiSequence) {
        const esp_err_t err = write_backlight_bytes(step, sizeof(step));
        if (err == ESP_OK) {
            any_ok = true;
        }
    }

    if (!any_ok) {
        ESP_LOGW(kTag, "panel backlight I2C had no successful writes; continuing display init");
    } else {
        ESP_LOGI(kTag, "panel backlight init done via I2C 0x%02X", kPanelBacklightI2cAddr);
    }
    return ESP_OK;
}

void cleanup_display() {
    if (g_panel != nullptr) {
        esp_lcd_panel_del(g_panel);
        g_panel = nullptr;
    }
    if (g_dbi_io != nullptr) {
        esp_lcd_panel_io_del(g_dbi_io);
        g_dbi_io = nullptr;
    }
    if (g_dsi_bus != nullptr) {
        esp_lcd_del_dsi_bus(g_dsi_bus);
        g_dsi_bus = nullptr;
    }
    if (g_mipi_ldo != nullptr) {
        esp_ldo_release_channel(g_mipi_ldo);
        g_mipi_ldo = nullptr;
    }
    g_display_initialized = false;
}

esp_err_t cleanup_display_after_error(esp_err_t err) {
    cleanup_display();
    return err;
}

} // namespace

esp_err_t init_display() {
    if (g_display_initialized) {
        return ESP_OK;
    }

    esp_err_t err = init_i2c();
    if (err != ESP_OK) {
        return err;
    }

    err = init_panel_backlight();
    if (err != ESP_OK) {
        return err;
    }

    ESP_LOGI(kTag, "Enable MIPI DSI PHY LDO");
    esp_ldo_channel_config_t ldo_config = {
        .chan_id = kMipiPhyLdoChannel,
        .voltage_mv = kMipiPhyLdoVoltageMv,
    };
    err = esp_ldo_acquire_channel(&ldo_config, &g_mipi_ldo);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }

    ESP_LOGI(kTag, "Create MIPI DSI bus (%d Mbps, %d lanes)", kMipiLaneBitrateMbps, kMipiDsiLaneCount);
    esp_lcd_dsi_bus_config_t bus_config = {
        .bus_id = 0,
        .num_data_lanes = kMipiDsiLaneCount,
        .phy_clk_src = static_cast<mipi_dsi_phy_pllref_clock_source_t>(0),
        .lane_bit_rate_mbps = kMipiLaneBitrateMbps,
    };
    err = esp_lcd_new_dsi_bus(&bus_config, &g_dsi_bus);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }

    ESP_LOGI(kTag, "Create DBI panel IO");
    esp_lcd_dbi_io_config_t dbi_config = {
        .virtual_channel = 0,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    err = esp_lcd_new_panel_io_dbi(g_dsi_bus, &dbi_config, &g_dbi_io);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }

    ESP_LOGI(kTag, "Create Waveshare 4.3\" DSI panel (%dx%d)", kHSize, kVSize);
    esp_lcd_dpi_panel_config_t dpi_config = {
        .virtual_channel = 0,
        .dpi_clk_src = MIPI_DSI_DPI_CLK_SRC_DEFAULT,
        .dpi_clock_freq_mhz = kDpiClockMhz,
        .in_color_format = LCD_COLOR_FMT_RGB565,
        .out_color_format = LCD_COLOR_FMT_RGB565,
        .num_fbs = 1,
        .video_timing = {
            .h_size = static_cast<uint32_t>(kHSize),
            .v_size = static_cast<uint32_t>(kVSize),
            .hsync_pulse_width = 12,
            .hsync_back_porch = 42,
            .hsync_front_porch = 42,
            .vsync_pulse_width = 8,
            .vsync_back_porch = 2,
            .vsync_front_porch = 60,
        },
    };

    dsi_vendor_config_t vendor_config = {
        .init_cmds = nullptr,
        .init_cmds_size = 0,
        .mipi_config = {
            .dsi_bus = g_dsi_bus,
            .dpi_config = &dpi_config,
        },
    };
    const esp_lcd_panel_dev_config_t panel_config = {
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .data_endian = LCD_RGB_DATA_ENDIAN_BIG,
        .bits_per_pixel = 16,
        .reset_gpio_num = GPIO_NUM_NC,
        .vendor_config = &vendor_config,
    };
    err = esp_lcd_new_panel_dsi(g_dbi_io, &panel_config, &g_panel);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }

    err = esp_lcd_panel_reset(g_panel);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }
    err = esp_lcd_panel_init(g_panel);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }
    err = esp_lcd_panel_disp_on_off(g_panel, true);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }

    err = esp_lcd_dpi_panel_set_pattern(g_panel, MIPI_DSI_PATTERN_BAR_VERTICAL);
    if (err != ESP_OK) {
        ESP_LOGW(kTag, "hardware color-bar pattern failed: %s", esp_err_to_name(err));
    } else {
        ESP_LOGI(kTag, "hardware color-bar pattern active");
    }

    g_display_initialized = true;
    ESP_LOGI(kTag, "Display ready (%dx%d RGB565)", kHSize, kVSize);
    return ESP_OK;
}

esp_err_t show_hardware_pattern() {
    if (g_panel == nullptr) {
        return ESP_ERR_INVALID_STATE;
    }
    return esp_lcd_dpi_panel_set_pattern(g_panel, MIPI_DSI_PATTERN_BAR_VERTICAL);
}

esp_err_t clear_hardware_pattern() {
    if (g_panel == nullptr) {
        return ESP_ERR_INVALID_STATE;
    }
    return esp_lcd_dpi_panel_set_pattern(g_panel, MIPI_DSI_PATTERN_NONE);
}

esp_err_t draw_rgb565(const uint16_t* pixels, int x0, int y0, int width, int height) {
    if (!g_display_initialized) {
        return ESP_ERR_INVALID_STATE;
    }
    if (pixels == nullptr || width <= 0 || height <= 0) {
        return ESP_ERR_INVALID_ARG;
    }
    return esp_lcd_panel_draw_bitmap(g_panel, x0, y0, x0 + width, y0 + height, pixels);
}

} // namespace ps_probe::board
