#ifndef PUZZLESCRIPT_GBC_TILE_CACHE_H
#define PUZZLESCRIPT_GBC_TILE_CACHE_H

#include <gb/gb.h>

#include "puzzlescript/gbc.h"

#define PS_GBC_BACKGROUND_TILE_OFFSET 64U
#define PS_GBC_BACKGROUND_PHASE_TILES \
    (PS_GBC_GENERATED_CELL_WIDTH * PS_GBC_GENERATED_CELL_HEIGHT)
#define PS_GBC_BOARD_TILE_OFFSET \
    (PS_GBC_BACKGROUND_TILE_OFFSET + PS_GBC_BACKGROUND_PHASE_TILES)

void ps_gbc_render_full_board(
    const void* board,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t origin_x,
    uint8_t origin_y
) BANKED;
void ps_gbc_render_dirty_board(
    const void* board,
    const uint8_t* dirty,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t origin_x,
    uint8_t origin_y
) BANKED;

#endif
