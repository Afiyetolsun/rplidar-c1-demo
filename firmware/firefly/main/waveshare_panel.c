#include "waveshare_panel.h"
#include "radar-ui.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_st7789.h"

static esp_lcd_panel_handle_t panel;

void waveshare_display_init(void) {
    gpio_config_t backlight = {.pin_bit_mask = 1ULL << 46, .mode = GPIO_MODE_OUTPUT};
    ESP_ERROR_CHECK(gpio_config(&backlight));
    gpio_set_level(46, 1);
    spi_bus_config_t bus = {
        .mosi_io_num = 45, .miso_io_num = -1, .sclk_io_num = 40,
        .quadwp_io_num = -1, .quadhd_io_num = -1,
        .max_transfer_sz = RADAR_WIDTH * 20 * (int)sizeof(uint16_t)
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));
    esp_lcd_panel_io_handle_t io = NULL;
    esp_lcd_panel_io_spi_config_t io_config = {
        .cs_gpio_num = 42, .dc_gpio_num = 41, .spi_mode = 0, .pclk_hz = 40 * 1000 * 1000,
        .trans_queue_depth = 4, .lcd_cmd_bits = 8, .lcd_param_bits = 8
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI2_HOST, &io_config, &io));
    esp_lcd_panel_dev_config_t config = {
        .reset_gpio_num = 39, .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .data_endian = LCD_RGB_DATA_ENDIAN_LITTLE, .bits_per_pixel = 16
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7789(io, &config, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, true));
    // The 172-wide glass sits inside the ST7789's 240-wide memory, 34 columns in.
    ESP_ERROR_CHECK(esp_lcd_panel_set_gap(panel, 34, 0));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));
}

void waveshare_display_present(void) {
    for (int y = 0; y < RADAR_HEIGHT; y += 20) {
        int rows = RADAR_HEIGHT - y;
        if (rows > 20) rows = 20;
        ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(panel, 0, y, RADAR_WIDTH, y + rows, radar_pixels + y * RADAR_WIDTH));
    }
}
