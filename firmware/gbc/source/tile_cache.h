#ifndef PUZZLESCRIPT_GBC_TILE_CACHE_H
#define PUZZLESCRIPT_GBC_TILE_CACHE_H

#include <gb/gb.h>

#include "puzzlescript/gbc.h"

#define PS_GBC_CACHE_TILE_OFFSET 64U
#define PS_GBC_CACHE_COMPOSITIONS 16U
#define PS_GBC_TILES_PER_CELL 4U
#define PS_GBC_SOURCE_PIXEL_BUFFER_BYTES \
    (25U * PS_GBC_TILES_PER_CELL)
#define PS_GBC_DEDICATED_TILE_OFFSET \
    (PS_GBC_CACHE_TILE_OFFSET \
        + PS_GBC_CACHE_COMPOSITIONS * PS_GBC_TILES_PER_CELL)
#define PS_GBC_BOARD_TILE_LIMIT \
    (PS_GBC_DEDICATED_TILE_OFFSET \
        + PS_GBC_MAX_BOARD_CELLS * PS_GBC_TILES_PER_CELL)

void ps_gbc_render_full_board(
    const void* board,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t offset_x,
    uint8_t offset_y
) BANKED;
void ps_gbc_render_dirty_board(
    const void* board,
    const uint8_t* dirty,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t offset_x,
    uint8_t offset_y
) BANKED;

#endif
