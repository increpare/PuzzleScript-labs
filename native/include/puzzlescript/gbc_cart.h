#pragma once

#include "puzzlescript/gbc_descriptor.h"

#include <stdint.h>

#define PS_GBC_CART_TITLE_CAPACITY 32U
#define PS_GBC_CART_PAGE_SIZE 8U

typedef struct ps_gbc_cart_entry {
    uint8_t descriptor_bank;
    const ps_gbc_game_descriptor* descriptor;
    uint32_t source_hash;
    char title[PS_GBC_CART_TITLE_CAPACITY];
} ps_gbc_cart_entry;
