#pragma bank 1

#include <gb/gb.h>

#include "generated_game.h"
#include "tile_cache.h"

#include <string.h>

#define ATTR_TILE_BANK 0x08U
#define SCREEN_TILES (PS_GBC_VIEWPORT_WIDTH * PS_GBC_VIEWPORT_HEIGHT)
#define FULL_RENDER_CACHE_CAPACITY 16U

extern uint8_t gTileMap[SCREEN_TILES];
extern uint8_t gAttributes[SCREEN_TILES];
extern uint8_t gSourcePixels[64];
extern uint8_t gTileBytes[16];
extern uint8_t composeTile(uint32_t objects);
static uint32_t gFullRenderMasks[FULL_RENDER_CACHE_CAPACITY];
static uint8_t gFullRenderAttributes[FULL_RENDER_CACHE_CAPACITY];

#if PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 1U
#define BOARD_OBJECTS(board, cell) (((const uint8_t*)(board))[(cell)])
#elif PS_GBC_GENERATED_OBJECT_BYTES_PER_CELL == 2U
#define BOARD_OBJECTS(board, cell) (((const uint16_t*)(board))[(cell)])
#else
#define BOARD_OBJECTS(board, cell) (((const uint32_t*)(board))[(cell)])
#endif

bool ps_gbc_reuse_matching_tile(
    const void* board,
    const uint8_t* dirty,
    uint16_t cell_count,
    uint16_t current_cell,
    uint16_t screen_cell,
    uint16_t board_height,
    uint8_t offset_x,
    uint8_t offset_y
) BANKED {
    uint16_t candidate;
    const uint32_t current_objects = BOARD_OBJECTS(board, current_cell);
    for (candidate = 0U; candidate < cell_count; ++candidate) {
        if (candidate == current_cell || BOARD_OBJECTS(board, candidate) != current_objects) {
            continue;
        }
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

void ps_gbc_render_full_board(
    const void* board,
    uint16_t board_width,
    uint16_t board_height,
    uint8_t offset_x,
    uint8_t offset_y
) BANKED {
    uint8_t cached = 0U;
    uint8_t screen_y;
    for (screen_y = 0U; screen_y < PS_GBC_VIEWPORT_HEIGHT; ++screen_y) {
        uint8_t screen_x;
        for (screen_x = 0U; screen_x < PS_GBC_VIEWPORT_WIDTH; ++screen_x) {
            const uint16_t screen_cell =
                (uint16_t)screen_y * PS_GBC_VIEWPORT_WIDTH + screen_x;
            uint32_t objects = ps_gbc_generated_game.background_mask;
            uint8_t cache_index = 0U;
            if (screen_x >= offset_x
                && screen_x < (uint8_t)(offset_x + board_width)
                && screen_y >= offset_y
                && screen_y < (uint8_t)(offset_y + board_height)) {
                objects = BOARD_OBJECTS(
                    board,
                    (uint16_t)(screen_x - offset_x) * board_height
                        + (uint16_t)(screen_y - offset_y));
            }
            while (cache_index < cached
                && gFullRenderMasks[cache_index] != objects) {
                ++cache_index;
            }
            if (cache_index < cached) {
                gTileMap[screen_cell] = cache_index;
                gAttributes[screen_cell] = gFullRenderAttributes[cache_index];
            } else {
                const uint16_t tile = cached < FULL_RENDER_CACHE_CAPACITY
                    ? cached : screen_cell;
                ps_gbc_render_cell(screen_cell, tile, objects);
                if (cached < FULL_RENDER_CACHE_CAPACITY) {
                    gFullRenderMasks[cached] = objects;
                    gFullRenderAttributes[cached] = gAttributes[screen_cell];
                    ++cached;
                }
            }
        }
    }
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
