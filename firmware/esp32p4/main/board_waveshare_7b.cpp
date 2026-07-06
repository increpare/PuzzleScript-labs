#include "board_waveshare_7b.hpp"

#include "probe_config.hpp"
#include "esp_check.h"
#include "esp_lcd_ek79007.h"
#include "esp_lcd_mipi_dsi.h"
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

} // namespace

esp_err_t init_display() {
    if (g_panel != nullptr) {
        return ESP_OK;
    }

    ESP_LOGI(kTag, "Enable MIPI DSI PHY LDO");
    esp_ldo_channel_config_t ldo_config = {
        .chan_id = kMipiPhyLdoChannel,
        .voltage_mv = kMipiPhyLdoVoltageMv,
    };
    ESP_RETURN_ON_ERROR(esp_ldo_acquire_channel(&ldo_config, &g_mipi_ldo), kTag, "ldo");

    ESP_LOGI(kTag, "Create MIPI DSI bus");
    esp_lcd_dsi_bus_config_t bus_config = EK79007_PANEL_BUS_DSI_2CH_CONFIG();
    ESP_RETURN_ON_ERROR(esp_lcd_new_dsi_bus(&bus_config, &g_dsi_bus), kTag, "dsi_bus");

    ESP_LOGI(kTag, "Create DBI panel IO");
    esp_lcd_dbi_io_config_t dbi_config = EK79007_PANEL_IO_DBI_CONFIG();
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_dbi(g_dsi_bus, &dbi_config, &g_dbi_io), kTag, "dbi_io");

    ESP_LOGI(kTag, "Create EK79007 panel");
    esp_lcd_dpi_panel_config_t dpi_config = EK79007_1024_600_PANEL_60HZ_CONFIG(LCD_COLOR_PIXEL_FORMAT_RGB565);
    ek79007_vendor_config_t vendor_config = {
        .mipi_config = {
            .dsi_bus = g_dsi_bus,
            .dpi_config = &dpi_config,
            .lane_num = kMipiDsiLaneCount,
        },
    };
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = kPanelResetGpio,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor_config,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_ek79007(g_dbi_io, &panel_config, &g_panel), kTag, "panel");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(g_panel), kTag, "panel_reset");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(g_panel), kTag, "panel_init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(g_panel, true), kTag, "panel_on");
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
    if (g_panel == nullptr || pixels == nullptr || width <= 0 || height <= 0) {
        return ESP_ERR_INVALID_ARG;
    }
    return esp_lcd_panel_draw_bitmap(g_panel, x0, y0, x0 + width, y0 + height, pixels);
}

} // namespace ps_probe::board
