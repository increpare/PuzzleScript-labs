#include "board_waveshare_7b.hpp"

#include "probe_config.hpp"
#include "esp_lcd_ek79007.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_ldo_regulator.h"
#include "esp_log.h"

namespace ps_probe::board {
namespace {

constexpr const char* kTag = "board_7b";
constexpr int kPanelResetGpio = 33;
constexpr int kMipiDsiLaneCount = 2;
constexpr int kMipiPhyLdoChannel = 3;
constexpr int kMipiPhyLdoVoltageMv = 2500;

esp_ldo_channel_handle_t g_mipi_ldo = nullptr;
esp_lcd_dsi_bus_handle_t g_dsi_bus = nullptr;
esp_lcd_panel_io_handle_t g_dbi_io = nullptr;
esp_lcd_panel_handle_t g_panel = nullptr;
bool g_display_initialized = false;

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

    ESP_LOGI(kTag, "Enable MIPI DSI PHY LDO");
    esp_ldo_channel_config_t ldo_config = {
        .chan_id = kMipiPhyLdoChannel,
        .voltage_mv = kMipiPhyLdoVoltageMv,
    };
    esp_err_t err = esp_ldo_acquire_channel(&ldo_config, &g_mipi_ldo);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }

    ESP_LOGI(kTag, "Create MIPI DSI bus");
    esp_lcd_dsi_bus_config_t bus_config = {
        .bus_id = 0,
        .num_data_lanes = 2,
        .phy_clk_src = static_cast<mipi_dsi_phy_pllref_clock_source_t>(0),
        .lane_bit_rate_mbps = 900,
    };
    err = esp_lcd_new_dsi_bus(&bus_config, &g_dsi_bus);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }

    ESP_LOGI(kTag, "Create DBI panel IO");
    esp_lcd_dbi_io_config_t dbi_config = EK79007_PANEL_IO_DBI_CONFIG();
    err = esp_lcd_new_panel_io_dbi(g_dsi_bus, &dbi_config, &g_dbi_io);
    if (err != ESP_OK) {
        return cleanup_display_after_error(err);
    }

    ESP_LOGI(kTag, "Create EK79007 panel");
    esp_lcd_dpi_panel_config_t dpi_config = EK79007_1024_600_PANEL_60HZ_CONFIG_CF(LCD_COLOR_FMT_RGB565);
    ek79007_vendor_config_t vendor_config = {
        .mipi_config = {
            .dsi_bus = g_dsi_bus,
            .dpi_config = &dpi_config,
            .lane_num = kMipiDsiLaneCount,
        },
    };
    const esp_lcd_panel_dev_config_t panel_config = {
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .data_endian = LCD_RGB_DATA_ENDIAN_BIG,
        .bits_per_pixel = 16,
        .reset_gpio_num = static_cast<gpio_num_t>(kPanelResetGpio),
        .vendor_config = &vendor_config,
    };
    err = esp_lcd_new_panel_ek79007(g_dbi_io, &panel_config, &g_panel);
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
    g_display_initialized = true;
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
