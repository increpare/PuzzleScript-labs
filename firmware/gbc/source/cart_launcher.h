#ifndef PUZZLESCRIPT_GBC_CART_LAUNCHER_H
#define PUZZLESCRIPT_GBC_CART_LAUNCHER_H

#include <stdint.h>

#include "puzzlescript/gbc_cart.h"

#if defined(PS_GBC_FREESTANDING)
#include <gb/gb.h>
#define PS_GBC_CART_LAUNCHER_BANKED BANKED
#else
#define PS_GBC_CART_LAUNCHER_BANKED
#endif

typedef struct ps_gbc_cart_launcher {
    uint8_t selected;
    uint8_t first_visible;
    uint8_t game_count;
} ps_gbc_cart_launcher;

void ps_gbc_cart_launcher_init(
    ps_gbc_cart_launcher* launcher,
    uint8_t game_count) PS_GBC_CART_LAUNCHER_BANKED;
void ps_gbc_cart_launcher_move(
    ps_gbc_cart_launcher* launcher,
    int8_t direction) PS_GBC_CART_LAUNCHER_BANKED;
void ps_gbc_cart_launcher_page(
    ps_gbc_cart_launcher* launcher,
    int8_t direction) PS_GBC_CART_LAUNCHER_BANKED;
uint8_t ps_gbc_cart_launcher_background_pixel(
    const ps_gbc_launcher_card* card,
    uint8_t x,
    uint8_t y) PS_GBC_CART_LAUNCHER_BANKED;
uint8_t ps_gbc_cart_launcher_border_plane(
    uint8_t background_plane,
    bool scroll_plane,
    bool selected,
    bool final_tile) PS_GBC_CART_LAUNCHER_BANKED;
uint16_t ps_gbc_cart_launcher_tile_data_address(
    uint8_t tile,
    bool unsigned_mode) PS_GBC_CART_LAUNCHER_BANKED;
bool ps_gbc_cart_launcher_decode_progress(
    uint16_t saved_level,
    uint8_t level_count,
    bool* completed,
    uint8_t* level) PS_GBC_CART_LAUNCHER_BANKED;
void ps_gbc_cart_launcher_format_progress(
    const ps_gbc_launcher_card* card,
    bool has_save,
    bool completed,
    uint8_t level,
    char output[8]) PS_GBC_CART_LAUNCHER_BANKED;

#endif
