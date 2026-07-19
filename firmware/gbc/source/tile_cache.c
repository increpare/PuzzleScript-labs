#pragma bank 1

#include <gb/gb.h>

#include "tile_cache.h"

#include <string.h>

#define ATTR_TILE_BANK 0x08U
#define SCREEN_TILES (PS_GBC_VIEWPORT_WIDTH * PS_GBC_VIEWPORT_HEIGHT)

extern uint8_t gTileMap[SCREEN_TILES];
extern uint8_t gAttributes[SCREEN_TILES];
extern uint8_t gSourcePixels[64];
extern uint8_t gTileBytes[16];
extern uint8_t composeTile(uint32_t objects);

bool ps_gbc_reuse_matching_tile(
    const uint32_t* board,
    const uint8_t* dirty,
    uint16_t cell_count,
    uint16_t current_cell,
    uint16_t screen_cell,
    uint16_t board_height,
    uint8_t offset_x,
    uint8_t offset_y
) BANKED {
    uint16_t candidate;
    for (candidate = 0U; candidate < cell_count; ++candidate) {
        if (candidate == current_cell || board[candidate] != board[current_cell]) continue;
        if (candidate < current_cell
            || (dirty[candidate >> 3U]
                & (uint8_t)(1U << (candidate & 7U))) == 0U) {
            const uint16_t candidate_x = (uint16_t)(candidate / board_height);
            const uint16_t candidate_y = (uint16_t)(candidate % board_height);
            const uint16_t source_cell = (uint16_t)(
                (uint16_t)(candidate_y + offset_y) * PS_GBC_VIEWPORT_WIDTH
                + (uint16_t)(candidate_x + offset_x));
            gTileMap[screen_cell] = gTileMap[source_cell];
            gAttributes[screen_cell] = gAttributes[source_cell];
            return true;
        }
    }
    return false;
}

uint16_t ps_gbc_find_free_tile(uint16_t screen_cell) BANKED {
    uint16_t cell;
    uint16_t tile;
    memset(gSourcePixels, 0, (SCREEN_TILES + 7U) / 8U);
    for (cell = 0U; cell < SCREEN_TILES; ++cell) {
        if (cell == screen_cell) continue;
        tile = (uint16_t)gTileMap[cell]
            | ((gAttributes[cell] & ATTR_TILE_BANK) != 0U ? 256U : 0U);
        gSourcePixels[tile >> 3U] |= (uint8_t)(1U << (tile & 7U));
    }
    for (tile = 0U; tile < SCREEN_TILES; ++tile) {
        if ((gSourcePixels[tile >> 3U] & (uint8_t)(1U << (tile & 7U))) == 0U) {
            return tile;
        }
    }
    return screen_cell;
}

void ps_gbc_render_cell(uint16_t screen_cell, uint16_t tile, uint32_t objects) BANKED {
    const uint8_t palette = composeTile(objects);
    const uint8_t tile_bank = (uint8_t)(tile >> 8U);
    VBK_REG = tile_bank;
    set_bkg_data((uint8_t)tile, 1U, gTileBytes);
    gTileMap[screen_cell] = (uint8_t)tile;
    gAttributes[screen_cell] =
        (uint8_t)(palette | (tile_bank != 0U ? ATTR_TILE_BANK : 0U));
}
