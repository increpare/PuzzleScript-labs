#ifndef PUZZLESCRIPT_GBC_CART_LAUNCHER_H
#define PUZZLESCRIPT_GBC_CART_LAUNCHER_H

#include <stdint.h>

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

#endif
