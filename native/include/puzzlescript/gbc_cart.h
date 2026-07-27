#pragma once

#include "puzzlescript/gbc_descriptor.h"

#include <stdint.h>

#define PS_GBC_CART_TITLE_CAPACITY 32U
#define PS_GBC_CART_PAGE_SIZE 8U
#define PS_GBC_CART_LEVEL_BITMAP_BYTES 32U
#define PS_GBC_CART_SAVE_COMPLETED 0x8000U

typedef struct ps_gbc_cart_entry {
    uint8_t descriptor_bank;
    const ps_gbc_game_descriptor* descriptor;
    uint32_t source_hash;
    char title[PS_GBC_CART_TITLE_CAPACITY];
} ps_gbc_cart_entry;

typedef struct ps_gbc_launcher_card {
    char title[PS_GBC_CART_TITLE_CAPACITY];
    uint16_t palette[4];
    uint8_t background_tile_2bpp[16];
    uint8_t player_pixels[64];
    uint8_t level_count;
    uint8_t board_level_count;
    uint8_t level_is_board_bits[PS_GBC_CART_LEVEL_BITMAP_BYTES];
    bool detail_colors_reduced;
} ps_gbc_launcher_card;
