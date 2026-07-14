#include "board_display.hpp"

#include "board_pins.hpp"

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_lcd_ili9341.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_check.h"
#include "esp_log.h"

namespace pocket_card::board {
namespace {

constexpr const char* kTag = "board_display";
constexpr int kSpiHost = SPI2_HOST;
constexpr int kPixelClockHz = 40 * 1000 * 1000;

esp_lcd_panel_io_handle_t g_io = nullptr;
esp_lcd_panel_handle_t g_panel = nullptr;
bool g_ready = false;

} // namespace

esp_err_t init_display() {
    if (g_ready) {
        return ESP_OK;
    }

    gpio_config_t backlight_config = {
        .pin_bit_mask = 1ULL << kLcdBacklight,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&backlight_config), kTag, "backlight gpio");
    gpio_set_level(kLcdBacklight, 0);

    spi_bus_config_t bus_config = {
        .mosi_io_num = kLcdMosi,
        .miso_io_num = kLcdMiso,
        .sclk_io_num = kLcdSck,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 320 * 240 * sizeof(uint16_t),
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(static_cast<spi_host_device_t>(kSpiHost), &bus_config, SPI_DMA_CH_AUTO), kTag, "spi bus");

    esp_lcd_panel_io_spi_config_t io_config = {
        .cs_gpio_num = kLcdCs,
        .dc_gpio_num = kLcdDc,
        .spi_mode = 0,
        .pclk_hz = kPixelClockHz,
        .trans_queue_depth = 10,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_RETURN_ON_ERROR(
        esp_lcd_new_panel_io_spi(static_cast<esp_lcd_spi_bus_handle_t>(kSpiHost), &io_config, &g_io),
        kTag,
        "panel io");

    esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = -1,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR,
        .bits_per_pixel = 16,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_ili9341(g_io, &panel_config, &g_panel), kTag, "panel");

    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(g_panel), kTag, "panel reset");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(g_panel), kTag, "panel init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(g_panel, true), kTag, "panel invert");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_mirror(g_panel, true, false), kTag, "panel mirror");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_swap_xy(g_panel, true), kTag, "panel swap");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(g_panel, true), kTag, "panel on");

    set_backlight(true);
    g_ready = true;
    ESP_LOGI(kTag, "ILI9341 ready (320x240 landscape)");
    return ESP_OK;
}

esp_err_t draw_rgb565(const uint16_t* pixels, int x, int y, int width, int height) {
    if (!g_ready || pixels == nullptr) {
        return ESP_ERR_INVALID_STATE;
    }
    return esp_lcd_panel_draw_bitmap(g_panel, x, y, x + width, y + height, pixels);
}

void set_backlight(bool enabled) {
    gpio_set_level(kLcdBacklight, enabled ? 1 : 0);
}

} // namespace pocket_card::board
