#ifndef PUZZLESCRIPT_GBC_TILE_CACHE_H
#define PUZZLESCRIPT_GBC_TILE_CACHE_H

#include <gb/gb.h>

#include "puzzlescript/gbc.h"

bool ps_gbc_reuse_matching_tile(
    const uint32_t* board,
    const uint8_t* dirty,
    uint16_t cell_count,
    uint16_t current_cell,
    uint16_t screen_cell,
    uint16_t board_height,
    uint8_t offset_x,
    uint8_t offset_y
) BANKED;
uint16_t ps_gbc_find_free_tile(uint16_t screen_cell) BANKED;
void ps_gbc_render_cell(uint16_t screen_cell, uint16_t tile, uint32_t objects) BANKED;

#endif
